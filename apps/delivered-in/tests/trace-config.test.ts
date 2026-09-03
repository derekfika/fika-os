import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Delivered-In effective App Hosting config enables tracing", () => {
  const config = readFileSync(new URL("../apphosting.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_DATA_SOURCE_TRACE/);
  assert.match(config, /availability:\s*(?:\[BUILD, RUNTIME\]|\n\s*- BUILD\s*\n\s*- RUNTIME)/);
  assert.match(config, /value:\s*["']?1["']?/);
});

test("Delivered-In reads the CPU-owned Grab & Go package through a bounded network boundary", () => {
  const source = readFileSync(new URL("../lib/grab-and-go-catalogue-client.ts", import.meta.url), "utf8");
  assert.match(source, /CPU_PRODUCTION_BASE_URL/);
  assert.match(source, /grab-and-go\.catalogue/);
  assert.match(source, /cache:\s*"no-store"/);
  const orders = readFileSync(new URL("../lib/grab-and-go-store.ts", import.meta.url), "utf8");
  assert.match(orders, /grab-and-go\.orders\.by-oploc-date[\s\S]*source:\s*"FIRESTORE"/);
  assert.doesNotMatch(orders, /grab-and-go-catalogue\.json/);
});
