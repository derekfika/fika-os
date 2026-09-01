import { createAuthModEvaluationContext, resolveUserAccess } from "./authmod-core/evaluator";
import type { AuthModRepository } from "./authmod-core/repository";
import { isEffective, type AuthPrincipal } from "./authmod-core/model";
import type { OplocReadPackage } from "./oploc-read-package";

type PermittedOplocInput = {
  repository: AuthModRepository;
  principal: AuthPrincipal;
  appId?: string;
};

export type PermittedOplocScope = {
  all: boolean;
  ids: ReadonlySet<string>;
};

/** Resolve visibility from AUTHMOD only; package contents are never consulted. */
export async function resolvePermittedOplocIds(input: PermittedOplocInput): Promise<PermittedOplocScope> {
  const applications = await input.repository.listApplications();
  const candidates = applications.filter((application) => application.scopeModel !== "none" && (!input.appId || application.appId === input.appId));
  const context = createAuthModEvaluationContext(input.repository, input.principal);
  const permitted = new Set<string>();
  const identity = await context.identity();
  if (!identity) throw Object.assign(new Error("AUTHMOD identity could not be resolved."), { status: 401, code: "AUTHMOD_IDENTITY_UNRESOLVED" });
  if (identity.status !== "active") throw Object.assign(new Error("AUTHMOD identity is not active."), { status: 403, code: "AUTHMOD_IDENTITY_INACTIVE" });
  const assignedOplocIds = [...new Set((await context.siteAssignments()).filter(value => isEffective(value)).map(value => value.oplocId).filter(Boolean))];

  for (const application of candidates) {
    const appAccess = await resolveUserAccess(input.repository, { principal: input.principal, appId: application.appId }, context);
    if (appAccess.reasonCode === "store-unavailable") throw authmodUnavailable();
    if (!appAccess.allowed) continue;
    if (identity.identityKind === "person" && identity.fullAccess) return { all: true, ids: permitted };
    const decisions = await Promise.all(assignedOplocIds.map((oplocId) => resolveUserAccess(input.repository, { principal: input.principal, appId: application.appId, oplocId }, context)));
    decisions.forEach((decision, index) => {
      if (decision.reasonCode === "store-unavailable") throw authmodUnavailable();
      if (decision.allowed) permitted.add(assignedOplocIds[index]);
    });
  }
  return { all: false, ids: permitted };
}

export function isPermittedOploc(scope: PermittedOplocScope | ReadonlySet<string>, oplocId: string) {
  return "all" in scope ? scope.all || scope.ids.has(oplocId) : scope.has(oplocId);
}

export function filterAuthorizedOplocs(value: OplocReadPackage, scope: PermittedOplocScope | ReadonlySet<string>): OplocReadPackage {
  return { oplocs: value.oplocs.filter((oploc) => isPermittedOploc(scope, oploc.canonicalId)) };
}

function authmodUnavailable() {
  return Object.assign(new Error("AUTHMOD authorization data is unavailable."), { status: 503, code: "AUTHMOD_STORE_UNAVAILABLE" });
}
