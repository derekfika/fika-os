import { LOGISTICS_VEHICLE_IDS, type LogisticsDriverOption } from "../../../shared/logistics-authority";
import { createAuthModEvaluationContext, evaluateAuthority } from "./evaluator";
import { isEffective } from "./model";
import type { AuthModRepository } from "./repository";

/** Direct validation deliberately bypasses catalogue/admission caches. */
export async function resolveLogisticsDriver(repository: AuthModRepository, driverId: string): Promise<LogisticsDriverOption | undefined> {
  const identity = await repository.getIdentity(driverId);
  if (!identity || identity.id !== driverId || identity.identityKind !== "person" || !isEffective(identity) || identity.identityLinkStatus !== "matched" || !identity.displayName.trim()) return;
  const assignments = await repository.listAppAssignments(identity.id);
  if (!assignments.some(item => item.identityId === identity.id && item.appId === "logistics" && isEffective(item))) return;
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName, identityKind: identity.identityKind };
  const context = createAuthModEvaluationContext(repository, principal);
  const decisions = await Promise.all(LOGISTICS_VEHICLE_IDS.map(vehicleId => evaluateAuthority(repository, { principal, appId: "logistics", resource: "logistics.driver", action: "Contribute", scope: { kind: "resource", ids: [vehicleId] } }, context)));
  if (decisions.some(item => item.reasonCode === "store-unavailable")) throw Object.assign(new Error("Driver authority is unavailable."), { status: 503 });
  const permittedDriverVehicleIds = LOGISTICS_VEHICLE_IDS.filter((_, index) => decisions[index].allowed);
  return permittedDriverVehicleIds.length ? { driverId: identity.id, displayName: identity.displayName, permittedDriverVehicleIds } : undefined;
}

export async function listLogisticsDrivers(repository: AuthModRepository): Promise<LogisticsDriverOption[]> {
  // Read only driver grants, then known identities. Never scan workforce identities.
  const grants = await repository.listLogisticsDriverGrants();
  const ids = [...new Set(grants.filter(item => item.subjectType === "interactive" && item.appId === "logistics" && item.resource === "logistics.driver" && item.action === "Contribute" && isEffective(item)).map(item => item.subjectId))];
  const drivers = await Promise.all(ids.map(id => resolveLogisticsDriver(repository, id)));
  return drivers.filter((item): item is LogisticsDriverOption => Boolean(item)).sort((a, b) => a.displayName.localeCompare(b.displayName));
}
