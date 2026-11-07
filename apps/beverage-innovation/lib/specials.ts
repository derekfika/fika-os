import type { BeverageActor } from "./runtime";
import type { BeverageRecord, MonthlySpecialRecord } from "./contracts";

export type SpecialDraft = Pick<MonthlySpecialRecord, "title" | "beverageId" | "beverageVersionId" | "month" | "startDate" | "endDate" | "targetSites" | "notes">;

export function createMonthlySpecial(input: SpecialDraft, beverage: BeverageRecord, actor: BeverageActor, id: string, at: string): MonthlySpecialRecord {
  if (!beverage.versions.some(version => version.id === input.beverageVersionId)) throw Object.assign(new Error("Choose a version that exists in the beverage history."), { status: 422, code: "BEVERAGE_VERSION_NOT_FOUND" });
  if (input.beverageId !== beverage.id) throw Object.assign(new Error("The beverage ID does not match the selected recipe."), { status: 422, code: "BEVERAGE_LINK_MISMATCH" });
  if (input.targetSites.some(site => !actor.scopeOplocIds.includes(site.oplocId))) throw Object.assign(new Error("The local AUTHMOD fixture does not cover every selected site."), { status: 403, code: "AUTHMOD_OPLOC_DENIED" });
  if (new Set(input.targetSites.map(site => site.oplocId)).size !== input.targetSites.length) throw Object.assign(new Error("A site can only be assigned once to a launch window."), { status: 422, code: "BEVERAGE_SPECIAL_SITE_DUPLICATE" });
  return { ...input, id, schemaVersion: 1, aggregateVersion: 1, status: "draft", createdAt: at, updatedAt: at, createdBy: actor.authmodIdentityId, updatedBy: actor.authmodIdentityId };
}

export function updateMonthlySpecial(current: MonthlySpecialRecord, patch: Partial<Pick<MonthlySpecialRecord, "title" | "startDate" | "endDate" | "month" | "targetSites" | "notes">>, actor: BeverageActor, at: string): MonthlySpecialRecord {
  if (current.status === "cancelled" || current.status === "ended") throw Object.assign(new Error("Completed or cancelled launch windows are historical and cannot be edited."), { status: 409, code: "BEVERAGE_SPECIAL_IMMUTABLE" });
  if (patch.targetSites && patch.targetSites.some(site => !actor.scopeOplocIds.includes(site.oplocId))) throw Object.assign(new Error("The local AUTHMOD fixture does not cover every selected site."), { status: 403, code: "AUTHMOD_OPLOC_DENIED" });
  if (patch.targetSites && new Set(patch.targetSites.map(site => site.oplocId)).size !== patch.targetSites.length) throw Object.assign(new Error("A site can only be assigned once to a launch window."), { status: 422, code: "BEVERAGE_SPECIAL_SITE_DUPLICATE" });
  return { ...current, ...patch, updatedAt: at, updatedBy: actor.authmodIdentityId };
}

export function transitionMonthlySpecial(current: MonthlySpecialRecord, beverage: BeverageRecord, to: MonthlySpecialRecord["status"], actor: BeverageActor, at: string): MonthlySpecialRecord {
  const allowed: Record<MonthlySpecialRecord["status"], MonthlySpecialRecord["status"][]> = {
    draft: ["scheduled", "cancelled"], scheduled: ["live", "cancelled"], live: ["ended"], ended: [], cancelled: [],
  };
  if (!allowed[current.status].includes(to)) throw Object.assign(new Error(`Cannot move a ${current.status} special to ${to}.`), { status: 422, code: "BEVERAGE_SPECIAL_TRANSITION_INVALID" });
  if (to === "scheduled") {
    const version = beverage.versions.find(item => item.id === current.beverageVersionId);
    if (version?.status !== "approved") throw Object.assign(new Error("Schedule a monthly special only from an approved beverage version."), { status: 409, code: "BEVERAGE_SPECIAL_VERSION_NOT_APPROVED" });
    if (!current.targetSites.some(site => site.assigned)) throw Object.assign(new Error("Assign at least one site before scheduling."), { status: 422, code: "BEVERAGE_SPECIAL_SITES_REQUIRED" });
    if (current.targetSites.some(site => site.assigned && site.blockers.length)) throw Object.assign(new Error("Resolve launch blockers before scheduling."), { status: 409, code: "BEVERAGE_SPECIAL_BLOCKED" });
  }
  return { ...current, status: to, aggregateVersion: current.aggregateVersion + 1, updatedAt: at, updatedBy: actor.authmodIdentityId };
}
