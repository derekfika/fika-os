import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Delivered-In effective App Hosting config enables tracing", () => {
  const config = readFileSync(new URL("../apphosting.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_DATA_SOURCE_TRACE/);
  assert.match(config, /availability:\s*(?:\[BUILD, RUNTIME\]|\n\s*- BUILD\s*\n\s*- RUNTIME)/);
  assert.match(config, /value:\s*["']?1["']?/);
});

test("Delivered-In classifies local catalogue reads as STATIC and hosted reads as FIRESTORE", () => {
  const source = readFileSync(new URL("../lib/grab-and-go-store.ts", import.meta.url), "utf8");
  assert.match(source, /grab-and-go\.catalogue\.read[\s\S]*source:\s*"STATIC"/);
  assert.match(source, /grab-and-go\.orders\.by-oploc-date[\s\S]*source:\s*"FIRESTORE"/);
});
