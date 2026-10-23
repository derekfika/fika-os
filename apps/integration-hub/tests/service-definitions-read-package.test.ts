import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";
import { decodeReadPackage, encodeReadPackage, retrieveReadPackage, type ReadPackageStore } from "@fika/server-shared/read-package";
import { serviceDefinitionsFromRecords } from "../lib/service-definitions-read-package";
import type { CanonicalRecord } from "../lib/types";

const definition = record("Service Definition", "service-definition:coffee", { serviceName: "Coffee Bar", description: "Hot drinks", lifecycleState: "active" });

test("Service Definition package preserves the compatible catalogue shape and integrity", () => {
  const value = { serviceDefinitions: serviceDefinitionsFromRecords([definition], []) };
  const encoded = encodeReadPackage("integration-hub/service-definitions", 2, value, value.serviceDefinitions.length, { contractVersion: "integration-hub.service-definitions.v1", sourceVersion: "canonical:1:revisions:0" });
  assert.equal(encoded.manifest.dataset, "integration-hub/service-definitions");
  assert.equal(encoded.manifest.recordCount, 1);
  assert.deepEqual(decodeReadPackage(encoded.manifest, encoded.bytes), value);
  assert.throws(() => decodeReadPackage(encoded.manifest, Uint8Array.from(encoded.bytes, (byte, index) => index === 0 ? byte ^ 1 : byte)), /integrity check failed/);
});

test("package retrieval distinguishes an absent manifest from corrupt stored bytes", async () => {
  const encoded = encodeReadPackage("integration-hub/service-definitions", 1, { serviceDefinitions: [] }, 0);
  const store = memoryStore();
  assert.equal(await retrieveReadPackage(store, encoded.manifest.dataset), undefined, "a missing manifest is rebuildable");
  await store.putImmutable(encoded.manifest.objectName, encoded.bytes, encoded.manifest.contentHash);
  await store.putManifest(encoded.manifest.dataset, encoded.manifest);
  assert.deepEqual((await retrieveReadPackage(store, encoded.manifest.dataset))?.value, { serviceDefinitions: [] });
  const corrupt = Uint8Array.from(encoded.bytes); corrupt[0] ^= 0xff;
  await store.putImmutable(encoded.manifest.objectName, corrupt, encoded.manifest.contentHash);
  await assert.rejects(retrieveReadPackage(store, encoded.manifest.dataset), /integrity check failed/);
});

test("Service Definition GET reads the package on hits and rebuilds only a missing package", () => {
  const route = readFileSync(new URL("../app/api/service-definitions/route.ts", import.meta.url), "utf8");
  const packageSource = readFileSync(new URL("../lib/service-definitions-read-package.ts", import.meta.url), "utf8");
  const routeFile = parse(route, "route.tsx");
  const getRoute = namedFunction(routeFile, "GET");
  const getCalls = callNames(getRoute);
  assert.ok(getCalls.includes("requireActor") && getCalls.includes("assertPermission"));
  assert.ok(getCalls.includes("getServiceDefinitionsReadPackage"));
  assert.ok(!getCalls.includes("serviceDefinitionCatalogueOverview"));
  const packageFile = parse(packageSource, "service-definitions-read-package.ts");
  const reader = namedFunction(packageFile, "getServiceDefinitionsReadPackage");
  assert.ok(callNames(reader).includes("retrieveReadPackage"));
  assert.ok(!callNames(reader).includes("collection"), "steady-state reads must not query canonical records directly");
  const missingBranch = missingManifestBranch(reader);
  assert.ok(callNames(missingBranch.thenStatement).includes("rebuildServiceDefinitionsReadPackage"));
  assert.ok(reader.getText(packageFile).includes("recoveryInFlight"), "concurrent misses must share one rebuild");
});

test("Service Definition rebuild hooks cover saves and deletes without putting authority in the package", () => {
  const configuration = readFileSync(new URL("../lib/operational-configuration-service.ts", import.meta.url), "utf8");
  const catalogue = readFileSync(new URL("../lib/service-catalogue-service.ts", import.meta.url), "utf8");
  const packageSource = readFileSync(new URL("../lib/service-definitions-read-package.ts", import.meta.url), "utf8");
  assert.match(configuration, /rebuildServiceDefinitionsReadPackage/);
  assert.match(catalogue, /await rebuildServiceDefinitionsReadPackage\(\)/);
  assert.doesNotMatch(packageSource, /authority|employment|assignment|delegation/i);
});

test("Hospitality and Events reference reads use the bounded typed reader", () => {
  const canonical = readFileSync(new URL("../lib/canonical-oplocs.ts", import.meta.url), "utf8");
  const hospitality = readFileSync(new URL("../lib/hospitality-catalogue-service.ts", import.meta.url), "utf8");
  const events = readFileSync(new URL("../lib/events-read-contract.ts", import.meta.url), "utf8");
  assert.match(canonical, /limit\(limit \+ 1\)/);
  assert.match(canonical, /canonical\.by-type\.bounded/);
  assert.match(hospitality, /listCanonicalRecordsByTypes/);
  assert.match(events, /listCanonicalRecordsByTypes/);
  assert.doesNotMatch(canonical, /where\("entityType", "in", wanted\)\.get\(\)/);
});

test("package misses recover from authority; integrity failures stay closed and explicit rebuilds require admin", () => {
  const rebuildRoute = readFileSync(new URL("../app/api/read-packages/rebuild/route.ts", import.meta.url), "utf8");
  const oploc = readFileSync(new URL("../lib/oploc-read-package.ts", import.meta.url), "utf8");
  const arrangements = readFileSync(new URL("../lib/service-arrangements-read-package.ts", import.meta.url), "utf8");
  const definitions = readFileSync(new URL("../lib/service-definitions-read-package.ts", import.meta.url), "utf8");
  const routeFile = parse(rebuildRoute, "rebuild-route.tsx");
  const post = namedFunction(routeFile, "POST");
  const routeCalls = callNames(post);
  assert.ok(routeCalls.includes("requireActor") && routeCalls.includes("assertPermission"));
  const query = routeFile.statements.find((statement): statement is ts.VariableStatement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "Query"));
  assert.ok(query, "rebuild route must validate its dataset query");
  const enumCall = findCalls(query).find(call => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "enum");
  const datasets = enumCall?.arguments[0];
  assert.ok(datasets && ts.isArrayLiteralExpression(datasets));
  assert.deepEqual(datasets.elements.map(item => ts.isStringLiteral(item) ? item.text : ""), ["oplocs", "service-arrangements", "service-definitions", "authmod-references", "authmod-access", "authmod-access-active"]);
  const actorCall = findCalls(post).find(call => callNames(call).includes("requireActor"));
  const actorRoles = actorCall?.arguments[1];
  assert.ok(actorRoles && ts.isArrayLiteralExpression(actorRoles));
  assert.deepEqual(actorRoles.elements.map(item => ts.isStringLiteral(item) ? item.text : ""), ["integration-admin"]);
  for (const [source, getter, rebuild, code] of [
    [oploc, "getOplocReadPackage", "rebuildOplocReadPackage", "OPLOC_PACKAGE_INTEGRITY_FAILURE"],
    [arrangements, "getServiceArrangementsReadPackage", "rebuildServiceArrangementsReadPackage", "SERVICE_ARRANGEMENTS_PACKAGE_INTEGRITY_FAILURE"],
    [definitions, "getServiceDefinitionsReadPackage", "rebuildServiceDefinitionsReadPackage", "SERVICE_DEFINITIONS_PACKAGE_INTEGRITY_FAILURE"],
  ] as const) {
    const file = parse(source, `${getter}.ts`);
    const reader = namedFunction(file, getter);
    const tryIndex = reader.body!.statements.findIndex(ts.isTryStatement);
    const missing = missingManifestBranch(reader);
    const missingIndex = reader.body!.statements.indexOf(missing);
    assert.ok(tryIndex >= 0 && tryIndex < missingIndex, `${getter} must classify retrieval integrity errors before handling a missing manifest`);
    const catchBlock = reader.body!.statements[tryIndex] as ts.TryStatement;
    assert.ok(catchBlock.catchClause, `${getter} must fail closed when package retrieval throws`);
    const caughtCalls = callNames(catchBlock.catchClause.block);
    assert.ok(caughtCalls.includes("recordDataAccess"));
    assert.ok(!caughtCalls.includes(rebuild), "integrity failures must not trigger a rebuild");
    assert.ok(catchBlock.catchClause.block.getText(file).includes(code));
    assert.ok(callNames(missing.thenStatement).includes(rebuild), "a missing manifest may recover from authoritative data");
    assert.ok(reader.getText(file).includes("recoveryInFlight"), "concurrent missing-package recovery must be coalesced");
  }
});

function record(entityType: CanonicalRecord["entityType"], canonicalId: string, values: Record<string, unknown>): CanonicalRecord {
  const now = "2026-08-31T09:00:00.000Z";
  return { canonicalId, entityType, dataHash: "test", lifecycleStatus: "published", publicationStatus: "published", record: { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: "person:admin", updatedAt: now, updatedBy: "person:admin", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType, canonicalId, ...values } };
}

function memoryStore(): ReadPackageStore {
  const objects = new Map<string, Uint8Array>();
  const manifests = new Map<string, import("@fika/server-shared/read-package").ReadPackageManifest>();
  return {
    async putImmutable(name, bytes) { objects.set(name, bytes); },
    async get(name) { return objects.get(name); },
    async has(name) { return objects.has(name); },
    async getManifest(key) { return manifests.get(key); },
    async putManifest(key, manifest) { manifests.set(key, manifest); },
  };
}

function parse(source: string, filename: string) { return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function namedFunction(source: ts.SourceFile, name: string) {
  const declaration = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration?.body, `Expected function ${name}`);
  return declaration;
}
function findCalls(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (current: ts.Node) => { if (ts.isCallExpression(current)) calls.push(current); ts.forEachChild(current, visit); };
  visit(node); return calls;
}
function callNames(node: ts.Node) { return findCalls(node).map(call => ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : ""); }
function missingManifestBranch(node: ts.Node) {
  let result: ts.IfStatement | undefined;
  const visit = (current: ts.Node) => {
    if (ts.isIfStatement(current) && ts.isPrefixUnaryExpression(current.expression) && current.expression.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(current.expression.operand) && ["result", "retrieved"].includes(current.expression.operand.text)) result = current;
    ts.forEachChild(current, visit);
  };
  visit(node);
  assert.ok(result, "reader must distinguish a missing manifest from retrieval errors");
  return result;
}
