import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getHubBaseUrl } from "../lib/hub-url";
import { errorResponse } from "../lib/api";

test("local CPU Hub URL keeps the explicit localhost fallback", () => {
  assert.equal(getHubBaseUrl({ FIKA_RUNTIME_MODE: "local" }), "http://localhost:3200");
  assert.equal(getHubBaseUrl({ FIKA_RUNTIME_MODE: "local", FIKA_HUB_BASE_URL: "http://localhost:3210/" }), "http://localhost:3210");
});

test("hosted CPU Hub URL uses the staging endpoint and rejects missing or local values", () => {
  assert.equal(getHubBaseUrl({ FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com/" }), "https://staging-os.fikacatering.com");
  assert.throws(() => getHubBaseUrl({ FIKA_RUNTIME_MODE: "staging" }), /FIKA_HUB_BASE_URL is required/);
  assert.throws(() => getHubBaseUrl({ FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: "http://localhost:3200" }), /must use HTTPS/);
});

test("upstream failures keep their status instead of becoming client 400s", async () => {
  assert.equal((await errorResponse(Object.assign(new Error("Hub unavailable"), { status: 503 })).json()).error.code, "UPSTREAM_UNAVAILABLE");
  assert.equal((await errorResponse(Object.assign(new Error("Hub unavailable"), { status: 502 }))).status, 502);
  assert.equal((await errorResponse(new Error("Hub unavailable"))).status, 503);
});

test("inspector opens from the loaded card before its targeted detail request completes", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setSelected\(cachedOrder \|\| \(order as ProductionOrder\)\)/);
  assert.match(page, /api\/production\?canonicalId=/);
  assert.doesNotMatch(page, /if \(!preserveOpen\) setSelected\(undefined\)/);
  assert.match(page, /cpu-detail-loading/);
});
