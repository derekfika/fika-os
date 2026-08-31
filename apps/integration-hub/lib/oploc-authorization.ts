import { createAuthModEvaluationContext, resolveUserAccess } from "./authmod-core/evaluator";
import type { AuthModRepository } from "./authmod-core/repository";
import type { AuthPrincipal } from "./authmod-core/model";
import type { OplocReadPackage } from "./oploc-read-package";

type PermittedOplocInput = {
  repository: AuthModRepository;
  principal: AuthPrincipal;
  activeOplocs: Array<{ id: string; label: string; active: boolean }>;
  appId?: string;
};

/** Resolve visibility from AUTHMOD only; package contents are never consulted. */
export async function resolvePermittedOplocIds(input: PermittedOplocInput) {
  const applications = await input.repository.listApplications();
  const candidates = applications.filter((application) => application.scopeModel !== "none" && (!input.appId || application.appId === input.appId));
  const context = createAuthModEvaluationContext(input.repository, input.principal, input.activeOplocs);
  const permitted = new Set<string>();

  for (const application of candidates) {
    const appAccess = await resolveUserAccess(input.repository, { principal: input.principal, appId: application.appId }, context);
    if (appAccess.reasonCode === "store-unavailable") throw authmodUnavailable();
    if (!appAccess.allowed) continue;
    const decisions = await Promise.all(input.activeOplocs.map((oploc) => resolveUserAccess(input.repository, { principal: input.principal, appId: application.appId, oplocId: oploc.id }, context)));
    decisions.forEach((decision, index) => {
      if (decision.reasonCode === "store-unavailable") throw authmodUnavailable();
      if (decision.allowed) permitted.add(input.activeOplocs[index].id);
    });
  }
  return permitted;
}

export function filterAuthorizedOplocs(value: OplocReadPackage, permittedOplocIds: ReadonlySet<string>): OplocReadPackage {
  return { oplocs: value.oplocs.filter((oploc) => permittedOplocIds.has(oploc.canonicalId)) };
}

function authmodUnavailable() {
  return Object.assign(new Error("AUTHMOD authorization data is unavailable."), { status: 503, code: "AUTHMOD_STORE_UNAVAILABLE" });
}
