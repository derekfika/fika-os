import { idempotentId, isEffective } from "./authmod-core/model";
import { readStudioPreviewAccess, STUDIO_AUTHMOD_APP } from "./authmod-core/hospitality-studio-admission";
import type { FirestoreAuthModRepository } from "./authmod-core/firestore-repository";
import type { FikaSessionPrincipal } from "./fika-session";

export const studioPublicationResource = "hospitality-menu-studio.publication";
const activationResources = {
  "activate-seasonal": "hospitality-menu-studio.seasonal-activation",
  "activate-collection": "hospitality-menu-studio.collection-activation",
} as const;
type ActivationAction = keyof typeof activationResources;
type Repository = Pick<FirestoreAuthModRepository, "getApplication" | "getAuthorityGrant" | "getRuntimeAccessPackage">;

export async function studioPublicationAuthority(repository: Repository, session: FikaSessionPrincipal, action: ActivationAction | "publish") {
  const studio = await readStudioPreviewAccess({
    getApplication: id => repository.getApplication(id),
    readCurrentAccess: id => repository.getRuntimeAccessPackage(id),
  }, session);
  if (!studio?.permissions.Manage) return false;
  const resource = action === "publish" ? studioPublicationResource : activationResources[action];
  const permission = action === "publish" ? "Publish" : "Approve";
  const grant = await repository.getAuthorityGrant(idempotentId("authority", "interactive", session.authmodIdentityId,
    STUDIO_AUTHMOD_APP, resource, permission, "organisation"));
  return Boolean(grant && grant.appId === STUDIO_AUTHMOD_APP && grant.resource === resource && grant.action === permission &&
    grant.subjectType === "interactive" && grant.subjectId === session.authmodIdentityId &&
    grant.provenance === "explicit-special-authority" && grant.scope.kind === "organisation" &&
    Array.isArray(grant.scope.ids) && grant.scope.ids.length === 0 && grant.delegationSourceGrantId === undefined &&
    (grant.accessType === undefined || grant.accessType === "permanent" || grant.accessType === "temporary") &&
    [grant.effectiveFrom, grant.effectiveTo].every(value => value === undefined || Number.isFinite(Date.parse(value))) && isEffective(grant));
}
