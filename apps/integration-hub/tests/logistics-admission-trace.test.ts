import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as ts from "typescript";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";

const routeSource = fs.readFileSync(path.resolve("app/api/logistics/access/route.ts"), "utf8");

test.beforeEach(() => { process.env.FIKA_DATA_SOURCE_TRACE = "1"; });
test.afterEach(() => { delete process.env.FIKA_DATA_SOURCE_TRACE; });

test("Logistics admission route traces the authenticated AUTHMOD boundary", () => {
  const source = ts.createSourceFile("route.tsx", routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const getRoute = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "GET");
  const handleGet = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "handleGet");
  assert.ok(getRoute?.body, "GET route must be present");
  assert.ok(handleGet?.body, "admission logic must remain behind the instrumented route boundary");
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); };
  visit(getRoute.body);
  const nameOf = (call: ts.CallExpression) => ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "";
  const names = calls.map(nameOf);
  assert.equal(names.filter(name => name === "withDataTrace").length, 1);
  assert.ok(names.includes("withAuthmodRequestContext") && names.includes("handleGet"));
  const admissionCalls: ts.CallExpression[] = [];
  const visitAdmission = (node: ts.Node) => { if (ts.isCallExpression(node)) admissionCalls.push(node); ts.forEachChild(node, visitAdmission); };
  visitAdmission(handleGet.body);
  const admissionNames = admissionCalls.map(nameOf);
  for (const required of ["requireFikaSession", "cachedAuthmodAdmission", "createAuthModEvaluationContext", "resolveUserAccess", "resolvePermittedVehicleIds", "evaluateAuthority", "errorResponse"])
    assert.ok(admissionNames.includes(required), `admission handler must retain ${required}`);
  const trace = calls.find(call => nameOf(call) === "withDataTrace");
  const options = trace?.arguments[0];
  assert.ok(options && ts.isObjectLiteralExpression(options), "trace call must receive structured route metadata");
  const action = options.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText(source) === "action");
  assert.ok(action && ts.isStringLiteral(action.initializer));
  assert.equal(action.initializer.text, "integration-hub.logistics.admission");
  assert.ok(options.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "requestId"));
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
