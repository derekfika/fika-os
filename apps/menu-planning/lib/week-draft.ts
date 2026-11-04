import type { RollingEntry, RollingSnapshot } from "./rolling-menu-types";
import type { RollingEntryPatch } from "./rolling-command";
import { applyRollingEntryPatch } from "./rolling-command";
import { assertMenuSlotCanBeRemoved, plannerSlotsForWeek } from "./rolling-menu-types";
import { suggestMenuRowSlot } from "./menu-template";

// Browser recovery data is never authority. Only these editable fields cross the save boundary.
export const DRAFT_ENTRY_FIELDS = ["itemId", "itemLabel", "slot", "portions", "allocations"] as const;
export type WeekChanges = {
  updates: Array<{ entryId: string; dayId: string; patch: RollingEntryPatch }>;
  creates: Array<Pick<RollingEntry, "id" | "dayId" | "slot" | "itemId" | "itemLabel">>;
  customSlots?: string[];
  removedSlots?: string[];
  templateAdditions?: string[];
};
export type WeekSaveRequest = { weekId: string; expectedWeekVersion: number; requestId: string; changes: WeekChanges };
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function weekChanges(base: RollingSnapshot, draft: RollingSnapshot): WeekChanges {
  const existing = new Map(base.entries.map(entry => [entry.id, entry]));
  const updates: WeekChanges["updates"] = [];
  const creates: WeekChanges["creates"] = [];
  for (const entry of draft.entries) {
    const before = existing.get(entry.id);
    if (!before) { creates.push({ id: entry.id, dayId: entry.dayId, slot: entry.slot, itemId: entry.itemId, itemLabel: entry.itemLabel }); continue; }
    const patch: RollingEntryPatch = {};
    for (const key of DRAFT_ENTRY_FIELDS) if (!equal(before[key], entry[key])) Object.assign(patch, { [key]: entry[key] ?? (key === "itemId" ? "" : undefined) });
    if (Object.keys(patch).length) updates.push({ entryId: entry.id, dayId: entry.dayId, patch });
  }
  return { updates, creates,
    ...(!equal(base.week.customSlots || [], draft.week.customSlots || []) ? { customSlots: draft.week.customSlots || [] } : {}),
    ...(!equal(base.week.removedSlots || [], draft.week.removedSlots || []) ? { removedSlots: draft.week.removedSlots || [] } : {}),
  };
}
export function isWeekDirty(base: RollingSnapshot, draft: RollingSnapshot) {
  const changes = weekChanges(base, draft);
  return Boolean(changes.updates.length || changes.creates.length || changes.customSlots || changes.removedSlots);
}
export function editableDay(snapshot: RollingSnapshot, dayId: string) {
  return snapshot.week.status !== "archived" && snapshot.week.status !== "published" && snapshot.week.dayStatuses?.[dayId] !== "published" && snapshot.days.some(day => day.id === dayId);
}
/** Apply ordinary planner actions without network activity or server-owned review/audit evidence. */
export function editWeek(snapshot: RollingSnapshot, action: string, input: Record<string, any>): RollingSnapshot {
  const next = structuredClone(snapshot);
  if (action === "update-entry") {
    const entry = next.entries.find(entry => entry.id === input.entryId);
    if (!entry || !editableDay(next, entry.dayId)) throw Error("This menu day is locked. Use the publication amendment workflow first.");
    applyRollingEntryPatch(entry, input.patch || {});
  } else if (action === "create-entry") {
    const day = next.days.find(day => day.id === input.dayId);
    if (!day || !editableDay(next, day.id)) throw Error("This menu day is locked.");
    if (next.entries.some(entry => entry.dayId === day.id && entry.slot === input.slot)) throw Error("That menu slot already exists.");
    const entry: RollingEntry = { id: input.id || `${next.week.id}:entry:${crypto.randomUUID()}`, dayId: day.id, date: day.date, slot: input.slot, itemId: input.itemId, itemLabel: input.itemLabel || "", portions: 0, allocations: [], allergens: {}, audit: [] };
    next.entries.push(entry); day.entryIds.push(entry.id); next.week.entryIds.push(entry.id);
  } else if (action === "add-menu-slot") {
    if (next.week.status === "published" || next.week.status === "archived") throw Error("This week is locked.");
    const slot = suggestMenuRowSlot(input.category, [...plannerSlotsForWeek(next.week), ...(next.week.customSlots || []), ...(next.week.removedSlots || [])]);
    next.week.customSlots = [...(next.week.customSlots || []), slot];
  } else if (action === "remove-menu-slot") {
    if (next.week.status === "published" || next.week.status === "archived") throw Error("This week is locked.");
    const slot = String(input.slot).trim().toUpperCase().replace(/\s+/g, " ");
    assertMenuSlotCanBeRemoved(slot);
    if (next.entries.some(entry => entry.slot === slot && entry.itemLabel.trim())) throw Error("Clear the dishes in this row before removing it.");
    if (![...plannerSlotsForWeek(next.week), ...(next.week.customSlots || [])].includes(slot)) throw Error("That menu row does not exist.");
    next.week.customSlots = (next.week.customSlots || []).filter(value => value !== slot);
    next.week.removedSlots = [...new Set([...(next.week.removedSlots || []), slot])];
  } else throw Error("Save or discard the draft before using this operation.");
  return next;
}

export type DraftConflict = { entryId?: string; field: string; base: unknown; local: unknown; remote: unknown; label: string };
/** Three-way field comparison. Conflicting values require an explicit choice; nothing is saved here. */
export function reconcileWeek(base: RollingSnapshot, local: RollingSnapshot, remote: RollingSnapshot) {
  if (base.week.id !== remote.week.id || local.week.id !== remote.week.id) throw Error("Cannot reconcile different weeks.");
  const merged = structuredClone(remote);
  const conflicts: DraftConflict[] = [];
  const changes = weekChanges(base, local);
  for (const update of changes.updates) {
    const before = base.entries.find(entry => entry.id === update.entryId)!;
    const mine = local.entries.find(entry => entry.id === update.entryId)!;
    const theirs = remote.entries.find(entry => entry.id === update.entryId);
    const target = merged.entries.find(entry => entry.id === update.entryId);
    if (!theirs || !target) { conflicts.push({ entryId: mine.id, field: "missing", base: before, local: mine, remote: undefined, label: `${mine.itemLabel || mine.slot}: row removed on server` }); continue; }
    for (const key of DRAFT_ENTRY_FIELDS) {
      if (equal(before[key], mine[key]) || equal(mine[key], theirs[key])) continue;
      if (!editableDay(remote, theirs.dayId) || (!equal(before[key], theirs[key]))) conflicts.push({ entryId: mine.id, field: key, base: before[key], local: mine[key], remote: theirs[key], label: `${mine.itemLabel || mine.slot}: ${key}` });
      else Object.assign(target, { [key]: structuredClone(mine[key]) });
    }
  }
  for (const created of changes.creates) {
    const mine = local.entries.find(entry => entry.id === created.id)!;
    const occupied = merged.entries.find(entry => entry.dayId === mine.dayId && entry.slot === mine.slot);
    if (occupied || !editableDay(remote, mine.dayId)) {
      if (occupied?.id !== mine.id || !equal(occupied.itemId, mine.itemId)) conflicts.push({ entryId: mine.id, field: "create", base: undefined, local: mine, remote: occupied, label: `${mine.slot}: slot now occupied or locked` });
    } else { merged.entries.push(structuredClone(mine)); merged.week.entryIds.push(mine.id); merged.days.find(day => day.id === mine.dayId)!.entryIds.push(mine.id); }
  }
  for (const key of ["customSlots", "removedSlots"] as const) {
    if (equal(base.week[key] || [], local.week[key] || [])) continue;
    if (!equal(base.week[key] || [], remote.week[key] || []) && !equal(local.week[key] || [], remote.week[key] || [])) conflicts.push({ field: key, base: base.week[key], local: local.week[key], remote: remote.week[key], label: `Menu rows: ${key}` });
    else merged.week[key] = structuredClone(local.week[key]);
  }
  return { merged, conflicts };
}
export const draftStorageKey = (identity: string, environment: string, weekId: string) => `fika-week-draft:v1:${encodeURIComponent(environment)}:${encodeURIComponent(identity)}:${encodeURIComponent(weekId)}`;
export type RecoveredWeekDraft = { schema: 1; identity: string; environment: string; base: RollingSnapshot; draft: RollingSnapshot; savedAt: number; pending?: { request: WeekSaveRequest; submitted: RollingSnapshot } };
export function parseRecoveredDraft(value: string | null, identity: string, environment: string, weekId: string): RecoveredWeekDraft | undefined {
  try { const draft = JSON.parse(value || "null") as RecoveredWeekDraft; if (draft?.schema !== 1 || draft.identity !== identity || draft.environment !== environment || draft.base?.week?.id !== weekId || draft.draft?.week?.id !== weekId || !Array.isArray(draft.base.entries) || !Array.isArray(draft.draft.entries) || !Array.isArray(draft.base.days) || !Array.isArray(draft.draft.days)) return undefined; return draft; } catch { return undefined; }
}
