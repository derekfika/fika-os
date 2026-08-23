import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appDataPath } from "../../shared/app-data-path";
import * as XLSX from "xlsx";
export * from "./rolling-menu-types";
import { ROLLING_SLOTS, type RollingAllocation, type RollingDay, type RollingEntry, type RollingSnapshot, type RollingSlot, type RollingWeek, type RollingWeekStatus } from "./rolling-menu-types";
import { normaliseDishName, titleCase } from "./text";
import { resolveAllergenSnapshot } from "./allergen-resolution";
import type { MenuItem } from "./domain";
import { resolveGovernedOploc } from "../../shared/governed-oplocs";
import { readRollingState, updateRollingState } from "./operational-store";
export interface Stored { version: 1; weeks: RollingWeek[]; days: RollingDay[]; entries: RollingEntry[]; }

const now = () => new Date().toISOString();
const operationalDate = () => { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const read = (): Stored => readRollingState<Stored>();
const write = (value: Stored) => { updateRollingState<Stored>(current => { Object.assign(current, structuredClone(value)); }); };
const dateFromName = (name: string) => { const m = name.match(/(\d{2})[._-](\d{2})[._-](\d{2,4})/); if (!m) return undefined; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2]}-${m[1]}`; };
const addDays = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const dayName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const slotOf = (value: unknown): RollingSlot | undefined => { const text = String(value ?? "").trim().toUpperCase(); if (ROLLING_SLOTS.includes(text as RollingSlot)) return text as RollingSlot; if (/^EXTRAS/.test(text)) return "EXTRAS 1"; return undefined; };
const normaliseDestination = (allocation: RollingAllocation): RollingAllocation => {
  const governed = resolveGovernedOploc(allocation.destinationId, allocation.destinationLabel);
  if (governed) return { ...allocation, destinationId: governed.id, destinationLabel: governed.label };
  // Hub is the authority for current OPLOC IDs. Preserve an explicit Hub ID even
  // when this local compatibility map has not seen it yet; publication validates
  // it against the live Hub list before allowing the menu through.
  return allocation.destinationId ? { ...allocation } : { ...allocation, destinationId: undefined };
};

export function repointDestinationId(oldId: string, newId: string, newLabel: string, actor = "oploc-identity-recovery") {
  let updated = 0;
  for (const week of listWeeks()) {
    const snapshot = getWeek(week.id);
    let changed = false;
    for (const entry of snapshot.entries) {
      const allocations = entry.allocations.map(allocation => allocation.destinationId === oldId ? { ...allocation, destinationId: newId, destinationLabel: newLabel } : allocation);
      if (allocations.some((allocation, index) => allocation.destinationId !== entry.allocations[index].destinationId || allocation.destinationLabel !== entry.allocations[index].destinationLabel)) {
        entry.allocations = allocations;
        entry.audit.push({ action: "destination-identity-repointed", at: now(), by: actor });
        updated += 1;
        changed = true;
      }
    }
    if (changed) { snapshot.week.version += 1; saveSnapshot(snapshot); }
  }
  return updated;
}
export function migrateSavedDestinations() {
  const db = read(); let changed = 0; let governed = 0; let oneOff = 0;
  db.entries = db.entries.map(entry => ({ ...entry, allocations: entry.allocations.map(allocation => { const next = normaliseDestination(allocation); if (next.destinationId) governed += 1; else oneOff += 1; if (next.destinationId !== allocation.destinationId || next.destinationLabel !== allocation.destinationLabel) changed += 1; return next; }) }));
  if (changed) write(db);
  return { changed, governed, oneOff, entries: db.entries.length };
}

export function emptyWeek(weekCommencing: string, actor = "local-menu-planner"): RollingSnapshot {
  const id = `rolling-week:${weekCommencing}`; const days = Array.from({ length: 7 }, (_, i) => ({ id: `${id}:day:${i + 1}`, date: addDays(weekCommencing, i), dayName: dayName(addDays(weekCommencing, i)), entryIds: [] }));
  const week: RollingWeek = { id, weekCommencing, weekEnding: addDays(weekCommencing, 6), status: "draft", version: 1, dayIds: days.map(d => d.id), entryIds: [], sourceFiles: [], customSlots: [], dayStatuses: Object.fromEntries(days.map(day => [day.id, "draft"])), audit: [{ action: "week-created", at: now(), by: actor }] };
  return { week, days, entries: [] };
}
const weekConflict = (weekCommencing: string) => Object.assign(new Error(`A menu already exists for WC ${new Date(`${weekCommencing}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`), { status: 409 });
export function assertWeekDateAvailable(weekCommencing: string) {
  if (listWeeks().some(week => week.weekCommencing === weekCommencing)) throw weekConflict(weekCommencing);
}
export function listWeeks(): RollingWeek[] { return read().weeks.sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing)); }
export function listAllEntries(): RollingEntry[] { return structuredClone(read().entries); }
export function defaultWeekForDate(weeks: RollingWeek[], date = operationalDate()) {
  const ordered = weeks.slice().sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing));
  const current = ordered.find(week => week.weekCommencing <= date && week.weekEnding >= date);
  return current || ordered.slice().sort((a, b) => Math.abs(Date.parse(`${a.weekCommencing}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) - Math.abs(Date.parse(`${b.weekCommencing}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) || a.weekCommencing.localeCompare(b.weekCommencing))[0];
}
export function snapshotFromStored(db: Stored, weekId?: string): RollingSnapshot {
  const ordered = db.weeks.slice().sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing));
  const today = operationalDate();
  const week = weekId ? db.weeks.find(w => w.id === weekId) : defaultWeekForDate(ordered, today);
  if (!week) return emptyWeek(new Date().toISOString().slice(0, 10));
  return { week: structuredClone(week), days: structuredClone(db.days.filter(d => week.dayIds.includes(d.id))), entries: structuredClone(db.entries.filter(e => week.entryIds.includes(e.id))) };
}
export function replaceSnapshotInStored(db: Stored, snapshot: RollingSnapshot) {
  const existing = db.weeks.find(w => w.id === snapshot.week.id);
  if (existing) { db.days = db.days.filter(d => !existing.dayIds.includes(d.id)); db.entries = db.entries.filter(e => !existing.entryIds.includes(e.id)); }
  const wi = db.weeks.findIndex(w => w.id === snapshot.week.id); if (wi >= 0) db.weeks[wi] = structuredClone(snapshot.week); else db.weeks.push(structuredClone(snapshot.week));
  db.days.push(...snapshot.days.map(value => structuredClone(value))); db.entries.push(...snapshot.entries.map(value => structuredClone(value)));
}
export function getWeek(weekId?: string): RollingSnapshot { return snapshotFromStored(read(), weekId); }
export function addOneOffDestination(weekId: string, dayId: string, label: string, address: string, actor = "local-menu-planner") {
  const snapshot = getWeek(weekId); const day = snapshot.days.find(item => item.id === dayId);
  const cleanLabel = label.trim(); const cleanAddress = address.trim();
  if (!day) throw Object.assign(new Error("Menu day was not found."), { status: 404 });
  if (!cleanLabel) throw Object.assign(new Error("A one-off location name is required."), { status: 422 });
  const existing = day.oneOffDestinations?.find(item => item.label.toLocaleLowerCase() === cleanLabel.toLocaleLowerCase());
  if (existing) return snapshot;
  day.oneOffDestinations = [...(day.oneOffDestinations || []), { id: `${day.id}:one-off:${Date.now()}`, label: cleanLabel, ...(cleanAddress ? { address: cleanAddress, addressStatus: "confirmed" as const } : { addressStatus: "pending" as const }) }];
  snapshot.week.version += 1; snapshot.week.audit.push({ action: "one-off-destination-added", at: now(), by: actor });
  return saveSnapshot(snapshot);
}
// Working edits must not downgrade or mutate immutable publication state.
const markDayDraft = (_snapshot: RollingSnapshot, _dayId: string) => {};
export function saveSnapshot(snapshot: RollingSnapshot) {
  updateRollingState<Stored>(db => {
    replaceSnapshotInStored(db, snapshot);
  });
  return getWeek(snapshot.week.id);
}
export function createEntry(weekId: string, dayId: string, slot: string, itemLabel: string, actor = "local-menu-planner", itemId?: string) { const snapshot = getWeek(weekId); const day = snapshot.days.find(d => d.id === dayId); if (!day) throw Object.assign(new Error("Menu day was not found."), { status: 404 }); if (snapshot.entries.some(e => e.dayId === dayId && e.slot === slot)) throw Object.assign(new Error("That menu slot already has a dish."), { status: 409 }); markDayDraft(snapshot, dayId); const id = `${snapshot.week.id}:entry:${dayId}:${slot.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${Date.now()}`; const entry: RollingEntry = { id, dayId, date: day.date, slot, itemId, itemLabel: normaliseDishName(itemLabel), portions: 0, allocations: [], allergens: {}, audit: [{ action: "entry-created", at: now(), by: actor }] }; snapshot.entries.push(entry); day.entryIds.push(id); snapshot.week.entryIds.push(id); snapshot.week.version += 1; return saveSnapshot(snapshot); }
export function addMenuSlot(weekId: string, slot: string, actor = "local-menu-planner") { const snapshot = getWeek(weekId); const clean = slot.trim().toUpperCase().replace(/\s+/g, " "); if (!clean) throw Object.assign(new Error("A menu slot name is required."), { status: 422 }); if (!/^(SALAD|EXTRAS) \d+$/.test(clean) && !/^[A-Z][A-Z0-9 /&-]{1,39}$/.test(clean)) throw Object.assign(new Error("Use a governed slot such as Salad, Side, or a named category."), { status: 422 }); if (ROLLING_SLOTS.includes(clean as RollingSlot) || snapshot.week.customSlots?.includes(clean)) throw Object.assign(new Error("That menu slot already exists."), { status: 409 }); snapshot.week.customSlots = [...(snapshot.week.customSlots || []), clean]; snapshot.week.version += 1; return saveSnapshot(snapshot); }
export function removeMenuSlot(weekId: string, slot: string, actor = "local-menu-planner") { const snapshot = getWeek(weekId); const clean = slot.trim().toUpperCase().replace(/\s+/g, " "); if (snapshot.entries.some(entry => entry.slot === clean && entry.itemLabel.trim())) throw Object.assign(new Error("A menu slot with a dish on any day cannot be removed."), { status: 409 }); if (!ROLLING_SLOTS.includes(clean as RollingSlot) && !snapshot.week.customSlots?.includes(clean)) throw Object.assign(new Error("That menu slot does not exist."), { status: 404 }); snapshot.week.customSlots = (snapshot.week.customSlots || []).filter(value => value !== clean); snapshot.week.removedSlots = Array.from(new Set([...(snapshot.week.removedSlots || []), clean])); snapshot.week.version += 1; snapshot.week.audit.push({ action: "menu-slot-removed", at: now(), by: actor }); return saveSnapshot(snapshot); }
export function cleanDuplicateEntries(weekId: string, actor = "local-menu-planner") { const snapshot = getWeek(weekId); const groups = new Map<string, RollingEntry[]>(); for (const entry of snapshot.entries) { const key = `${entry.dayId}|${entry.slot}|${entry.itemLabel.trim().toLocaleLowerCase()}`; groups.set(key, [...(groups.get(key) || []), entry]); } const remove = new Set<string>(); for (const entries of groups.values()) { if (entries.length < 2) continue; const ranked = entries.slice().sort((a, b) => (Number(b.portions > 0) * 4 + b.allocations.length * 2 + Object.values(b.allergens).filter(value => value !== "clear").length) - (Number(a.portions > 0) * 4 + a.allocations.length * 2 + Object.values(a.allergens).filter(value => value !== "clear").length)); for (const duplicate of ranked.slice(1)) remove.add(duplicate.id); } if (!remove.size) return { snapshot, removed: 0 }; snapshot.entries = snapshot.entries.filter(entry => !remove.has(entry.id)); snapshot.days.forEach(day => { day.entryIds = snapshot.entries.filter(entry => entry.dayId === day.id).map(entry => entry.id); }); snapshot.week.entryIds = snapshot.entries.map(entry => entry.id); snapshot.week.version += 1; snapshot.week.audit.push({ action: "duplicate-menu-entries-cleaned", at: now(), by: actor }); return { snapshot: saveSnapshot(snapshot), removed: remove.size }; }
export function repointDishIds(mapping: Record<string, string>, aliases: Record<string, string> = {}, actor = "automatic-dish-normaliser") { let updated = 0; for (const week of listWeeks()) { const snapshot = getWeek(week.id); let changed = false; for (const entry of snapshot.entries) { const next = (entry.itemId && mapping[entry.itemId]) || aliases[entry.itemLabel.toLocaleLowerCase()]; if (next) { if (entry.itemId && mapping[entry.itemId]) entry.itemId = next; if (aliases[entry.itemLabel.toLocaleLowerCase()]) entry.itemLabel = next; entry.audit.push({ action: "dish-reference-repointed", at: now(), by: actor }); updated += 1; changed = true; } } if (changed) { snapshot.week.version += 1; saveSnapshot(snapshot); } } return updated; }
export function attachCanonicalDishIds(items: Array<{ canonicalId: string; displayName: string; reviewStatus?: string }>, actor = "rolling-menu-migration") { let updated = 0; const active = items.filter(item => item.reviewStatus !== "archived"); for (const week of listWeeks()) { const snapshot = getWeek(week.id); let changed = false; for (const entry of snapshot.entries) { if (entry.itemId) continue; const match = active.find(item => item.displayName.trim().toLocaleLowerCase() === entry.itemLabel.trim().toLocaleLowerCase()); if (!match) continue; entry.itemId = match.canonicalId; entry.audit.push({ action: "canonical-dish-identity-attached", at: now(), by: actor }); updated += 1; changed = true; } if (changed) { snapshot.week.version += 1; saveSnapshot(snapshot); } } return updated; }
export function applyEntryPatch(entry: RollingEntry, patch: Partial<Pick<RollingEntry, "itemId" | "itemLabel" | "portions" | "slot" | "allocations" | "allergens" | "mayContainNotes" | "allergenReviewInvalidated">>) { const nextItemId = patch.itemId !== undefined ? patch.itemId || "" : entry.itemId || ""; const nextLabel = patch.itemLabel !== undefined ? normaliseDishName(patch.itemLabel).toLocaleLowerCase() : entry.itemLabel.trim().toLocaleLowerCase(); const dishChanged = nextItemId !== (entry.itemId || "") || nextLabel !== entry.itemLabel.trim().toLocaleLowerCase(); const restoringReview = patch.allergenReviewInvalidated === false && patch.allergens !== undefined; Object.assign(entry, { ...patch, ...(patch.itemLabel !== undefined ? { itemLabel: normaliseDishName(patch.itemLabel) } : {}), ...(dishChanged && !restoringReview ? { allergens: {}, mayContainNotes: "", allergenReviewInvalidated: true } : {}) }); return dishChanged; }
export function updateEntry(weekId: string, entryId: string, patch: Partial<Pick<RollingEntry, "itemId" | "itemLabel" | "portions" | "slot" | "allocations" | "allergens" | "mayContainNotes" | "allergenReviewInvalidated">>, actor = "local-menu-planner") { const snapshot = getWeek(weekId); const entry = snapshot.entries.find(e => e.id === entryId); if (!entry) throw Object.assign(new Error("Menu entry was not found."), { status: 404 }); markDayDraft(snapshot, entry.dayId); applyEntryPatch(entry, patch); if (patch.allocations !== undefined) entry.allocations = patch.allocations.map(normaliseDestination); if (patch.allergens !== undefined) entry.allergenReviewInvalidated = false; entry.audit.push({ action: "entry-amended", at: now(), by: actor }); snapshot.week.version += 1; return saveSnapshot(snapshot); }
export function publishWeek(weekId: string, actor = "local-menu-planner") { const snapshot = getWeek(weekId); if (snapshot.week.status === "published") throw Object.assign(new Error("This menu week is already published."), { status: 409 }); snapshot.week.status = "published"; snapshot.week.dayStatuses = undefined; snapshot.week.version += 1; snapshot.week.audit.push({ action: "week-published", at: now(), by: actor }); return saveSnapshot(snapshot); }
export function duplicateWeek(weekId: string, weekCommencing: string, actor = "local-menu-planner") { assertWeekDateAvailable(weekCommencing); const source = getWeek(weekId); const next = emptyWeek(weekCommencing, actor); const dayMap = new Map(source.days.map((d, i) => [d.id, next.days[i]?.id])); next.entries = source.entries.map(e => ({ ...structuredClone(e), id: `${next.week.id}:entry:${e.id.split(":entry:").pop()}`, dayId: dayMap.get(e.dayId) || next.days[0].id, date: addDays(weekCommencing, source.days.findIndex(d => d.id === e.dayId)), audit: [{ action: "entry-copied", at: now(), by: actor }] })); next.days.forEach(d => d.entryIds = next.entries.filter(e => e.dayId === d.id).map(e => e.id)); next.week.entryIds = next.entries.map(e => e.id); next.week.sourceFiles = source.week.sourceFiles.slice(); next.week.customSlots = source.week.customSlots?.slice() || []; next.week.removedSlots = source.week.removedSlots?.slice() || []; return saveSnapshot(next); }
function entryIntegrityErrors(entry: RollingEntry, governedIds?: Set<string>) { const errors: string[] = []; const label = entry.itemLabel.trim() || entry.slot; if (!entry.itemId?.trim()) errors.push(`${label} needs a canonical dish identity before publication.`); if (!Number.isFinite(entry.portions) || entry.portions <= 0) errors.push(`${label} needs a positive finite portion total.`); if (!entry.allocations.length) errors.push(`${label} needs at least one destination allocation.`); const unknown = entry.allocations.filter(allocation => !allocation.destinationId || (governedIds ? !governedIds.has(allocation.destinationId) : !resolveGovernedOploc(allocation.destinationId))); if (unknown.length) errors.push(`${label} has an unresolved destination; select a governed OPLOC.`); const quantities = entry.allocations.map(allocation => allocation.quantity); if (quantities.some(quantity => !Number.isFinite(quantity) || quantity <= 0)) errors.push(`${label} has an allocation with a positive quantity requirement.`); const destinationKeys = entry.allocations.map(allocation => allocation.destinationId || `unresolved:${allocation.destinationLabel.trim().toLocaleLowerCase()}`); if (new Set(destinationKeys).size !== destinationKeys.length) errors.push(`${label} has duplicate destination allocations.`); const total = quantities.reduce((sum, quantity) => sum + (Number.isFinite(quantity) ? quantity : 0), 0); if (Number.isFinite(entry.portions) && total !== entry.portions) errors.push(`${label} allocation total (${total}) must equal portions (${entry.portions}).`); return errors; }
export function validateWeek(snapshot: RollingSnapshot, options: { governedOplocIds?: Set<string>; requireCanonicalDishId?: boolean } = {}): string[] { const errors: string[] = []; const entries = snapshot.entries.filter(entry => entry.itemLabel.trim()); if (!entries.length) errors.push("Add at least one menu entry."); let catalogue: MenuItem[] = []; let catalogueError = false; try { const cataloguePath = appDataPath("menu-planning", "menu-planning", "canonical-menu-items.json"); const parsed = JSON.parse(readFileSync(cataloguePath, "utf8")) as { items?: MenuItem[] }; if (!Array.isArray(parsed.items)) throw new Error("items is not an array"); catalogue = parsed.items; } catch { catalogueError = true; if (options.requireCanonicalDishId) errors.push("The canonical dish catalogue is unavailable; publication cannot continue."); } for (const entry of entries) { errors.push(...entryIntegrityErrors(entry, options.governedOplocIds)); if (options.requireCanonicalDishId && !catalogueError && (!entry.itemId || !catalogue.some(item => item.canonicalId === entry.itemId && item.reviewStatus !== "archived"))) errors.push(`${entry.itemLabel || entry.slot} references a canonical dish that does not exist or is archived.`); } const missingAllergens = entries.filter(entry => { const dish = entry.itemId ? catalogue.find(item => item.canonicalId === entry.itemId) : undefined; return resolveAllergenSnapshot(entry, dish).unresolved.length > 0; }).length; if (missingAllergens) errors.push(`${missingAllergens} menu ${missingAllergens === 1 ? "entry needs" : "entries need"} an explicit allergen review.`); return [...new Set(errors)]; }

export function importWorkbook(buffer: ArrayBuffer | Buffer, workbookName: string, actor = "historical-importer"): { snapshot: RollingSnapshot; warnings: string[]; recognisedEntries: number } {
  const date = dateFromName(workbookName) || "2026-08-17"; const snapshot = emptyWeek(date, actor); const wb = XLSX.read(buffer, { type: "buffer" }); const warnings: string[] = [];
  const sheets = wb.SheetNames.filter(n => /^(mon|tue|wed|thurs|thu|fri)$/i.test(n));
  for (const sheetName of sheets) { const dayIndex = ["mon", "tue", "wed", "thurs", "thu", "fri"].findIndex(v => v === sheetName.toLowerCase()); if (dayIndex < 0) continue; const day = snapshot.days[dayIndex]; const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" }); const headerIndex = rows.findIndex(r => String(r[0]).toUpperCase() === "PRODUCT"); if (headerIndex < 0) { warnings.push(`${sheetName}: product header not found`); continue; } const header = rows[headerIndex] as unknown[]; for (let i = headerIndex + 1; i < rows.length; i++) { const row = rows[i] as unknown[]; const slot = slotOf(row[0]); const label = String(row[1] ?? "").trim(); if (!slot || !label || /^total/i.test(label)) continue; const allocations: RollingAllocation[] = []; for (let c = 2; c < header.length; c++) { const quantity = Number(row[c]); if (!Number.isFinite(quantity) || quantity <= 0) continue; const destinationLabel = String(header[c] ?? "").trim(); if (!destinationLabel || /^total$/i.test(destinationLabel)) continue; allocations.push({ destinationLabel, quantity, sourceLabel: destinationLabel }); } const portions = allocations.reduce((sum, a) => sum + a.quantity, 0); const id = `${snapshot.week.id}:entry:${sheetName}:${i + 1}:${slug(label)}`; const entry: RollingEntry = { id, dayId: day.id, date: day.date, slot, itemLabel: titleCase(label.replace(/\s+/g, " ")), portions, allocations, allergens: {}, source: { workbook: workbookName, sheet: sheetName, range: `A${i + 1}`, rawText: JSON.stringify(row) }, audit: [{ action: "historical-source-imported", at: now(), by: actor }] }; snapshot.entries.push(entry); day.entryIds.push(id); } }
  snapshot.week.entryIds = snapshot.entries.map(e => e.id); snapshot.week.sourceFiles = [workbookName]; return { snapshot, warnings, recognisedEntries: snapshot.entries.length };
}
