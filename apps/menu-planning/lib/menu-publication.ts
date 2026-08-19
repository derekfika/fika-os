import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalAllergenMap } from "../../shared/allergen-contract";
import type { RollingDay, RollingEntry, RollingSnapshot } from "./rolling-menu-types";
import { getWeek, listWeeks, replaceSnapshotInStored, saveSnapshot, snapshotFromStored, validateWeek, type Stored as RollingMenuStored } from "./rolling-menu";
import { renderPdfLocally } from "./local-pdf";
import { resolveAllergenSnapshot } from "./allergen-resolution";
import type { MenuItem } from "./domain";
import { publishedAllergenMatrixHtml } from "../../shared/published-allergen-matrix";
import { claimEvent, createDomainEvent, eventIsDue, markEventDelivered, markEventFailed, type DurableDomainEvent } from "../../shared/domain-events";
import { fulfilmentFromPublishedMenuDay, fulfilmentRequirementIdentity, type FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { readPublicationState, updatePublicationState, withMenuPlanningTransaction } from "./operational-store";
import { appDataPath } from "../../shared/app-data-path";

export const PUBLICATION_ATTESTATION = "I confirm that I have reviewed the allergen information shown for this day's published menu and that it reflects the approved information available at the time of publication.";
export type MenuPublicationSignature = { printedName: string; signatureDataUrl?: string; signedAt: string; actor: string; attestation: string };
export type MenuPublicationSignoff = { date: string; productionChef: MenuPublicationSignature; headChefSiteManager: MenuPublicationSignature; dayContentHash: string };
export type PublishedMenuEntry = { sourceEntryId: string; slot: string; canonicalDishId?: string; dishName: string; portions: number; allocations: Array<{ destinationId?: string; destinationLabel: string; quantity: number }>; allergens: CanonicalAllergenMap; mayContainNotes?: string };
export type DriveArchive = { status: "saved" | "not_configured" | "failed"; fileId?: string; driveUrl?: string; account: string; fileName: string; archivedAt: string; pdfStatus: "saved" | "not_configured" | "failed" | "unavailable"; pdfFileId?: string; pdfDriveUrl?: string; pdfFileName: string };
export type PublishedMenuDay = { publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; status: "published" | "superseded" | "withdrawn"; contentHash: string; publishedAt: string; publishedBy: string; entries: PublishedMenuEntry[]; allergenSignoff: MenuPublicationSignoff; driveArchive?: DriveArchive; withdrawal?: { actor: string; at: string; reason: string } };
export type MenuPublication = { publicationId: string; sourceWeekId: string; weekCommencing: string; weekEnding: string; days: PublishedMenuDay[]; audit: Array<{ action: string; at: string; by: string; publicationDayId?: string }> };
type StoredPublications = { version: 2; publications: MenuPublication[]; events: DurableDomainEvent[]; /** Legacy migration field; central Integration Hub is authoritative. */ fulfilmentRequirements?: FulfilmentRequirement[] };
const now = () => new Date().toISOString();
const stable = (value: unknown): string => { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); };
export const contentHash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const read = (): StoredPublications => { const value = readPublicationState<Partial<StoredPublications>>(); if (!Array.isArray(value.publications)) throw Object.assign(new Error("Menu publication data is unavailable; no publication list was loaded."), { status: 503 }); return { version: 2, publications: value.publications, events: Array.isArray(value.events) ? value.events : [] }; };
const write = (value: StoredPublications) => { updatePublicationState<StoredPublications>(current => { Object.assign(current, structuredClone(value)); }); };
const clone = <T>(value: T): T => structuredClone(value);
export const publishedDayMatrixHtml = publishedAllergenMatrixHtml;
const populatedWeekdays = (snapshot: RollingSnapshot) => snapshot.days.slice(0, 5).filter(day => snapshot.entries.some(entry => entry.dayId === day.id && entry.itemLabel.trim()));
const canonicalItems = (): MenuItem[] => { try { return (JSON.parse(readFileSync(appDataPath("menu-planning", "menu-planning", "canonical-menu-items.json"), "utf8")) as { items?: MenuItem[] }).items || []; } catch { return []; } };
const publishedEntry = (entry: RollingEntry, canonicalDish?: MenuItem): PublishedMenuEntry => { const resolved = resolveAllergenSnapshot(entry, canonicalDish); return { sourceEntryId: entry.id, slot: entry.slot, ...(entry.itemId ? { canonicalDishId: entry.itemId } : {}), dishName: entry.itemLabel, portions: entry.portions, allocations: entry.allocations.map(allocation => ({ destinationId: allocation.destinationId, destinationLabel: allocation.destinationLabel, quantity: allocation.quantity })), allergens: clone(resolved.allergens), mayContainNotes: entry.mayContainNotes || resolved.mayContainNotes }; };
export function buildPublishedDay(snapshot: RollingSnapshot, day: RollingDay) { const items = canonicalItems(); const entries = snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim()).map(entry => publishedEntry(entry, items.find(item => item.canonicalId === entry.itemId || item.displayName.trim().toLocaleLowerCase() === entry.itemLabel.trim().toLocaleLowerCase()))); const stableDay = { sourceDayId: day.id, date: day.date, dayName: day.dayName, entries }; return { ...stableDay, contentHash: contentHash(stableDay) }; }
export function publicationPreview(snapshot: RollingSnapshot, dayId?: string) { return (dayId ? snapshot.days.filter(day => day.id === dayId) : populatedWeekdays(snapshot)).map(day => buildPublishedDay(snapshot, day)); }
function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
function validateDay(snapshot: RollingSnapshot, dayId: string) { const entries = snapshot.entries.filter(entry => entry.dayId === dayId && entry.itemLabel.trim()); if (!entries.length) throw Object.assign(new Error("This menu day has no populated entries."), { status: 422 }); const errors = validateWeek({ ...snapshot, entries }); if (errors.length) throw Object.assign(new Error(errors.join(" ")), { status: 422 }); return entries; }
export function publicationDayBlockers(snapshot: RollingSnapshot, dayId: string) { try { validateDay(snapshot, dayId); return []; } catch (error) { return [error instanceof Error ? error.message : "This menu day is not ready for publication."]; } }
export function validatePublicationSignoff(snapshot: RollingSnapshot, dayId: string, signoff: MenuPublicationSignoff) { validateDay(snapshot, dayId); const day = publicationPreview(snapshot, dayId)[0]; if (!day) throw Object.assign(new Error("Menu day was not found."), { status: 404 }); const productionChefReady = Boolean(signoff?.productionChef?.printedName.trim() && signoff.productionChef.signatureDataUrl); const headChefReady = Boolean(signoff?.headChefSiteManager?.printedName.trim() && signoff.headChefSiteManager.signatureDataUrl); if (!productionChefReady || !headChefReady || signoff.dayContentHash !== day.contentHash) throw conflict(`Production Chef and Head Chef / Site Manager allergen sign-off is required for ${day.dayName}, and must match the current day content.`); return day; }
function appendPublicationEvents(stored: StoredPublications, publication: MenuPublication, day: PublishedMenuDay, action: "published" | "amended" | "withdrawn", actor: string) {
  stored.events ||= [];
  const occurredAt = action === "withdrawn" ? day.withdrawal?.at || now() : day.publishedAt;
  const addEvent = (event: DurableDomainEvent) => { if (!stored.events.some(existing => existing.eventId === event.eventId)) stored.events.push(event); };
  addEvent(createDomainEvent({ eventType: `menu.day.${action}`, sourceAggregateId: `${publication.publicationId}:${day.sourceDayId}`, sourceVersion: day.version, occurredAt, payload: { publicationId: publication.publicationId, publicationDayId: day.publicationDayId, sourceDayId: day.sourceDayId, serviceDate: day.date, version: day.version, contentHash: day.contentHash, status: day.status, actor } }));
  const currentDestinations = [...new Set(day.entries.flatMap(entry => entry.allocations.map(allocation => allocation.destinationId).filter((id): id is string => Boolean(id))))];
  const previousDestinations = stored.events
    .map(event => event.payload as Partial<FulfilmentRequirement>)
    .filter(requirement => requirement.entityType === "Fulfilment Requirement" && requirement.sourceDomain === "menu-planning" && requirement.sourceEntityId === day.sourceDayId)
    .map(requirement => requirement.destinationOplocId)
    .filter((id): id is string => Boolean(id));
  const destinations = [...new Set([...currentDestinations, ...previousDestinations])];
  for (const destinationOplocId of destinations) {
    const previous = stored.events
      .map(event => event.payload as FulfilmentRequirement)
      .filter(requirement => requirement?.entityType === "Fulfilment Requirement" && requirement.canonicalId === fulfilmentRequirementIdentity("menu-planning", day.sourceDayId, destinationOplocId))
      .sort((a, b) => b.sourceVersion - a.sourceVersion)[0];
    const requirement = fulfilmentFromPublishedMenuDay(currentDestinations.includes(destinationOplocId) ? day : { ...day, status: "withdrawn" }, destinationOplocId, previous);
    addEvent(createDomainEvent({ eventType: `fulfilment.requirement.${requirement.status === "withdrawn" ? "withdrawn" : previous ? "amended" : "created"}`, sourceAggregateId: requirement.canonicalId, sourceVersion: requirement.sourceVersion, occurredAt, payload: requirement, causationId: `${publication.publicationId}:${day.sourceDayId}:v${day.version}` }));
  }
}
export function listMenuPublications() { return read().publications.map(clone); }
export function getMenuPublication(publicationId: string) { const publication = read().publications.find(value => value.publicationId === publicationId); return publication ? clone(publication) : undefined; }
export type PublicationDayState = { currentPublicationDayId?: string; currentVersion?: number; currentContentHash?: string; hasCurrentPublication: boolean; hasUnpublishedChanges: boolean; legacy: boolean; status: "published" | "draft" | "legacy" };
export function publicationState(snapshot: RollingSnapshot): Record<string, PublicationDayState> {
  const publication = read().publications.find(value => value.sourceWeekId === snapshot.week.id);
  return Object.fromEntries(snapshot.days.slice(0, 5).map(day => {
    const current = publication?.days.filter(value => value.sourceDayId === day.id && value.status === "published").sort((a, b) => b.version - a.version)[0];
    const legacy = !current && !publication && snapshot.week.status === "published" && !snapshot.week.dayStatuses;
    const working = buildPublishedDay(snapshot, day);
    const state: PublicationDayState = current ? { currentPublicationDayId: current.publicationDayId, currentVersion: current.version, currentContentHash: current.contentHash, hasCurrentPublication: true, hasUnpublishedChanges: current.contentHash !== working.contentHash, legacy: false, status: "published" } : { hasCurrentPublication: false, hasUnpublishedChanges: false, legacy, status: legacy ? "legacy" : "draft" };
    return [day.id, state];
  }));
}
export function createPublishedMenuDay(weekId: string, dayId: string, signoff: MenuPublicationSignoff, actor = "local-menu-planner", governedOplocIds?: Set<string>) {
  const expectedWeekVersion = getWeek(weekId).week.version;
  return withMenuPlanningTransaction(state => {
    const rolling = state.rolling as unknown as RollingMenuStored;
    const snapshot = snapshotFromStored(rolling, weekId);
    if (snapshot.week.version !== expectedWeekVersion) throw conflict("The working menu changed while publication was being prepared. Refresh and try again.");
    const entries = snapshot.entries.filter(entry => entry.dayId === dayId && entry.itemLabel.trim());
    const day = snapshot.days.find(value => value.id === dayId);
    if (!day) throw Object.assign(new Error("Menu day was not found."), { status: 404 });
    if (!entries.length) throw Object.assign(new Error("This menu day has no populated entries."), { status: 422 });
    const errors = validateWeek({ ...snapshot, entries }, { governedOplocIds, requireCanonicalDishId: Boolean(governedOplocIds) });
    if (errors.length) throw Object.assign(new Error(errors.join(" ")), { status: 422 });
    const preview = buildPublishedDay(snapshot, day);
    const productionChefReady = Boolean(signoff?.productionChef?.printedName.trim() && signoff.productionChef.signatureDataUrl);
    const headChefReady = Boolean(signoff?.headChefSiteManager?.printedName.trim() && signoff.headChefSiteManager.signatureDataUrl);
    if (!productionChefReady || !headChefReady || signoff.dayContentHash !== preview.contentHash) throw conflict(`Production Chef and Head Chef / Site Manager allergen sign-off is required for ${day.dayName}, and must match the current day content.`);
    const stored = state.publications as unknown as StoredPublications;
    let publication = stored.publications.find(value => value.sourceWeekId === snapshot.week.id);
    if (!publication) { publication = { publicationId: `menu-publication:${snapshot.week.id}`, sourceWeekId: snapshot.week.id, weekCommencing: snapshot.week.weekCommencing, weekEnding: snapshot.week.weekEnding, days: [], audit: [] }; stored.publications.push(publication); }
    const current = publication.days.find(value => value.sourceDayId === day.id && value.status === "published");
    if (current?.contentHash === preview.contentHash) throw conflict(`This menu day is already published at version ${current.version}.`);
    const version = publication.days.filter(value => value.sourceDayId === day.id).reduce((highest, value) => Math.max(highest, value.version), 0) + 1;
    publication.days = publication.days.map(value => value.sourceDayId === day.id && value.status === "published" ? { ...value, status: "superseded" as const } : value);
    const publishedAt = now();
    const publishedDay: PublishedMenuDay = { publicationDayId: `${publication.publicationId}:${day.id}:v${version}`, sourceDayId: day.id, date: day.date, dayName: day.dayName, version, status: "published", contentHash: preview.contentHash, publishedAt, publishedBy: actor, entries: clone(preview.entries), allergenSignoff: clone(signoff) };
    publication.days.push(publishedDay);
    publication.audit.push({ action: "menu-day-published", at: publishedAt, by: actor, publicationDayId: publishedDay.publicationDayId });
    appendPublicationEvents(stored, publication, publishedDay, version === 1 ? "published" : "amended", actor);
    snapshot.week.dayStatuses = { ...(snapshot.week.dayStatuses || {}), [day.id]: "published" };
    const populated = populatedWeekdays(snapshot); const publishedCount = populated.filter(value => snapshot.week.dayStatuses?.[value.id] === "published").length;
    snapshot.week.status = publishedCount === populated.length && populated.length > 0 ? "published" : "partially_published";
    snapshot.week.version += 1; snapshot.week.audit.push({ action: "menu-day-published", at: publishedAt, by: actor });
    replaceSnapshotInStored(rolling, snapshot);
    return clone(publication);
  });
}
export function currentPublishedDays(publication: MenuPublication) { return publication.days.filter(day => day.status === "published"); }
export function listMenuPublicationEvents() { return read().events.map(clone); }
export async function replayMenuPublicationOutbox(consumer: (event: DurableDomainEvent) => Promise<void> | void, at = new Date()) {
  let delivered = 0; let failed = 0;
  while (true) {
    const claimId = `menu-replay:${randomUUID()}`;
    const claimed = withMenuPlanningTransaction(state => {
      const stored = state.publications as unknown as StoredPublications; stored.events ||= [];
      const sorted = stored.events.slice().sort((a, b) => a.sourceAggregateId.localeCompare(b.sourceAggregateId) || a.sourceVersion - b.sourceVersion || a.eventId.localeCompare(b.eventId));
      const event = sorted.find(candidate => eventIsDue(candidate, at) && !sorted.some(previous => previous.sourceAggregateId === candidate.sourceAggregateId && previous.sourceVersion < candidate.sourceVersion && previous.delivery.status !== "delivered"));
      if (!event) return undefined;
      const next = claimEvent(event, claimId, at.toISOString()); const index = stored.events.findIndex(candidate => candidate.eventId === event.eventId); stored.events[index] = next; return structuredClone(next);
    });
    if (!claimed) break;
    try {
      await consumer(claimed);
      withMenuPlanningTransaction(state => { const stored = state.publications as unknown as StoredPublications; const index = stored.events.findIndex(event => event.eventId === claimed.eventId && event.delivery.claimId === claimId); if (index >= 0) stored.events[index] = markEventDelivered(stored.events[index], new Date().toISOString()); });
      delivered += 1;
    } catch (error) {
      withMenuPlanningTransaction(state => { const stored = state.publications as unknown as StoredPublications; const index = stored.events.findIndex(event => event.eventId === claimed.eventId && event.delivery.claimId === claimId); if (index >= 0) stored.events[index] = markEventFailed(stored.events[index], error, new Date().toISOString()); });
      failed += 1;
    }
  }
  return { delivered, failed };
}
export function publicationSourceWeeks() { return listWeeks().filter(week => week.status === "published" || week.status === "partially_published"); }
export function withdrawPublishedMenuDay(publicationId: string, publicationDayId: string, reason: string, actor = "local-menu-planner") {
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
  });
}
export async function archivePublishedDayMatrix(publicationId: string, publicationDayId: string) {
  const publication = getMenuPublication(publicationId); const day = publication?.days.find(value => value.publicationDayId === publicationDayId); if (!publication || !day) throw new Error("Published menu day was not found.");
  const html = publishedDayMatrixHtml(day); const pdfFileName = `Delivered-In_${publication.weekCommencing}_${day.dayName}_v${day.version}_Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_"); const base = (process.env.HOSPITALITY_BOOKING_BASE_URL || "http://localhost:3300").replace(/\/$/, ""); const archivedAt = now();
  let archive: DriveArchive = { status: "failed", account: process.env.MENU_PUBLICATION_DRIVE_ACCOUNT_LABEL || "Configured Google Drive account", fileName: pdfFileName, pdfFileName, pdfStatus: "unavailable", archivedAt };
  let pdfBase64: string | undefined;
  try { const outputPath = join(process.env.TEMP || process.env.TMP || ".", pdfFileName); await renderPdfLocally(html, outputPath); pdfBase64 = (await readFile(outputPath)).toString("base64"); } catch { /* The archive remains failed until a PDF can be generated. */ }
  if (pdfBase64) try {
    const response = await fetch(`${base}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: pdfFileName, html, pdfBase64, siteKey: process.env.MENU_PUBLICATION_DRIVE_SITE_KEY || "delivered-in", weekCommencing: publication.weekCommencing }), signal: AbortSignal.timeout(8000) });
    const body = await response.json() as { saved?: { fileId?: string; driveUrl?: string } | null };
    archive = { ...archive, status: response.ok && body.saved ? "saved" : response.status === 503 ? "not_configured" : "failed", pdfStatus: response.ok && body.saved ? "saved" : response.status === 503 ? "not_configured" : "failed", ...(body.saved?.fileId ? { fileId: body.saved.fileId, pdfFileId: body.saved.fileId } : {}), ...(body.saved?.driveUrl ? { driveUrl: body.saved.driveUrl, pdfDriveUrl: body.saved.driveUrl } : {}) };
  } catch { /* Publication remains available; the PDF archive status is retained for retry/attention. */ }
  const stored = read(); const target = stored.publications.find(value => value.publicationId === publicationId)?.days.find(value => value.publicationDayId === publicationDayId); if (target) { target.driveArchive = archive; write(stored); }
  return archive;
}
