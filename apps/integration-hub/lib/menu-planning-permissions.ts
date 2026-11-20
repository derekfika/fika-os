import { applicationAccessPolicy, applicationAssignmentId } from "./authmod-core/application-access-levels";
import { createAuthModEvaluationContext, evaluateAuthority, resolveUserAccess, type AuthModEvaluationContext } from "./authmod-core/evaluator";
import type { ApplicationAccessLevel, AuthPrincipal, Scope } from "./authmod-core/model";
import type { AuthModRepository } from "./authmod-core/repository";
import { resolvePermittedOplocIds } from "./oploc-authorization";

export const MENU_PLANNING_APP = "menu-planning";
const MENU_PLANNING_NORMAL = applicationAccessPolicy(MENU_PLANNING_APP)!.resource;
const organisation: Scope = { kind: "organisation", ids: [] };

function checkAvailability(decision: { reasonCode: string; allowed: boolean }) {
  if (decision.reasonCode === "store-unavailable") throw Object.assign(new Error("Menu Planning authorization data is unavailable."), { status: 503, code: "AUTHMOD_STORE_UNAVAILABLE" });
  return decision.allowed;
}

async function menuPlanningCanManage(repository: AuthModRepository, principal: AuthPrincipal, scope: Scope, context: AuthModEvaluationContext) {
  return checkAvailability(await evaluateAuthority(repository, {
    principal, appId: MENU_PLANNING_APP, resource: MENU_PLANNING_NORMAL, action: "Manage", scope,
  }, context));
}

const oplocScope = (id: string): Scope => ({ kind: "oploc", ids: [id] });

export async function readMenuPlanningWritePermissions(repository: AuthModRepository, principal: AuthPrincipal, oplocIds: string[], context: AuthModEvaluationContext) {
  const decisions = await Promise.all(oplocIds.map(id => menuPlanningCanManage(repository, principal, oplocScope(id), context)));
  const manageOplocIds = oplocIds.filter((_, index) => decisions[index]);
  if (!manageOplocIds.length) return { manageOplocIds, publishOplocIds: [], canManageOrganisation: false, canPublishOrganisation: false };
  const canPublish = async (scope: Scope) => checkAvailability(await evaluateAuthority(repository, {
    principal, appId: MENU_PLANNING_APP, resource: "menu.publish", action: "Publish", scope,
  }, context));
  const [canManageOrganisation, organisationPublish] = await Promise.all([
    menuPlanningCanManage(repository, principal, organisation, context), canPublish(organisation),
  ]);
  // Legacy grants may confer Publish at a subset of the managed sites.
  const publishDecisions = organisationPublish ? undefined : await Promise.all(manageOplocIds.map(id => canPublish(oplocScope(id))));
  const publishOplocIds = manageOplocIds.filter((_, index) => organisationPublish || publishDecisions?.[index]);
  return { manageOplocIds, publishOplocIds, canManageOrganisation, canPublishOrganisation: canManageOrganisation && organisationPublish };
}

export async function readMenuPlanningAccountPermissions(repository: AuthModRepository, principal: AuthPrincipal) {
  // Use authority records on the admin screen so a failed package publication
  // can be shown alongside the successfully committed permission change.
  const context = createAuthModEvaluationContext(repository, principal, [], { useRuntimePackage: false });
  const assignment = (await context.appAssignments()).find(value => value.id === applicationAssignmentId(principal.id, MENU_PLANNING_APP));
  const admitted = checkAvailability(await resolveUserAccess(repository, { principal, appId: MENU_PLANNING_APP }, context));
  const scope = admitted ? await resolvePermittedOplocIds({ repository, principal, appId: MENU_PLANNING_APP }, context) : { all: false, ids: new Set<string>() };
  const oplocIds = scope.all ? (await context.activeOplocs()).map(oploc => oploc.id) : [...scope.ids];
  const canManage = await Promise.all(oplocIds.map(id => menuPlanningCanManage(repository, principal, oplocScope(id), context)));
  const manageOplocIds = oplocIds.filter((_, index) => canManage[index]);
  const effectiveLevel: ApplicationAccessLevel = !admitted ? "none" : manageOplocIds.length ? "manage" : "view";
  return { effectiveLevel, configuredLevel: assignment?.permissionLevel, version: assignment?.version ?? 0, allOplocs: scope.all, oplocIds, manageOplocIds };
}
