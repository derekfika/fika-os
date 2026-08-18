import { promises as fs } from "node:fs";
import type { MenuOutput } from "@/lib/mnk-menu-output";

type OAuthClient = { installed?: { client_id: string; client_secret: string; token_uri?: string } };
type OAuthToken = { access_token?: string; refresh_token?: string; expiry_date?: number; token_type?: string };

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

async function accessToken(): Promise<string> {
  const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_FILE;
  const clientPath = process.env.GOOGLE_OAUTH_CLIENT_FILE;
  if (!tokenPath || !clientPath) throw new Error("Google OAuth client and token files are not configured.");
  const [client, token] = await Promise.all([
    fs.readFile(clientPath, "utf8").then(value => JSON.parse(value) as OAuthClient),
    fs.readFile(tokenPath, "utf8").then(value => JSON.parse(value) as OAuthToken),
  ]);
  const installed = client.installed;
  if (!installed?.client_id || !installed.client_secret || !token.refresh_token) throw new Error("Google OAuth token is missing a refresh token.");
  if (token.access_token && (!token.expiry_date || token.expiry_date > Date.now() + 60_000)) return token.access_token;
  const response = await googleFetch(installed.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: installed.client_id, client_secret: installed.client_secret, refresh_token: token.refresh_token, grant_type: "refresh_token" }),
  }, "Google OAuth refresh");
  const refreshed = await json<{ access_token: string; expires_in?: number }>(response);
  await fs.writeFile(tokenPath, JSON.stringify({ ...token, ...refreshed, expiry_date: Date.now() + (refreshed.expires_in || 3600) * 1000 }, null, 2), "utf8");
  return refreshed.access_token;
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
  return { templateId: overrideTemplateId || process.env.GOOGLE_MENU_TEMPLATE_ID };
}

function outputFolderId(siteKey = "mnk") {
  const suffix = siteKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return process.env[`GOOGLE_MENU_OUTPUT_FOLDER_ID_${suffix}`] || process.env.GOOGLE_MENU_OUTPUT_FOLDER_ID;
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
  const pageHeight = presentation.pageSize?.height?.magnitude || 5_625_000;
  const x = config.contentLeft ?? anchor.element.transform?.translateX ?? 600_000;
  const contentWidth = Math.max(3_000_000, config.contentLeft !== undefined || config.contentRight !== undefined
    ? pageWidth - x - (config.contentRight ?? 0)
    : pageWidth - 1_200_000);
  const anchorY = config.contentTop ?? anchor.element.transform?.translateY ?? 0;
  const anchorHeight = config.contentTop !== undefined || config.contentBottom !== undefined
    ? pageHeight - anchorY - (config.contentBottom ?? 0)
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
  const gap = blocks.length > 6 ? 90000 : 180000;
  const totalHeight = blocks.reduce((sum, block) => sum + block.itemHeight + block.allergenHeight + gap, 0);
  // Centre the block in the template's content area, then apply a modest
  // lower optical bias. The bias is bounded so longer menus still move up
  // rather than colliding with the footer.
  const opticalBias = 350000;
  const centredOffset = (anchorHeight - totalHeight) / 2;
  let y = anchorY + Math.max(180000, Math.min(centredOffset + opticalBias, 1_650_000));
  const requests: Array<Record<string, unknown>> = anchor.generated || !anchor.element.objectId || config.preserveAnchor ? [] : [{ deleteObject: { objectId: anchor.element.objectId } }];
  output.items.forEach((item, index) => {
    const itemId = `fika-menu-item-${index}`;
    const itemName = item.name.trim();
    const block = blocks[index];
    const allergen = block.allergen;
    requests.push({ createShape: { objectId: itemId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: anchor.slide.objectId, size: { width: { magnitude: contentWidth, unit: "EMU" }, height: { magnitude: block.itemHeight, unit: "EMU" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" } } } }, { insertText: { objectId: itemId, text: itemName } }, { updateTextStyle: { objectId: itemId, style: { fontFamily: "Montserrat", fontSize: { magnitude: config.itemFontSize || 18, unit: "PT" }, bold: true, foregroundColor: { opaqueColor: { rgbColor: config.itemColor || { red: 0.06, green: 0.3, blue: 0.42 } } } }, textRange: { type: "ALL" }, fields: "fontFamily,fontSize,bold,foregroundColor" } }, { updateParagraphStyle: { objectId: itemId, style: { alignment: "CENTER" }, textRange: { type: "ALL" }, fields: "alignment" } });
    y += block.itemHeight;
    if (allergen) {
      const allergenId = `fika-menu-allergen-${index}`;
      requests.push({ createShape: { objectId: allergenId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: anchor.slide.objectId, size: { width: { magnitude: contentWidth, unit: "EMU" }, height: { magnitude: block.allergenHeight, unit: "EMU" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" } } } }, { insertText: { objectId: allergenId, text: allergen } }, { updateTextStyle: { objectId: allergenId, style: { fontFamily: "Montserrat", fontSize: { magnitude: config.allergenFontSize || 14, unit: "PT" }, foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 0, blue: 0 } } } }, textRange: { type: "ALL" }, fields: "fontFamily,fontSize,foregroundColor" } }, { updateParagraphStyle: { objectId: allergenId, style: { alignment: "CENTER" }, textRange: { type: "ALL" }, fields: "alignment" } });
      y += block.allergenHeight;
    }
    y += 180000;
  });
  return requests;
}

export function buildGoogleMenuRequests(output: MenuOutput, presentation: Presentation, config: MenuTemplateConfig = {}) {
  const anchor = contentAnchor(presentation);
  return anchor
    ? menuRequests(output, anchor, presentation, config)
    : [{ replaceAllText: { containsText: { text: "{{MENU_ITEMS}}", matchCase: true }, replaceText: output.items.map(item => item.name).join("\n") } }];
}

/** Copies the approved native template and replaces its explicit text tokens. */
export async function createGoogleMenu(output: MenuOutput, siteKey = "mnk", settings?: { folderId?: string; templateId?: string }) {
  const config = templateConfig(siteKey, settings?.templateId);
  const templateId = driveResourceId(config.templateId);
  const folderId = driveResourceId(settings?.folderId || outputFolderId(siteKey));
  if (!templateId || !folderId || folderId === "your_drive_folder_id") return null;
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  await assertDriveFolder(folderId, headers, "Hospitality menu");
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
export async function saveGoogleDriveHtml(input: { name: string; html: string; siteKey?: string; folderId?: string }) {
  const folderId = driveResourceId(input.folderId || outputFolderId(input.siteKey || "mnk"));
  if (!folderId || folderId === "your_drive_folder_id") return null;
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}` };
  await assertDriveFolder(folderId, headers, "Quote");
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

export async function saveGoogleDrivePdf(input: { name: string; pdfBase64: string; siteKey?: string; folderId?: string }) {
  const folderId = driveResourceId(input.folderId || outputFolderId(input.siteKey || "mnk"));
  if (!folderId || folderId === "your_drive_folder_id") return null;
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}` };
  await assertDriveFolder(folderId, headers, "Allergen matrix");
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
