import { promises as fs } from "node:fs";
import type { ProjectedDay, Site } from "./projection";
import { groupSiteMenuEntries, siteMenuFileName, type SiteMenuArtifact } from "./site-menu";
import { CANONICAL_ALLERGEN_COLUMNS } from "./allergen-columns";
import { assertStagingDriveResource, driveAccessToken, resolveDriveOwner } from "@fika/server-shared/drive-owner";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { MenuArtifactError, menuAllergenLabel, publishMenuArtifact, resolveMenuTemplate } from "@fika/server-shared/menu-artifact";
import { deliveredInMenuFromDay, deliveredInMenuSiteKey } from "./menu-adapter";
import { siteMenuDriveConfig } from "./site-menu-drive-config";

type OAuthClient = { installed?: { client_id: string; client_secret: string; token_uri?: string } };
type OAuthToken = { access_token?: string; refresh_token?: string; expiry_date?: number; token_type?: string };
type Presentation = { pageSize?: { width?: { magnitude?: number }; height?: { magnitude?: number } }; slides?: Array<{ objectId: string; pageElements?: Array<{ objectId: string; size?: { width?: { magnitude?: number }; height?: { magnitude?: number } }; transform?: { translateX?: number; translateY?: number }; shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } } }> }> };

const json = async <T>(response: Response): Promise<T> => { const text = await response.text(); let body: unknown; try { body = JSON.parse(text); } catch { throw new Error(`Google API returned ${response.status} without JSON.`); } if (!response.ok) throw new Error(`Google API ${response.status}: ${JSON.stringify(body)}`); return body as T; };
export async function googleFetch(input: string, init: RequestInit, label: string) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000); try { return await fetch(input, { ...init, redirect: "error", signal: controller.signal }); } catch (error) { if ((error as { name?: string }).name === "AbortError") throw new Error(`${label} timed out after 30 seconds.`); throw new Error(`${label} failed: ${(error as Error).message}`); } finally { clearTimeout(timer); } }
function resourceId(value?: string) { const raw = value?.trim().replace(/[),.;]+$/, ""); if (!raw) return undefined; return (raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || raw.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] || raw).replace(/[),.;]+$/, ""); }
async function accessToken() {
  const owner = resolveDriveOwner({ type: "app-workspace", appId: "delivered-in" });
  return driveAccessToken(owner);
}
async function assertFolder(folderId: string, headers: Record<string, string>) { const metadata = await json<{ mimeType?: string; trashed?: boolean }>(await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=mimeType,trashed`, { headers }, "Delivered-In output folder validation")); if (metadata.mimeType !== "application/vnd.google-apps.folder" || metadata.trashed) throw new Error("The configured Delivered-In output folder is not accessible."); }
export function weekFolderName(weekCommencing?: string) { return weekCommencing ? `WC_${weekCommencing}` : undefined; }
async function weekFolderId(rootFolderId: string, weekCommencing: string, headers: Record<string, string>) { const name = weekFolderName(weekCommencing); if (!name) return rootFolderId; await assertFolder(rootFolderId, headers); const query = `'${rootFolderId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`; const existing = await json<{ files?: Array<{ id: string }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id)&pageSize=1`, { headers }, "Delivered-In week folder lookup")); if (existing.files?.[0]?.id) return existing.files[0].id; const created = await json<{ id: string }>(await googleFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", { method: "POST", headers, body: JSON.stringify({ name, parents: [rootFolderId], mimeType: "application/vnd.google-apps.folder" }) }, "Delivered-In week folder creation")); return created.id; }
async function trashDriveFile(fileId: string, headers: Record<string, string>) { await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ trashed: true }) }, "Delivered-In previous menu replacement"); }
export async function retireGoogleSiteMenu(fileId?: string, oplocId?: string) { if (!fileId) return; const token = oplocId ? await driveAccessToken(resolveDriveOwner(siteMenuDriveConfig(oplocId).owner)) : await accessToken(); await trashDriveFile(fileId, { Authorization: `Bearer ${token}`, "content-type": "application/json" }); }
async function readPresentation(id: string, headers: Record<string, string>) {
  await assertStagingDriveResource(id, headers.Authorization);
  return json<Presentation>(await googleFetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}`, { headers }, "Delivered-In Slides template read"));
}
function titleCase(value: string) { return value.trim().toLocaleLowerCase("en-GB").replace(/(^|[^A-Za-zÀ-ÿ])([a-zà-ÿ])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("en-GB")}`); }
function declaredAllergens(entry: ProjectedDay["entries"][number]) {
  const labels = new Map<string, string>(CANONICAL_ALLERGEN_COLUMNS);
  const keys = [...new Set([...labels.keys(), ...Object.keys(entry.allergens)])].filter(key => key !== "no_key_allergens");
  const names = (state: "contains" | "may_contain") => keys.filter(key => entry.allergens[key] === state).map(key => labels.get(key) ?? menuAllergenLabel(key)).join(", ");
  const contains = names("contains");
  const mayContain = names("may_contain");
  return [
    contains && `Contains: ${contains}`,
    mayContain && `May contain: ${mayContain}`,
    entry.allergenDetailNotes?.trim() && `Specific allergens: ${entry.allergenDetailNotes.trim()}`,
    entry.mayContainNotes?.trim() && `May contain: ${entry.mayContainNotes.trim()}`,
  ].filter((line): line is string => Boolean(line));
}

export function assertPrintableCpuEvidence(day: ProjectedDay) {
  const packet = day.sourceLineage?.cpu;
  if (day.cpuReview?.status !== "signed" || packet?.sourceStatus !== "current" || packet.sourceCompleteness !== "complete"
      || !packet.releaseId || !packet.releaseVersion || !packet.contentHash || packet.sourceBundleHash !== day.contentHash) {
    throw new MenuArtifactError("MENU_SIGNED_PACKET_REQUIRED", "A current CPU-signed allergen packet for this published day is required to generate its menu.", 409);
  }
  for (const entry of day.entries) {
    const states = Object.values(entry.allergens);
    if (entry.allergensVisible !== true || (!states.length && entry.cpuAllergenState !== "clear")
        || states.some(state => state !== "clear" && state !== "contains" && state !== "may_contain")) {
      throw new MenuArtifactError("MENU_ALLERGENS_UNCONFIRMED", `CPU allergen evidence for "${entry.dishName}" is incomplete. Review the dish before generating its menu.`, 409);
    }
  }
}
function sectionAnchors(presentation: Presentation, token: string) { return (presentation.slides || []).flatMap(slide => (slide.pageElements || []).filter(element => (element.shape?.text?.textElements || []).map(item => item.textRun?.content || "").join("").includes(token)).map(element => ({ slide, element }))); }
function assertMenuSectionAnchors(day: ProjectedDay, presentation: Presentation) {
  for (const section of groupSiteMenuEntries(day.entries)) {
    const token = `{{${section.key.toUpperCase()}}}`;
    if (!sectionAnchors(presentation, token).length) {
      throw new MenuArtifactError("MENU_TEMPLATE_SECTION_MISSING", `The site menu template needs a ${token} placeholder for ${section.title}. Restore the placeholder and generate the menu again.`, 409);
    }
  }
}

// A pending Drive receipt can outlive a successful, atomic Slides batch. Check
// the generated dish and declaration text before reusing a copy with no anchors.
function hasRenderedMenu(day: ProjectedDay, presentation: Presentation) {
  const sections = groupSiteMenuEntries(day.entries);
  if (!sections.length) return false;
  const expected = new Map(sections.map(section => [section.key, section.entries.flatMap((entry, index) => {
    const allergens = declaredAllergens(entry);
    return [[`dish-${index}`, titleCase(entry.dishName)], ...(allergens.length ? [[`allergens-${index}`, `(${allergens.join(", ")})`]] : [])];
  })]));
  const groups = new Map<string, Map<string, string>>();
  for (const slide of presentation.slides || []) {
    for (const element of slide.pageElements || []) {
      if (!element.objectId.startsWith("fika-delivered-in-")) continue;
      const match = /^fika-delivered-in-(salads|hot_mains|sides_extras)-(\d+)-((?:dish|allergens)-\d+)$/.exec(element.objectId);
      if (!match) return false;
      const group = `${match[1]}-${match[2]}`;
      const rows = groups.get(group) || new Map<string, string>();
      const text = (element.shape?.text?.textElements || []).map(run => run.textRun?.content || "").join("").replace(/\n$/, "");
      rows.set(match[3], text);
      groups.set(group, rows);
    }
  }
  if (!sections.every(section => groups.has(`${section.key}-0`))) return false;
  for (const [group, rows] of groups) {
    const section = sections.find(candidate => group.startsWith(`${candidate.key}-`));
    const items = section && expected.get(section.key);
    if (!items || items.length !== rows.size || !items.every(([id, value]) => rows.get(id) === value)) return false;
  }
  return true;
}
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
  const token = `{{${key.toUpperCase()}}}`; const anchors = sectionAnchors(presentation, token);
  const sections = groupSiteMenuEntries(day.entries);
  const entries = sections.find(section => section.key === key)?.entries || [];
  if (!entries.length) return anchors.map(({ slide, element }) => {
    const hasPopulatedSection = sections.some(section => sectionAnchors({ slides: [slide] }, `{{${section.key.toUpperCase()}}}`).length > 0);
    return { deleteObject: { objectId: hasPopulatedSection ? element.objectId : slide.objectId } };
  });
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
  assertMenuSectionAnchors(day, presentation);
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
async function createSharedSiteMenu(day: ProjectedDay, site: Site, generatedBy: string, deliveryId?: string): Promise<SiteMenuArtifact> {
  const menu = deliveredInMenuFromDay(day, site);
  const template = resolveMenuTemplate({ siteKey: menu.siteKey, oplocId: site.oplocId });
  const { owner, folderId } = siteMenuDriveConfig(site.oplocId);
  const token = await driveAccessToken(resolveDriveOwner(owner)); const headers = { Authorization: `Bearer ${token}` };
  const outputFolderId = await weekFolderId(folderId, day.weekCommencing || "", { ...headers, "content-type": "application/json" });
  const published = await publishMenuArtifact({ menu, template, folderId: outputFolderId, headers });
  const release = (day as ProjectedDay & { sourceLineage?: { cpu?: { releaseId?: string; releaseVersion?: string; contentHash?: string } } }).sourceLineage?.cpu;
  return { artifactId: published.artifactId, oplocId: site.oplocId, sourceDayId: day.sourceDayId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, generatedAt: new Date().toISOString(), generatedBy, driveFileId: published.fileId, driveUrl: published.driveUrl, fileName: published.fileName, ...(deliveryId ? { deliveryId } : {}), ...(release?.releaseId ? { sourceReleaseId: release.releaseId } : {}), ...(release?.releaseVersion ? { sourceReleaseVersion: release.releaseVersion } : {}), ...(release?.contentHash ? { sourcePacketHash: release.contentHash } : {}) };
}

export async function createGoogleSiteMenu(day: ProjectedDay, site: Site, generatedBy: string, existingFileId?: string, deliveryId?: string): Promise<SiteMenuArtifact> {
  assertPrintableCpuEvidence(day);
  if (deliveredInMenuSiteKey(site)) return createSharedSiteMenu(day, site, generatedBy, deliveryId);
  const templateId = resourceId(process.env.GOOGLE_DELIVERED_IN_TEMPLATE_ID); const folderId = resourceId(process.env.GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_APP_DELIVERED_IN);
  if (!templateId || !folderId) throw new Error("Delivered-In Google Slides template and output folder are not configured.");
  const token = await accessToken(); const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  const fileName = siteMenuFileName(site.label, day); const stableDeliveryId = deliveryId ? stableDocumentId(`${site.oplocId}:${deliveryId}`) : undefined;
  let copy: { id: string; webViewLink?: string; appProperties?: Record<string, string> } | undefined;
  if (stableDeliveryId) {
    const query = `appProperties has { key='fikaDeliveryId' and value='${stableDeliveryId}' } and trashed = false`;
    const existing = await json<{ files?: Array<{ id: string; webViewLink?: string; appProperties?: Record<string, string> }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,webViewLink,appProperties)&pageSize=1`, { headers }, "Delivered-In delivery artifact lookup"));
    copy = existing.files?.[0];
  }
  const resuming = Boolean(copy);
  if (!copy) {
    const template = await readPresentation(templateId, headers);
    assertMenuSectionAnchors(day, template);
    const outputFolderId = await weekFolderId(folderId, day.weekCommencing || "", headers);
    copy = await json<{ id: string; webViewLink?: string }>(await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(templateId)}/copy?supportsAllDrives=true&fields=id,webViewLink`, { method: "POST", headers, body: JSON.stringify({ name: fileName, parents: [outputFolderId], ...(stableDeliveryId ? { appProperties: { fikaDeliveryId: stableDeliveryId, fikaMaterializationStatus: "pending" } } : {}) }) }, "Delivered-In Slides template copy"));
  }
  const release = (day as ProjectedDay & { sourceLineage?: { cpu?: { releaseId?: string; releaseVersion?: string; contentHash?: string } } }).sourceLineage?.cpu;
  if (copy.appProperties?.fikaMaterializationStatus === "ready" && copy.appProperties.fikaMenuSections === "checked") return { artifactId: `delivered-in-menu:${site.oplocId}:${day.sourceDayId}:${stableDeliveryId || day.contentHash}`, oplocId: site.oplocId, sourceDayId: day.sourceDayId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, generatedAt: new Date().toISOString(), generatedBy, driveFileId: copy.id, driveUrl: copy.webViewLink || `https://docs.google.com/presentation/d/${copy.id}/edit`, fileName, ...(deliveryId ? { deliveryId } : {}), ...(release?.releaseId ? { sourceReleaseId: release.releaseId } : {}), ...(release?.releaseVersion ? { sourceReleaseVersion: release.releaseVersion } : {}), ...(release?.contentHash ? { sourcePacketHash: release.contentHash } : {}) };
  const presentation = await readPresentation(copy.id, headers);
  if (!resuming || !hasRenderedMenu(day, presentation)) {
    if (copy.appProperties?.fikaMaterializationStatus === "ready") {
      throw new MenuArtifactError("MENU_OUTPUT_INCOMPLETE", "The saved site menu does not match all published dishes and allergen declarations. Generate a new menu from the corrected template.", 409);
    }
    const requests = buildDeliveredInMenuRequests(day, site, presentation);
    await json(await googleFetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(copy.id)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests }) }, "Delivered-In Slides generation"));
  }
  if (stableDeliveryId) await json(await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copy.id)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ appProperties: { fikaDeliveryId: stableDeliveryId, fikaMaterializationStatus: "ready", fikaMenuSections: "checked" } }) }, "Delivered-In delivery artifact certification"));
  const driveUrl = copy.webViewLink || `https://docs.google.com/presentation/d/${copy.id}/edit`;
  return { artifactId: `delivered-in-menu:${site.oplocId}:${day.sourceDayId}:${stableDeliveryId || day.contentHash}`, oplocId: site.oplocId, sourceDayId: day.sourceDayId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, generatedAt: new Date().toISOString(), generatedBy, driveFileId: copy.id, driveUrl, fileName, ...(deliveryId ? { deliveryId } : {}), ...(release?.releaseId ? { sourceReleaseId: release.releaseId } : {}), ...(release?.releaseVersion ? { sourceReleaseVersion: release.releaseVersion } : {}), ...(release?.contentHash ? { sourcePacketHash: release.contentHash } : {}) };
}
