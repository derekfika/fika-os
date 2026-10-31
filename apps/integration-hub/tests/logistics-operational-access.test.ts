import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { MemoryAuthModRepository } from "../lib/authmod-core/memory-repository";
import { V1_APPLICATIONS, type AuthIdentity, type InteractivePrincipal } from "../lib/authmod-core/model";
import { evaluateAuthority, resolvePermittedVehicleIds, resolveUserAccess } from "../lib/authmod-core/evaluator";
import { grantAuthority } from "../lib/authmod-core/authority";
import { grantStandardApplicationAccess } from "../lib/authmod-core/grants";
import { LOGISTICS_MAINTENANCE_AUTHORITIES } from "../../shared/logistics-authority";

const at = "2026-01-01T00:00:00Z";
function fixture(kind: "person" | "operational" = "operational", fullAccess = false) {
  const repo = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS] });
  const identity: AuthIdentity = { id: "test:logistics", displayName: "Test Logistics", identityKind: kind, fullAccess, identityLinkStatus: "unmatched", status: "active", provenance: "import", version: 1, createdAt: at, updatedAt: at };
  repo.identities.set(identity.id, identity);
  repo.appAssignments.set("test:assignment", { id: "test:assignment", identityId: identity.id, appId: "logistics", status: "active", source: "standard-app-access", version: 1, createdAt: at, updatedAt: at });
  const principal: InteractivePrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, identityKind: kind };
  return { repo, identity, principal };
}
async function permit(f: ReturnType<typeof fixture>, ids: string[]) {
  return grantAuthority(f.repo, { subjectId: f.identity.id, subjectType: "interactive", actor: f.principal, appId: "logistics", resource: "logistics.vehicle", action: "View", scope: { kind: "resource", ids }, reason: "Isolated test vehicle permissions" });
}

for (const kind of ["person", "operational"] as const) test(`${kind} standard Logistics View/Manage grants do not alter explicit vehicle resolution`, async () => {
  const f = fixture(kind);
  f.repo.appAssignments.clear();
  const bundle = await grantStandardApplicationAccess(f.repo, { identityId: f.identity.id, appId: "logistics", actor: f.principal, reason: "Isolated standard app bundle" });
  const authority = (action: "View" | "Manage") => evaluateAuthority(f.repo, { principal: f.principal, appId: "logistics", resource: "logistics.normal", action, scope: { kind: "organisation", ids: [] } });
  assert.equal((await resolveUserAccess(f.repo, { principal: f.principal, appId: "logistics" })).allowed, true);
  assert.equal((await authority("View")).allowed, true);
  assert.equal((await authority("Manage")).allowed, true);
  assert.deepEqual((await resolvePermittedVehicleIds(f.repo, { principal: f.principal })).permittedVehicleIds, []);
  const manage = bundle.grants.find(grant => grant.action === "Manage")!;
  f.repo.grants.set(manage.id, { ...manage, status: "revoked" });
  assert.equal((await authority("View")).allowed, true);
  assert.equal((await authority("Manage")).allowed, false);
  f.repo.grants.set(manage.id, { ...manage, effectiveTo: "2000-01-01T00:00:00Z" });
  assert.equal((await authority("Manage")).allowed, false);
  f.repo.appAssignments.set(bundle.assignment.id, { ...bundle.assignment, status: "revoked" });
  assert.equal((await authority("View")).allowed, false);
  assert.equal((await authority("Manage")).allowed, false);
});

test("disabled Logistics app and unavailable policy store fail closed", async () => {
  const f = fixture("operational");
  f.repo.appAssignments.clear();
  await grantStandardApplicationAccess(f.repo, { identityId: f.identity.id, appId: "logistics", actor: f.principal, reason: "Isolated standard app bundle" });
  const app = await f.repo.getApplication("logistics");
  assert.ok(app);
  f.repo.applications.set("logistics", { ...app, enabled: false });
  assert.equal((await evaluateAuthority(f.repo, { principal: f.principal, appId: "logistics", resource: "logistics.normal", action: "View", scope: { kind: "organisation", ids: [] } })).allowed, false);
  f.repo.applications.set("logistics", app);
  f.repo.getIdentity = async () => { throw new Error("isolated policy-store outage"); };
  const unavailable = await evaluateAuthority(f.repo, { principal: f.principal, appId: "logistics", resource: "logistics.normal", action: "View", scope: { kind: "organisation", ids: [] } });
  assert.equal(unavailable.allowed, false);
  assert.equal(unavailable.reasonCode, "store-unavailable");
});

test("operational planner account needs explicit grants and can access both vans without Full Access", async () => {
  const f = fixture();
  assert.equal((await resolveUserAccess(f.repo, { principal: f.principal, appId: "logistics" })).allowed, true);
  assert.deepEqual((await resolvePermittedVehicleIds(f.repo, { principal: f.principal })).permittedVehicleIds, []);
  await permit(f, ["van1", "van2"]);
  assert.deepEqual(await resolvePermittedVehicleIds(f.repo, { principal: f.principal }), { permittedVehicleIds: ["van1", "van2"], resolutionFailed: false });
  assert.equal(f.repo.identities.get(f.identity.id)?.identityKind, "operational");
  assert.equal(f.repo.identities.get(f.identity.id)?.fullAccess, false);
});
for (const vehicle of ["van1", "van2"]) test(`${vehicle}-only authority retains the correct vehicle and denies the other`, async () => {
  const f = fixture(); await permit(f, [vehicle]);
  assert.deepEqual((await resolvePermittedVehicleIds(f.repo, { principal: f.principal })).permittedVehicleIds, [vehicle]);
  const other = vehicle === "van1" ? "van2" : "van1";
  assert.deepEqual((await resolvePermittedVehicleIds(f.repo, { principal: f.principal, vehicleIds: [other] })).permittedVehicleIds, []);
});
test("person Full Access does not substitute for explicit vehicle authority", async () => {
  const f = fixture("person", true);
  assert.deepEqual((await resolvePermittedVehicleIds(f.repo, { principal: f.principal })).permittedVehicleIds, []);
});
test("both vehicle scopes grant neither maintenance nor AUTHMOD admin authority", async () => {
  const f = fixture(); await permit(f, ["van1", "van2"]);
  for (const resource of [...LOGISTICS_MAINTENANCE_AUTHORITIES, "authmod"]) {
    assert.equal((await evaluateAuthority(f.repo, { principal: f.principal, appId: resource === "authmod" ? "integration-hub" : "logistics", resource, action: "Administer", scope: { kind: "organisation", ids: [] } })).allowed, false);
  }
  await grantAuthority(f.repo, { subjectId: f.identity.id, subjectType: "interactive", actor: f.principal, appId: "logistics", resource: "logistics.repair", action: "Administer", scope: { kind: "organisation", ids: [] }, reason: "Isolated explicit maintenance permission" });
  for (const resource of LOGISTICS_MAINTENANCE_AUTHORITIES) assert.equal((await evaluateAuthority(f.repo, { principal: f.principal, appId: "logistics", resource, action: "Administer", scope: { kind: "organisation", ids: [] } })).allowed, resource === "logistics.repair");
});
for (const denied of ["unassigned", "inactive", "revoked-grant", "expired-grant"]) test(`${denied} account remains denied`, async () => {
  const f = fixture(); const grant = await permit(f, ["van1", "van2"]);
  if (denied === "unassigned") f.repo.appAssignments.clear();
  if (denied === "inactive") f.repo.identities.set(f.identity.id, { ...f.identity, status: "inactive" });
  if (denied === "revoked-grant") f.repo.grants.set(grant.id, { ...grant, status: "revoked" });
  if (denied === "expired-grant") f.repo.grants.set(grant.id, { ...grant, effectiveTo: "2000-01-01T00:00:00Z" });
  assert.deepEqual((await resolvePermittedVehicleIds(f.repo, { principal: f.principal })).permittedVehicleIds, []);
});
for (const [mode, project] of [["production", "fika-os"], ["staging", "other-project"]]) test(`policy repair refuses ${mode}/${project} before credentials or writes`, () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/logistics-access-policy.ts", "--execute"], { encoding: "utf8", windowsHide: true, env: { ...process.env, FIKA_RUNTIME_MODE: mode, FIREBASE_PROJECT_ID: project, FIRESTORE_EMULATOR_HOST: "", FIREBASE_AUTH_EMULATOR_HOST: "" } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Only the real fika-os-dev staging environment is permitted/);
  assert.equal(result.stdout, "");
});
