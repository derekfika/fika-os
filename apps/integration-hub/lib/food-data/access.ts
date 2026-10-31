import { isEffective, type AuthModRepository } from "../authmod-core";
import { FOOD_DATA_GRANT } from "./config";

/**
 * Food Data access is an explicit, effective AUTHMOD grant held by an active person. Nothing is cached and
 * AUTHMOD Administrators get no implicit access: they can grant themselves the authority, visibly and audited.
 * One bounded targeted grant read per request.
 */
export async function hasFoodDataAccess(repository: AuthModRepository, identityId: string, at = new Date()) {
  const identity = await repository.getIdentity(identityId);
  if (!identity || identity.identityKind !== "person" || identity.status !== "active") return false;
  const grants = await repository.listAuthorityGrantsForDecision({ subjectId: identityId, subjectType: "interactive", ...FOOD_DATA_GRANT });
  return grants.some(grant => grant.subjectId === identityId && grant.subjectType === "interactive" && grant.appId === FOOD_DATA_GRANT.appId && grant.resource === FOOD_DATA_GRANT.resource && grant.action === FOOD_DATA_GRANT.action && grant.scope.kind === "organisation" && isEffective(grant, at));
}
