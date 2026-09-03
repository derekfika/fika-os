import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalAllergenMap } from "./fika-contracts";
import type { RollingDay, RollingEntry, RollingSnapshot } from "./rolling-menu-types";
import { getWeek, listWeeks, normaliseRollingSnapshotDestinations, replaceSnapshotInStored, saveSnapshot, snapshotFromStored, validateWeek, type Stored as RollingMenuStored } from "./rolling-menu";
import type { GovernedOploc } from "./oploc-authority";
import { renderPdfLocally } from "./local-pdf";
import { resolveAllergenSnapshot } from "./allergen-resolution";
import type { MenuItem } from "./domain";
import { publishedAllergenMatrixHtml, createDomainEvent, markEventDelivered, markEventFailed, type DurableDomainEvent, type FulfilmentRequirement } from "./fika-contracts";
import { claimNextMenuPlanningEvent, getPublicationById, getPublishedSnapshot, listPublicationState, readPublicationState, readPublicationStateForDateRange, readPublicationStateForWeek, updateMenuPlanningEvent, withMenuPlanningTransaction } from "./operational-store";
import { cwd } from "node:process";
import { decodeWeeklyPublicationPacket, encodeWeeklyPublicationPacket, type WeeklyPublicationPacket } from "@fika/server-shared/weekly-publication-packet";

export const PUBLICATION_ATTESTATION = "I confirm that I have reviewed the allergen information shown for this day's published menu and that it reflects the approved information available at the time of publication.";
export type MenuPublicationSignature = { printedName: string; signatureDataUrl?: string; signedAt: string; actor: string; attestation: string };
export type MenuPublicationSignoff = { date?: string; productionChef?: MenuPublicationSignature; headChefSiteManager?: MenuPublicationSignature; dayContentHash?: string };
export type MenuPublicationWeekPublishInput = { weekContentHash?: string };
export type PublishedMenuEntry = { sourceEntryId: string; slot: string; canonicalDishId?: string; dishName: string; portions: number; allocations: Array<{ destinationId?: string; destinationLabel: string; destinationAddress?: string; quantity: number }>; allergens: CanonicalAllergenMap; mayContainNotes?: string };
export type CompiledPublishedWeekSnapshot = { schemaVersion: 1; snapshotId: string; publicationId: string; sourceWeekId: string; sourceWeekVersion: number; publicationVersion: number; publishedAt: string; publishedBy: string; contentHash: string; sourceLineage: { sourceDomain: "menu-planning"; sourceEntityId: string; publicationId: string; sourceWeekVersion: number; publicationVersion: number; sourceContentHash: string }; week: { weekCommencing: string; weekEnding: string }; days: Array<{ publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; entries: PublishedMenuEntry[] }> };
export type DriveArchive = { status: "saved" | "not_configured" | "failed"; fileId?: string; driveUrl?: string; account: string; fileName: string; archivedAt: string; pdfStatus: "saved" | "not_configured" | "failed" | "unavailable"; pdfFileId?: string; pdfDriveUrl?: string; pdfFileName: string };
export type PublishedMenuDay = { publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; status: "published" | "superseded" | "withdrawn"; contentHash: string; publishedAt: string; publishedBy: string; entries: PublishedMenuEntry[]; allergenSignoff?: MenuPublicationSignoff; driveArchive?: DriveArchive; withdrawal?: { actor: string; at: string; reason: string } };
export type MenuPublication = { publicationId: string; sourceWeekId: string; weekCommencing: string; weekEnding: string; publicationVersion?: number; publicationStatus?: "published" | "withdrawn"; compiledSnapshotId?: string; /** Current one-document downstream handoff. */ weekPacket?: WeeklyPublicationPacket<CompiledPublishedWeekSnapshot>; days: PublishedMenuDay[]; audit: Array<{ action: string; at: string; by: string; publicationDayId?: string }> };
type StoredPublications = { version: 2; publications: MenuPublication[]; events: DurableDomainEvent[]; snapshots?: Record<string, CompiledPublishedWeekSnapshot>; /** Legacy migration field; central Integration Hub is authoritative. */ fulfilmentRequirements?: FulfilmentRequirement[] };
const now = () => new Date().toISOString();
const stable = (value: unknown): string => { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); };
export const contentHash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const read = async (): Promise<StoredPublications> => { const value = await readPublicationState<Partial<StoredPublications>>(); if (!Array.isArray(value.publications)) throw Object.assign(new Error("Menu publication data is unavailable; no publication list was loaded."), { status: 503 }); return { version: 2, publications: value.publications, events: Array.isArray(value.events) ? value.events : [], snapshots: value.snapshots || {} }; };
const clone = <T>(value: T): T => structuredClone(value);
/** Normalize only publication/event graphs before hashing or persistence. */
const normalizePublicationValue = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(item => normalizePublicationValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, normalizePublicationValue(item)])) as T;
  }
  return value;
};
export const publishedDayMatrixHtml = publishedAllergenMatrixHtml;
const populatedWeekdays = (snapshot: RollingSnapshot) => snapshot.days.slice(0, 5).filter(day => snapshot.entries.some(entry => entry.dayId === day.id && entry.itemLabel.trim()));
// Publication previews are pure transformations. The local catalogue read is
// explicitly scoped to this app so NFT never treats it as a monorepo root.
const canonicalItems = (): MenuItem[] => { try { return (JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ cwd(), "local-data", "menu-planning", "canonical-menu-items.json"), "utf8")) as { items?: MenuItem[] }).items || []; } catch { return []; } };
const publishedEntry = (entry: RollingEntry, canonicalDish?: MenuItem): PublishedMenuEntry => { const resolved = resolveAllergenSnapshot(entry, canonicalDish); const mayContainNotes = entry.mayContainNotes ?? resolved.mayContainNotes; return normalizePublicationValue({ sourceEntryId: entry.id, slot: entry.slot, ...(canonicalDish?.canonicalId ? { canonicalDishId: canonicalDish.canonicalId } : {}), dishName: entry.itemLabel, portions: entry.portions, allocations: entry.allocations.map(allocation => ({ ...(allocation.destinationId !== undefined ? { destinationId: allocation.destinationId } : {}), destinationLabel: allocation.destinationLabel, ...(allocation.destinationAddress !== undefined ? { destinationAddress: allocation.destinationAddress } : {}), quantity: allocation.quantity })), allergens: clone(resolved.allergens), ...(mayContainNotes !== undefined ? { mayContainNotes } : {}) }); };
export function buildPublishedDay(snapshot: RollingSnapshot, day: RollingDay) { const items = canonicalItems(); const entries = snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim()).map(entry => { const canonicalDish = entry.itemId ? items.find(item => item.canonicalId === entry.itemId) : undefined; return publishedEntry(entry, canonicalDish); }); const stableDay = normalizePublicationValue({ sourceDayId: day.id, date: day.date, dayName: day.dayName, entries }); return { ...stableDay, contentHash: contentHash(stableDay) }; }
const snapshotBytes = (value: unknown) => { const serialized = JSON.stringify(value); return typeof Buffer !== "undefined" ? Buffer.byteLength(serialized, "utf8") : new TextEncoder().encode(serialized).length; };
export const MAX_COMPILED_SNAPSHOT_BYTES = 900 * 1024;
export function buildCompiledPublicationSnapshot(publication: MenuPublication, sourceWeekVersion: number): CompiledPublishedWeekSnapshot {
  const publicationVersion = publication.publicationVersion || 1;
  const publishedAt = publication.days.filter(day => day.status === "published").map(day => day.publishedAt).sort().at(-1) || now();
  const publishedBy = publication.days.filter(day => day.status === "published").map(day => day.publishedBy).at(-1) || "";
  const base = normalizePublicationValue({ schemaVersion: 1 as const, snapshotId: `${publication.publicationId}:snapshot:v${publicationVersion}`, publicationId: publication.publicationId, sourceWeekId: publication.sourceWeekId, sourceWeekVersion, publicationVersion, publishedAt, publishedBy, sourceLineage: { sourceDomain: "menu-planning" as const, sourceEntityId: publication.sourceWeekId, publicationId: publication.publicationId, sourceWeekVersion, publicationVersion, sourceContentHash: "pending" }, week: { weekCommencing: publication.weekCommencing, weekEnding: publication.weekEnding }, days: publication.days.filter(day => day.status === "published").sort((a, b) => a.date.localeCompare(b.date)).map(day => ({ publicationDayId: day.publicationDayId, sourceDayId: day.sourceDayId, date: day.date, dayName: day.dayName, version: day.version, entries: clone(day.entries) })) });
  base.sourceLineage.sourceContentHash = contentHash({ ...base, sourceLineage: { ...base.sourceLineage, sourceContentHash: "pending" } });
  const snapshot = { ...base, contentHash: contentHash(base) } as CompiledPublishedWeekSnapshot;
  if (snapshotBytes(snapshot) > MAX_COMPILED_SNAPSHOT_BYTES) throw Object.assign(new Error(`The compiled publication snapshot exceeds the ${MAX_COMPILED_SNAPSHOT_BYTES} byte safety limit.`), { status: 413 });
  return snapshot;
}
export function publicationPreview(snapshot: RollingSnapshot, dayId?: string) { return (dayId ? snapshot.days.filter(day => day.id === dayId) : populatedWeekdays(snapshot)).map(day => buildPublishedDay(snapshot, day)); }
function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
function validateDay(snapshot: RollingSnapshot, dayId: string, governedOplocIds?: Set<string>) { const entries = snapshot.entries.filter(entry => entry.dayId === dayId && entry.itemLabel.trim()); if (!entries.length) return entries; const errors = validateWeek({ ...snapshot, entries }, { governedOplocIds, requireCanonicalDishId: Boolean(governedOplocIds) }); if (errors.length) throw Object.assign(new Error(errors.join(" ")), { status: 422 }); return entries; }
export function publicationDayBlockers(snapshot: RollingSnapshot, dayId: string, governedOplocIds?: Set<string>) { try { validateDay(snapshot, dayId, governedOplocIds); return []; } catch (error) { return [error instanceof Error ? error.message : "This menu day is not ready for publication."]; } }
export function publicationWeekBlockers(snapshot: RollingSnapshot, governedOplocIds?: Set<string>) {
  const blockers: string[] = [];
  const weekdays = snapshot.days.slice(0, 5);
  if (weekdays.length < 5) blockers.push("The menu week must contain five service days.");
  if (!weekdays.some(day => snapshot.entries.some(entry => entry.dayId === day.id && entry.itemLabel.trim()))) blockers.push("The menu week must contain at least one populated service day.");
  for (const day of weekdays) for (const blocker of publicationDayBlockers(snapshot, day.id, governedOplocIds)) blockers.push(`${day.dayName}: ${blocker}`);
  return [...new Set(blockers)];
}
export function validatePublicationSignoff(snapshot: RollingSnapshot, dayId: string, signoff: MenuPublicationSignoff = {}, governedOplocIds?: Set<string>) { validateDay(snapshot, dayId, governedOplocIds); const day = publicationPreview(snapshot, dayId)[0]; if (!day) throw Object.assign(new Error("Menu day was not found."), { status: 404 }); return day; }
function appendPublicationEvents(stored: StoredPublications, publication: MenuPublication, day: PublishedMenuDay, action: "published" | "amended" | "withdrawn", actor: string) {
  stored.events ||= [];
  const occurredAt = action === "withdrawn" ? day.withdrawal?.at || now() : day.publishedAt;
  const addEvent = (event: DurableDomainEvent) => { if (!stored.events.some(existing => existing.eventId === event.eventId)) stored.events.push(event); };
  addEvent(createDomainEvent({ eventType: `menu.day.${action}`, sourceAggregateId: `${publication.publicationId}:${day.sourceDayId}`, sourceVersion: day.version, occurredAt, payload: { publicationId: publication.publicationId, publicationDayId: day.publicationDayId, sourceDayId: day.sourceDayId, serviceDate: day.date, version: day.version, contentHash: day.contentHash, status: day.status, actor } }));
  const currentDestinations = [...new Set(day.entries.flatMap(entry => entry.allocations.map(allocation => allocation.destinationId).filter((id): id is string => Boolean(id))))];
  const previousDestinations = publication.days
    .filter(candidate => candidate.sourceDayId === day.sourceDayId)
    .flatMap(candidate => candidate.entries.flatMap(entry => entry.allocations.map(allocation => allocation.destinationId)))
    .filter((id): id is string => Boolean(id));
  const destinations = [...new Set([...currentDestinations, ...previousDestinations])];
  for (const destinationOplocId of destinations) {
    const active = currentDestinations.includes(destinationOplocId);
  addEvent(createDomainEvent({ eventType: "production.materialise", sourceAggregateId: `${publication.publicationId}:${day.sourceDayId}:${destinationOplocId}`, sourceVersion: day.version, occurredAt, payload: normalizePublicationValue({ sourceDomain: "menu-planning", sourceEntityId: day.sourceDayId, publicationId: publication.publicationId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, destinationOplocId, destinationLabel: day.entries.flatMap(entry => entry.allocations).find(allocation => allocation.destinationId === destinationOplocId)?.destinationLabel || destinationOplocId, serviceDate: day.date, status: active ? action === "withdrawn" ? "withdrawn" : action === "amended" ? "amended" : "published" : "withdrawn", lines: active ? day.entries.flatMap(entry => entry.allocations.filter(allocation => allocation.destinationId === destinationOplocId).map(allocation => normalizePublicationValue({ sourceLineId: entry.sourceEntryId, ...(entry.canonicalDishId !== undefined ? { canonicalItemId: entry.canonicalDishId } : {}), itemName: entry.dishName, quantity: allocation.quantity, unit: "portion", workstream: "delivered_in" as const, approvedAllergenSnapshot: normalizePublicationValue({ allergens: entry.allergens, ...(entry.mayContainNotes !== undefined ? { mayContainNotes: entry.mayContainNotes } : {}), sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash }) }))) : [{ sourceLineId: `${day.sourceDayId}:withdrawn`, itemName: "Withdrawn Delivered-In menu", quantity: 0, unit: "portion", workstream: "delivered_in" as const }] }), causationId: `${publication.publicationId}:${day.sourceDayId}:v${day.version}` }));
  }
}
export async function listMenuPublications(limit = 16) { return ((await listPublicationState<StoredPublications>(limit)).publications || []).map(clone); }
export async function listMenuPublicationsForDateRange(fromWeek: string, toWeekExclusive: string) {
  const stored = await readPublicationStateForDateRange<StoredPublications>(fromWeek, toWeekExclusive);
  return stored.publications.map(clone);
}
export async function getMenuPublication(publicationId: string) { const publication = await getPublicationById<MenuPublication>(publicationId); return publication ? clone(publication) : undefined; }
export async function getCompiledPublicationSnapshot(publicationId: string, version?: number) {
  const publication = await getMenuPublication(publicationId);
  if (!publication) return undefined;
  if (!version && publication.weekPacket && publication.publicationStatus !== "withdrawn" && publication.days.some(day => day.status === "published")) return clone(decodeWeeklyPublicationPacket<CompiledPublishedWeekSnapshot>(publication.weekPacket));
  const storedSnapshot = await getPublishedSnapshot<CompiledPublishedWeekSnapshot>(publicationId, version);
  if (storedSnapshot) return clone(storedSnapshot);
  if (version) return undefined;
  return publication.days.some(day => day.status === "published") ? buildCompiledPublicationSnapshot(publication, 0) : undefined;
}
export type PublicationDayState = { currentPublicationDayId?: string; currentVersion?: number; currentContentHash?: string; hasCurrentPublication: boolean; hasUnpublishedChanges: boolean; legacy: boolean; status: "published" | "draft" | "legacy" };
export async function publicationState(snapshot: RollingSnapshot): Promise<Record<string, PublicationDayState>> {
  const publication = (await readPublicationStateForWeek<StoredPublications>(snapshot.week.id)).publications.find(value => value.sourceWeekId === snapshot.week.id);
  return Object.fromEntries(snapshot.days.slice(0, 5).map(day => {
    const current = publication?.days.filter(value => value.sourceDayId === day.id && value.status === "published").sort((a, b) => b.version - a.version)[0];
    const legacy = !current && !publication && snapshot.week.status === "published" && !snapshot.week.dayStatuses;
    const working = buildPublishedDay(snapshot, day);
    const state: PublicationDayState = current ? { currentPublicationDayId: current.publicationDayId, currentVersion: current.version, currentContentHash: current.contentHash, hasCurrentPublication: true, hasUnpublishedChanges: current.contentHash !== working.contentHash, legacy: false, status: "published" } : { hasCurrentPublication: false, hasUnpublishedChanges: false, legacy, status: legacy ? "legacy" : "draft" };
    return [day.id, state];
  }));
}
export async function createPublishedMenuDay(weekId: string, dayId: string, signoff: MenuPublicationSignoff, actor = "local-menu-planner", governedOplocIds?: Set<string>) {
  const expectedWeekVersion = (await getWeek(weekId)).week.version;
  return withMenuPlanningTransaction(state => {
    const rolling = state.rolling as unknown as RollingMenuStored;
    const snapshot = snapshotFromStored(rolling, weekId);
    if (snapshot.week.version !== expectedWeekVersion) throw conflict("The working menu changed while publication was being prepared. Refresh and try again.");
    const entries = snapshot.entries.filter(entry => entry.dayId === dayId && entry.itemLabel.trim());
    const day = snapshot.days.find(value => value.id === dayId);
    if (!day) throw Object.assign(new Error("Menu day was not found."), { status: 404 });
    const errors = validateWeek({ ...snapshot, entries }, { governedOplocIds, requireCanonicalDishId: Boolean(governedOplocIds) });
    if (errors.length) throw Object.assign(new Error(errors.join(" ")), { status: 422 });
    const preview = buildPublishedDay(snapshot, day);
    if (signoff.dayContentHash && signoff.dayContentHash !== preview.contentHash) throw conflict("The current day content changed after sign-off. Review and sign again before publishing.");
    const stored = state.publications as unknown as StoredPublications;
    let publication = stored.publications.find(value => value.sourceWeekId === snapshot.week.id);
    if (!publication) { publication = { publicationId: `menu-publication:${snapshot.week.id}`, sourceWeekId: snapshot.week.id, weekCommencing: snapshot.week.weekCommencing, weekEnding: snapshot.week.weekEnding, days: [], audit: [] }; stored.publications.push(publication); }
    const current = publication.days.find(value => value.sourceDayId === day.id && value.status === "published");
    if (current?.contentHash === preview.contentHash) throw conflict(`This menu day is already published at version ${current.version}.`);
    const version = publication.days.filter(value => value.sourceDayId === day.id).reduce((highest, value) => Math.max(highest, value.version), 0) + 1;
    publication.days = publication.days.map(value => value.sourceDayId === day.id && value.status === "published" ? { ...value, status: "superseded" as const } : value);
    const publishedAt = now();
    const publishedDay: PublishedMenuDay = normalizePublicationValue({ publicationDayId: `${publication.publicationId}:${day.id}:v${version}`, sourceDayId: day.id, date: day.date, dayName: day.dayName, version, status: "published", contentHash: preview.contentHash, publishedAt, publishedBy: actor, entries: clone(preview.entries), ...(Object.keys(signoff || {}).length ? { allergenSignoff: normalizePublicationValue(signoff) } : {}) });
    publication.days.push(publishedDay);
    publication.publicationVersion = (publication.publicationVersion || 0) + 1;
    const compiledSnapshot = buildCompiledPublicationSnapshot(publication, expectedWeekVersion);
    publication.compiledSnapshotId = compiledSnapshot.snapshotId;
    stored.snapshots ||= {};
    stored.snapshots[compiledSnapshot.snapshotId] = compiledSnapshot;
    publication.audit.push({ action: "menu-day-published", at: publishedAt, by: actor, publicationDayId: publishedDay.publicationDayId });
    appendPublicationEvents(stored, publication, publishedDay, version === 1 ? "published" : "amended", actor);
    snapshot.week.dayStatuses = { ...(snapshot.week.dayStatuses || {}), [day.id]: "published" };
    const populated = populatedWeekdays(snapshot); const publishedCount = populated.filter(value => snapshot.week.dayStatuses?.[value.id] === "published").length;
    snapshot.week.status = publishedCount === populated.length && populated.length > 0 ? "published" : "partially_published";
    snapshot.week.version += 1; snapshot.week.audit.push({ action: "menu-day-published", at: publishedAt, by: actor });
    replaceSnapshotInStored(rolling, snapshot);
    return clone(publication);
  }, { weekId, weekVersion: expectedWeekVersion }, { weekId, sourceWeekId: weekId, includeEvents: false });
}
/** Publish the complete current week in one transaction. Legacy day publications remain readable. */
export async function createPublishedMenuWeek(weekId: string, input: MenuPublicationWeekPublishInput = {}, actor = "local-menu-planner", governedOplocIds?: Set<string>, governedOplocs?: readonly GovernedOploc[]) {
  const expectedWeekVersion = (await getWeek(weekId)).week.version;
  return withMenuPlanningTransaction(state => {
    const rolling = state.rolling as unknown as RollingMenuStored;
    const snapshot = normaliseRollingSnapshotDestinations(snapshotFromStored(rolling, weekId), governedOplocs);
    if (snapshot.week.version !== expectedWeekVersion) throw conflict("The working menu changed while publication was being prepared. Refresh and try again.");
    const blockers = publicationWeekBlockers(snapshot, governedOplocIds);
    if (blockers.length) throw Object.assign(new Error(blockers.join(" ")), { status: 422 });
    const previews = snapshot.days.slice(0, 5).map(day => buildPublishedDay(snapshot, day));
    if (input.weekContentHash && input.weekContentHash !== contentHash(previews)) throw conflict("The current week content changed after the publication review. Refresh before publishing.");
    const stored = state.publications as unknown as StoredPublications;
    let publication = stored.publications.find(value => value.sourceWeekId === snapshot.week.id);
    if (!publication) { publication = { publicationId: `menu-publication:${snapshot.week.id}`, sourceWeekId: snapshot.week.id, weekCommencing: snapshot.week.weekCommencing, weekEnding: snapshot.week.weekEnding, days: [], audit: [] }; stored.publications.push(publication); }
    const publishedAt = now();
    const nextVersion = (publication.publicationVersion || 0) + 1;
    const currentDays = new Map(publication.days.filter(day => day.status === "published").map(day => [day.sourceDayId, day]));
    if (nextVersion > 1 && previews.every(preview => currentDays.get(preview.sourceDayId)?.contentHash === preview.contentHash)) throw conflict(`This menu week is already published at version ${publication.publicationVersion}.`);
    const nextDays: PublishedMenuDay[] = previews.map((preview, index) => {
      const current = currentDays.get(preview.sourceDayId);
      const version = current?.contentHash === preview.contentHash ? current.version : publication!.days.filter(day => day.sourceDayId === preview.sourceDayId).reduce((highest, day) => Math.max(highest, day.version), 0) + 1;
      return normalizePublicationValue({ publicationDayId: `${publication!.publicationId}:v${nextVersion}:day:${index}`, sourceDayId: preview.sourceDayId, date: preview.date, dayName: preview.dayName, version, status: "published" as const, contentHash: preview.contentHash, publishedAt, publishedBy: actor, entries: preview.entries });
    });
    publication.days = publication.days.map(day => day.status === "published" ? { ...day, status: "superseded" as const } : day).concat(nextDays);
    publication.publicationVersion = nextVersion;
    publication.publicationStatus = "published";
    const compiledSnapshot = buildCompiledPublicationSnapshot(publication, expectedWeekVersion);
    publication.compiledSnapshotId = compiledSnapshot.snapshotId;
    publication.weekPacket = encodeWeeklyPublicationPacket(compiledSnapshot, publishedAt);
    stored.snapshots ||= {};
    stored.snapshots[compiledSnapshot.snapshotId] = compiledSnapshot;
    publication.audit.push({ action: nextVersion === 1 ? "menu-week-published" : "menu-week-amended", at: publishedAt, by: actor });
    for (const day of nextDays) appendPublicationEvents(stored, publication!, day, nextVersion === 1 ? "published" : "amended", actor);
    snapshot.week.dayStatuses = Object.fromEntries(nextDays.map(day => [day.sourceDayId, "published"]));
    snapshot.week.status = "published";
    snapshot.week.version += 1;
    snapshot.week.audit.push({ action: nextVersion === 1 ? "menu-week-published" : "menu-week-amended", at: publishedAt, by: actor });
    replaceSnapshotInStored(rolling, snapshot);
    return clone(publication!);
  }, { weekId, weekVersion: expectedWeekVersion }, { weekId, sourceWeekId: weekId, includeEvents: false });
}
export function currentPublishedDays(publication: MenuPublication) { return publication.days.filter(day => day.status === "published"); }
/** Explicit historical audit/repair read; normal publication lookups never call this path. */
export async function listMenuPublicationEvents() { return (await read()).events.map(clone); }
export async function replayMenuPublicationOutbox(consumer: (event: DurableDomainEvent) => Promise<void> | void, at = new Date()) {
  let delivered = 0; let failed = 0;
  while (true) {
    const claimId = `menu-replay:${randomUUID()}`;
    const claimed = await claimNextMenuPlanningEvent(claimId, at);
    if (!claimed) break;
    try {
      await consumer(claimed);
      await updateMenuPlanningEvent(claimed.eventId, event => event.delivery.claimId === claimId ? normalizePublicationValue(markEventDelivered(event, new Date().toISOString())) : undefined);
      delivered += 1;
    } catch (error) {
      await updateMenuPlanningEvent(claimed.eventId, event => event.delivery.claimId === claimId ? normalizePublicationValue(markEventFailed(event, error, new Date().toISOString())) : undefined);
      failed += 1;
    }
  }
  return { delivered, failed };
}
export async function publicationSourceWeeks() { return (await listWeeks()).filter(week => week.status === "published" || week.status === "partially_published"); }
export async function withdrawPublishedMenuDay(publicationId: string, publicationDayId: string, reason: string, actor = "local-menu-planner") {
  if (!reason.trim()) throw Object.assign(new Error("A withdrawal reason is required."), { status: 422 });
  return withMenuPlanningTransaction(state => {
    const stored = state.publications as unknown as StoredPublications;
    const publication = stored.publications.find(value => value.publicationId === publicationId);
    const day = publication?.days.find(value => value.publicationDayId === publicationDayId);
    if (!publication || !day) throw Object.assign(new Error("Published menu day was not found."), { status: 404 });
    if (day.status !== "published") throw conflict("Only the current published day can be withdrawn.");
    const at = now(); day.status = "withdrawn"; day.withdrawal = { actor, at, reason: reason.trim() }; publication.audit.push({ action: "menu-day-withdrawn", at, by: actor, publicationDayId }); appendPublicationEvents(stored, publication, day, "withdrawn", actor);
    const rolling = state.rolling as unknown as RollingMenuStored; const snapshot = snapshotFromStored(rolling, publication.sourceWeekId); snapshot.week.dayStatuses = { ...(snapshot.week.dayStatuses || {}), [day.sourceDayId]: "draft" }; snapshot.week.status = "partially_published"; snapshot.week.version += 1; snapshot.week.audit.push({ action: "menu-day-withdrawn", at, by: actor }); replaceSnapshotInStored(rolling, snapshot);
    return clone(publication);
  }, undefined, { weekId: publicationId.replace(/^menu-publication:/, ""), sourceWeekId: publicationId.replace(/^menu-publication:/, ""), includeEvents: false });
}
export async function withdrawPublishedMenuWeek(publicationId: string, reason: string, actor = "local-menu-planner") {
  if (!reason.trim()) throw Object.assign(new Error("A withdrawal reason is required."), { status: 422 });
  return withMenuPlanningTransaction(state => {
    const stored = state.publications as unknown as StoredPublications;
    const publication = stored.publications.find(value => value.publicationId === publicationId);
    if (!publication) throw Object.assign(new Error("Menu publication was not found."), { status: 404 });
    const publishedDays = publication.days.filter(day => day.status === "published");
    if (!publishedDays.length) throw conflict("This menu week has no current published days to withdraw.");
    const at = now();
    for (const day of publishedDays) { day.status = "withdrawn"; day.withdrawal = { actor, at, reason: reason.trim() }; appendPublicationEvents(stored, publication, day, "withdrawn", actor); }
    const rolling = state.rolling as unknown as RollingMenuStored;
    const snapshot = snapshotFromStored(rolling, publication.sourceWeekId);
    snapshot.week.dayStatuses = Object.fromEntries(snapshot.days.slice(0, 5).map(day => [day.id, "draft"]));
    snapshot.week.status = "draft";
    snapshot.week.version += 1;
    snapshot.week.audit.push({ action: "menu-week-withdrawn", at, by: actor });
    replaceSnapshotInStored(rolling, snapshot);
    publication.audit.push({ action: "menu-week-withdrawn", at, by: actor });
    publication.publicationStatus = "withdrawn";
    delete publication.weekPacket;
    return clone(publication);
  }, undefined, { weekId: publicationId.replace(/^menu-publication:/, ""), sourceWeekId: publicationId.replace(/^menu-publication:/, ""), includeEvents: false });
}
export async function archivePublishedDayMatrix(publicationId: string, publicationDayId: string) {
  const publication = await getMenuPublication(publicationId); const day = publication?.days.find(value => value.publicationDayId === publicationDayId); if (!publication || !day) throw new Error("Published menu day was not found.");
  const html = publishedDayMatrixHtml(day); const pdfFileName = `Delivered-In_${publication.weekCommencing}_${day.dayName}_v${day.version}_Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_"); const base = (process.env.HOSPITALITY_BOOKING_BASE_URL || "http://localhost:3300").replace(/\/$/, ""); const archivedAt = now();
  let archive: DriveArchive = { status: "failed", account: process.env.MENU_PUBLICATION_DRIVE_ACCOUNT_LABEL || "Configured Google Drive account", fileName: pdfFileName, pdfFileName, pdfStatus: "unavailable", archivedAt };
  let pdfBase64: string | undefined;
  try { const outputPath = join(/*turbopackIgnore: true*/ process.env.TEMP || process.env.TMP || ".", pdfFileName); await renderPdfLocally(html, outputPath); pdfBase64 = (await readFile(outputPath)).toString("base64"); } catch { /* The archive remains failed until a PDF can be generated. */ }
  if (pdfBase64) try {
    const response = await fetch(`${base}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: pdfFileName, html, pdfBase64, siteKey: process.env.MENU_PUBLICATION_DRIVE_SITE_KEY || "delivered-in", weekCommencing: publication.weekCommencing }), signal: AbortSignal.timeout(8000) });
    const body = await response.json() as { saved?: { fileId?: string; driveUrl?: string } | null };
    archive = { ...archive, status: response.ok && body.saved ? "saved" : response.status === 503 ? "not_configured" : "failed", pdfStatus: response.ok && body.saved ? "saved" : response.status === 503 ? "not_configured" : "failed", ...(body.saved?.fileId ? { fileId: body.saved.fileId, pdfFileId: body.saved.fileId } : {}), ...(body.saved?.driveUrl ? { driveUrl: body.saved.driveUrl, pdfDriveUrl: body.saved.driveUrl } : {}) };
  } catch { /* Publication remains available; the PDF archive status is retained for retry/attention. */ }
  await withMenuPlanningTransaction(state => {
    const stored = state.publications as unknown as StoredPublications;
    const target = stored.publications.find(value => value.publicationId === publicationId)?.days.find(value => value.publicationDayId === publicationDayId);
    if (target) target.driveArchive = archive;
  }, undefined, { sourceWeekId: publication.sourceWeekId, includeEvents: false });
  return archive;
}
