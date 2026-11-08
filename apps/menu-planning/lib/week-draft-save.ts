import { createHash } from "node:crypto";
import { z } from "zod";
import { withMenuPlanningTransaction } from "./operational-store";
import { listCanonicalMenuItemsByIds } from "./canonical-menu-repository";
import { applyRollingEntryPatch } from "./rolling-command";
import { assertMenuSlotCanBeRemoved, plannerSlotsForWeek, type RollingSnapshot, type RollingWeek } from "./rolling-menu-types";
import { editableDay, editableWorkingDraftDay, type WeekSaveRequest } from "./week-draft";
import { isGovernedMenuSlot } from "./menu-template";
import type { Stored } from "./rolling-menu";

const id = z.string().trim().min(1).max(300).refine(value => !value.includes("/"), "Invalid identity");
const allocation = z.object({ destinationId: id.optional(), destinationLabel: z.string().min(1).max(300), destinationAddress: z.string().max(1000).optional(), quantity: z.number().finite().nonnegative(), sourceLabel: z.string().max(300).optional() }).strict();
const slot = z.string().min(1).max(80).refine(isGovernedMenuSlot, "Choose a governed menu row");
const patch = z.object({ itemId: z.string().max(300).optional(), itemLabel: z.string().max(500).optional(), slot: slot.optional(), portions: z.number().finite().nonnegative().optional(), allocations: z.array(allocation).max(100).optional(), isCoreSalad: z.boolean().optional() }).strict();
const requestSchema = z.object({ weekId: id, expectedWeekVersion: z.number().int().positive(), requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), workingDraft: z.boolean().optional(), changes: z.object({ updates: z.array(z.object({ entryId: id, dayId: id, patch }).strict()).max(350), creates: z.array(z.object({ id, dayId: id, slot, itemId: id.optional(), itemLabel: z.string().trim().max(500), portions: z.number().finite().nonnegative(), allocations: z.array(allocation).max(100), isCoreSalad: z.boolean().optional() }).strict()).max(350), customSlots: z.array(slot).max(100).optional(), removedSlots: z.array(slot).max(100).optional(), templateAdditions: z.array(slot).max(50).optional() }).strict().refine(changes => changes.updates.length + changes.creates.length <= 350) }).strict();
function fail(message: string, status = 422): never { throw Object.assign(new Error(message), { status }); }
type WorkingDraftLineage = { dayId: string; publicationDayId: string; publicationVersion: number };
type Receipt = RollingWeek["audit"][number] & { requestId?: string; fingerprint?: string; baseVersion?: number; savedVersion?: number; workingDraftLineage?: WorkingDraftLineage[] };
const fingerprint = (request: WeekSaveRequest) => createHash("sha256").update(JSON.stringify(request)).digest("hex");

export function applyWeekSave(snapshot: RollingSnapshot, request: WeekSaveRequest, actor: string, allowedOplocIds: ReadonlySet<string>, at = new Date().toISOString(), oplocAliases: ReadonlyMap<string, string> = new Map(), workingDraftLineage: WorkingDraftLineage[] = []) {
  const hash = fingerprint(request);
  const receipt = (snapshot.week.audit as Receipt[]).find(event => event.requestId === request.requestId);
  if (receipt) {
    if (receipt.by !== actor || receipt.fingerprint !== hash) fail("That save request ID was already used for different changes.", 409);
    return { snapshot, replayed: true };
  }
  if (snapshot.week.id !== request.weekId || snapshot.week.version !== request.expectedWeekVersion) fail("This week changed on the server. Your draft is retained; review the latest week before saving.", 409);
  const workingDraft = request.workingDraft === true;
  if (snapshot.week.status === "archived" || (snapshot.week.status === "published" && !workingDraft) || (workingDraft && !["published", "partially_published"].includes(snapshot.week.status))) fail("This week is locked. Use the publication amendment workflow first.", 409);
  if (workingDraft) {
    for (const update of request.changes.updates) if (!editableWorkingDraftDay(snapshot, update.dayId)) fail("Working-draft saves may change only currently published days.", 409);
    for (const created of request.changes.creates) if (!editableWorkingDraftDay(snapshot, created.dayId)) fail("Working-draft entries may be added only to currently published days.", 409);
    if (request.changes.customSlots || request.changes.removedSlots || request.changes.templateAdditions) fail("Working-draft saves cannot change shared menu rows or templates.", 409);
  }
  const next = structuredClone(snapshot);
  if (next.week.dayIds.some(id => !next.days.some(day => day.id === id)) || next.week.entryIds.some(id => !next.entries.some(entry => entry.id === id)) || next.days.some(day => day.entryIds.some(id => !next.entries.some(entry => entry.id === id && entry.dayId === day.id)))) fail("This week is incomplete. No changes were saved.", 409);
  const audit: Receipt = { action: "week-draft-saved", at, by: actor, requestId: request.requestId, fingerprint: hash, baseVersion: snapshot.week.version, savedVersion: snapshot.week.version + 1, ...(request.workingDraft ? { workingDraftLineage: structuredClone(workingDraftLineage) } : {}) };
  const touched = new Set<string>();
  const checkAllocations = (entry: RollingSnapshot["entries"][number]) => {
    if (entry.allocations.some(value => value.destinationId && !allowedOplocIds.has(oplocAliases.get(value.destinationId) || value.destinationId))) fail("This save contains a destination outside your permitted scope.", 403);
    if (entry.portions !== entry.allocations.reduce((sum, value) => sum + value.quantity, 0) && entry.allocations.length) fail("Portions must match destination allocations.");
  };
  for (const update of request.changes.updates) {
    if (touched.has(update.entryId)) fail("A save cannot change the same entry twice.");
    touched.add(update.entryId);
    const entry = next.entries.find(entry => entry.id === update.entryId && entry.dayId === update.dayId && next.week.entryIds.includes(entry.id));
    if (!entry || !(workingDraft ? editableWorkingDraftDay(next, entry.dayId) : editableDay(next, entry.dayId)) || !next.days.find(day => day.id === entry.dayId)?.entryIds.includes(entry.id)) fail("A changed menu entry is missing or locked.", 409);
    checkAllocations(entry);
    applyRollingEntryPatch(entry, update.patch, { actor, at });
    if (update.patch.allocations) entry.allocations = entry.allocations.map(value => value.destinationId && oplocAliases.has(value.destinationId) ? { ...value, destinationId: oplocAliases.get(value.destinationId) } : value);
    checkAllocations(entry);
    entry.audit.push(audit);
  }
  for (const created of request.changes.creates) {
    if (!created.id.startsWith(`${next.week.id}:entry:`) || touched.has(created.id) || next.entries.some(entry => entry.id === created.id)) fail("A new menu entry has an invalid or duplicate identity.");
    touched.add(created.id);
    const day = next.days.find(day => day.id === created.dayId && next.week.dayIds.includes(day.id));
    if (!day || !(workingDraft ? editableWorkingDraftDay(next, day.id) : editableDay(next, day.id))) fail("A new menu entry belongs to a missing or locked day.", 409);
    if (created.itemLabel.trim() && !created.itemId) fail("Choose an existing canonical dish for each new named entry.");
    const entry = { ...created, date: day.date, allocations: created.allocations.map(value => value.destinationId && oplocAliases.has(value.destinationId) ? { ...value, destinationId: oplocAliases.get(value.destinationId) } : value), allergens: {}, allergenReviewInvalidated: true, audit: [audit] };
    if (created.isCoreSalad) applyRollingEntryPatch(entry, { isCoreSalad: true }, { actor, at });
    checkAllocations(entry); next.entries.push(entry);
    next.week.entryIds.push(created.id); day.entryIds.push(created.id);
  }
  if (request.changes.customSlots) next.week.customSlots = [...new Set(request.changes.customSlots)];
  if (request.changes.removedSlots) {
    for (const removed of request.changes.removedSlots) {
      if ((snapshot.week.removedSlots || []).includes(removed)) continue;
      assertMenuSlotCanBeRemoved(removed);
      if (next.entries.some(entry => entry.slot === removed && entry.itemLabel.trim())) fail("A row containing dishes cannot be removed.", 409);
    }
    next.week.removedSlots = [...new Set(request.changes.removedSlots)];
  }
  const slots = new Set([...plannerSlotsForWeek(next.week), ...(next.week.customSlots || [])]);
  const occupied = new Set<string>();
  for (const entry of next.entries) {
    const key = JSON.stringify([entry.dayId, entry.slot]);
    // Existing legacy duplicate cells remain intact; no new duplicate cell may be introduced.
    if (touched.has(entry.id) && !slots.has(entry.slot)) fail("A changed entry refers to a missing menu row.");
    if (occupied.has(key) && next.entries.filter(value => value.dayId === entry.dayId && value.slot === entry.slot).some(value => touched.has(value.id))) fail("Two dishes cannot occupy the same menu cell.", 409);
    occupied.add(key);
  }
  if (touched.size + (request.changes.customSlots ? 1 : 0) + (request.changes.removedSlots ? 1 : 0) === 0) return { snapshot, replayed: false };
  next.week.version += 1; next.week.audit.push(audit);
  return { snapshot: next, replayed: false };
}

/** A bounded week transaction; the existing adapter persists diffs and leaves publications/outboxes untouched. */
export async function saveWeekDraft(raw: unknown, actor: string, allowedOplocIds: ReadonlySet<string>, oplocAliases: ReadonlyMap<string, string> = new Map()) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) fail("The week save contains invalid entries or relationships.");
  const request = parsed.data as WeekSaveRequest;
  const dishIds = [...new Set([...request.changes.creates.map(entry => entry.itemId), ...request.changes.updates.map(update => update.patch.itemId)].filter((id): id is string => Boolean(id)))];
  const dishes = await listCanonicalMenuItemsByIds(dishIds);
  const active = new Set(dishes.filter(item => item.reviewStatus !== "archived").map(item => item.canonicalId));
  if (dishIds.some(id => !active.has(id))) fail("A selected dish is missing or archived. Your draft has been retained.", 409);
  return withMenuPlanningTransaction(state => {
    const rolling = state.rolling as unknown as Stored;
    const week = rolling.weeks.find(week => week.id === request.weekId);
    if (!week) return fail("The planning week was not found.", 404);
    const current = { week, days: rolling.days.filter(day => week.dayIds.includes(day.id)), entries: rolling.entries.filter(entry => week.entryIds.includes(entry.id)) };
    if (request.workingDraft) {
      const publications = state.publications as { publications?: Array<{ sourceWeekId?: string; days?: Array<{ sourceDayId: string; status: string }> }> };
      const publication = publications.publications?.find(value => value.sourceWeekId === request.weekId);
      const currentPublished = (publication?.days || []).filter(day => day.status === "published");
      const currentPublishedDays = new Set(currentPublished.map(day => day.sourceDayId));
      if (!publication || !currentPublishedDays.size) fail("A working draft requires an existing current publication. Nothing was saved.", 409);
      const changedDays = new Set([...request.changes.updates.map(update => update.dayId), ...request.changes.creates.map(entry => entry.dayId)]);
      if ([...changedDays].some(dayId => !currentPublishedDays.has(dayId))) fail("Working-draft saves may change only currently published days. Nothing was saved.", 409);
    }
    const publicationState = state.publications as { publications?: Array<{ sourceWeekId?: string; publicationVersion?: number; days?: Array<{ sourceDayId: string; publicationDayId: string; version: number; status: string }> }> };
    const publication = publicationState.publications?.find(value => value.sourceWeekId === request.weekId);
    const currentPublishedDays = (publication?.days || []).filter(day => day.status === "published");
    const touchedDays = new Set([...request.changes.updates.map(update => update.dayId), ...request.changes.creates.map(entry => entry.dayId)]);
    const lineage = request.workingDraft ? currentPublishedDays.filter(day => touchedDays.has(day.sourceDayId)).map(day => ({ dayId: day.sourceDayId, publicationDayId: day.publicationDayId, publicationVersion: publication?.publicationVersion || day.version })) : [];
    const result = applyWeekSave(current, request, actor, allowedOplocIds, new Date().toISOString(), oplocAliases, lineage);
    if (!result.replayed) {
      rolling.weeks[rolling.weeks.findIndex(week => week.id === request.weekId)] = result.snapshot.week;
      const entries = new Map(result.snapshot.entries.map(entry => [entry.id, entry]));
      rolling.entries = rolling.entries.map(entry => { const next = entries.get(entry.id); entries.delete(entry.id); return next || entry; });
      rolling.entries.push(...entries.values());
      const days = new Map(result.snapshot.days.map(day => [day.id, day]));
      rolling.days = rolling.days.map(day => days.get(day.id) || day);
      if (request.changes.templateAdditions?.length) {
        if (request.changes.templateAdditions.some(slot => !result.snapshot.week.customSlots?.includes(slot))) fail("A template row must also be added to this week.");
        rolling.menuTemplateSlots = [...new Set([...(rolling.menuTemplateSlots || []), ...request.changes.templateAdditions])];
      }
    }
    return result;
  }, undefined, { weekId: request.weekId, sourceWeekId: "__none__", includeEvents: false, includeTemplateSettings: Boolean(request.changes.templateAdditions?.length) });
}
