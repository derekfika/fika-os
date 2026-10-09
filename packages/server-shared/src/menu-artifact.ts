import { createHash } from "node:crypto";
import { canonicalOplocId } from "./governed-oplocs";
import { SITE_BRANDING, layoutTemplateKey, planMenuLayout, resolveLayoutMaster, siteBrandingFor, type SiteBranding } from "./menu-formats";
import { buildMenuSlidesRequests, type SlidesPresentation } from "./menu-slides";
import { assertNormalizedMenu } from "./menu-validation";
import { DEFAULT_MENU_OUTPUT_FORMAT, MENU_OUTPUT_FORMATS, MenuArtifactError, type MenuOutputFormat, type NormalizedMenu } from "./menu-types";

/**
 * Shared menu-artifact path.
 *
 *   workflow adapter (Hospitality / Delivered-In)
 *     -> NormalizedMenu
 *     + MenuOutputFormat ("tablet" | "flat-label" | "tent-label")   chosen by the caller
 *     + SiteBranding                                                resolved from the site
 *     -> planMenuLayout()        menu-formats.ts  (geometry, fitting, pagination)
 *     -> Google Slides requests  menu-slides.ts
 *     -> idempotent Drive publication (below)
 *
 * Nothing below knows which workflow produced the menu. Adapters live with the
 * owning app and must only emit current, accepted menu state.
 */

export * from "./menu-types";
export { assertNormalizedMenu } from "./menu-validation";
export { GENERATED_MENUS_FOLDER, ensureGeneratedMenusFolder, menuWeekCommencing, menuWeekFolderName } from "./menu-drive";
export { allergensFromStates, assertAllergensPrintable, menuAllergenLabel, menuAllergenLine, menuAllergenLines, type MenuAllergenLine } from "./menu-allergens";
export { LAYOUT_MASTERS, SITE_BRANDING, fitLabelFace, layoutTemplateKey, planMenuLayout, resolveLayoutMaster, siteBrandingFor, type MenuLayoutPlan, type MenuLayoutPage, type PlanElement, type PlanParagraph, type SiteBranding } from "./menu-formats";
export { MENU_CONTENT_OBJECT_ID, buildMenuSlidesRequests, flattenSlideElements, type SlidesPresentation } from "./menu-slides";

export function assertMenuOutputFormat(format: unknown): MenuOutputFormat {
  if (!MENU_OUTPUT_FORMATS.includes(format as MenuOutputFormat)) throw new MenuArtifactError("MENU_FORMAT_INVALID", `Unknown menu format "${String(format)}". Use one of: ${MENU_OUTPUT_FORMATS.join(", ")}.`, 400);
  return format as MenuOutputFormat;
}

// ---------------------------------------------------------------- identity

const safeName = (value: string) => String(value).trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const FORMAT_FILE_SUFFIX: Record<MenuOutputFormat, string> = { tablet: "", "flat-label": "-flat-labels", "tent-label": "-tent-labels" };

/** Existing Hospitality convention: `date-time-company-destination` (for example `2026-08-25-12-00-FIKA-MNK`); non-tablet formats add a suffix so files never share a name. */
export function menuArtifactFileName(menu: NormalizedMenu, format: MenuOutputFormat = DEFAULT_MENU_OUTPUT_FORMAT) {
  const base = menu.fileName?.trim() || [menu.serviceDate, menu.serviceTime, menu.source.clientName, menu.siteLabel].map(value => safeName(String(value ?? ""))).filter(Boolean).join("-");
  return `${base}${FORMAT_FILE_SUFFIX[format]}`;
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Identity of the thing being printed, independent of revision: site + date/time + source
 * + output format. Superseded revisions are retired per source key, so the format is part
 * of it: generating flat labels must never retire the tablet menu for the same booking.
 */
export function menuArtifactSourceKey(menu: NormalizedMenu, format: MenuOutputFormat = DEFAULT_MENU_OUTPUT_FORMAT) {
  return sha([menu.siteKey, menu.serviceDate, menu.serviceTime || "", menu.source.workflow, menu.source.id, format].join("|"));
}

/**
 * Identity of one exact revision of that menu in one format: site, workflow, source id,
 * source revision, output format and layout template version. A retry yields the same
 * key; an amendment or a different format yields a new one.
 */
export function menuArtifactKey(menu: NormalizedMenu, templateKey: string, format: MenuOutputFormat = DEFAULT_MENU_OUTPUT_FORMAT) {
  return sha([menuArtifactSourceKey(menu, format), `v${menu.source.version}`, menu.source.revisionStamp || "", format, templateKey].join("|"));
}

export function menuArtifactId(menu: NormalizedMenu, templateKey: string, format: MenuOutputFormat = DEFAULT_MENU_OUTPUT_FORMAT) {
  return `menu-artifact:${menu.siteKey}:${menu.serviceDate}:${menu.source.workflow}:${menu.source.id}:${format}:v${menu.source.version}:${menuArtifactKey(menu, templateKey, format).slice(0, 12)}`;
}

// ---------------------------------------------------------------- templates

export type MenuTemplate = {
  /** Layout master identity + version, for example `mnk-flat-label-v1`. Part of the artifact key. */
  key: string;
  siteKey: string;
  label: string;
  format: MenuOutputFormat;
  /** Google Slides master deck copied per artifact. */
  templateId: string;
  branding: SiteBranding;
};

export function menuSiteKeyForOploc(oplocId?: string) {
  const canonical = canonicalOplocId(oplocId);
  return SITE_BRANDING.find(site => site.oplocIds.includes(canonical || ""))?.siteKey;
}

export function menuTemplateSiteKeys() { return SITE_BRANDING.map(site => site.siteKey); }

export function menuDriveResourceId(value?: string) {
  const raw = value?.trim().replace(/[),.;]+$/, "");
  if (!raw) return undefined;
  const match = raw.match(/\/folders\/([A-Za-z0-9_-]+)/) || raw.match(/\/d\/([A-Za-z0-9_-]+)/);
  return (match?.[1] || raw).replace(/[),.;]+$/, "");
}

/**
 * Resolves the site branding, layout master and Drive master deck for a format.
 * Fails safely rather than producing an incorrectly branded artifact: an unknown
 * site, an unsupported format or an unconfigured deck is an actionable error, never
 * a silent fallback. `templateIdOverride` (a Hospitality site setting) names a
 * tablet deck and is ignored for label formats so a tablet deck is never used as a label master.
 */
export function resolveMenuTemplate(input: { siteKey?: string; oplocId?: string; templateIdOverride?: string; format?: MenuOutputFormat }, env: Record<string, string | undefined> = process.env): MenuTemplate {
  const format = assertMenuOutputFormat(input.format ?? DEFAULT_MENU_OUTPUT_FORMAT);
  const requested = input.siteKey?.trim().toLowerCase() || menuSiteKeyForOploc(input.oplocId);
  const branding = requested ? siteBrandingFor(requested) : undefined;
  if (!branding) throw new MenuArtifactError("MENU_TEMPLATE_SITE_UNSUPPORTED", `No menu template is defined for site "${input.siteKey || input.oplocId || "unknown"}". Supported sites: ${menuTemplateSiteKeys().join(", ")}.`, 422);
  resolveLayoutMaster(branding, format); // MENU_FORMAT_UNSUPPORTED when the site has no layout for it
  const entry = branding.formats[format]!;
  const override = format === "tablet" ? menuDriveResourceId(input.templateIdOverride) : undefined;
  const templateId = override || entry.envKeys.map(key => menuDriveResourceId(env[key])).find(Boolean);
  if (!templateId) throw new MenuArtifactError("MENU_TEMPLATE_NOT_CONFIGURED", `The ${branding.siteLabel} ${format} menu template is not configured. Set ${entry.envKeys[0]}${format === "tablet" ? " (or the Google menu template in Hospitality settings)" : ""} to the approved Google Slides ${format === "tablet" ? "template" : "MNK Label Template deck"}.`, 409);
  return { key: layoutTemplateKey(branding, format), siteKey: branding.siteKey, label: branding.siteLabel, format, templateId, branding };
}

// ---------------------------------------------------------------- Drive publication

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function api<T>(fetchImpl: FetchLike, url: string, init: RequestInit, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try { response = await fetchImpl(url, { ...init, signal: controller.signal }); }
  catch (error) { throw new MenuArtifactError("MENU_GOOGLE_UNAVAILABLE", `${label} failed: ${(error as Error).message}`, 502); }
  finally { clearTimeout(timer); }
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { throw new MenuArtifactError("MENU_GOOGLE_UNAVAILABLE", `${label}: Google API returned ${response.status} without JSON.`, 502); }
  if (!response.ok) throw new MenuArtifactError("MENU_GOOGLE_UNAVAILABLE", `${label}: Google API ${response.status}: ${JSON.stringify(body).slice(0, 400)}`, 502);
  return body as T;
}

export type PublishedMenuArtifact = {
  fileId: string; presentationUrl: string; driveUrl: string; fileName: string;
  artifactKey: string; artifactId: string; templateKey: string; format: MenuOutputFormat;
  /** Pages generated (1 for a tablet menu; labels page automatically). */
  pageCount: number;
  /** True when this exact revision already existed and nothing was created. */
  reused: boolean;
  /** Earlier revisions of the same menu that were retired so they cannot look current. */
  retiredFileIds: string[];
};

/**
 * Creates the menu once per exact revision. A retry finds the existing file by
 * its artifact key and reuses it; an amendment creates a new file and retires
 * the earlier revisions of the same source (Drive trash, reversible).
 */
export async function publishMenuArtifact(input: {
  menu: NormalizedMenu; template: MenuTemplate; folderId: string; headers: Record<string, string>; fetch?: FetchLike;
}): Promise<PublishedMenuArtifact> {
  assertNormalizedMenu(input.menu);
  const format = input.template.format;
  // Plan first: an overflow or unsafe allergen state must fail before any Drive file exists.
  const plan = planMenuLayout(input.menu, format, input.template.branding);
  const fetchImpl: FetchLike = input.fetch || ((url, init) => fetch(url, init));
  const headers = { ...input.headers, "content-type": "application/json" };
  const artifactKey = menuArtifactKey(input.menu, input.template.key, format);
  const sourceKey = menuArtifactSourceKey(input.menu, format);
  const fileName = menuArtifactFileName(input.menu, format);
  const drive = "https://www.googleapis.com/drive/v3/files";
  const find = (property: string, value: string) => api<{ files?: Array<{ id: string; webViewLink?: string; appProperties?: Record<string, string> }> }>(fetchImpl,
    `${drive}?q=${encodeURIComponent(`appProperties has { key='${property}' and value='${value}' } and trashed = false`)}&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=${encodeURIComponent("files(id,webViewLink,appProperties)")}&pageSize=50`,
    { headers }, "Google Drive menu lookup");
  const existing = (await find("fikaMenuArtifactKey", artifactKey)).files?.[0];
  let file = existing;
  if (!file) {
    file = await api<{ id: string; webViewLink?: string; appProperties?: Record<string, string> }>(fetchImpl,
      `${drive}/${encodeURIComponent(input.template.templateId)}/copy?supportsAllDrives=true&fields=id,webViewLink`,
      { method: "POST", headers, body: JSON.stringify({ name: fileName, parents: [input.folderId], appProperties: { fikaMenuArtifactKey: artifactKey, fikaMenuSourceKey: sourceKey, fikaMenuFormat: format } }) }, "Google Drive template copy");
  }
  if (file.appProperties?.fikaMenuMaterialised !== "ready") {
    const presentation = await api<SlidesPresentation>(fetchImpl, `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(file.id)}`, { headers }, "Google Slides template read");
    const requests = buildMenuSlidesRequests(input.menu, input.template, presentation);
    await api(fetchImpl, `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(file.id)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests }) }, "Google Slides menu update");
    await api(fetchImpl, `${drive}/${encodeURIComponent(file.id)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ appProperties: { fikaMenuArtifactKey: artifactKey, fikaMenuSourceKey: sourceKey, fikaMenuFormat: format, fikaMenuMaterialised: "ready" } }) }, "Google Drive menu finalise");
  }
  const retired: string[] = [];
  for (const earlier of (await find("fikaMenuSourceKey", sourceKey)).files || []) {
    if (earlier.id === file.id) continue;
    await api(fetchImpl, `${drive}/${encodeURIComponent(earlier.id)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ trashed: true }) }, "Google Drive superseded menu retire");
    retired.push(earlier.id);
  }
  const presentationUrl = `https://docs.google.com/presentation/d/${file.id}/edit`;
  return { fileId: file.id, presentationUrl, driveUrl: file.webViewLink || presentationUrl, fileName, artifactKey, artifactId: menuArtifactId(input.menu, input.template.key, format), templateKey: input.template.key, format, pageCount: plan.pages.length, reused: Boolean(existing && existing.appProperties?.fikaMenuMaterialised === "ready"), retiredFileIds: retired };
}
