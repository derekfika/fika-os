import { CANONICAL_ALLERGEN_COLUMNS, isCompleteOperationalAllergenMap } from "../../../shared/allergen-contract";
import { unresolvedNamedAllergenKeys } from "./allergen-review-state";
import type { PlanStatus, PlannedMenuItem, ProductionPlan } from "./production-plan";

/** The current canonical matrix is complete only when every row is named, checked and fully recorded. */
export function isProductionPlanMatrixComplete(menuItems: PlannedMenuItem[]) {
  return menuItems.length > 0 && menuItems.every((item) => item.name.trim() && item.subItems.length > 0 && item.subItems.every((subItem) => subItem.name.trim() && subItem.evidenceStatus === "completed" && isCompleteOperationalAllergenMap(subItem.allergens)));
}

/** Existing signatures/releases remain a separate lock from the unsigned planned-state repair. */
export function hasAllergenAuthority(plan: Pick<ProductionPlan, "signatures" | "signedSignatures" | "signedMenuContentHash" | "currentAllergenRelease" | "matrixArtifact" | "signedMatrixArtifact" | "masterMatrixArtifact" | "siteMatrixArtifacts">) {
  return Boolean(plan.currentAllergenRelease || plan.signatures?.length || plan.signedSignatures?.length || plan.signedMenuContentHash || plan.matrixArtifact || plan.signedMatrixArtifact || plan.masterMatrixArtifact || plan.siteMatrixArtifacts);
}

/** A stale planned value cannot lock an incomplete current matrix. */
export function effectiveProductionPlanStatus(plan: Pick<ProductionPlan, "status" | "menuItems">): PlanStatus {
  return plan.status === "planned" && !isProductionPlanMatrixComplete(plan.menuItems) ? "planning" : plan.status;
}

export function mergeMissingProductionOrderLines(plan: ProductionPlan, orderId: string, lines: Array<{ canonicalId: string; itemName: string; customerQuantity: number }>) {
  const existing = new Set(plan.menuItems.map((item) => item.sourceLineId || item.id));
  const missing = lines.filter((line) => !existing.has(line.canonicalId)).map((line, index) => ({ id: `menu-item:${orderId}:original:${index}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${orderId}:original:${index}`, name: "", quantity: line.customerQuantity, allergens: {}, note: "", evidenceStatus: "not_completed" as const }] }));
  const sourceName = new Map(lines.map((line) => [line.canonicalId, line.itemName] as const));
  const sameName = (left: string, right: string) => left.trim().toLocaleLowerCase("en-GB") === right.trim().toLocaleLowerCase("en-GB");
  // A reviewed dish whose Production Order line was renamed is a different dish: it takes the new source name and every row is
  // reopened (unrecorded, unconfirmed). The baseline is server-owned; an item with no baseline simply adopts the current name.
  const reconciled = plan.menuItems.map((item) => {
    const current = item.sourceLineId ? sourceName.get(item.sourceLineId) : undefined;
    if (current === undefined) return item;
    if (item.sourceItemName === undefined || sameName(item.sourceItemName, current)) return item.sourceItemName === current ? item : { ...item, sourceItemName: current };
    return { ...item, name: current, sourceItemName: current, subItems: item.subItems.map(({ allergenReview: _dropped, ...sub }) => ({ ...sub, allergens: {}, mayContainNotes: "", evidenceStatus: "not_completed" as const })) };
  });
  const changed = reconciled.some((item, index) => item !== plan.menuItems[index]);
  const base = changed ? { ...plan, menuItems: reconciled } : plan;
  const next = missing.length ? { ...base, menuItems: [...base.menuItems, ...missing.map((item) => ({ ...item, sourceItemName: item.name }))] } : base;
  return { ...next, status: effectiveProductionPlanStatus(next) };
}

export type AllergenReviewProblem = {
  itemId: string;
  itemName: string;
  rowId?: string;
  rowName?: string;
  kind: "no-rows" | "item-unnamed" | "row-unnamed" | "row-unchecked" | "allergens-not-recorded";
  allergens: string[];
};

/**
 * Everything that still blocks sign-off for the current matrix. Unrecorded allergens are never assumed clear:
 * every named allergen of every relevant row must be explicitly clear, contains or may contain, and every row checked.
 */
export function allergenReviewProblems(menuItems: PlannedMenuItem[]): AllergenReviewProblem[] {
  if (!menuItems.length) return [{ itemId: "", itemName: "This order", kind: "no-rows", allergens: [] }];
  const label = (key: string) => CANONICAL_ALLERGEN_COLUMNS.find(([candidate]) => candidate === key)?.[1] || key;
  const problems: AllergenReviewProblem[] = [];
  for (const item of menuItems) {
    const itemName = item.name.trim() || "Unnamed menu item";
    if (!item.name.trim()) problems.push({ itemId: item.id, itemName, kind: "item-unnamed", allergens: [] });
    if (!item.subItems.length) { problems.push({ itemId: item.id, itemName, kind: "no-rows", allergens: [] }); continue; }
    for (const row of item.subItems) {
      const rowName = row.name.trim() || "Unnamed row";
      const base = { itemId: item.id, itemName, rowId: row.id, rowName };
      if (!row.name.trim()) problems.push({ ...base, kind: "row-unnamed", allergens: [] });
      // An unreviewed row has one requirement: the chef confirms it with Mark checked (white cells then become confirmed Clear).
      // Only a row already marked checked yet still holding unconfirmed allergens (legacy data) needs a fresh, explicit review.
      if (row.evidenceStatus !== "completed") { problems.push({ ...base, kind: "row-unchecked", allergens: [] }); continue; }
      const unresolved = unresolvedNamedAllergenKeys(row.allergens).map(label);
      if (unresolved.length) problems.push({ ...base, kind: "allergens-not-recorded", allergens: unresolved });
    }
  }
  return problems;
}

export function describeAllergenReviewProblem(problem: AllergenReviewProblem) {
  const where = problem.rowName ? `${problem.itemName} › ${problem.rowName}` : problem.itemName;
  switch (problem.kind) {
    case "no-rows": return `${where}: add at least one row to review.`;
    case "item-unnamed": return `${where}: give the menu item a name.`;
    case "row-unnamed": return `${where}: name this row.`;
    case "row-unchecked": return `${where}: review the row, then press Mark checked (empty allergens are recorded as Clear).`;
    case "allergens-not-recorded": return `${where}: ${problem.allergens.length} allergen${problem.allergens.length === 1 ? " was" : "s were"} never confirmed (${problem.allergens.join(", ")}). Press Mark checked again to confirm the row; empty allergens are recorded as Clear.`;
  }
}

/**
 * The persisted revision of a plan as an opaque token. `null` means no plan has been stored yet (initial creation);
 * a stored plan that pre-dates revision stamps maps to a fixed legacy token so it can still be saved once and is then stamped.
 */
export const LEGACY_PLAN_REVISION = "legacy-unversioned";
export const planRevisionToken = (plan?: Pick<ProductionPlan, "updatedAt">): string | null => plan ? (plan.updatedAt || LEGACY_PLAN_REVISION) : null;

/** Null when the save is based on the stored revision; otherwise the 409 to return. Nothing is written on a mismatch. */
export function reviewRevisionConflict(expectedRevision: string | null, stored?: Pick<ProductionPlan, "updatedAt">): (Error & { status: number; code: string; currentRevision: string | null }) | null {
  const currentRevision = planRevisionToken(stored);
  if (expectedRevision === currentRevision) return null;
  return Object.assign(new Error("This allergen review was changed by someone else after you opened it, so your edits were not saved. Copy anything you need, reload the review to see the latest evidence and signatures, then re-apply your changes."), { status: 409, code: "CPU_ALLERGEN_REVIEW_CONFLICT", currentRevision });
}

/** A revision stamp that is always strictly later than the previous one, even for two saves inside the same millisecond. */
export function nextPlanRevisionStamp(nowIso: string, previous?: string): string {
  if (!previous || previous === LEGACY_PLAN_REVISION || Date.parse(nowIso) > Date.parse(previous)) return nowIso;
  return new Date(Date.parse(previous) + 1).toISOString();
}
