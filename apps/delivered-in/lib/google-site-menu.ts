import { promises as fs } from "node:fs";
import type { ProjectedDay, Site } from "./projection";
import { groupSiteMenuEntries, siteMenuFileName, type SiteMenuArtifact } from "./site-menu";
import { CANONICAL_ALLERGEN_COLUMNS } from "./allergen-columns";
import { driveOwnerEnvKey } from "@fika/server-shared/drive-owner";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { MenuArtifactError, ensureGeneratedMenusFolder, menuDestinationToken, publishMenuArtifact, resolveMenuDestination, resolveMenuTemplate, type MenuOutputFormat } from "@fika/server-shared/menu-artifact";
import { deliveredInMenuFromDay, deliveredInMenuSiteKey } from "./menu-adapter";

type OAuthClient = { installed?: { client_id: string; client_secret: string; token_uri?: string } };
type OAuthToken = { access_token?: string; refresh_token?: string; expiry_date?: number; token_type?: string };
type Presentation = { pageSize?: { width?: { magnitude?: number }; height?: { magnitude?: number } }; slides?: Array<{ objectId: string; pageElements?: Array<{ objectId: string; size?: { width?: { magnitude?: number }; height?: { magnitude?: number } }; transform?: { translateX?: number; translateY?: number }; shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } } }> }> };

const json = async <T>(response: Response): Promise<T> => { const text = await response.text(); let body: unknown; try { body = JSON.parse(text); } catch { throw new Error(`Google API returned ${response.status} without JSON.`); } if (!response.ok) throw new Error(`Google API ${response.status}: ${JSON.stringify(body)}`); return body as T; };
async function googleFetch(input: string, init: RequestInit, label: string) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000); try { return await fetch(input, { ...init, signal: controller.signal }); } catch (error) { if ((error as { name?: string }).name === "AbortError") throw new Error(`${label} timed out after 30 seconds.`); throw new Error(`${label} failed: ${(error as Error).message}`); } finally { clearTimeout(timer); } }
function resourceId(value?: string) { const raw = value?.trim().replace(/[),.;]+$/, ""); if (!raw) return undefined; return (raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || raw.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] || raw).replace(/[),.;]+$/, ""); }
/** The OPLOC's own Drive owner (DWD impersonates exactly that user) and explicit menu parent folder; never an app-wide owner or folder. */
async function siteDestination(oplocId: string) {
  const destination = resolveMenuDestination({ oplocId });
  return { destination, token: await menuDestinationToken(destination) };
}
export function weekFolderName(weekCommencing?: string) { return weekCommencing ? `WC_${weekCommencing}` : undefined; }
async function trashDriveFile(fileId: string, headers: Record<string, string>) { await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ trashed: true }) }, "Delivered-In previous menu replacement"); }
export async function retireGoogleSiteMenu(oplocId: string, fileId?: string) { if (!fileId) return; const { token } = await siteDestination(oplocId); await trashDriveFile(fileId, { Authorization: `Bearer ${token}`, "content-type": "application/json" }); }
function slideText(slide: NonNullable<Presentation["slides"]>[number]) { return (slide.pageElements || []).flatMap(element => element.shape?.text?.textElements || []).map(element => element.textRun?.content || "").join(""); }
function titleCase(value: string) { return value.trim().toLocaleLowerCase("en-GB").replace(/(^|[^A-Za-zÀ-ÿ])([a-zà-ÿ])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("en-GB")}`); }
function declaredAllergens(dayEntry: ProjectedDay["entries"][number]) { return CANONICAL_ALLERGEN_COLUMNS.filter(([key]) => key !== "no_key_allergens" && (dayEntry.allergens[key] === "contains" || dayEntry.allergens[key] === "may_contain")).map(([, label]) => label); }
function sectionAnchors(presentation: Presentation, token: string) { return (presentation.slides || []).flatMap(slide => (slide.pageElements || []).filter(element => (element.shape?.text?.textElements || []).map(item => item.textRun?.content || "").join("").includes(token)).map(element => ({ slide, element }))); }
function textBoxRequest(slideId: string, objectId: string, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: { red: number; green: number; blue: number }, bold: boolean) {
  return [
    { createShape: { objectId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: slideId, size: { width: { magnitude: width, unit: "EMU" }, height: { magnitude: height, unit: "EMU" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" } } } },
    { insertText: { objectId, text } },
    { updateTextStyle: { objectId, style: { fontFamily: "Montserrat", fontSize: { magnitude: fontSize, unit: "PT" }, bold, foregroundColor: { opaqueColor: { rgbColor: color } } }, textRange: { type: "ALL" }, fields: "fontFamily,fontSize,bold,foregroundColor" } },
    { updateShapeProperties: { objectId, shapeProperties: { contentAlignment: "MIDDLE" }, fields: "contentAlignment" } },
    { updateParagraphStyle: { objectId, style: { alignment: "CENTER", lineSpacing: 100 }, textRange: { type: "ALL" }, fields: "alignment,lineSpacing" } },
  ];
}
function sectionRequests(day: ProjectedDay, presentation: Presentation, key: "salads" | "hot_mains" | "sides_extras") {
  const token = `{{${key.toUpperCase()}}}`; const anchors = sectionAnchors(presentation, token); const entries = groupSiteMenuEntries(day.entries).find(section => section.key === key)?.entries || [];
  if (!entries.length) return anchors.map(anchor => ({ deleteObject: { objectId: anchor.slide.objectId } }));
  const requests: Array<Record<string, unknown>> = []; const pageWidth = presentation.pageSize?.width?.magnitude || 10_000_000; const pageHeight = presentation.pageSize?.height?.magnitude || 5_625_000;
  anchors.forEach((anchor, anchorIndex) => {
    const y = anchor.element.transform?.translateY || 1_000_000; const sideMargin = Math.max(650_000, Math.min(900_000, pageWidth * .08)); const x = sideMargin; const width = pageWidth - (sideMargin * 2); const tokenHeight = anchor.element.size?.height?.magnitude || 0; const safeHeight = Math.max(1_800_000, pageHeight - y - 950_000); const height = Math.min(Math.max(tokenHeight, safeHeight), pageHeight - y - 650_000);
    const measure = (font: number) => { const charsPerLine = Math.max(24, Math.floor((width / 12_700) / (font * .70))); return entries.map(entry => { const nameLines = Math.max(1, Math.ceil(titleCase(entry.dishName).length / charsPerLine)); const allergens = declaredAllergens(entry); const allergenCharsPerLine = Math.max(30, charsPerLine + 10); const allergenLines = allergens.length ? Math.max(1, Math.ceil(`(${allergens.join(", ")})`.length / allergenCharsPerLine)) : 0; const lineHeight = Math.max(190_000, font * 12_700 * 1.24 + 70_000); const allergenFont = Math.max(10, font * .68); const allergenHeight = allergenLines ? allergenLines * allergenFont * 12_700 * 1.18 + 75_000 : 0; return { entry, allergens, nameHeight: nameLines * lineHeight + 65_000, allergenHeight }; }); };
    let font = 28; let allergenFont = Math.max(11, font * .68); const gap = Math.max(65_000, Math.min(145_000, 195_000 - entries.length * 14_000)); let blocks = measure(font); let total = blocks.reduce((sum, block) => sum + block.nameHeight + block.allergenHeight + gap, 0);
    while (total > height && font > 12) { font -= .5; allergenFont = Math.max(10, font * .68); blocks = measure(font); total = blocks.reduce((sum, block) => sum + block.nameHeight + block.allergenHeight + gap, 0); }
    let cursor = y + Math.max(100_000, (height - total) / 2); requests.push({ deleteObject: { objectId: anchor.element.objectId } });
    blocks.forEach((block, index) => { const dishId = `fika-delivered-in-${key}-${anchorIndex}-dish-${index}`; requests.push(...textBoxRequest(anchor.slide.objectId, dishId, titleCase(block.entry.dishName), x, cursor, width, block.nameHeight, font, { red: 0, green: 0, blue: 0 }, false)); cursor += block.nameHeight; if (block.allergens.length) { const allergenId = `fika-delivered-in-${key}-${anchorIndex}-allergens-${index}`; requests.push(...textBoxRequest(anchor.slide.objectId, allergenId, `(${block.allergens.join(", ")})`, x, cursor, width, block.allergenHeight, allergenFont, { red: 1, green: 0, blue: 0 }, true)); cursor += block.allergenHeight; } cursor += gap; });
  });
  return requests;
}
export function buildDeliveredInMenuRequests(day: ProjectedDay, site: Site, presentation: Presentation) {
  const requests: Array<Record<string, unknown>> = [
    { replaceAllText: { containsText: { text: "{{SITE_NAME}}", matchCase: true }, replaceText: site.label } },
    { replaceAllText: { containsText: { text: "{{SERVICE_DATE}}", matchCase: true }, replaceText: new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) } },
    { replaceAllText: { containsText: { text: "{{WEEK_COMMENCING}}", matchCase: true }, replaceText: day.weekCommencing || "" } },
  ];
  for (const key of ["salads", "hot_mains", "sides_extras"] as const) requests.push(...sectionRequests(day, presentation, key));
  return requests;
}

/**
 * Sites with a shared site template (for example MNK) are rendered by the shared
 * menu renderer from the normalized menu. The Delivered-In generic template
 * path below is kept unchanged for sites that have no site template.
 */
async function createSharedSiteMenu(day: ProjectedDay, site: Site, generatedBy: string, deliveryId?: string, format: MenuOutputFormat = "tablet"): Promise<SiteMenuArtifact> {
  const menu = deliveredInMenuFromDay(day, site);
  const template = resolveMenuTemplate({ siteKey: menu.siteKey, oplocId: site.oplocId, format });
  const { destination, token } = await siteDestination(site.oplocId); const headers = { Authorization: `Bearer ${token}` };
  // <this site's menu parent>/Generated Menus/WC_<week commencing>
  const { folderId: outputFolderId } = await ensureGeneratedMenusFolder({ parentId: destination.parentFolderId, serviceDate: day.weekCommencing || day.date, headers });
  const published = await publishMenuArtifact({ menu, template, folderId: outputFolderId, headers });
  const release = (day as ProjectedDay & { sourceLineage?: { cpu?: { releaseId?: string; releaseVersion?: string; contentHash?: string } } }).sourceLineage?.cpu;
  return { artifactId: published.artifactId, oplocId: site.oplocId, sourceDayId: day.sourceDayId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, generatedAt: new Date().toISOString(), generatedBy, driveFileId: published.fileId, driveUrl: published.driveUrl, fileName: published.fileName, ...(format !== "tablet" ? { format } : {}), ...(deliveryId ? { deliveryId } : {}), ...(release?.releaseId ? { sourceReleaseId: release.releaseId } : {}), ...(release?.releaseVersion ? { sourceReleaseVersion: release.releaseVersion } : {}), ...(release?.contentHash ? { sourcePacketHash: release.contentHash } : {}) };
}

/** `format` is chosen by the caller. The CPU release flow only ever regenerates the tablet menu; label artifacts are tracked per format and flagged outdated, never auto-regenerated. */
export async function createGoogleSiteMenu(day: ProjectedDay, site: Site, generatedBy: string, existingFileId?: string, deliveryId?: string, format: MenuOutputFormat = "tablet"): Promise<SiteMenuArtifact> {
  if (deliveredInMenuSiteKey(site)) return createSharedSiteMenu(day, site, generatedBy, deliveryId, format);
  if (format !== "tablet") throw new MenuArtifactError("MENU_FORMAT_UNSUPPORTED", `${site.label} has no ${format} layout; labels are available for sites with a shared menu template (MNK).`, 422);
  // Generic template: an OPLOC-specific deck wins; the shared generic deck is the fallback. Owner and parent folder are always this site's own.
  const templateId = resourceId(process.env[`GOOGLE_DELIVERED_IN_TEMPLATE_ID_${driveOwnerEnvKey({ type: "oploc-workspace", oplocId: site.oplocId })}`] || process.env.GOOGLE_DELIVERED_IN_TEMPLATE_ID);
  if (!templateId) throw new Error("Delivered-In generic Google Slides template is not configured (GOOGLE_DELIVERED_IN_TEMPLATE_ID or the OPLOC-specific key).");
  const { destination, token } = await siteDestination(site.oplocId); const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  const { folderId: outputFolderId } = await ensureGeneratedMenusFolder({ parentId: destination.parentFolderId, serviceDate: day.weekCommencing || day.date, headers }); // <site menu parent>/Generated Menus/WC_<week commencing>
  const fileName = siteMenuFileName(site.label, day); const stableDeliveryId = deliveryId ? stableDocumentId(`${site.oplocId}:${deliveryId}`) : undefined;
  let copy: { id: string; webViewLink?: string; appProperties?: Record<string, string> } | undefined;
  if (stableDeliveryId) {
    const query = `appProperties has { key='fikaDeliveryId' and value='${stableDeliveryId}' } and trashed = false`;
    const existing = await json<{ files?: Array<{ id: string; webViewLink?: string; appProperties?: Record<string, string> }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,webViewLink,appProperties)&pageSize=1`, { headers }, "Delivered-In delivery artifact lookup"));
    copy = existing.files?.[0];
  }
  if (!copy) copy = await json<{ id: string; webViewLink?: string }>(await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(templateId)}/copy?supportsAllDrives=true&fields=id,webViewLink`, { method: "POST", headers, body: JSON.stringify({ name: fileName, parents: [outputFolderId], ...(stableDeliveryId ? { appProperties: { fikaDeliveryId: stableDeliveryId, fikaMaterializationStatus: "pending" } } : {}) }) }, "Delivered-In Slides template copy"));
  const release = (day as ProjectedDay & { sourceLineage?: { cpu?: { releaseId?: string; releaseVersion?: string; contentHash?: string } } }).sourceLineage?.cpu;
  if (copy.appProperties?.fikaMaterializationStatus === "ready") return { artifactId: `delivered-in-menu:${site.oplocId}:${day.sourceDayId}:${stableDeliveryId || day.contentHash}`, oplocId: site.oplocId, sourceDayId: day.sourceDayId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, generatedAt: new Date().toISOString(), generatedBy, driveFileId: copy.id, driveUrl: copy.webViewLink || `https://docs.google.com/presentation/d/${copy.id}/edit`, fileName, ...(deliveryId ? { deliveryId } : {}), ...(release?.releaseId ? { sourceReleaseId: release.releaseId } : {}), ...(release?.releaseVersion ? { sourceReleaseVersion: release.releaseVersion } : {}), ...(release?.contentHash ? { sourcePacketHash: release.contentHash } : {}) };
  const presentation = await json<Presentation>(await googleFetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(copy.id)}`, { headers }, "Delivered-In Slides template read"));
  await json(await googleFetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(copy.id)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: buildDeliveredInMenuRequests(day, site, presentation) }) }, "Delivered-In Slides generation"));
  if (stableDeliveryId) await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copy.id)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ appProperties: { fikaDeliveryId: stableDeliveryId, fikaMaterializationStatus: "ready" } }) }, "Delivered-In delivery artifact certification");
  const driveUrl = copy.webViewLink || `https://docs.google.com/presentation/d/${copy.id}/edit`;
  return { artifactId: `delivered-in-menu:${site.oplocId}:${day.sourceDayId}:${stableDeliveryId || day.contentHash}`, oplocId: site.oplocId, sourceDayId: day.sourceDayId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, generatedAt: new Date().toISOString(), generatedBy, driveFileId: copy.id, driveUrl, fileName, ...(deliveryId ? { deliveryId } : {}), ...(release?.releaseId ? { sourceReleaseId: release.releaseId } : {}), ...(release?.releaseVersion ? { sourceReleaseVersion: release.releaseVersion } : {}), ...(release?.contentHash ? { sourcePacketHash: release.contentHash } : {}) };
}
