import assert from "node:assert/strict";
import test from "node:test";
import { cachedAuthmodAdmission, clearAuthmodAdmissionCacheForTests, invalidateAuthmodAdmissionCache } from "../lib/authmod-admission-cache";
import { LOGISTICS_VEHICLE_IDS, MemoryAuthModRepository, V1_APPLICATIONS, resolvePermittedVehicleIds } from "../lib/authmod-core";
import type { AppAssignment, AuthIdentity, AuthorityGrant, AuthPrincipal } from "../lib/authmod-core/model";

const admin: AuthPrincipal = { type: "interactive", id: "admin", displayName: "AUTHMOD admin", identityKind: "person" };
const now = "2026-08-31T08:00:00.000Z";

function fixture() {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS] });
  const identity: AuthIdentity = { id: "identity:driver", displayName: "Driver", normalizedEmail: "driver@example.test", identityKind: "person", status: "active", identityLinkStatus: "matched", fullAccess: false, provenance: "manual-override", createdAt: now, updatedAt: now, version: 1 };
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, identityKind: identity.identityKind };
  repository.identities.set(identity.id, identity);
  repository.appAssignments.set("app:driver:logistics", { id: "app:driver:logistics", identityId: identity.id, appId: "logistics", status: "active", source: "manual-override", version: 1, createdAt: now, updatedAt: now } as AppAssignment);
  return { repository, identity, principal };
}

function vehicleGrant(subjectId: string, id: string, vehicleId: string, extra: Partial<AuthorityGrant> = {}): AuthorityGrant {
  return { id, subjectId, subjectType: "interactive", appId: "logistics", resource: "logistics.vehicle", action: "View", scope: { kind: "resource", ids: [vehicleId] }, status: "active", provenance: "explicit-special-authority", version: 1, createdAt: now, updatedAt: now, ...extra };
}

test.beforeEach(() => clearAuthmodAdmissionCacheForTests());
test.afterEach(() => clearAuthmodAdmissionCacheForTests());

test("vehicle grants resolve to stable permitted vehicle IDs", async () => {
  const { repository, principal } = fixture();
  repository.grants.set("grant:van1", vehicleGrant(principal.id, "grant:van1", "van1"));
  assert.deepEqual((await resolvePermittedVehicleIds(repository, { principal })).permittedVehicleIds, ["van1"]);
  assert.equal((await resolvePermittedVehicleIds(repository, { principal, vehicleIds: ["van2"] })).permittedVehicleIds.length, 0);
});

test("projection or catalogue contents cannot grant vehicle authority", async () => {
  const { repository, principal } = fixture();
  repository.oplocs.set("van1", { id: "van1", label: "Van 1", active: true });
  assert.deepEqual((await resolvePermittedVehicleIds(repository, { principal })).permittedVehicleIds, []);
});

test("A+B grants permit both vehicles, while missing, invalid and expired grants fail closed", async () => {
  const { repository, principal } = fixture();
  repository.grants.set("grant:van1", vehicleGrant(principal.id, "grant:van1", "van1"));
  repository.grants.set("grant:van2", vehicleGrant(principal.id, "grant:van2", "van2"));
  assert.deepEqual((await resolvePermittedVehicleIds(repository, { principal })).permittedVehicleIds, [...LOGISTICS_VEHICLE_IDS]);
  repository.grants.delete("grant:van1"); repository.grants.delete("grant:van2");
  assert.deepEqual((await resolvePermittedVehicleIds(repository, { principal })).permittedVehicleIds, []);
  repository.grants.set("grant:invalid", vehicleGrant(principal.id, "grant:invalid", "truck-1"));
  assert.deepEqual((await resolvePermittedVehicleIds(repository, { principal })).permittedVehicleIds, []);
  repository.grants.set("grant:expired", vehicleGrant(principal.id, "grant:expired", "van1", { effectiveTo: "2026-01-01T00:00:00.000Z" }));
  assert.deepEqual((await resolvePermittedVehicleIds(repository, { principal })).permittedVehicleIds, []);
});

test("suspended identity and Full Access do not grant special vehicle authority", async () => {
  const { repository, identity, principal } = fixture();
  repository.grants.set("grant:van1", vehicleGrant(principal.id, "grant:van1", "van1"));
  repository.identities.set(identity.id, { ...identity, status: "revoked", version: 2 });
  assert.deepEqual((await resolvePermittedVehicleIds(repository, { principal })).permittedVehicleIds, []);
  repository.grants.delete("grant:van1");
  repository.identities.set(identity.id, { ...identity, fullAccess: true, version: 3 });
  assert.deepEqual((await resolvePermittedVehicleIds(repository, { principal })).permittedVehicleIds, []);
});

test("vehicle-specific cache keys and invalidation cannot leak authority", async () => {
  let loads = 0;
  const load = async () => ({ allowed: true, permittedVehicleIds: ["van1"], load: ++loads });
  await cachedAuthmodAdmission({ identityId: "driver-a", appId: "logistics", scope: "van1", authorityAction: "logistics.vehicle.view", load });
  await cachedAuthmodAdmission({ identityId: "driver-a", appId: "logistics", scope: "van2", authorityAction: "logistics.vehicle.view", load });
  await cachedAuthmodAdmission({ identityId: "driver-b", appId: "logistics", scope: "van1", authorityAction: "logistics.vehicle.view", load });
  assert.equal(loads, 3);
  invalidateAuthmodAdmissionCache();
  await cachedAuthmodAdmission({ identityId: "driver-a", appId: "logistics", scope: "van1", authorityAction: "logistics.vehicle.view", load });
  assert.equal(loads, 4);
});
