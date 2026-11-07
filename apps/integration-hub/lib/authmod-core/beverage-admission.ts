import { isEffective, type AuthModAction, type AuthorizationDecision, type EffectivePeriod } from "./model";
import type { AuthModRepository, AuthmodRuntimeAccessPackage } from "./repository";

export const BEVERAGE_AUTHMOD_APP_ID = "beverage-innovation";
export const BEVERAGE_AUTHMOD_NORMAL_RESOURCE = "beverage-innovation.normal";
export const BEVERAGE_AUTHMOD_APPROVAL_RESOURCE = "beverage-innovation.approval";
export const BEVERAGE_AUTHMOD_NORMAL_BUNDLE = "beverage-innovation-normal";
export const BEVERAGE_AUTHMOD_NORMAL_ACTIONS = ["View", "Contribute", "Manage"] as const;
const MAX_SITE_SCOPE = 100;

// The regular runtime readers can rebuild and publish missing packages. A
// future transport must wire these two readers to current-only, read-only
// package access. This contract intentionally does not accept the live repo.
export type ReadOnlyBeverageAuthority = Pick<AuthModRepository, "findIdentitiesByExternal" | "getApplication" | "getActiveOploc"> & {
  readCurrentAccessPackage(identityId: string): Promise<AuthmodRuntimeAccessPackage>;
  readCurrentOplocRedirects(): Promise<Readonly<Record<string, string>>>;
};

type VerifySessionCookie = (cookie: string, checkRevoked: true) => Promise<{ uid: string }>;

function effective(record: EffectivePeriod & { status: string }, at: Date) {
  return [record.effectiveFrom, record.effectiveTo].every(value => value === undefined || Number.isFinite(Date.parse(value))) &&
    isEffective(record, at);
}

function validOplocId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 160 && id.trim() === id && !/[\p{Cc}\p{Cf}]/u.test(id);
}

function canonicalOplocId(redirects: Readonly<Record<string, string>>, id: string) {
  if (!Object.hasOwn(redirects, id)) return id;
  const canonical = redirects[id];
  if (!validOplocId(canonical) || Object.hasOwn(redirects, canonical)) {
    throw new Error("Beverage authorization requires final canonical OPLOC redirects.");
  }
  return canonical;
}

/** Server-side foundation. Only a verified Firebase cookie can supply the UID. */
export async function decideBeverageSiteAuthority(
  repository: ReadOnlyBeverageAuthority,
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
      input.oplocIds.length > MAX_SITE_SCOPE || !input.oplocIds.every(validOplocId)) return deny("invalid-request");
  const action = input.action;
  if (!input.sessionCookie) return decision;
  let verified: { uid: string };
  try { verified = await verifySessionCookie(input.sessionCookie, true); }
  catch { return decision; }
  if (typeof verified?.uid !== "string" || !verified.uid) return decision;

  try {
    const identities = await repository.findIdentitiesByExternal("firebase", verified.uid, 2);
    const identity = identities[0];
    if (identities.length !== 1 || !identity?.id || identity.externalProvider !== "firebase" || identity.externalUid !== verified.uid) return decision;
    decision.principalId = identity.id;
    const at = new Date();
    if (!effective(identity, at)) return deny("identity-inactive");

    const app = await repository.getApplication(BEVERAGE_AUTHMOD_APP_ID);
    if (app?.appId !== BEVERAGE_AUTHMOD_APP_ID || app.enabled !== true || app.launchVisible !== false ||
        app.scopeModel !== "oploc" || app.standardResource !== BEVERAGE_AUTHMOD_NORMAL_RESOURCE ||
        app.standardBundleId !== BEVERAGE_AUTHMOD_NORMAL_BUNDLE ||
        app.standardActions.length !== BEVERAGE_AUTHMOD_NORMAL_ACTIONS.length ||
        !BEVERAGE_AUTHMOD_NORMAL_ACTIONS.every(value => app.standardActions.includes(value))) return deny("app-disabled");

    const access = await repository.readCurrentAccessPackage(identity.id);
    const current = access.identity;
    if (!Number.isSafeInteger(identity.version) || identity.version < 1 ||
        current.id !== identity.id || current.externalProvider !== "firebase" || current.externalUid !== verified.uid ||
        current.version !== identity.version) return deny("store-unavailable");
    if (!effective(current, at)) return deny("identity-inactive");
    const assignment = access.appAssignments.find(value => value.identityId === identity.id &&
      value.appId === BEVERAGE_AUTHMOD_APP_ID && value.accessType !== "delegated" && effective(value, at));
    if (!assignment) return deny("app-not-assigned");

    const redirects = await repository.readCurrentOplocRedirects();
    const canonical = (id: string) => canonicalOplocId(redirects, id);
    const ids = [...new Set(input.oplocIds.map(canonical))];
    const assigned = new Map(access.siteAssignments.filter(value =>
      value.identityId === identity.id && value.accessType !== "delegated" && effective(value, at))
      .map(value => [canonical(value.oplocId), value]));
    if (!ids.every(id => assigned.has(id))) return deny("oploc-not-assigned");
    const sites = await Promise.all(ids.map(id => repository.getActiveOploc(id)));
    if (!sites.every((site, index) => site?.active === true && site.id === ids[index])) return deny("oploc-not-assigned");
    decision.scope = { kind: "oploc", ids };

    const resource = action === "Approve" ? BEVERAGE_AUTHMOD_APPROVAL_RESOURCE : BEVERAGE_AUTHMOD_NORMAL_RESOURCE;
    const matched = access.authorityGrants.filter(grant => {
      if (grant.subjectType !== "interactive" || grant.subjectId !== identity.id || grant.appId !== BEVERAGE_AUTHMOD_APP_ID ||
          grant.resource !== resource || grant.action !== action || !effective(grant, at) ||
          grant.accessType === "delegated" || grant.delegationSourceGrantId) return false;
      if (grant.scope.kind === "organisation") {
        return action !== "Approve" && grant.scope.ids.length === 0 && Boolean(assignment.bundleId) &&
          grant.provenance === "standard-app-access" && grant.bundleId === assignment.bundleId;
      }
      return grant.scope.kind === "oploc" && grant.provenance === "explicit-special-authority" &&
        ids.every(id => grant.scope.ids.some(value => canonical(value) === id));
    });
    if (!matched.length) return deny("authority-not-granted");
    const validUntil = [current, assignment, ...ids.map(id => assigned.get(id)!), ...matched]
      .map(value => value.effectiveTo).filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
    return { ...decision, allowed: true, reasonCode: "allowed", matchedGrantIds: matched.map(value => value.id), ...(validUntil ? { validUntil } : {}) };
  } catch {
    return deny("store-unavailable");
  }
}
