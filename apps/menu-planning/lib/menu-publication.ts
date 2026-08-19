import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CanonicalAllergenMap } from "../../shared/allergen-contract";
import { CANONICAL_ALLERGEN_COLUMNS } from "../../shared/allergen-contract";
import type { RollingDay, RollingEntry, RollingSnapshot } from "./rolling-menu-types";
import { getWeek, listWeeks, saveSnapshot, validateWeek } from "./rolling-menu";
import { renderPdfLocally } from "./local-pdf";

export const PUBLICATION_ATTESTATION = "I confirm that I have reviewed the allergen information shown for this day's published menu and that it reflects the approved information available at the time of publication.";
export type MenuPublicationSignature = { printedName: string; signatureDataUrl?: string; signedAt: string; actor: string; attestation: string };
export type MenuPublicationSignoff = { date: string; productionChef: MenuPublicationSignature; headChefSiteManager: MenuPublicationSignature; dayContentHash: string };
export type PublishedMenuEntry = { sourceEntryId: string; slot: string; canonicalDishId?: string; dishName: string; portions: number; allocations: Array<{ destinationId?: string; destinationLabel: string; quantity: number }>; allergens: CanonicalAllergenMap; mayContainNotes?: string };
export type DriveArchive = { status: "saved" | "not_configured" | "failed"; fileId?: string; driveUrl?: string; account: "cpux@fikacatering.com"; fileName: string; archivedAt: string; pdfStatus: "saved" | "not_configured" | "failed" | "unavailable"; pdfFileId?: string; pdfDriveUrl?: string; pdfFileName: string };
export type PublishedMenuDay = { publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; status: "published" | "superseded"; contentHash: string; publishedAt: string; publishedBy: string; entries: PublishedMenuEntry[]; allergenSignoff: MenuPublicationSignoff; driveArchive?: DriveArchive };
export type MenuPublication = { publicationId: string; sourceWeekId: string; weekCommencing: string; weekEnding: string; days: PublishedMenuDay[]; audit: Array<{ action: string; at: string; by: string; publicationDayId?: string }> };
type StoredPublications = { version: 2; publications: MenuPublication[] };
const file = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
const now = () => new Date().toISOString();
const stable = (value: unknown): string => { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); };
export const contentHash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const read = (): StoredPublications => { if (!existsSync(file)) return { version: 2, publications: [] }; try { const value = JSON.parse(readFileSync(file, "utf8")) as StoredPublications; return { version: 2, publications: value.publications || [] }; } catch { return { version: 2, publications: [] }; } };
const write = (value: StoredPublications) => { mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2)); renameSync(temporary, file); };
const clone = <T>(value: T): T => structuredClone(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
export function publishedDayMatrixHtml(day: PublishedMenuDay) { const headers = CANONICAL_ALLERGEN_COLUMNS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join(""); const rows = day.entries.map(entry => `<tr><th>${escapeHtml(entry.slot)} · ${escapeHtml(entry.dishName)}</th>${CANONICAL_ALLERGEN_COLUMNS.map(([key]) => `<td>${entry.allergens[key] === "contains" ? "✓" : entry.allergens[key] === "may_contain" ? "MC" : ""}</td>`).join("")}<td>${escapeHtml(entry.mayContainNotes || "")}</td></tr>`).join(""); return `<!doctype html><html><head><meta charset="utf-8"><title>Delivered-In ${escapeHtml(day.dayName)} allergen matrix</title><style>body{font-family:Arial,sans-serif;color:#24115c}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #24115c;padding:5px;text-align:center}thead th{background:#4f34c7;color:#fff}tbody th{text-align:left}.meta{margin:12px 0}.signatures{display:flex;gap:24px}</style></head><body><h1>FIKA Delivered-In · ${escapeHtml(day.dayName)} ${escapeHtml(day.date)}</h1><p class="meta">Service date: ${escapeHtml(day.date)} · Published v${day.version} · Day hash ${escapeHtml(day.contentHash)}</p><p class="signatures">Production Chef: ${escapeHtml(day.allergenSignoff.productionChef.printedName)} · Head Chef / Site Manager: ${escapeHtml(day.allergenSignoff.headChefSiteManager.printedName)}</p><table><thead><tr><th>Dish / slot</th>${headers}<th>May-contain notes</th></tr></thead><tbody>${rows}</tbody></table></body></html>`; }
const populatedWeekdays = (snapshot: RollingSnapshot) => snapshot.days.slice(0, 5).filter(day => snapshot.entries.some(entry => entry.dayId === day.id && entry.itemLabel.trim()));
const publishedEntry = (entry: RollingEntry): PublishedMenuEntry => ({ sourceEntryId: entry.id, slot: entry.slot, ...(entry.itemId ? { canonicalDishId: entry.itemId } : {}), dishName: entry.itemLabel, portions: entry.portions, allocations: entry.allocations.map(allocation => ({ destinationId: allocation.destinationId, destinationLabel: allocation.destinationLabel, quantity: allocation.quantity })), allergens: clone(entry.allergens), mayContainNotes: entry.mayContainNotes });
export function buildPublishedDay(snapshot: RollingSnapshot, day: RollingDay) { const entries = snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim()).map(publishedEntry); const stableDay = { sourceDayId: day.id, date: day.date, dayName: day.dayName, entries }; return { ...stableDay, contentHash: contentHash(stableDay) }; }
export function publicationPreview(snapshot: RollingSnapshot, dayId?: string) { return (dayId ? snapshot.days.filter(day => day.id === dayId) : populatedWeekdays(snapshot)).map(day => buildPublishedDay(snapshot, day)); }
function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
function validateDay(snapshot: RollingSnapshot, dayId: string) { const entries = snapshot.entries.filter(entry => entry.dayId === dayId && entry.itemLabel.trim()); if (!entries.length) throw Object.assign(new Error("This menu day has no populated entries."), { status: 422 }); const errors = validateWeek({ ...snapshot, entries }); if (errors.length) throw Object.assign(new Error(errors.join(" ")), { status: 422 }); return entries; }
export function publicationDayBlockers(snapshot: RollingSnapshot, dayId: string) { try { validateDay(snapshot, dayId); return []; } catch (error) { return [error instanceof Error ? error.message : "This menu day is not ready for publication."]; } }
export function validatePublicationSignoff(snapshot: RollingSnapshot, dayId: string, signoff: MenuPublicationSignoff) { validateDay(snapshot, dayId); const day = publicationPreview(snapshot, dayId)[0]; if (!day) throw Object.assign(new Error("Menu day was not found."), { status: 404 }); const productionChefReady = Boolean(signoff?.productionChef?.printedName.trim() && signoff.productionChef.signatureDataUrl); const headChefReady = Boolean(signoff?.headChefSiteManager?.printedName.trim() && signoff.headChefSiteManager.signatureDataUrl); if (!productionChefReady || !headChefReady || signoff.dayContentHash !== day.contentHash) throw conflict(`Production Chef and Head Chef / Site Manager allergen sign-off is required for ${day.dayName}, and must match the current day content.`); return day; }
export function listMenuPublications() { return read().publications.map(clone); }
export function getMenuPublication(publicationId: string) { const publication = read().publications.find(value => value.publicationId === publicationId); return publication ? clone(publication) : undefined; }
export function createPublishedMenuDay(weekId: string, dayId: string, signoff: MenuPublicationSignoff, actor = "local-menu-planner") {
  const snapshot = getWeek(weekId);
  if (snapshot.week.status === "published" && !snapshot.week.dayStatuses) throw conflict("This menu week is already published.");
  const day = validatePublicationSignoff(snapshot, dayId, signoff);
  const stored = read();
  let publication = stored.publications.find(value => value.sourceWeekId === snapshot.week.id);
  if (!publication) { publication = { publicationId: `menu-publication:${snapshot.week.id}`, sourceWeekId: snapshot.week.id, weekCommencing: snapshot.week.weekCommencing, weekEnding: snapshot.week.weekEnding, days: [], audit: [] }; stored.publications.push(publication); }
  const current = publication.days.find(value => value.sourceDayId === day.sourceDayId && value.status === "published");
  if (current?.contentHash === day.contentHash) throw conflict(`This menu day is already published at version ${current.version}.`);
  const version = publication.days.filter(value => value.sourceDayId === day.sourceDayId).reduce((highest, value) => Math.max(highest, value.version), 0) + 1;
  publication.days = publication.days.map(value => value.sourceDayId === day.sourceDayId && value.status === "published" ? { ...value, status: "superseded" as const } : value);
  const publishedAt = now();
  const publishedDay: PublishedMenuDay = { publicationDayId: `${publication.publicationId}:${day.sourceDayId}:v${version}`, sourceDayId: day.sourceDayId, date: day.date, dayName: day.dayName, version, status: "published", contentHash: day.contentHash, publishedAt, publishedBy: actor, entries: clone(day.entries), allergenSignoff: clone(signoff) };
  publication.days.push(publishedDay);
  publication.audit.push({ action: "menu-day-published", at: publishedAt, by: actor, publicationDayId: publishedDay.publicationDayId });
  write(stored);
  snapshot.week.dayStatuses = { ...(snapshot.week.dayStatuses || {}), [day.sourceDayId]: "published" };
  const populated = populatedWeekdays(snapshot); const publishedCount = populated.filter(value => snapshot.week.dayStatuses?.[value.id] === "published").length;
  snapshot.week.status = publishedCount === populated.length && populated.length > 0 ? "published" : "partially_published";
  snapshot.week.version += 1; snapshot.week.audit.push({ action: "menu-day-published", at: publishedAt, by: actor }); saveSnapshot(snapshot);
  return clone(publication);
}
export function currentPublishedDays(publication: MenuPublication) { return publication.days.filter(day => day.status === "published"); }
export function publicationSourceWeeks() { return listWeeks().filter(week => week.status === "published" || week.status === "partially_published"); }
export async function archivePublishedDayMatrix(publicationId: string, publicationDayId: string) {
  const publication = getMenuPublication(publicationId); const day = publication?.days.find(value => value.publicationDayId === publicationDayId); if (!publication || !day) throw new Error("Published menu day was not found.");
  const html = publishedDayMatrixHtml(day); const pdfFileName = `Delivered-In_${publication.weekCommencing}_${day.dayName}_v${day.version}_Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_"); const base = (process.env.HOSPITALITY_BOOKING_BASE_URL || "http://localhost:3300").replace(/\/$/, ""); const archivedAt = now();
  let archive: DriveArchive = { status: "failed", account: "cpux@fikacatering.com", fileName: pdfFileName, pdfFileName, pdfStatus: "unavailable", archivedAt };
  let pdfBase64: string | undefined;
  try { const outputPath = join(process.env.TEMP || process.env.TMP || ".", pdfFileName); await renderPdfLocally(html, outputPath); pdfBase64 = (await readFile(outputPath)).toString("base64"); } catch { /* The archive remains failed until a PDF can be generated. */ }
  if (pdfBase64) try {
    const response = await fetch(`${base}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: pdfFileName, html, pdfBase64, siteKey: "delivered-in", driveAccount: "cpux@fikacatering.com" }), signal: AbortSignal.timeout(8000) });
    const body = await response.json() as { saved?: { fileId?: string; driveUrl?: string } | null };
    archive = { ...archive, status: response.ok && body.saved ? "saved" : response.status === 503 ? "not_configured" : "failed", pdfStatus: response.ok && body.saved ? "saved" : response.status === 503 ? "not_configured" : "failed", ...(body.saved?.fileId ? { fileId: body.saved.fileId, pdfFileId: body.saved.fileId } : {}), ...(body.saved?.driveUrl ? { driveUrl: body.saved.driveUrl, pdfDriveUrl: body.saved.driveUrl } : {}) };
  } catch { /* Publication remains available; the PDF archive status is retained for retry/attention. */ }
  const stored = read(); const target = stored.publications.find(value => value.publicationId === publicationId)?.days.find(value => value.publicationDayId === publicationDayId); if (target) { target.driveArchive = archive; write(stored); }
  return archive;
}
