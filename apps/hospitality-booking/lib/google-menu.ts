import type { MenuOutput } from "@/lib/mnk-menu-output";
import { driveAccessToken, driveFolderPath, resolveDriveOwner, type DriveOwner, type ResolvedDriveOwner } from "./drive-owner";

const json = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error(`Google API returned ${response.status} without JSON.`); }
  if (!response.ok) throw new Error(`Google API ${response.status}: ${JSON.stringify(body)}`);
  return body as T;
};

async function googleFetch(input: string, init: RequestInit, label: string, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  catch (error) { if ((error as { name?: string }).name === "AbortError") throw new Error(`${label} timed out after 30 seconds.`); throw new Error(`${label} failed: ${(error as Error).message}`); }
  finally { clearTimeout(timer); }
}

async function driveHeaders(owner: DriveOwner) {
  const resolved = resolveDriveOwner(owner);
  const token = await driveAccessToken(resolved);
  return { owner: resolved, headers: { Authorization: `Bearer ${token}` } };
}

type Presentation = { pageSize?: { width?: { magnitude?: number }; height?: { magnitude?: number } }; slides?: Array<{ objectId: string; pageElements?: Array<{ objectId: string; size?: { width?: { magnitude?: number }; height?: { magnitude?: number } }; transform?: { translateX?: number; translateY?: number; scaleX?: number; scaleY?: number }; shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } } }> }> };

type MenuAnchor = {
  slide: NonNullable<Presentation["slides"]>[number];
  element: NonNullable<NonNullable<Presentation["slides"]>[number]["pageElements"]>[number];
  generated?: boolean;
};

type MenuTemplateConfig = {
  templateId?: string;
  contentLeft?: number;
  contentRight?: number;
  contentTop?: number;
  contentBottom?: number;
  itemFontSize?: number;
  allergenFontSize?: number;
  itemColor?: { red: number; green: number; blue: number };
  preserveAnchor?: boolean;
};

function templateConfig(siteKey = "mnk", overrideTemplateId?: string): MenuTemplateConfig {
  if (siteKey === "angel-court") {
    return {
      templateId: overrideTemplateId || process.env.GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT,
      // Angel Court's template reserves a brown vertical rail on the left.
      // Keep generated content wholly within the white content panel.
      contentLeft: 1_750_000,
      contentRight: 350_000,
      contentTop: 1_700_000,
      contentBottom: 900_000,
      // Keep the template's reserved brown rail and leave enough leading for
      // long item/allergen lines to wrap without colliding.
      preserveAnchor: true,
      itemFontSize: 15,
      allergenFontSize: 11,
      itemColor: { red: 0.54, green: 0.30, blue: 0.13 },
    };
  }
  return {
    templateId: overrideTemplateId || process.env.GOOGLE_MENU_TEMPLATE_ID,
    // MNK's portrait template contains a small empty footer box. It is not a
    // content anchor, so use the known white panel bounds instead of allowing
    // anchor discovery to clip the menu at the bottom of the slide.
    contentLeft: 450_000,
    contentRight: 450_000,
    contentTop: 1_800_000,
    contentBottom: 700_000,
    preserveAnchor: true,
    itemFontSize: 15,
    allergenFontSize: 10,
  };
}

/** Accept either a Drive folder/file ID or a copied Drive URL. Users commonly
 * paste the whole `/folders/<id>` link (sometimes with trailing punctuation)
 * into .env.local; the Google APIs require only the stable ID. */
function driveResourceId(value?: string) {
  const raw = value?.trim().replace(/[),.;]+$/, "");
  if (!raw) return undefined;
  const match = raw.match(/\/folders\/([A-Za-z0-9_-]+)/) || raw.match(/\/d\/([A-Za-z0-9_-]+)/);
  return (match?.[1] || raw).replace(/[),.;]+$/, "");
}

async function assertDriveFolder(folderId: string, headers: Record<string, string>, operation: string) {
  const metadata = await json<{ id?: string; name?: string; mimeType?: string; trashed?: boolean }>(await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,trashed`,
    { headers }, `${operation} folder validation`,
  ));
  if (metadata.mimeType !== "application/vnd.google-apps.folder" || metadata.trashed) {
    throw Error(`${operation} folder ${folderId} is not an accessible Google Drive folder.`);
  }
}

export function weekFolderName(weekCommencing?: string) { return weekCommencing ? `WC_${weekCommencing}` : undefined; }
async function resolveWeekFolder(rootFolderId: string, weekCommencing: string | undefined, headers: Record<string, string>, operation: string) {
  await assertDriveFolder(rootFolderId, headers, operation);
  const name = weekFolderName(weekCommencing);
  if (!name) return rootFolderId;
  const query = `'${rootFolderId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const existing = await json<{ files?: Array<{ id: string }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id)&pageSize=1`, { headers }, `${operation} week folder lookup`));
  if (existing.files?.[0]?.id) return existing.files[0].id;
  const created = await json<{ id: string }>(await googleFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name, parents: [rootFolderId], mimeType: "application/vnd.google-apps.folder" }) }, `${operation} week folder creation`));
  return created.id;
}
async function resolveChildFolder(parentFolderId: string, folderName: string | undefined, headers: Record<string, string>, operation: string) {
  if (!folderName?.trim()) return parentFolderId;
  const name = folderName.trim().replace(/[\\/]+/g, "-").slice(0, 120);
  const query = `'${parentFolderId}' in parents and name = '${name.replaceAll("'", "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const existing = await json<{ files?: Array<{ id: string }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id)&pageSize=1`, { headers }, `${operation} OPLOC folder lookup`));
  if (existing.files?.[0]?.id) return existing.files[0].id;
  const created = await json<{ id: string }>(await googleFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name, parents: [parentFolderId], mimeType: "application/vnd.google-apps.folder" }) }, `${operation} OPLOC folder creation`));
  return created.id;
}

async function resolveArtifactFolder(owner: ResolvedDriveOwner, configuredFolderId: string | undefined, artifactType: "quote" | "menu" | "production", headers: Record<string, string>, operation: string) {
  const configured = driveResourceId(configuredFolderId || owner.configuredRootFolderId);
  if (configured) {
    await assertDriveFolder(configured, headers, operation);
    return configured;
  }
  let parent = "root";
  for (const folder of driveFolderPath(owner, artifactType)) parent = await resolveChildFolder(parent, folder, headers, operation);
  return parent;
}

function contentAnchor(presentation: Presentation): MenuAnchor | null {
  for (const slide of presentation.slides || []) for (const element of slide.pageElements || []) {
    const text = element.shape?.text?.textElements?.map(item => item.textRun?.content || "").join("") || "";
    if (text.includes("{{MENU_ITEMS}}")) return { slide, element };
  }
  // Templates no longer need a visible token. Prefer the largest empty text
  // box as the designer's content region, then fall back to an invisible
  // virtual region so a header/footer-only template also works.
  for (const slide of presentation.slides || []) {
    const candidates = (slide.pageElements || []).filter(element => {
      const text = element.shape?.text?.textElements?.map(item => item.textRun?.content || "").join("").trim() || "";
      const width = element.size?.width?.magnitude || 0;
      const height = element.size?.height?.magnitude || 0;
      return !text && width * height > 1_000_000_000;
    });
    if (candidates.length) {
      const element = candidates.sort((a, b) => ((b.size?.width?.magnitude || 0) * (b.size?.height?.magnitude || 0)) - ((a.size?.width?.magnitude || 0) * (a.size?.height?.magnitude || 0)))[0];
      return { slide, element };
    }
  }
  const slide = presentation.slides?.[0];
  if (!slide) return null;
  return {
    slide,
    generated: true,
    element: {
      objectId: "",
      size: {
        width: { magnitude: Math.max(3_000_000, (presentation.pageSize?.width?.magnitude || 10_000_000) - 1_200_000) },
        height: { magnitude: Math.max(3_000_000, (presentation.pageSize?.height?.magnitude || 5_625_000) - 2_000_000) },
      },
      transform: { translateX: 600_000, translateY: 1_000_000 },
    },
  };
}

function titleCase(value: string) { return value.replace(/[A-Za-zÀ-ÿ]+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()); }

function menuRequests(output: MenuOutput, anchor: NonNullable<ReturnType<typeof contentAnchor>>, presentation: Presentation, config: MenuTemplateConfig = {}) {
  const pageWidth = presentation.pageSize?.width?.magnitude || 10_000_000;
  const slideHeight = presentation.pageSize?.height?.magnitude || 5_625_000;
  const x = config.contentLeft ?? anchor.element.transform?.translateX ?? 600_000;
  const contentWidth = Math.max(3_000_000, config.contentLeft !== undefined || config.contentRight !== undefined
    ? pageWidth - x - (config.contentRight ?? 0)
    : pageWidth - 1_200_000);
  const anchorY = config.contentTop ?? anchor.element.transform?.translateY ?? 0;
  const anchorHeight = config.contentTop !== undefined || config.contentBottom !== undefined
    ? slideHeight - anchorY - (config.contentBottom ?? 0)
    : anchor.element.size?.height?.magnitude || 3_000_000;
  const blocks = output.items.map(item => {
    const allergen = item.allergens.length ? `(${item.allergens.map(titleCase).join(", ")})` : "";
    const itemLines = Math.max(1, Math.ceil(item.name.trim().length / 38));
    const allergenLines = allergen ? Math.max(1, Math.ceil(allergen.length / 55)) : 0;
    return {
      item,
      allergen,
      itemHeight: Math.max(520000, itemLines * 300000 + 120000),
      allergenHeight: allergen ? Math.max(300000, allergenLines * 220000 + 90000) : 0,
    };
  });
  // Keep the generated content in one bounded text box. The previous
  // implementation created one shape per line and relied on estimated EMU
  // heights; in the real MNK template that allowed later shapes to overflow
  // the slide and made a menu appear to contain only its last visible item.
  const contentId = "fika-menu-content";
  const pagePadding = 180000;
  const contentHeight = Math.max(1_000_000, anchorHeight - pagePadding * 2);
  const itemFontSize = config.itemFontSize || 15;
  const allergenFontSize = config.allergenFontSize || 10;
  const lines: string[] = [];
  const ranges: Array<{ start: number; end: number; allergen: boolean }> = [];
  let cursor = 0;
  blocks.forEach((block, index) => {
    const itemLine = block.item.name.trim();
    lines.push(itemLine);
    const itemStart = cursor;
    cursor += itemLine.length;
    ranges.push({ start: itemStart, end: cursor, allergen: false });
    if (block.allergen) {
      lines.push(block.allergen);
      cursor += 1;
      ranges.push({ start: cursor, end: cursor + block.allergen.length, allergen: true });
      cursor += block.allergen.length;
    }
    if (index < blocks.length - 1) {
      lines.push("");
      cursor += 1;
    }
    cursor += 1;
  });
  const text = lines.join("\n");
  const requests: Array<Record<string, unknown>> = anchor.generated || !anchor.element.objectId || config.preserveAnchor
    ? []
    : [{ deleteObject: { objectId: anchor.element.objectId } }];
  requests.push(
    { createShape: { objectId: contentId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: anchor.slide.objectId, size: { width: { magnitude: contentWidth, unit: "EMU" }, height: { magnitude: contentHeight, unit: "EMU" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: anchorY + pagePadding, unit: "EMU" } } } },
    { insertText: { objectId: contentId, text } },
    { updateShapeProperties: { objectId: contentId, shapeProperties: { contentAlignment: "MIDDLE" }, fields: "contentAlignment" } },
    { updateTextStyle: { objectId: contentId, style: { fontFamily: "Montserrat", fontSize: { magnitude: itemFontSize, unit: "PT" }, bold: true, foregroundColor: { opaqueColor: { rgbColor: config.itemColor || { red: 0.06, green: 0.3, blue: 0.42 } } } }, textRange: { type: "ALL" }, fields: "fontFamily,fontSize,bold,foregroundColor" } },
    { updateParagraphStyle: { objectId: contentId, style: { alignment: "CENTER" }, textRange: { type: "ALL" }, fields: "alignment" } },
  );
  ranges.filter(range => range.allergen).forEach(range => requests.push({ updateTextStyle: { objectId: contentId, style: { fontFamily: "Montserrat", fontSize: { magnitude: allergenFontSize, unit: "PT" }, bold: false, foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 0, blue: 0 } } } }, textRange: { type: "FIXED_RANGE", startIndex: range.start, endIndex: range.end }, fields: "fontFamily,fontSize,bold,foregroundColor" } }));
  return requests;
}

export function buildGoogleMenuRequests(output: MenuOutput, presentation: Presentation, config: MenuTemplateConfig = {}) {
  const anchor = contentAnchor(presentation);
  return anchor
    ? menuRequests(output, anchor, presentation, config)
    : [{ replaceAllText: { containsText: { text: "{{MENU_ITEMS}}", matchCase: true }, replaceText: output.items.map(item => item.name).join("\n") } }];
}

/** Copies the approved native template and replaces its explicit text tokens. */
export async function createGoogleMenu(output: MenuOutput, owner: DriveOwner, settings?: { folderId?: string; templateId?: string; siteKey?: string }) {
  const config = templateConfig(settings?.siteKey, settings?.templateId);
  const templateId = driveResourceId(config.templateId);
  if (!templateId) return null;
  const { owner: resolved, headers: authHeaders } = await driveHeaders(owner);
  const headers = { ...authHeaders, "content-type": "application/json" };
  const folderId = await resolveArtifactFolder(resolved, settings?.folderId, "menu", headers, "Hospitality menu");
  const copy = await json<{ id: string; webViewLink?: string }>(await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(templateId)}/copy?supportsAllDrives=true&fields=id,webViewLink`, {
    method: "POST", headers, body: JSON.stringify({ name: output.fileName, parents: [folderId] }),
  }, "Google Drive template copy"));
  const presentation = await json<Presentation>(await googleFetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(copy.id)}`, { headers }, "Google Slides template read"));
  const requests = buildGoogleMenuRequests(output, presentation, config);
  requests.push({ replaceAllText: { containsText: { text: "{{MENU_TITLE}}", matchCase: true }, replaceText: "MENU" } }, { replaceAllText: { containsText: { text: "{{BOOKING_ID}}", matchCase: true }, replaceText: output.bookingId } });
  await json(await googleFetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(copy.id)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests }) }, "Google Slides menu update"));
  const presentationUrl = `https://docs.google.com/presentation/d/${copy.id}/edit`;
  return { fileId: copy.id, presentationUrl, driveUrl: copy.webViewLink || presentationUrl };
}

/** Save a generated quote beside the site's generated menu files. The file name
 * is supplied by the caller and is used as the idempotency key in that folder. */
export async function saveGoogleDriveHtml(input: { name: string; html: string; owner: DriveOwner; folderId?: string; weekCommencing?: string }) {
  const { owner, headers } = await driveHeaders(input.owner);
  const rootFolderId = await resolveArtifactFolder(owner, input.folderId, "quote", headers, "Quote");
  const folderId = await resolveWeekFolder(rootFolderId, input.weekCommencing, headers, "Quote");
  const escapedName = input.name.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const query = `'${folderId}' in parents and name = '${escapedName}' and trashed = false`;
  const existing = await json<{ files?: Array<{ id: string; webViewLink?: string }> }>(await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,webViewLink)&pageSize=1`,
    { headers }, "Google Drive quote lookup",
  ));
  const found = existing.files?.[0];
  if (found) return { fileId: found.id, driveUrl: found.webViewLink || `https://drive.google.com/open?id=${found.id}`, reused: true };

  const metadata = JSON.stringify({ name: input.name, parents: [folderId], mimeType: "text/html" });
  const boundary = `fika_quote_${Date.now()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${input.html}\r\n--${boundary}--\r\n`,
  ]);
  const uploaded = await json<{ id: string; webViewLink?: string }>(await googleFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    { method: "POST", headers: { ...headers, "content-type": `multipart/related; boundary=${boundary}` }, body },
    "Google Drive quote upload",
  ));
  return { fileId: uploaded.id, driveUrl: uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}`, reused: false };
}

export async function saveGoogleDrivePdf(input: { name: string; pdfBase64: string; owner: DriveOwner; folderId?: string; weekCommencing?: string; folderLabel?: string }) {
  const { owner, headers } = await driveHeaders(input.owner);
  const rootFolderId = await resolveArtifactFolder(owner, input.folderId, "production", headers, input.folderLabel || "Allergen matrix");
  const weekFolderId = await resolveWeekFolder(rootFolderId, input.weekCommencing, headers, input.folderLabel || "Allergen matrix");
  const folderId = weekFolderId;
  const escapedName = input.name.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const query = `'${folderId}' in parents and name = '${escapedName}' and trashed = false`;
  const existing = await json<{ files?: Array<{ id: string; webViewLink?: string }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,webViewLink)&pageSize=1`, { headers }, "Google Drive matrix lookup"));
  const found = existing.files?.[0];
  const metadata = JSON.stringify({ name: input.name, parents: [folderId], mimeType: "application/pdf" });
  const boundary = `fika_matrix_${Date.now()}`;
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`, `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${input.pdfBase64}\r\n--${boundary}--\r\n`]);
  if (found) {
    await json(await googleFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(found.id)}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, { method: "PATCH", headers: { ...headers, "content-type": `multipart/related; boundary=${boundary}` }, body }, "Google Drive matrix update"));
    return { fileId: found.id, driveUrl: found.webViewLink || `https://drive.google.com/open?id=${found.id}`, reused: true };
  }
  const uploaded = await json<{ id: string; webViewLink?: string }>(await googleFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", { method: "POST", headers: { ...headers, "content-type": `multipart/related; boundary=${boundary}` }, body }, "Google Drive matrix upload"));
  return { fileId: uploaded.id, driveUrl: uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}`, reused: false };
}
