import assert from "node:assert/strict";
import test from "node:test";
import { hubFetch, hubUserFetch } from "../lib/hub";

const keys = ["FIKA_RUNTIME_MODE", "FIKA_HUB_BASE_URL", "MNK_CANON_BRIDGE_TOKEN"] as const;
async function withEnv<T>(values: Partial<Record<(typeof keys)[number], string>>, run: () => Promise<T>) {
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, values);
  try { return await run(); }
  finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
}

test("production Hub calls refuse the staging Hub before any request is made", async () => {
  await withEnv({ FIKA_RUNTIME_MODE: "production", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com", MNK_CANON_BRIDGE_TOKEN: "test-token" }, async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response("{}"); }) as typeof fetch;
    await assert.rejects(hubFetch("/api/bookings/mnk"), /not the approved production service/);
    await assert.rejects(hubUserFetch("/api/oplocs", "fika_os_session=test"), /not the approved production service/);
    assert.equal(calls, 0);
  });
});

test("approved production Hub calls carry credentials but refuse to follow redirects", async () => {
  await withEnv({ FIKA_RUNTIME_MODE: "production", FIKA_HUB_BASE_URL: "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app/", MNK_CANON_BRIDGE_TOKEN: "test-token" }, async () => {
    const seen: Array<{ url: string; redirect?: RequestRedirect }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), redirect: init?.redirect }); return new Response("{}"); }) as typeof fetch;
    await hubFetch("/api/bookings/mnk");
    await hubUserFetch("/api/oplocs", "fika_os_session=test");
    assert.deepEqual(seen, [
      { url: "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app/api/bookings/mnk", redirect: "error" },
      { url: "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app/api/oplocs", redirect: "error" },
    ]);
  });
});

test("staging may use its own Hub and local development keeps loopback", async () => {
  await withEnv({ FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com", MNK_CANON_BRIDGE_TOKEN: "test-token" }, async () => {
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;
    await hubUserFetch("/api/oplocs", null);
  });
  await withEnv({ FIKA_RUNTIME_MODE: "local", FIKA_HUB_BASE_URL: "http://127.0.0.1:3200", MNK_CANON_BRIDGE_TOKEN: "test-token" }, async () => {
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;
    await hubFetch("/api/bookings/mnk");
  });
});
