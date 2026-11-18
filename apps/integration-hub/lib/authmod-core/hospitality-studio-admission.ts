import { idempotentId, isEffective, type EffectivePeriod } from "./model";
import type { AuthModRepository, AuthmodRuntimeAccessPackage } from "./repository";

export const STUDIO_AUTHMOD_APP = "hospitality-menu-studio";
export const STUDIO_PREVIEW_RESOURCE = "hospitality-menu-studio.preview";
export const STUDIO_PREVIEW_BUNDLE = "hospitality-menu-studio-preview";
export const STUDIO_STAGING_ORIGIN = "https://menu-studio-staging.fikacatering.com";
export const STUDIO_AUTH_HUB_ORIGIN = "https://staging-os.fikacatering.com";
const STAGING_HUB_RUN_HOST = "fika-os-staging-594727519934.europe-west4.run.app";

export function isStudioAuthHubRequestHost(host: string | null) {
  // App Hosting forwards the custom domain to this exact managed Cloud Run service.
  return host === new URL(STUDIO_AUTH_HUB_ORIGIN).host || host === STAGING_HUB_RUN_HOST;
}
const directAccessTypes = [undefined, "permanent", "temporary", "cover"];

type StudioSession = { authmodIdentityId: string; firebaseUid: string; identityKind: "person" | "operational" };
type PreviewAuthority = Pick<AuthModRepository, "getApplication"> & {
  readCurrentAccess(identityId: string): Promise<Pick<AuthmodRuntimeAccessPackage, "identity" | "authorityGrants" | "appAssignments">>;
};

function effectiveDirect(record: EffectivePeriod & { status: string; accessType?: string }, at: Date) {
  return directAccessTypes.includes(record.accessType) &&
    [record.effectiveFrom, record.effectiveTo].every(value => value === undefined || (typeof value === "string" && Number.isFinite(Date.parse(value)))) &&
    isEffective(record, at);
}

/** The adapter supplies a verified, already-bound session and a current-only AUTHMOD reader. */
export async function readStudioPreviewAccess(authority: PreviewAuthority, session: StudioSession, at = new Date()) {
  if (session.identityKind !== "person" || !session.authmodIdentityId || !session.firebaseUid) return null;
  const app = await authority.getApplication(STUDIO_AUTHMOD_APP);
  if (app?.appId !== STUDIO_AUTHMOD_APP || app.enabled !== true || app.launchVisible !== false ||
      app.baseUrl !== STUDIO_STAGING_ORIGIN || app.scopeModel !== "none" || app.standardBundleId !== STUDIO_PREVIEW_BUNDLE ||
      app.standardResource !== STUDIO_PREVIEW_RESOURCE || app.standardActions?.length !== 1 || app.standardActions[0] !== "View") {
    return null;
  }

  const { identity, appAssignments, authorityGrants } = await authority.readCurrentAccess(session.authmodIdentityId);
  if (identity.id !== session.authmodIdentityId || identity.externalProvider !== "firebase" ||
      identity.externalUid !== session.firebaseUid || identity.identityKind !== "person") {
    throw Object.assign(new Error("Studio AUTHMOD binding did not match the current access package."), { status: 503 });
  }
  if (!effectiveDirect(identity, at)) return null;
  const assigned = appAssignments.some(assignment => assignment.identityId === identity.id &&
    assignment.appId === STUDIO_AUTHMOD_APP && assignment.source === "standard-app-access" &&
    assignment.bundleId === idempotentId("standard-app-access", identity.id, STUDIO_AUTHMOD_APP) && effectiveDirect(assignment, at));
  if (!assigned) return null;
  const permits = (action: "View" | "Manage") => authorityGrants.some(grant =>
    grant.subjectId === identity.id && grant.subjectType === "interactive" &&
    grant.appId === STUDIO_AUTHMOD_APP && grant.resource === STUDIO_PREVIEW_RESOURCE && grant.action === action &&
    grant.provenance === "explicit-special-authority" && grant.scope.kind === "organisation" &&
    Array.isArray(grant.scope.ids) && grant.scope.ids.length === 0 && grant.delegationSourceGrantId === undefined && effectiveDirect(grant, at));
  if (!permits("View")) return null;
  return {
    principal: { id: identity.id, displayName: identity.displayName },
    permissions: { View: true as const, ...(permits("Manage") ? { Manage: true as const } : {}) },
  };
}
