import { categoriesForMenuSlot, isCanonicalDishCategory, normaliseDishCategory } from "./dish-categories";
import { isGovernedMenuSlot } from "./menu-template";
import { applyRollingEntryPatch } from "./rolling-command";
import { plannerSlotsForWeek, type RollingAllocation, type RollingDay, type RollingEntry, type RollingSnapshot } from "./rolling-menu-types";

/**
 * Pure planner for Duplicate Planning. It never touches storage: the server
 * recomputes this plan from authoritative state for both preview and apply, so
 * a client-supplied plan is never trusted.
 *
 * Rules (see the Duplicate Planning design in the PR description):
 * - MENU copies dish identities and slots. Existing target allocations stay on
 *   the target when its dish changes (flagged as retained quantities); source
 *   quantities are never copied.
 * - PORTIONS copies per-site allocations onto target entries that already hold a
 *   dish, keyed by canonical OPLOC ID. Target dishes are never changed.
 * - MENU+PORTIONS does both. Source quantities are only copied with canonical destinations.
 * - Source slots that are blank are left alone on the target (replace never clears).
 * - Published target days are never written; they are reported as exceptions.
 */

export type DuplicateContent = "menu" | "portions" | "menu-and-portions";
export type DuplicateExisting = "replace" | "fill-empty";
export type DuplicateScope = { kind: "week" } | { kind: "days"; dayIndexes: number[] };
export type DuplicatePlacement = { kind: "corresponding" } | { kind: "day"; dayIndex: number };

export type DuplicateExceptionKind =
  | "published"
  | "no-destination"
  | "same-day"
  | "no-target-row"
  | "no-target-dish"
  | "unknown-dish"
  | "incompatible-dish"
  | "occupied"
  | "unknown-destination"
  | "conflict"
  | "already-applied";

export type DuplicateException = {
  weekCommencing: string;
  dayId?: string;
  dayName?: string;
  date?: string;
  slot?: string;
  kind: DuplicateExceptionKind;
  message: string;
};

export type DuplicateTargetInput = {
  weekCommencing: string;
  snapshot: RollingSnapshot;
  isNewWeek: boolean;
  protectedDayIds: ReadonlySet<string>;
  placement: DuplicatePlacement;
  /** The week already carries this operation's audit marker, so nothing is written again. */
  alreadyApplied: boolean;
};

export type DuplicatePlanInput = {
  source: RollingSnapshot;
  targets: DuplicateTargetInput[];
  scope: DuplicateScope;
  content: DuplicateContent;
  existing: DuplicateExisting;
  /** Canonical dish ID to category, from the authoritative Dish Library. */
  dishCategoryById: ReadonlyMap<string, string | undefined>;
  /** Live canonical OPLOC ID to label. Only these destinations can receive portions. */
  liveOplocs: ReadonlyMap<string, string>;
  operationId: string;
  actor: string;
  at: string;
};

export type DuplicateOverwrite = {
  entryId: string;
  dayId: string;
  slot: string;
  fromDish: string;
  toDish: string;
  /** Allocation rows from the target that were retained on a changed dish (MENU mode). */
  retainedAllocationRows: number;
  /** Target allocation rows that were replaced by copied source allocations. */
  replacedAllocationRows: number;
};

export type DuplicateTargetPlan = {
  weekCommencing: string;
  weekId: string;
  isNewWeek: boolean;
  alreadyApplied: boolean;
  expectedVersion: number;
  next: RollingSnapshot;
  changedEntryIds: string[];
  rowsAdded: string[];
  createdEntries: number;
  dishesChanged: number;
  allocationRowsWritten: number;
  unchangedEntries: number;
  overwrites: DuplicateOverwrite[];
  exceptions: DuplicateException[];
  changed: boolean;
};

export type DuplicatePlan = {
  targets: DuplicateTargetPlan[];
  totals: { targets: number; dishesChanged: number; allocationRowsWritten: number; overwrites: number; exceptions: number; unchanged: number };
};

export const sortedDays = (snapshot: RollingSnapshot): RollingDay[] => snapshot.days.slice().sort((a, b) => a.date.localeCompare(b.date));

const slotKey = (slot: string) => slot.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hashOperation = (operationId: string) => operationId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "op";
const sumQuantities = (allocations: readonly RollingAllocation[]) => allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
const positiveRows = (allocations: readonly RollingAllocation[]) => allocations.filter(allocation => allocation.quantity > 0);
const hasDish = (entry: Pick<RollingEntry, "itemLabel">) => entry.itemLabel.trim().length > 0;
const sameDish = (entry: RollingEntry, source: RollingEntry) => (entry.itemId || "") === (source.itemId || "") && entry.itemLabel.trim().toLocaleLowerCase() === source.itemLabel.trim().toLocaleLowerCase();
const allocationKey = (allocations: readonly RollingAllocation[]) => JSON.stringify(positiveRows(allocations).map(allocation => [allocation.destinationId, allocation.quantity]).sort());

/** Map source allocations onto canonical OPLOC IDs. Anything else is reported, never guessed. */
export function mapDuplicateAllocations(allocations: readonly RollingAllocation[], liveOplocs: ReadonlyMap<string, string>) {
  const mapped = new Map<string, RollingAllocation>();
  const unmapped: string[] = [];
  for (const allocation of positiveRows(allocations)) {
    const label = allocation.destinationId ? liveOplocs.get(allocation.destinationId) : undefined;
    if (!allocation.destinationId || !label) {
      unmapped.push(allocation.destinationLabel || "unidentified destination");
      continue;
    }
    const existing = mapped.get(allocation.destinationId);
    mapped.set(allocation.destinationId, { destinationId: allocation.destinationId, destinationLabel: label, quantity: (existing?.quantity ?? 0) + allocation.quantity });
  }
  return { allocations: [...mapped.values()], unmapped };
}

export function planMenuDuplicate(input: DuplicatePlanInput): DuplicatePlan {
  const sourceDays = sortedDays(input.source);
  const sourceIndexes = input.scope.kind === "week" ? [0, 1, 2, 3, 4, 5, 6] : input.scope.dayIndexes;
  if (!sourceIndexes.length || new Set(sourceIndexes).size !== sourceIndexes.length || sourceIndexes.some(index => !Number.isInteger(index) || index < 0 || index > 6)) {
    throw Object.assign(new Error("Choose one or more valid source days."), { status: 422 });
  }
  if (input.targets.length === 0) throw Object.assign(new Error("Choose at least one destination week."), { status: 422 });
  if (sourceIndexes.length > 1 && input.targets.some(target => target.placement.kind === "day")) {
    throw Object.assign(new Error("A single destination day can receive only one source day."), { status: 422 });
  }
  const targets = input.targets.map(target => planTarget(input, sourceDays, sourceIndexes, target));
  const totals = targets.reduce((sum, target) => ({
    targets: sum.targets + (target.changed ? 1 : 0),
    dishesChanged: sum.dishesChanged + target.dishesChanged,
    allocationRowsWritten: sum.allocationRowsWritten + target.allocationRowsWritten,
    overwrites: sum.overwrites + target.overwrites.length,
    exceptions: sum.exceptions + target.exceptions.length,
    unchanged: sum.unchanged + target.unchangedEntries,
  }), { targets: 0, dishesChanged: 0, allocationRowsWritten: 0, overwrites: 0, exceptions: 0, unchanged: 0 });
  return { targets, totals };
}

function planTarget(input: DuplicatePlanInput, sourceDays: RollingDay[], sourceIndexes: number[], target: DuplicateTargetInput): DuplicateTargetPlan {
  const next = structuredClone(target.snapshot) as RollingSnapshot;
  const targetDays = sortedDays(next);
  const sameWeek = next.week.id === input.source.week.id;
  const changedEntryIds = new Set<string>();
  const createdIds = new Set<string>();
  const rowsAdded: string[] = [];
  const overwrites: DuplicateOverwrite[] = [];
  const exceptions: DuplicateException[] = [];
  let dishesChanged = 0;
  let allocationRowsWritten = 0;
  let unchangedEntries = 0;
  const expectedVersion = target.snapshot.week.version;
  const exceptionFor = (kind: DuplicateExceptionKind, message: string, day?: RollingDay, slot?: string) => exceptions.push({ weekCommencing: target.weekCommencing, dayId: day?.id, dayName: day?.dayName, date: day?.date, slot, kind, message });

  if (target.alreadyApplied) {
    exceptionFor("already-applied", "This operation has already been applied to this week; nothing was written again.");
  } else {
    for (const sourceIndex of sourceIndexes) {
      const sourceDay = sourceDays[sourceIndex];
      if (!sourceDay) continue;
      const targetIndex = target.placement.kind === "corresponding" ? sourceIndex : target.placement.dayIndex;
      const targetDay = targetDays[targetIndex];
      if (!targetDay) {
        exceptionFor("no-destination", "The destination day is not in the target week.");
        continue;
      }
      if (sameWeek && sourceDay.id === targetDay.id) {
        exceptionFor("same-day", "Source and destination are the same day, so there is nothing to copy.", targetDay);
        continue;
      }
      if (target.protectedDayIds.has(targetDay.id)) {
        exceptionFor("published", "This day is published. Copying here would overwrite historical publication, so it was skipped. Use the amendment flow to change it.", targetDay);
        continue;
      }
      const sourceEntries = input.source.entries.filter(entry => entry.dayId === sourceDay.id && hasDish(entry));
      for (const sourceEntry of sourceEntries) {
        const matches = next.entries.filter(entry => entry.dayId === targetDay.id && entry.slot === sourceEntry.slot);
        if (matches.length > 1) {
          exceptionFor("conflict", "The target cell has more than one menu entry. Refresh and resolve it before copying.", targetDay, sourceEntry.slot);
          continue;
        }
        const existing = matches[0];
        if (input.content === "portions") {
          planPortions(input, targetDay, sourceEntry, existing, changedEntryIds, overwrites, exceptionFor, () => { allocationRowsWritten += 1; }, () => { unchangedEntries += 1; });
          continue;
        }
        const planned = planMenu(input, next, targetDay, sourceEntry, existing, sourceEntryIsAvailable(next, targetDay, sourceEntry), rowsAdded, createdIds);
        if (planned.kind === "exception") {
          exceptionFor(planned.exception, planned.message, targetDay, sourceEntry.slot);
          continue;
        }
        if (planned.kind === "unchanged") { unchangedEntries += 1; continue; }
        changedEntryIds.add(planned.entry.id);
        if (planned.dishChanged) dishesChanged += 1;
        allocationRowsWritten += planned.allocationRowsWritten;
        if (planned.overwrite) overwrites.push(planned.overwrite);
        if (planned.unmapped.length) exceptionFor("unknown-destination", `Portions not copied for unrecognised destination: ${planned.unmapped.join(", ")}.`, targetDay, sourceEntry.slot);
      }
    }
  }

  // Keep day/week entry indexes consistent with the entries that now exist.
  for (const day of next.days) day.entryIds = next.entries.filter(entry => entry.dayId === day.id).map(entry => entry.id);
  next.week.entryIds = next.entries.map(entry => entry.id);
  const changed = changedEntryIds.size > 0 || rowsAdded.length > 0;
  if (changed) {
    next.week.version = expectedVersion + 1;
    next.week.audit.push({ action: `duplicate-plan:${input.operationId}`, at: input.at, by: input.actor });
  }
  const weekId = next.week.id;
  return {
    weekCommencing: target.weekCommencing,
    weekId,
    isNewWeek: target.isNewWeek,
    alreadyApplied: target.alreadyApplied,
    expectedVersion,
    next,
    changedEntryIds: [...changedEntryIds].sort(),
    rowsAdded,
    createdEntries: createdIds.size,
    dishesChanged,
    allocationRowsWritten,
    unchangedEntries,
    overwrites,
    exceptions,
    changed,
  };
}

/** A source slot needs a target row. Missing rows are added only for governed, non-removed rows. */
function sourceEntryIsAvailable(next: RollingSnapshot, targetDay: RollingDay, sourceEntry: RollingEntry) {
  void targetDay;
  const slot = sourceEntry.slot;
  return plannerSlotsForWeek(next.week).includes(slot) || Boolean(next.week.customSlots?.includes(slot));
}

type MenuPlan =
  | { kind: "exception"; exception: DuplicateExceptionKind; message: string }
  | { kind: "unchanged" }
  | { kind: "changed"; entry: RollingEntry; dishChanged: boolean; allocationRowsWritten: number; overwrite?: DuplicateOverwrite; unmapped: string[] };

function planMenu(
  input: DuplicatePlanInput,
  next: RollingSnapshot,
  targetDay: RollingDay,
  sourceEntry: RollingEntry,
  existing: RollingEntry | undefined,
  rowAvailable: boolean,
  rowsAdded: string[],
  createdIds: Set<string>,
): MenuPlan {
  const dishId = sourceEntry.itemId?.trim();
  if (!dishId) return { kind: "exception", exception: "unknown-dish", message: `${sourceEntry.itemLabel} has no canonical dish identity, so it was not copied.` };
  if (!input.dishCategoryById.has(dishId)) return { kind: "exception", exception: "unknown-dish", message: `${sourceEntry.itemLabel} is not in the Dish Library, so it was not copied.` };
  const category = normaliseDishCategory(input.dishCategoryById.get(dishId));
  if (!isCanonicalDishCategory(category) || !categoriesForMenuSlot(sourceEntry.slot).includes(category)) {
    return { kind: "exception", exception: "incompatible-dish", message: `${sourceEntry.itemLabel} is not compatible with ${sourceEntry.slot}.` };
  }
  if (!existing && !rowAvailable) {
    const removed = next.week.removedSlots?.includes(sourceEntry.slot);
    if (removed || !isGovernedMenuSlot(sourceEntry.slot)) return { kind: "exception", exception: "no-target-row", message: `${sourceEntry.slot} is not a menu row in the target week.` };
    next.week.customSlots = [...new Set([...(next.week.customSlots || []), sourceEntry.slot])];
    rowsAdded.push(sourceEntry.slot);
  }
  const wantsPortions = input.content === "menu-and-portions";
  const mapped = wantsPortions ? mapDuplicateAllocations(sourceEntry.allocations, input.liveOplocs) : { allocations: [] as RollingAllocation[], unmapped: [] as string[] };
  const targetHasDish = Boolean(existing && hasDish(existing));
  if (existing && targetHasDish && sameDish(existing, sourceEntry)) {
    if (!wantsPortions) return { kind: "unchanged" };
    if (allocationKey(existing.allocations) === allocationKey(mapped.allocations)) return { kind: "unchanged" };
    if (input.existing === "fill-empty" && positiveRows(existing.allocations).length) return { kind: "exception", exception: "occupied", message: `${sourceEntry.slot} already has portions; fill-empty kept them.` };
    const writtenRows = mapped.allocations.length;
    const replacedRows = positiveRows(existing.allocations).length;
    applyRollingEntryPatch(existing, { allocations: mapped.allocations, portions: sumQuantities(mapped.allocations) }, { actor: input.actor, at: input.at });
    existing.audit.push({ action: `duplicate-plan:${input.operationId}`, at: input.at, by: input.actor });
    return { kind: "changed", entry: existing, dishChanged: false, allocationRowsWritten: writtenRows + replacedRows, unmapped: mapped.unmapped };
  }
  if (existing && targetHasDish && input.existing === "fill-empty") return { kind: "exception", exception: "occupied", message: `${sourceEntry.slot} already has a dish; fill-empty kept it.` };
  const retained = existing ? positiveRows(existing.allocations).length : 0;
  const replacedRows = wantsPortions && existing ? positiveRows(existing.allocations).length : 0;
  if (wantsPortions && existing && input.existing === "fill-empty" && positiveRows(existing.allocations).length) {
    // The dish is empty here, so allocation rows are still protected by fill-empty.
    return { kind: "exception", exception: "occupied", message: `${sourceEntry.slot} already has portions; fill-empty kept them.` };
  }
  const patch = { itemId: dishId, itemLabel: sourceEntry.itemLabel, ...(wantsPortions ? { allocations: mapped.allocations, portions: sumQuantities(mapped.allocations) } : {}) };
  let entry = existing;
  if (!entry) {
    const id = `${next.week.id}:entry:${targetDay.id}:${slotKey(sourceEntry.slot)}:dup-${hashOperation(input.operationId)}`;
    entry = { id, dayId: targetDay.id, date: targetDay.date, slot: sourceEntry.slot, itemLabel: "", portions: 0, allocations: [], allergens: {}, audit: [] } as RollingEntry;
    createdIds.add(id);
    next.entries.push(entry);
  }
  const dishChanged = !existing || !sameDish(existing, sourceEntry);
  // Capture the outgoing dish before the patch overwrites it; the overwrite record reports it.
  const previousLabel = entry.itemLabel.trim();
  applyRollingEntryPatch(entry, patch, { actor: input.actor, at: input.at });
  entry.audit.push({ action: `duplicate-plan:${input.operationId}`, at: input.at, by: input.actor });
  // A blank target that already holds quantities is also a change: those quantities would now sit under a new dish.
  const overwrite: DuplicateOverwrite | undefined = existing && dishChanged && (targetHasDish || retained > 0)
    ? { entryId: entry.id, dayId: targetDay.id, slot: sourceEntry.slot, fromDish: previousLabel || "blank", toDish: sourceEntry.itemLabel.trim(), retainedAllocationRows: wantsPortions ? 0 : retained, replacedAllocationRows: replacedRows }
    : undefined;
  return { kind: "changed", entry, dishChanged, allocationRowsWritten: wantsPortions ? mapped.allocations.length + replacedRows : 0, overwrite, unmapped: mapped.unmapped };
}

function planPortions(
  input: DuplicatePlanInput,
  targetDay: RollingDay,
  sourceEntry: RollingEntry,
  existing: RollingEntry | undefined,
  changedEntryIds: Set<string>,
  overwrites: DuplicateOverwrite[],
  exceptionFor: (kind: DuplicateExceptionKind, message: string, day?: RollingDay, slot?: string) => void,
  onWritten: () => void,
  onUnchanged: () => void,
) {
  if (!positiveRows(sourceEntry.allocations).length) return;
  if (!existing || !hasDish(existing)) {
    exceptionFor("no-target-dish", `${sourceEntry.slot} has no dish on the target day, so portions were not copied.`, targetDay, sourceEntry.slot);
    return;
  }
  const mapped = mapDuplicateAllocations(sourceEntry.allocations, input.liveOplocs);
  if (mapped.unmapped.length) exceptionFor("unknown-destination", `Portions not copied for unrecognised destination: ${mapped.unmapped.join(", ")}.`, targetDay, sourceEntry.slot);
  if (!mapped.allocations.length) {
    exceptionFor("unknown-destination", `${sourceEntry.slot} has no destinations that map to a live OPLOC, so no portions were copied.`, targetDay, sourceEntry.slot);
    return;
  }
  const replacedRows = positiveRows(existing.allocations).length;
  if (input.existing === "fill-empty" && replacedRows) {
    exceptionFor("occupied", `${sourceEntry.slot} already has portions; fill-empty kept them.`, targetDay, sourceEntry.slot);
    return;
  }
  if (allocationKey(existing.allocations) === allocationKey(mapped.allocations)) {
    onUnchanged();
    return;
  }
  applyRollingEntryPatch(existing, { allocations: mapped.allocations, portions: sumQuantities(mapped.allocations) }, { actor: input.actor, at: input.at });
  existing.audit.push({ action: `duplicate-plan:${input.operationId}`, at: input.at, by: input.actor });
  changedEntryIds.add(existing.id);
  onWritten();
  if (replacedRows) overwrites.push({ entryId: existing.id, dayId: targetDay.id, slot: sourceEntry.slot, fromDish: existing.itemLabel.trim(), toDish: existing.itemLabel.trim(), retainedAllocationRows: 0, replacedAllocationRows: replacedRows });
}
