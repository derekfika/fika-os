import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";

test("CPU Production effective App Hosting config enables tracing", () => {
  const config = readFileSync(new URL("../apphosting.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_DATA_SOURCE_TRACE/);
  assert.match(config, /availability:\s*(?:\[BUILD, RUNTIME\]|\n\s*- BUILD\s*\n\s*- RUNTIME)/);
  assert.match(config, /value:\s*["']?1["']?/);
});

test("CPU Production Firestore reads emit one attributed total", async () => {
  const previousFlag = process.env.FIKA_DATA_SOURCE_TRACE;
  const previousInfo = console.info;
  const lines: string[] = [];
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
  console.info = ((...args: unknown[]) => lines.push(args.map(String).join(" "))) as typeof console.info;
  try {
    await withDataTrace({ app: "cpu-production", action: "cpu-production.load", path: "/api/production" }, async () => {
      recordDataAccess({ app: "cpu-production", operation: "production-plans.list", source: "FIRESTORE", documents: 3, firestoreReadKind: "query" });
    });
    const total = lines.find((line) => line.startsWith("[FIKA_DATA_TRACE_TOTAL] "));
    assert.ok(total);
    assert.equal(JSON.parse(total.slice("[FIKA_DATA_TRACE_TOTAL] ".length)).estimatedFirestoreBillableReads, 3);
  } finally {
    console.info = previousInfo;
    if (previousFlag === undefined) delete process.env.FIKA_DATA_SOURCE_TRACE;
    else process.env.FIKA_DATA_SOURCE_TRACE = previousFlag;
  }
});
