import { isEffective, type ApplicationRegistryEntry, type AuthModAction, type AuthorizationDecision, type EffectivePeriod } from "./model";
import type { AuthModRepository, AuthmodRuntimeAccessPackage } from "./repository";

export const BEVERAGE_AUTHMOD_APP_ID = "beverage-innovation";
export const BEVERAGE_AUTHMOD_NORMAL_RESOURCE = "beverage-innovation.normal";
export const BEVERAGE_AUTHMOD_APPROVAL_RESOURCE = "beverage-innovation.approval";
export const BEVERAGE_AUTHMOD_NORMAL_BUNDLE = "beverage-innovation-normal";
export const BEVERAGE_AUTHMOD_NORMAL_ACTIONS = ["View", "Contribute", "Manage"] as const;
export const MAX_BEVERAGE_OPLOC_SCOPE = 100;

// The regular runtime readers can rebuild and publish missing packages.
// Adapters must supply current-only, read-only package readers.
export type ReadOnlyBeverageAuthority = Pick<AuthModRepository, "findIdentitiesByExternal" | "getApplication" | "getActiveOploc"> & {
  readCurrentAccessPackage(identityId: string): Promise<Pick<AuthmodRuntimeAccessPackage, "identity" | "appAssignments" | "authorityGrants">>;
  readCurrentOplocRedirects(): Promise<Readonly<Record<string, string>>>;
};

type VerifySessionCookie = (cookie: string, checkRevoked: true) => Promise<{ uid: string }>;
type WithAuthoritySnapshot = (read: (repository: ReadOnlyBeverageAuthority) => Promise<AuthorizationDecision>) => Promise<AuthorizationDecision>;

export function isEffectiveBeverageAccess(record: EffectivePeriod & { status: string }, at: Date) {
  return [record.effectiveFrom, record.effectiveTo].every(value => value === undefined || Number.isFinite(Date.parse(value))) &&
    isEffective(record, at);
}

export function validBeverageOplocId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 160 && id.trim() === id && !/[\p{Cc}\p{Cf}]/u.test(id);
}

function canonicalOplocId(redirects: Readonly<Record<string, string>>, id: string) {
  if (!Object.hasOwn(redirects, id)) return id;
  const canonical = redirects[id];
  if (!validBeverageOplocId(canonical) || Object.hasOwn(redirects, canonical)) {
    throw new Error("Beverage authorization requires final canonical OPLOC redirects.");
  }
  return canonical;
}

export function isBeverageApplication(app: ApplicationRegistryEntry | undefined): app is ApplicationRegistryEntry {
  return Boolean(app?.appId === BEVERAGE_AUTHMOD_APP_ID && app.enabled === true && app.launchVisible === false &&
    app.scopeModel === "oploc" && app.standardResource === BEVERAGE_AUTHMOD_NORMAL_RESOURCE &&
    app.standardBundleId === BEVERAGE_AUTHMOD_NORMAL_BUNDLE && Array.isArray(app.standardActions) &&
    ((app.standardActions.length === 1 && app.standardActions[0] === "View") ||
     (app.standardActions.length === BEVERAGE_AUTHMOD_NORMAL_ACTIONS.length &&
      BEVERAGE_AUTHMOD_NORMAL_ACTIONS.every(action => app.standardActions.includes(action)))));
}

export function beverageApplicationAllowsAction(app: ApplicationRegistryEntry, action: AuthModAction) {
  return action === "Approve" ? app.standardActions.length === BEVERAGE_AUTHMOD_NORMAL_ACTIONS.length : app.standardActions.includes(action);
}

/** Server-side foundation. Only a verified Firebase cookie can supply the UID. */
export async function decideBeverageSiteAuthority(
  withAuthoritySnapshot: WithAuthoritySnapshot,
  verifySessionCookie: VerifySessionCookie,
  input: { sessionCookie?: string; action: AuthModAction; oplocIds: readonly string[] },
): Promise<AuthorizationDecision> {
  const decision: AuthorizationDecision = {
    allowed: false, principalId: "", principalType: "interactive", appId: BEVERAGE_AUTHMOD_APP_ID,
    action: input.action, matchedGrantIds: [], reasonCode: "unauthenticated",
  };
  const deny = (reasonCode: AuthorizationDecision["reasonCode"]) => ({ ...decision, reasonCode });
  const isNormalAction = (BEVERAGE_AUTHMOD_NORMAL_ACTIONS as readonly AuthModAction[]).includes(input.action);
  if ((!isNormalAction && input.action !== "Approve") || !Array.isArray(input.oplocIds) || !input.oplocIds.length ||
      input.oplocIds.length > MAX_BEVERAGE_OPLOC_SCOPE || !input.oplocIds.every(validBeverageOplocId)) return deny("invalid-request");
  if (!input.sessionCookie) return decision;
  let verified: { uid: string };
  try { verified = await verifySessionCookie(input.sessionCookie, true); }
  catch { return decision; }
  if (typeof verified?.uid !== "string" || !verified.uid) return decision;

  try {
    return await withAuthoritySnapshot(repository => decideFromSnapshot(repository, verified.uid, input, decision));
  } catch {
    return deny("store-unavailable");
  }
}

async function decideFromSnapshot(
  repository: ReadOnlyBeverageAuthority, uid: string,
  input: { action: AuthModAction; oplocIds: readonly string[] }, decision: AuthorizationDecision,
): Promise<AuthorizationDecision> {
  const deny = (reasonCode: AuthorizationDecision["reasonCode"]) => ({ ...decision, reasonCode });
  const action = input.action;
  const identities = await repository.findIdentitiesByExternal("firebase", uid, 2);
  const identity = identities[0];
  if (identities.length !== 1 || !identity?.id || identity.externalProvider !== "firebase" || identity.externalUid !== uid) return decision;
  decision.principalId = identity.id;
  const at = new Date();
  if (!isEffectiveBeverageAccess(identity, at)) return deny("identity-inactive");
  if (identity.identityKind !== "person") return deny("authority-not-granted");

  const app = await repository.getApplication(BEVERAGE_AUTHMOD_APP_ID);
  if (!isBeverageApplication(app)) return deny("app-disabled");
  if (!beverageApplicationAllowsAction(app, action)) return deny("authority-not-granted");

  const access = await repository.readCurrentAccessPackage(identity.id);
  const current = access.identity;
  if (!Number.isSafeInteger(identity.version) || identity.version < 1 ||
      current.id !== identity.id || current.externalProvider !== "firebase" || current.externalUid !== uid ||
      current.version !== identity.version) return deny("store-unavailable");
  if (!isEffectiveBeverageAccess(current, at)) return deny("identity-inactive");
  if (current.identityKind !== "person") return deny("authority-not-granted");
  const assignment = access.appAssignments.find(value => value.identityId === identity.id &&
    value.appId === BEVERAGE_AUTHMOD_APP_ID && value.accessType !== "delegated" && isEffectiveBeverageAccess(value, at));
  if (!assignment) return deny("app-not-assigned");

  const redirects = await repository.readCurrentOplocRedirects();
  const canonical = (id: string) => canonicalOplocId(redirects, id);
  const ids = [...new Set(input.oplocIds.map(canonical))];
  const sites = await Promise.all(ids.map(id => repository.getActiveOploc(id)));
  if (!sites.every((site, index) => site?.active === true && site.id === ids[index])) return deny("oploc-not-assigned");
  decision.scope = { kind: "oploc", ids };

  const resource = action === "Approve" ? BEVERAGE_AUTHMOD_APPROVAL_RESOURCE : BEVERAGE_AUTHMOD_NORMAL_RESOURCE;
  const matched = access.authorityGrants.filter(grant => {
    if (grant.subjectType !== "interactive" || grant.subjectId !== identity.id || grant.appId !== BEVERAGE_AUTHMOD_APP_ID ||
        grant.resource !== resource || grant.action !== action || !isEffectiveBeverageAccess(grant, at) ||
        grant.accessType === "delegated" || grant.delegationSourceGrantId) return false;
    return grant.scope.kind === "oploc" && grant.provenance === "explicit-special-authority" &&
      grant.scope.ids.length <= MAX_BEVERAGE_OPLOC_SCOPE &&
      new Set(grant.scope.ids).size === grant.scope.ids.length &&
      grant.scope.ids.every(id => validBeverageOplocId(id) && !Object.hasOwn(redirects, id)) &&
      ids.every(id => grant.scope.ids.includes(id));
  });
  if (!matched.length) return deny("authority-not-granted");
  const validUntil = [current, assignment, ...matched]
    .map(value => value.effectiveTo).filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  return { ...decision, allowed: true, reasonCode: "allowed", matchedGrantIds: matched.map(value => value.id), ...(validUntil ? { validUntil } : {}) };
}
