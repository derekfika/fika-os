import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";

const routeSource = fs.readFileSync(path.resolve("app/api/logistics/access/route.ts"), "utf8");

test.beforeEach(() => { process.env.FIKA_DATA_SOURCE_TRACE = "1"; });
test.afterEach(() => { delete process.env.FIKA_DATA_SOURCE_TRACE; });

test("Logistics admission route has one stable server trace boundary", () => {
  assert.match(routeSource, /withDataTrace\(\{ app: "integration-hub", action: "integration-hub\.logistics\.admission"/);
  assert.match(routeSource, /requestId: request\.headers\.get\("x-request-id"\)/);
  assert.match(routeSource, /requireFikaSession\(request\)/);
  assert.match(routeSource, /resolveUserAccess\(new FirestoreAuthModRepository\(\), \{ principal, appId: "logistics" \}\)/);
  assert.match(routeSource, /catch \(error\).*errorResponse/s);
});

test("successful admission emits one total containing AUTHMOD physical reads", async () => {
  const totals: Array<Record<string, unknown>> = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    const line = String(args[0] || "");
    if (line.startsWith("[FIKA_DATA_TRACE_TOTAL] ")) totals.push(JSON.parse(line.slice("[FIKA_DATA_TRACE_TOTAL] ".length)));
  };
  try {
    const response = await withDataTrace({ app: "integration-hub", action: "integration-hub.logistics.admission", path: "/api/logistics/access", requestId: "admission-success" }, async () => {
      recordDataAccess({ app: "integration-hub", operation: "authmod.getIdentity", source: "FIRESTORE", documents: 1 });
      recordDataAccess({ app: "integration-hub", operation: "authmod.listAuthorityGrants", source: "FIRESTORE", documents: 3 });
      recordDataAccess({ app: "integration-hub", operation: "authmod.listAppAssignments", source: "FIRESTORE", documents: 1 });
      return { status: 200, allowed: true };
    });
    assert.deepEqual(response, { status: 200, allowed: true });
  } finally { console.info = originalInfo; }
  assert.equal(totals.length, 1);
  assert.equal(totals[0].action, "integration-hub.logistics.admission");
  assert.equal(totals[0].requestId, "admission-success");
  assert.equal(totals[0].estimatedFirestoreBillableReads, 5);
  assert.equal((totals[0].records as unknown[]).length, 3);
});

test("denied admission still emits one total and disabled tracing remains a no-op", async () => {
  const totals: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => { if (String(args[0] || "").startsWith("[FIKA_DATA_TRACE_TOTAL] ")) totals.push(String(args[0])); };
  try {
    await assert.rejects(() => withDataTrace({ app: "integration-hub", action: "integration-hub.logistics.admission", path: "/api/logistics/access" }, async () => {
      recordDataAccess({ app: "integration-hub", operation: "authmod.listAuthorityGrants", source: "FIRESTORE", documents: 4 });
      throw Object.assign(new Error("denied"), { status: 403 });
    }), /denied/);
    assert.equal(totals.length, 1);
    delete process.env.FIKA_DATA_SOURCE_TRACE;
    totals.length = 0;
    await withDataTrace({ app: "integration-hub", action: "integration-hub.logistics.admission", path: "/api/logistics/access" }, async () => {
      recordDataAccess({ app: "integration-hub", operation: "authmod.getIdentity", source: "FIRESTORE", documents: 1 });
    });
  } finally { console.info = originalInfo; }
  assert.equal(totals.length, 0);
});
