import { createHash } from "node:crypto";
import { listCanonicalMenuItemsByIds } from "./canonical-menu-repository";
import { planMenuDuplicate, type DuplicateContent, type DuplicateExisting, type DuplicatePlan, type DuplicatePlacement, type DuplicateScope, type DuplicateTargetInput } from "./menu-duplicate";
import { publicationState } from "./menu-publication";
import type { GovernedOploc } from "./oploc-authority";
import { assertWeekDateAvailable, createWeekSnapshot, isCompletePlanningWeek, listWeeks, normaliseRollingSnapshotDestinations, planningWeekCommencing, saveSnapshot } from "./rolling-menu";
import { getWeekSnapshot } from "./operational-store";
import type { RollingSnapshot } from "./rolling-menu-types";

/**
 * Authoritative Duplicate Planning command. The client sends intent only; this
 * module loads source and destination state, recomputes the plan, and writes
 * only when the reviewed plan and every destination version still match.
 */

export type DuplicateDestinationRequest = { weekCommencing: string; placement: DuplicatePlacement };
export type DuplicateRequest = {
  mode: "preview" | "apply";
  sourceWeekId: string;
  scope: DuplicateScope;
  destinations: DuplicateDestinationRequest[];
  content: DuplicateContent;
  existing: DuplicateExisting;
  operationId: string;
  /** Destination week versions the reviewer saw. Apply rejects a stale destination. */
  expectedVersions?: Record<string, number>;
  /** Hash of the reviewed preview. Apply rejects when the recomputed plan differs. */
  planHash?: string;
};

const VALID_CONTENT: readonly DuplicateContent[] = ["menu", "portions", "menu-and-portions"];
const VALID_EXISTING: readonly DuplicateExisting[] = ["replace", "fill-empty"];
const MAX_DESTINATIONS = 8;
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

function validateRequest(request: DuplicateRequest) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(request.operationId)) throw httpError("The duplicate operation needs a valid operation ID.", 422);
  if (!VALID_CONTENT.includes(request.content)) throw httpError("Choose a valid copy mode.", 422);
  if (!VALID_EXISTING.includes(request.existing)) throw httpError("Choose whether to replace or fill empty slots.", 422);
  if (!request.sourceWeekId) throw httpError("Choose a source week.", 422);
  if (!Array.isArray(request.destinations) || request.destinations.length < 1 || request.destinations.length > MAX_DESTINATIONS) {
    throw httpError(`Choose between 1 and ${MAX_DESTINATIONS} destination weeks.`, 422);
  }
  const weeks = request.destinations.map(destination => planningWeekCommencing(destination.weekCommencing));
  if (new Set(weeks).size !== weeks.length) throw httpError("Each destination week can be chosen only once.", 422);
  if (request.mode === "apply" && (!request.planHash || !request.expectedVersions)) throw httpError("Review the preview before applying the duplicate.", 422);
}

/**
 * Canonical hash of the reviewed write set. Any change to the data written between
 * preview and apply alters it. Audit trails carry the computation timestamp, so they
 * are excluded: the same content must hash the same on every recomputation.
 */
export function duplicatePlanHash(plan: DuplicatePlan) {
  const material = plan.targets.map(target => [target.weekId, target.weekCommencing, target.expectedVersion, target.isNewWeek, target.alreadyApplied, target.changed ? target.next : null]);
  const withoutAudit = (_key: string, value: unknown) => (_key === "audit" ? undefined : value);
  return createHash("sha256").update(JSON.stringify(material, withoutAudit)).digest("hex");
}

/** Preview view: enough for the reviewer, without leaking the write set. */
function previewSummary(plan: DuplicatePlan) {
  return {
    totals: plan.totals,
    targets: plan.targets.map(target => ({
      weekId: target.weekId,
      weekCommencing: target.weekCommencing,
      isNewWeek: target.isNewWeek,
      alreadyApplied: target.alreadyApplied,
      expectedVersion: target.expectedVersion,
      changed: target.changed,
      dishesChanged: target.dishesChanged,
      createdEntries: target.createdEntries,
      allocationRowsWritten: target.allocationRowsWritten,
      unchangedEntries: target.unchangedEntries,
      rowsAdded: target.rowsAdded,
      overwrites: target.overwrites,
      exceptions: target.exceptions,
    })),
  };
}

async function loadDestinations(request: DuplicateRequest, actorId: string, liveOplocs: readonly GovernedOploc[], operationId: string) {
  const stored = await listWeeks();
  const targets: Array<DuplicateTargetInput & { versionAtRead: number | undefined }> = [];
  for (const destination of request.destinations) {
    const weekCommencing = planningWeekCommencing(destination.weekCommencing);
    const existing = stored.find(week => week.weekCommencing === weekCommencing);
    let snapshot: RollingSnapshot;
    if (existing) {
      const loaded = await getWeekSnapshot<RollingSnapshot>(existing.id);
      if (!loaded || !isCompletePlanningWeek(loaded)) throw httpError(`The planning week for ${weekCommencing} is incomplete and cannot be safely changed.`, 409);
      snapshot = normaliseRollingSnapshotDestinations(loaded, liveOplocs);
    } else {
      snapshot = await createWeekSnapshot(weekCommencing, actorId);
    }
    const publication = await publicationState(snapshot, liveOplocs);
    // publicationState reports Monday to Friday only. Weekend days of a published week stay protected too.
    const publishedWeek = snapshot.week.status === "published" || snapshot.week.status === "partially_published";
    const protectedDayIds = new Set(snapshot.days.filter(day => {
      const state = publication[day.id];
      if (!state) return publishedWeek || snapshot.week.dayStatuses?.[day.id] === "published";
      return state.status === "published" || state.legacy || state.hasCurrentPublication || snapshot.week.dayStatuses?.[day.id] === "published";
    }).map(day => day.id));
    const alreadyApplied = Boolean(existing && snapshot.week.audit.some(event => event.action === `duplicate-plan:${operationId}`));
    targets.push({ weekCommencing, snapshot, isNewWeek: !existing, protectedDayIds, placement: destination.placement, alreadyApplied, versionAtRead: existing ? snapshot.week.version : undefined });
  }
  return targets;
}

export async function duplicateMenuPlanning(request: DuplicateRequest, actorId: string, liveOplocs: readonly GovernedOploc[], at = new Date().toISOString()) {
  validateRequest(request);
  const sourceSnapshot = await getWeekSnapshot<RollingSnapshot>(request.sourceWeekId);
  if (!sourceSnapshot) throw httpError("The source week was not found.", 404);
  const source = normaliseRollingSnapshotDestinations(sourceSnapshot, liveOplocs);
  const dishIds = [...new Set(source.entries.map(entry => entry.itemId?.trim()).filter((id): id is string => Boolean(id)))];
  const dishes = await listCanonicalMenuItemsByIds(dishIds);
  const dishCategoryById = new Map(dishes.filter(item => item.reviewStatus !== "archived").map(item => [item.canonicalId, item.category] as const));
  const liveOplocMap = new Map(liveOplocs.map(oploc => [oploc.canonicalId, oploc.label] as const));
  const targets = await loadDestinations(request, actorId, liveOplocs, request.operationId);
  const plan = planMenuDuplicate({
    source,
    targets,
    scope: request.scope,
    content: request.content,
    existing: request.existing,
    dishCategoryById,
    liveOplocs: liveOplocMap,
    operationId: request.operationId,
    actor: actorId,
    at,
  });
  const planHash = duplicatePlanHash(plan);
  if (request.mode === "preview") return { mode: "preview" as const, planHash, plan: previewSummary(plan) };

  if (request.planHash !== planHash) throw httpError("The planning data changed since the preview. Review the duplicate again before applying.", 409);
  for (const target of targets) {
    if (target.versionAtRead !== undefined && request.expectedVersions?.[target.weekCommencing] !== target.versionAtRead) {
      throw httpError(`The planning week for ${target.weekCommencing} changed since the preview. Refresh and review it again.`, 409);
    }
  }
  const applied: Array<{ weekId: string; weekCommencing: string; version: number }> = [];
  // Destinations are applied one at a time; each save is guarded by its reviewed version.
  // A failure part-way leaves earlier weeks applied. The operation ID makes a retry skip them.
  for (const targetPlan of plan.targets) {
    if (!targetPlan.changed || targetPlan.alreadyApplied) continue;
    if (targetPlan.isNewWeek) {
      await assertWeekDateAvailable(targetPlan.weekCommencing);
      const saved = await saveSnapshot(targetPlan.next);
      applied.push({ weekId: saved.week.id, weekCommencing: saved.week.weekCommencing, version: saved.week.version });
    } else {
      const saved = await saveSnapshot(targetPlan.next, targetPlan.expectedVersion);
      applied.push({ weekId: saved.week.id, weekCommencing: saved.week.weekCommencing, version: saved.week.version });
    }
  }
  return { mode: "apply" as const, planHash, applied, plan: previewSummary(plan), weekAuditAction: `duplicate-plan:${request.operationId}` };
}

