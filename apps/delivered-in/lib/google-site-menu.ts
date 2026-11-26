import { promises as fs } from "node:fs";
import type { ProjectedDay, Site } from "./projection";
import { groupSiteMenuEntries, siteMenuFileName, type SiteMenuArtifact } from "./site-menu";
import { CANONICAL_ALLERGEN_COLUMNS } from "./allergen-columns";
import { assertStagingDriveResource, driveAccessToken, resolveDriveOwner } from "@fika/server-shared/drive-owner";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { MenuArtifactError, menuAllergenLabel, publishMenuArtifact } from "@fika/server-shared/menu-artifact";
import { deliveredInMenuFromDay, deliveredInMenuSiteKey, resolveDeliveredInMenuTemplate } from "./menu-adapter";
import { siteMenuDriveConfig } from "./site-menu-drive-config";

type OAuthClient = { installed?: { client_id: string; client_secret: string; token_uri?: string } };
type OAuthToken = { access_token?: string; refresh_token?: string; expiry_date?: number; token_type?: string };
type Dimension = { magnitude?: number; unit?: string };
type PageElement = {
  objectId: string;
  size?: { width?: Dimension; height?: Dimension };
  transform?: { translateX?: number; translateY?: number; scaleX?: number; scaleY?: number; shearX?: number; shearY?: number; unit?: string };
  shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } };
};
type Slide = { objectId: string; pageElements?: PageElement[] };
type Presentation = { pageSize?: { width?: Dimension; height?: Dimension }; slides?: Slide[] };

function emu(value: number | undefined, unit?: string) {
  if (value === undefined || (unit && unit !== "EMU" && unit !== "PT")) return NaN;
  return unit === "PT" ? value * 12_700 : value;
}

function pageDimensions(presentation: Presentation) {
  const size = presentation.pageSize;
  return { width: size ? emu(size.width?.magnitude, size.width?.unit) : 10_000_000,
    height: size ? emu(size.height?.magnitude, size.height?.unit) : 5_625_000 };
}

const json = async <T>(response: Response): Promise<T> => { const text = await response.text(); let body: unknown; try { body = JSON.parse(text); } catch { throw new Error(`Google API returned ${response.status} without JSON.`); } if (!response.ok) throw new Error(`Google API ${response.status}: ${JSON.stringify(body)}`); return body as T; };
export async function googleFetch(input: string, init: RequestInit, label: string) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000); try { return await fetch(input, { ...init, redirect: "error", signal: controller.signal }); } catch (error) { if ((error as { name?: string }).name === "AbortError") throw new Error(`${label} timed out after 30 seconds.`); throw new Error(`${label} failed: ${(error as Error).message}`); } finally { clearTimeout(timer); } }
function resourceId(value?: string) { const raw = value?.trim().replace(/[),.;]+$/, ""); if (!raw) return undefined; return (raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || raw.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] || raw).replace(/[),.;]+$/, ""); }
function menuDriveRoute(oplocId: string) {
  const config = siteMenuDriveConfig(oplocId);
  const root = resourceId(config.folderId);
  if (!root || !/^[A-Za-z0-9_-]+$/.test(root)) throw new MenuArtifactError("MENU_OUTPUT_FOLDER_NOT_CONFIGURED", "The Delivered-In menu output folder is invalid.", 409);
  const owner = resolveDriveOwner(config.owner);
  const key = stableDocumentId(JSON.stringify([oplocId, owner.type, owner.workspaceEmail?.toLowerCase() || "", root]));
  return { owner, root, key };
}
async function assertFolder(folderId: string, headers: Record<string, string>) { const metadata = await json<{ mimeType?: string; trashed?: boolean }>(await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=mimeType,trashed`, { headers }, "Delivered-In output folder validation")); if (metadata.mimeType !== "application/vnd.google-apps.folder" || metadata.trashed) throw new Error("The configured Delivered-In output folder is not accessible."); }
export function weekFolderName(weekCommencing?: string) { return weekCommencing ? `WC_${weekCommencing}` : undefined; }
async function findWeekFolder(root: string, week: string, headers: Record<string, string>) {
  if (!week) return root;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error("Invalid published week date.");
  const query = `'${root}' in parents and name = '${weekFolderName(week)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const result = await json<{ files?: Array<{ id: string }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)&pageSize=2`, { headers }, "Delivered-In week folder lookup"));
  if ((result.files?.length || 0) > 1) throw new MenuArtifactError("MENU_FOLDER_AMBIGUOUS", "More than one output folder exists for this week.", 409);
  return result.files?.[0]?.id;
}
async function weekFolderId(root: string, week: string, headers: Record<string, string>) {
  await assertStagingDriveResource(root, headers.Authorization);
  await assertFolder(root, headers);
  const existing = await findWeekFolder(root, week, headers);
  if (existing) return existing;
  const created = await json<{ id: string }>(await googleFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", { method: "POST", headers, body: JSON.stringify({ name: weekFolderName(week), parents: [root], mimeType: "application/vnd.google-apps.folder" }) }, "Delivered-In week folder creation"));
  return created.id;
}
type MenuDriveFile = { id: string; webViewLink?: string; parents?: string[]; ownedByMe?: boolean; driveId?: string; mimeType?: string; trashed?: boolean; appProperties?: Record<string, string> };
export async function retireGoogleSiteMenu(fileId?: string, oplocId?: string) {
  if (!fileId || !oplocId) return;
  const route = menuDriveRoute(oplocId);
  const token = await driveAccessToken(route.owner);
  const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`;
  const response = await googleFetch(`${url}&fields=id,parents,ownedByMe,driveId,mimeType,trashed,appProperties`, { headers }, "Delivered-In previous menu provenance");
  // Historical files can belong to the previous owner. Leave them intact when provenance is absent.
  if (response.status === 403 || response.status === 404) return;
  const file = await json<MenuDriveFile>(response);
  const properties = file.appProperties;
  if (file.trashed || file.mimeType !== "application/vnd.google-apps.presentation" || (!file.ownedByMe && !file.driveId) ||
      properties?.fikaMenuRoute !== route.key || !properties.fikaMenuFolder || file.parents?.length !== 1 || file.parents[0] !== properties.fikaMenuFolder) return;
  if (file.parents[0] !== route.root) {
    const parentResponse = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.parents[0])}?supportsAllDrives=true&fields=parents,mimeType,trashed`, { headers }, "Delivered-In previous week folder provenance");
    if (parentResponse.status === 403 || parentResponse.status === 404) return;
    const parent = await json<MenuDriveFile>(parentResponse);
    if (parent.trashed || parent.mimeType !== "application/vnd.google-apps.folder" || parent.parents?.length !== 1 || parent.parents[0] !== route.root) return;
  }
  await assertStagingDriveResource(fileId, headers.Authorization);
  await json(await googleFetch(url, { method: "PATCH", headers, body: JSON.stringify({ trashed: true }) }, "Delivered-In previous menu replacement"));
}
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

// Slides can succeed atomically before Drive records the delivery receipt. Verify
// the readable order on the actual pages, including each dish's declarations.
export function hasRenderedMenu(day: ProjectedDay, presentation: Presentation) {
  const sections = groupSiteMenuEntries(day.entries);
  if (!sections.length) return false;
  const expected = new Map(sections.map(section => [section.key as string, section.entries.flatMap((entry, index) => {
    const allergens = declaredAllergens(entry);
    return [{ key: `dish-${index}`, text: titleCase(entry.dishName) }, ...(allergens.length
      ? [{ key: `allergens-${index}`, text: `(${allergens.join(", ")})` }] : [])];
  })]));
  const page = pageDimensions(presentation);
  type Row = { key: string; text: string; slide: number; top: number };
  const groups = new Map<string, Row[]>();
  for (const [slideIndex, slide] of (presentation.slides || []).entries()) {
    const rectangles: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const element of slide.pageElements || []) {
      if (!element.objectId.startsWith("fika-delivered-in-")) continue;
      const match = /^fika-delivered-in-(salads|hot_mains|sides_extras)-(\d+)-((?:dish|allergens)-\d+)$/.exec(element.objectId);
      if (!match || !expected.has(match[1])) return false;
      const transform = element.transform;
      if (!transform || transform.shearX || transform.shearY) return false;
      const left = emu(transform.translateX ?? 0, transform.unit);
      const top = emu(transform.translateY ?? 0, transform.unit);
      const height = emu(element.size?.height?.magnitude, element.size?.height?.unit) * (transform.scaleY ?? 1);
      const width = emu(element.size?.width?.magnitude, element.size?.width?.unit) * (transform.scaleX ?? 1);
      if (!(left >= 0 && top >= 0 && height > 0 && width > 0 && left + width <= page.width && top + height <= page.height)) return false;
      rectangles.push({ left, right: left + width, top, bottom: top + height });
      const group = `${match[1]}-${match[2]}`;
      const rows = groups.get(group) || [];
      const text = (element.shape?.text?.textElements || []).map(run => run.textRun?.content || "").join("").replace(/\n$/, "");
      rows.push({ key: match[3], text, slide: slideIndex, top });
      groups.set(group, rows);
    }
    rectangles.sort((a, b) => a.top - b.top);
    for (let i = 0; i < rectangles.length; i++) {
      const box = rectangles[i];
      for (let j = i + 1; j < rectangles.length && rectangles[j].top < box.bottom - 1; j++) {
        if (rectangles[j].left < box.right && box.left < rectangles[j].right) return false;
      }
    }
  }
  if (!sections.every(section => groups.has(`${section.key}-0`))) return false;
  for (const [group, rows] of groups) {
    const items = expected.get(group.slice(0, group.lastIndexOf("-")))!;
    rows.sort((a, b) => a.slide - b.slide || a.top - b.top);
    if (items.length !== rows.length) return false;
    for (const [index, row] of rows.entries()) {
      if (items[index].key !== row.key || items[index].text !== row.text) return false;
      const previous = rows[index - 1];
      if (row.key.startsWith("allergens-") && previous?.slide !== row.slide) return false;
    }
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
type Section = ReturnType<typeof groupSiteMenuEntries>[number];
type MenuRequest = Record<string, unknown>;
type DishBlock = { index: number; dish: string; declaration: string; dishHeight: number; declarationHeight: number };

function wrappedLines(text: string, columns: number) {
  let lines = 0;
  for (const paragraph of text.split(/\r?\n/)) {
    lines++;
    let used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (used && used + 1 + word.length > columns) { lines++; used = 0; }
      const length = used + (used ? 1 : 0) + word.length;
      lines += Math.floor((length - 1) / columns);
      used = (length - 1) % columns + 1;
    }
  }
  return lines;
}

function layoutSection(section: Section, anchor: PageElement, page: { width: number; height: number }) {
  const transform = anchor.transform;
  const y = emu(transform?.translateY ?? 1_000_000, transform?.unit);
  const x = Math.max(650_000, Math.min(900_000, page.width * .08));
  const width = page.width - 2 * x;
  const anchorHeight = emu(anchor.size?.height?.magnitude ?? 0, anchor.size?.height?.unit) * (transform?.scaleY ?? 1);
  const safeHeight = Math.max(1_800_000, page.height - y - 950_000);
  const height = Math.min(Math.max(anchorHeight, safeHeight), page.height - y - 650_000);
  if (!(y >= 0 && width > 0 && height > 0)) throw new MenuArtifactError("MENU_TEMPLATE_GEOMETRY", `The ${section.title} slide has no usable content area.`, 409);
  const gap = Math.max(65_000, Math.min(145_000, 195_000 - section.entries.length * 14_000));
  const texts = section.entries.map((entry, index) => {
    const allergens = declaredAllergens(entry);
    return { index, dish: titleCase(entry.dishName), declaration: allergens.length ? `(${allergens.join(", ")})` : "" };
  });
  function measure(font: number) {
    const declarationFont = Math.max(10, font * .68);
    const textWidthPt = width / 12_700 - 12;
    const columns = Math.max(1, Math.floor(textWidthPt / (font * .70)));
    const declarationColumns = Math.max(1, Math.floor(textWidthPt / (declarationFont * .70)));
    return texts.map(row => ({ ...row,
      dishHeight: wrappedLines(row.dish, columns) * Math.max(190_000, font * 12_700 * 1.24 + 70_000) + 65_000,
      declarationHeight: row.declaration ? wrappedLines(row.declaration, declarationColumns) * declarationFont * 12_700 * 1.18 + 75_000 : 0,
    }));
  }
  const used = (blocks: DishBlock[]) => blocks.reduce((sum, b) => sum + b.dishHeight + b.declarationHeight + gap, -gap);
  let font = 28;
  let blocks = measure(font);
  while (font > 12 && used(blocks) > height) { font -= .5; blocks = measure(font); }
  const pages: DishBlock[][] = [[]];
  let occupied = 0;
  for (const block of blocks) {
    const blockHeight = block.dishHeight + block.declarationHeight;
    if (blockHeight > height) throw new MenuArtifactError("MENU_DISH_OVERFLOW", `"${block.dish}" and its allergen declarations cannot fit on a ${section.title} slide. Review the template content area.`, 422);
    if (occupied && occupied + gap + blockHeight > height) { pages.push([]); occupied = 0; }
    pages[pages.length - 1].push(block);
    occupied += (occupied ? gap : 0) + blockHeight;
  }
  return pages.map(rows => ({ rows, font, x, width, gap, top: y + (height - used(rows)) / 2 }));
}

export function buildDeliveredInMenuRequests(day: ProjectedDay, site: Site, presentation: Presentation) {
  assertMenuSectionAnchors(day, presentation);
  const requests: MenuRequest[] = [
    { replaceAllText: { containsText: { text: "{{SITE_NAME}}", matchCase: true }, replaceText: site.label } },
    { replaceAllText: { containsText: { text: "{{SERVICE_DATE}}", matchCase: true }, replaceText: new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) } },
    { replaceAllText: { containsText: { text: "{{WEEK_COMMENCING}}", matchCase: true }, replaceText: day.weekCommencing || "" } },
  ];
  const sections = groupSiteMenuEntries(day.entries);
  const keys = ["salads", "hot_mains", "sides_extras"] as const;
  const counts = { salads: 0, hot_mains: 0, sides_extras: 0 };
  const dimensions = pageDimensions(presentation);
  for (const [slideIndex, slide] of (presentation.slides || []).entries()) {
    const anchors = keys.flatMap(key => sectionAnchors({ slides: [slide] }, `{{${key.toUpperCase()}}}`).map(({ element }) => ({ key, element })));
    if (!anchors.length) continue;
    const pages = anchors.flatMap(({ key, element }) => {
      const section = sections.find(group => group.key === key);
      if (!section) return [];
      const prefix = `fika-delivered-in-${key}-${counts[key]++}`;
      return layoutSection(section, element, dimensions).map(layout => ({ ...layout, prefix }));
    });
    if (!pages.length) {
      requests.push({ deleteObject: { objectId: slide.objectId } });
      continue;
    }
    const pageId = (index: number) => index ? `fika-di-page-${slideIndex}-${index}` : slide.objectId;
    const placeholderIds = [...new Set(anchors.map(({ element }) => element.objectId))];
    const placeholderId = (page: number, i: number) => page ? `fika-di-anchor-${slideIndex}-${page}-${i}` : placeholderIds[i];
    // Slides inserts each duplicate immediately after its original. Duplicate in
    // reverse order, before modifying any of the source artwork or anchors.
    for (let page = pages.length - 1; page > 0; page--) {
      const objectIds: Record<string, string> = { [slide.objectId]: pageId(page) };
      placeholderIds.forEach((id, i) => { objectIds[id] = placeholderId(page, i); });
      requests.push({ duplicateObject: { objectId: slide.objectId, objectIds } });
    }
    pages.forEach(({ prefix, rows, font, x, width, gap, top }, page) => {
      placeholderIds.forEach((_, i) => requests.push({ deleteObject: { objectId: placeholderId(page, i) } }));
      let y = top;
      for (const row of rows) {
        requests.push(...textBoxRequest(pageId(page), `${prefix}-dish-${row.index}`, row.dish, x, y, width, row.dishHeight, font, { red: 0, green: 0, blue: 0 }, false));
        y += row.dishHeight;
        if (row.declaration) {
          requests.push(...textBoxRequest(pageId(page), `${prefix}-allergens-${row.index}`, row.declaration, x, y, width, row.declarationHeight, Math.max(10, font * .68), { red: 1, green: 0, blue: 0 }, true));
          y += row.declarationHeight;
        }
        y += gap;
      }
    });
  }
  return requests;
}

/**
 * Sites with a shared site template (for example MNK) are rendered by the shared
 * menu renderer from the normalized menu. The Delivered-In generic template
 * path below is kept unchanged for sites that have no site template.
 */
async function createSharedSiteMenu(day: ProjectedDay, site: Site, generatedBy: string, deliveryId?: string): Promise<SiteMenuArtifact> {
  const menu = deliveredInMenuFromDay(day, site);
  const template = resolveDeliveredInMenuTemplate(menu);
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
  const route = menuDriveRoute(site.oplocId);
  const templateId = resourceId(process.env.GOOGLE_DELIVERED_IN_TEMPLATE_ID);
  if (!templateId) throw new MenuArtifactError("MENU_TEMPLATE_NOT_CONFIGURED", "The Delivered-In Google Slides template is not configured.", 409);
  const token = await driveAccessToken(route.owner); const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  await assertStagingDriveResource(route.root, headers.Authorization);
  const fileName = siteMenuFileName(site.label, day); const stableDeliveryId = deliveryId ? stableDocumentId(`${site.oplocId}:${deliveryId}`) : undefined;
  let copy: MenuDriveFile | undefined;
  let outputFolderId = stableDeliveryId ? await findWeekFolder(route.root, day.weekCommencing || "", headers) : undefined;
  if (stableDeliveryId && outputFolderId) {
    const query = `'${outputFolderId}' in parents and appProperties has { key='fikaDeliveryId' and value='${stableDeliveryId}' } and mimeType = 'application/vnd.google-apps.presentation' and trashed = false`;
    const existing = await json<{ files?: MenuDriveFile[] }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,webViewLink,parents,ownedByMe,driveId,appProperties)&pageSize=2`, { headers }, "Delivered-In delivery artifact lookup"));
    if ((existing.files?.length || 0) > 1) throw new MenuArtifactError("MENU_DELIVERY_AMBIGUOUS", "More than one site menu matches this delivery in the selected output folder.", 409);
    copy = existing.files?.[0];
    if (copy) {
      const properties = copy.appProperties;
      const marked = properties?.fikaMenuRoute === route.key && properties.fikaMenuFolder === outputFolderId && (copy.ownedByMe || copy.driveId);
      const legacy = route.owner.type === "app-workspace" && !properties?.fikaMenuRoute && !properties?.fikaMenuFolder && copy.ownedByMe;
      if (properties?.fikaDeliveryId !== stableDeliveryId || copy.parents?.length !== 1 || copy.parents[0] !== outputFolderId || (!marked && !legacy)) {
        throw new MenuArtifactError("MENU_DELIVERY_OWNERSHIP_UNVERIFIED", "The saved menu does not belong to the selected output route. Review its ownership before retrying.", 409);
      }
      await assertStagingDriveResource(copy.id, headers.Authorization);
    }
  }
  const resuming = Boolean(copy);
  if (!copy) {
    const template = await readPresentation(templateId, headers);
    // Validate geometry and pair fit before creating a folder or a Drive copy.
    buildDeliveredInMenuRequests(day, site, template);
    outputFolderId ||= await weekFolderId(route.root, day.weekCommencing || "", headers);
    const appProperties = { fikaMenuRoute: route.key, fikaMenuFolder: outputFolderId, ...(stableDeliveryId ? { fikaDeliveryId: stableDeliveryId, fikaMaterializationStatus: "pending" } : {}) };
    copy = await json<MenuDriveFile>(await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(templateId)}/copy?supportsAllDrives=true&fields=id,webViewLink`, { method: "POST", headers, body: JSON.stringify({ name: fileName, parents: [outputFolderId], appProperties }) }, "Delivered-In Slides template copy"));
  }
  const release = (day as ProjectedDay & { sourceLineage?: { cpu?: { releaseId?: string; releaseVersion?: string; contentHash?: string } } }).sourceLineage?.cpu;
  if (copy.appProperties?.fikaMaterializationStatus === "ready" && copy.appProperties.fikaMenuSections === "paginated-v1") return { artifactId: `delivered-in-menu:${site.oplocId}:${day.sourceDayId}:${stableDeliveryId || day.contentHash}`, oplocId: site.oplocId, sourceDayId: day.sourceDayId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, generatedAt: new Date().toISOString(), generatedBy, driveFileId: copy.id, driveUrl: copy.webViewLink || `https://docs.google.com/presentation/d/${copy.id}/edit`, fileName, ...(deliveryId ? { deliveryId } : {}), ...(release?.releaseId ? { sourceReleaseId: release.releaseId } : {}), ...(release?.releaseVersion ? { sourceReleaseVersion: release.releaseVersion } : {}), ...(release?.contentHash ? { sourcePacketHash: release.contentHash } : {}) };
  const presentation = await readPresentation(copy.id, headers);
  if (!resuming || !hasRenderedMenu(day, presentation)) {
    if (copy.appProperties?.fikaMaterializationStatus === "ready") {
      throw new MenuArtifactError("MENU_OUTPUT_INCOMPLETE", "The saved site menu does not match all published dishes and allergen declarations. Generate a new menu from the corrected template.", 409);
    }
    const requests = buildDeliveredInMenuRequests(day, site, presentation);
    await json(await googleFetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(copy.id)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests }) }, "Delivered-In Slides generation"));
  }
  if (stableDeliveryId) await json(await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copy.id)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ appProperties: { fikaMenuRoute: route.key, fikaMenuFolder: outputFolderId, fikaDeliveryId: stableDeliveryId, fikaMaterializationStatus: "ready", fikaMenuSections: "paginated-v1" } }) }, "Delivered-In delivery artifact certification"));
  const driveUrl = copy.webViewLink || `https://docs.google.com/presentation/d/${copy.id}/edit`;
  return { artifactId: `delivered-in-menu:${site.oplocId}:${day.sourceDayId}:${stableDeliveryId || day.contentHash}`, oplocId: site.oplocId, sourceDayId: day.sourceDayId, sourcePublicationDayId: day.publicationDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, generatedAt: new Date().toISOString(), generatedBy, driveFileId: copy.id, driveUrl, fileName, ...(deliveryId ? { deliveryId } : {}), ...(release?.releaseId ? { sourceReleaseId: release.releaseId } : {}), ...(release?.releaseVersion ? { sourceReleaseVersion: release.releaseVersion } : {}), ...(release?.contentHash ? { sourcePacketHash: release.contentHash } : {}) };
}
