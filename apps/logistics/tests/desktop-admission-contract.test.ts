import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import * as ts from "typescript";

const require = createRequire(import.meta.url);
const { typescriptLoader } = require("../../../scripts/testing/load-typescript.cjs");
const { fixture } = require("./helpers/authority-route-harness.cjs");
const hubRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../integration-hub");
const loadHubModule = typescriptLoader({ typescript: ts, appRoot: hubRoot, mocks: {} });
const { MemoryAuthModRepository } = loadHubModule(path.join(hubRoot, "lib/authmod-core/memory-repository.ts"));
const { V1_APPLICATIONS } = loadHubModule(path.join(hubRoot, "lib/authmod-core/model.ts"));
const { grantStandardApplicationAccess } = loadHubModule(path.join(hubRoot, "lib/authmod-core/grants.ts"));
const evaluator = loadHubModule(path.join(hubRoot, "lib/authmod-core/evaluator.ts"));

async function contractFixture(kind: "person" | "operational" = "operational") {
  const repository = new MemoryAuthModRepository({ applications: structuredClone([...V1_APPLICATIONS]) });
  const at = "2026-01-01T00:00:00Z";
  const identity = { id: `test:desktop-contract:${kind}`, displayName: "Isolated desktop operator", identityKind: kind, fullAccess: false, identityLinkStatus: "unmatched", status: "active", provenance: "import", version: 1, createdAt: at, updatedAt: at };
  repository.identities.set(identity.id, identity);
  const actor = { type: "interactive" as const, id: identity.id, displayName: identity.displayName, identityKind: kind };
  const bundle = await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "logistics", actor, reason: "Isolated desktop admission contract" });
  assert.equal(identity.fullAccess, false);
  assert.ok([...repository.grants.values()].every((grant: { resource: string; action: string }) => grant.resource !== "logistics.vehicle" && grant.resource !== "authmod" && grant.action !== "Administer"));

  const loadRoute = typescriptLoader({ typescript: ts, appRoot: hubRoot, mocks: {
    "next/server": { NextRequest, NextResponse },
    "@/lib/api": { errorResponse: (error: { status?: number; message?: string }) => Response.json({ error: { message: error.message } }, { status: error.status || 500 }) },
    "@/lib/authmod-core": { FirestoreAuthModRepository: function Repository() { return repository; } },
    "@/lib/authmod-core/evaluator": evaluator,
    "@/lib/fika-session": { requireFikaSession: async () => ({ authmodIdentityId: identity.id, displayName: identity.displayName, identityKind: kind }) },
    "@/lib/authmod-admission-cache": { cachedAuthmodAdmission: (input: { load(): Promise<unknown> }) => input.load(), withAuthmodRequestContext: (callback: () => Promise<unknown>) => callback() },
    "@fika/server-shared/data-source-meter-server": { withDataTrace: (_: unknown, callback: () => Promise<unknown>) => callback() },
    "../../../../../../shared/auth-diagnostics": { logAuthDiagnostic() {} },
  } });
  const provider = loadRoute(path.join(hubRoot, "app/api/logistics/access/route.ts"));
  const logistics = fixture([]);
  logistics.setAdmissionHandler((input: string, options?: RequestInit) => provider.GET(new NextRequest(String(input), { headers: options?.headers })));
  return { repository, identity, bundle, logistics, provider };
}

for (const kind of ["person", "operational"] as const) test(`${kind}: actual Hub desktop View/Manage reaches both Logistics vans with zero vehicle grants`, async () => {
  const f = await contractFixture(kind);
  const manage = f.bundle.grants.find((grant: { action: string; id: string; status: string; effectiveTo?: string }) => grant.action === "Manage")!;
  f.repository.grants.set(manage.id, { ...manage, status: "revoked" });
  const admission = await f.provider.GET(new NextRequest("https://hub.test/api/logistics/access?mode=admission&vehicle=van2"));
  assert.equal(admission.status, 200);
  const admitted = await admission.json();
  assert.deepEqual(admitted.principal.permittedVehicleIds, []);
  assert.deepEqual(admitted.principal.desktopPermissions, { view: true, manage: false });

  await f.logistics.rebuild();
  assert.deepEqual((await f.logistics.vehicles()).body.permittedVehicleIds, ["van1", "van2"]);
  for (const mode of ["syncHead=1", "planningAttention=1", "projection=1"]) assert.equal((await f.logistics.get(mode)).response.status, 200, mode);
  for (const vehicle of ["van1", "van2"]) {
    const result = await f.logistics.get(`projection=1&vehicle=${vehicle}`);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.projection.runs.map((run: { vehicleId: string }) => run.vehicleId), [vehicle]);
  }
  const before = f.logistics.writes;
  assert.equal((await f.logistics.post({ action: "create-run", run: f.logistics.run("view-denied", "van1") })).response.status, 403);
  assert.equal(f.logistics.writes, before);

  f.repository.grants.set(manage.id, manage);
  for (const vehicle of ["van1", "van2"]) assert.equal((await f.logistics.post({ action: "create-run", run: f.logistics.run(`manage-${vehicle}`, vehicle) })).response.status, 200);
  for (const action of ["reset-planning-day", "repair-logistics-assignment-dates", "reconcile-logistics-day"]) {
    const writes = f.logistics.writes;
    assert.equal((await f.logistics.post({ action, serviceDate: f.logistics.date })).response.status, 403, action);
    assert.equal(f.logistics.writes, writes);
  }
});

test("actual Hub policy denials remain closed at Logistics reads and writes", async t => {
  for (const reason of ["missing-assignment", "revoked-assignment", "expired-assignment", "inactive-identity", "disabled-app", "revoked-view", "expired-view", "unavailable-store"] as const) await t.test(reason, async () => {
    const f = await contractFixture();
    const assignment = f.bundle.assignment;
    const view = f.bundle.grants.find((grant: { action: string; id: string; status: string; effectiveTo?: string }) => grant.action === "View")!;
    if (reason === "missing-assignment") f.repository.appAssignments.clear();
    if (reason === "revoked-assignment") f.repository.appAssignments.set(assignment.id, { ...assignment, status: "revoked" });
    if (reason === "expired-assignment") f.repository.appAssignments.set(assignment.id, { ...assignment, effectiveTo: "2000-01-01T00:00:00Z" });
    if (reason === "inactive-identity") f.repository.identities.set(f.identity.id, { ...f.identity, status: "inactive" });
    if (reason === "disabled-app") f.repository.applications.set("logistics", { ...f.repository.applications.get("logistics")!, enabled: false });
    if (reason === "revoked-view") f.repository.grants.set(view.id, { ...view, status: "revoked" });
    if (reason === "expired-view") f.repository.grants.set(view.id, { ...view, effectiveTo: "2000-01-01T00:00:00Z" });
    if (reason === "unavailable-store") f.repository.getIdentity = async () => { throw new Error("Isolated AUTHMOD outage"); };
    const expected = reason === "unavailable-store" ? 503 : 403;
    const before = f.logistics.writes;
    assert.equal((await f.logistics.vehicles()).response.status, expected);
    assert.equal((await f.logistics.get("syncHead=1")).response.status, expected);
    assert.equal((await f.logistics.post({ action: "create-run", run: f.logistics.run("denied", "van1") })).response.status, expected);
    assert.equal(f.logistics.writes, before);
  });
});

test("PIN execution does not call Hub desktop admission and stays confined to its van and actions", async () => {
  const f = await contractFixture();
  f.repository.identities.clear();
  f.repository.appAssignments.clear();
  f.repository.grants.clear();
  f.logistics.setAdmissionHandler(() => { throw new Error("PIN execution must not call Hub desktop admission"); });
  const before = f.logistics.writes;
  assert.equal((await f.logistics.postMobile({ action: "create-run", run: f.logistics.run("pin-planner-denied", "van1") })).response.status, 403);
  assert.equal(f.logistics.writes, before);
  const loaded = await f.logistics.postMobile({ action: "mark-stop-loaded", runId: "r1", stopId: "s1", expectedRunVersion: 1, expectedStopVersion: 1, loaded: true });
  assert.equal(loaded.response.status, 200);
  const after = f.logistics.writes;
  assert.equal((await f.logistics.postMobile({ action: "mark-stop-loaded", runId: "r2", stopId: "s2", expectedRunVersion: 1, expectedStopVersion: 1, loaded: true }, "van2")).response.status, 403);
  assert.equal(f.logistics.writes, after);
  assert.ok(!f.logistics.authorityRequests.includes("/api/logistics/access"));
});
