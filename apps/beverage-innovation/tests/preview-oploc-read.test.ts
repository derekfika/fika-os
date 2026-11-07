import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { handleBeveragePreviewOplocGet } from "../lib/preview-oploc-read";

const endpoint = "https://beverage-staging.fikacatering.com/api/preview/oplocs";
const audience = "https://staging-os.fikacatering.com/api/internal/beverage/reference";
const person = "fixture.person.session";
const cookieName = "fika_os_session_staging";
const ids = ["oploc:fixture-north", "oploc:fixture-south"];
const sites = [{ id: ids[1], label: "Fictional South" }, { id: ids[0], label: "Fictional North" }];
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev",
  FIKA_BEVERAGE_PREVIEW_ONLY: "1", FIKA_BEVERAGE_PREVIEW_REVIEWER_EMAILS: "fixture-reviewer@example.test",
  FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com", FIKA_BEVERAGE_HUB_OPLOC_READS: "1",
  FIKA_BEVERAGE_HUB_OPLOC_IDS: ids.join(","),
};
const claims = {
  sub: "104628272102873149105", email: "beverage-preview-runtime@fika-os-dev.iam.gserviceaccount.com",
  email_verified: true, iss: "https://accounts.google.com", aud: audience, exp: Math.floor(Date.now() / 1000) + 3600,
};
const jwt = (value = claims) => `fixture.${Buffer.from(JSON.stringify(value)).toString("base64url")}.signature`;

function request(init: { method?: string; headers?: HeadersInit } = {}, url = endpoint) {
  return new NextRequest(url, { headers: { Cookie: `${cookieName}=${person}; unrelated=do-not-forward`, Authorization: "Bearer incoming-do-not-forward" }, ...init });
}

function harness() {
  const events: string[] = [];
  let metadata = () => new Response(jwt(), { headers: { "Metadata-Flavor": "Google" } });
  let hub = () => Response.json({ readOnly: true, oplocs: sites });
  const deps: NonNullable<Parameters<typeof handleBeveragePreviewOplocGet>[1]> = {
    env,
    async verifyPreviewCookie(cookie) {
      events.push("verified");
      assert.equal(cookie, person);
      return { email: "fixture-reviewer@example.test", email_verified: true };
    },
    async fetch(input, init) {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      assert.equal(init?.method, "GET");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      if (url.hostname === "metadata.google.internal") {
        events.push("metadata");
        assert.equal(url.origin, "http://metadata.google.internal");
        assert.equal(url.pathname, "/computeMetadata/v1/instance/service-accounts/default/identity");
        assert.equal(url.searchParams.get("audience"), audience);
        assert.equal(url.searchParams.get("format"), "full");
        assert.deepEqual(Object.fromEntries(headers), { "metadata-flavor": "Google" });
        return metadata();
      }
      events.push("hub");
      assert.equal(`${url.origin}${url.pathname}`, `${audience}/oplocs`);
      assert.deepEqual(url.searchParams.getAll("oploc"), ids);
      assert.deepEqual(Object.fromEntries(headers), {
        accept: "application/json", authorization: `Bearer ${jwt()}`, cookie: `${cookieName}=${person}`,
      });
      return hub();
    },
  };
  return { events, deps, setMetadata: (reader: typeof metadata) => { metadata = reader; }, setHub: (reader: typeof hub) => { hub = reader; } };
}

test("server bridge verifies the FIKA session and forwards only that cookie and the dedicated audience token", async () => {
  const { deps, events } = harness();
  const result = await handleBeveragePreviewOplocGet(request(), deps);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.headers.get("set-cookie"), null);
  assert.deepEqual(await result.json(), { readOnly: true, oplocs: sites });
  assert.deepEqual(events, ["verified", "metadata", "hub"]);
});

test("disabled, wrong-host, cross-site, missing and revoked requests cause no upstream reads", async () => {
  const { deps, events } = harness();
  const off = { ...deps, env: { ...env, FIKA_BEVERAGE_HUB_OPLOC_READS: undefined } };
  assert.equal((await handleBeveragePreviewOplocGet(request(), off)).status, 404);
  assert.equal((await handleBeveragePreviewOplocGet(request({ method: "POST" }), deps)).status, 404);
  assert.equal((await handleBeveragePreviewOplocGet(request({}, endpoint.replace("beverage-staging", "elsewhere")), deps)).status, 404);
  assert.equal((await handleBeveragePreviewOplocGet(request({}, `${endpoint}?oploc=oploc:ungranted`), deps)).status, 400);
  assert.equal((await handleBeveragePreviewOplocGet(request({ headers: { "Sec-Fetch-Site": "cross-site" } }), deps)).status, 403);
  assert.equal((await handleBeveragePreviewOplocGet(request({ headers: {} }), deps)).status, 401);
  assert.equal((await handleBeveragePreviewOplocGet(request(), { ...deps, verifyPreviewCookie: async () => { throw Error("Revoked."); } })).status, 401);
  assert.equal((await handleBeveragePreviewOplocGet(request(), {
    ...deps, verifyPreviewCookie: async () => ({ email: "unknown@example.test", email_verified: true }),
  })).status, 403);
  assert.deepEqual(events, []);
});

test("wrong metadata caller or malformed Hub site evidence fails closed without exposing upstream data", async () => {
  const { deps, events, setMetadata, setHub } = harness();
  setMetadata(() => new Response(jwt({ ...claims, sub: "another-caller" }), { headers: { "Metadata-Flavor": "Google" } }));
  assert.equal((await handleBeveragePreviewOplocGet(request(), deps)).status, 503);
  assert.deepEqual(events.splice(0), ["verified", "metadata"]);
  setMetadata(() => new Response(jwt(), { headers: { "Metadata-Flavor": "Google" } }));
  for (const response of [
    () => Response.json({ error: { private: "not returned" } }, { status: 403 }),
    () => Response.json({ readOnly: true, oplocs: [sites[0], { id: "oploc:ungranted", label: "Not returned" }] }),
    () => Response.json({ readOnly: true, oplocs: sites, private: "not returned" }),
    () => Response.json({ readOnly: true, oplocs: [...sites, sites[0]] }),
    () => new Response("x".repeat(65 * 1024), { headers: { "Content-Type": "application/json" } }),
    () => Response.redirect("https://elsewhere.example.test"),
  ]) {
    setHub(response);
    const result = await handleBeveragePreviewOplocGet(request(), deps);
    assert.ok([403, 503].includes(result.status));
    assert.doesNotMatch(await result.text(), /not returned|Fictional|fixture.person.session/i);
  }
});
