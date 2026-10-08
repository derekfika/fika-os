import { createHash } from "node:crypto";
import { canonicalOplocId } from "./governed-oplocs";

/**
 * Shared menu-artifact path.
 *
 *   workflow adapter (Hospitality / Delivered-In)
 *     -> NormalizedMenu
 *     -> resolveMenuTemplate(site)
 *     -> layout -> Google Slides requests -> idempotent Drive publication
 *
 * Nothing below knows which workflow produced the menu. Adapters live with the
 * owning app and must only emit current, accepted menu state.
 */

export type MenuWorkflow = "hospitality" | "delivered-in";

export type NormalizedMenuItem = {
  id: string;
  name: string;
  description?: string;
  /** Canonical allergen keys the dish contains (for example `tree_nuts`). */
  contains: string[];
  /** Canonical allergen keys the dish may contain. */
  mayContain: string[];
};

export type NormalizedMenuSection = { key: string; label?: string; items: NormalizedMenuItem[] };

export type NormalizedMenu = {
  /** Site template key, for example `mnk` or `angel-court`. */
  siteKey: string;
  siteLabel: string;
  oplocId?: string;
  /** UK business date, `YYYY-MM-DD`. */
  serviceDate: string;
  /** Optional `HH:mm` service time. */
  serviceTime?: string;
  title: string;
  serviceLabel?: string;
  sections: NormalizedMenuSection[];
  /** Overrides the derived file name where an owning workflow has a governed one. */
  fileName?: string;
  source: {
    workflow: MenuWorkflow;
    /** Stable source identity (booking id, published day id, ...). */
    id: string;
    /** Source revision/version that this menu represents. */
    version: string | number;
    /** Content/revision fingerprint so a changed menu at the same version is distinct. */
    revisionStamp?: string;
    clientName?: string;
  };
};

export class MenuArtifactError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "MenuArtifactError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------- allergens

const ALLERGEN_LABEL_OVERRIDES: Record<string, string> = { no_key_allergens: "No key allergens" };

/** `tree_nuts` -> `Tree Nuts`. Raw machine keys never reach a customer-facing menu. */
export function menuAllergenLabel(key: string) {
  const override = ALLERGEN_LABEL_OVERRIDES[key];
  if (override) return override;
  return key.replace(/[_-]+/g, " ").trim().replace(/[A-Za-zÀ-ÿ]+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * Declared allergens for one dish: everything it contains, then anything it may
 * contain (never dropped). `no_key_allergens` is not an allergen.
 */
export function menuAllergenLine(item: Pick<NormalizedMenuItem, "contains" | "mayContain">) {
  const declared = [...new Set([...item.contains, ...item.mayContain])].filter(key => key !== "no_key_allergens");
  return declared.length ? `(${declared.map(menuAllergenLabel).join(", ")})` : "";
}

/** Allergen states from either workflow -> normalized sets. `unrecorded` is never treated as clear. */
export function allergensFromStates(states: Record<string, string | undefined> | undefined) {
  const contains: string[] = []; const mayContain: string[] = []; const unrecorded: string[] = [];
  for (const [key, state] of Object.entries(states || {})) {
    if (key === "no_key_allergens") continue;
    if (state === "contains") contains.push(key);
    else if (state === "may_contain") mayContain.push(key);
    else if (state === "unrecorded") unrecorded.push(key);
  }
  return { contains, mayContain, unrecorded };
}

// ---------------------------------------------------------------- validation

export function assertNormalizedMenu(menu: NormalizedMenu) {
  if (!menu.siteKey?.trim()) throw new MenuArtifactError("MENU_SITE_REQUIRED", "A menu needs a destination site.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(menu.serviceDate)) throw new MenuArtifactError("MENU_DATE_INVALID", "A menu needs a YYYY-MM-DD service date.");
  if (menu.serviceTime !== undefined && !/^\d{2}:\d{2}$/.test(menu.serviceTime)) throw new MenuArtifactError("MENU_TIME_INVALID", "A menu service time must be HH:mm.");
  if (!menu.source?.id?.trim()) throw new MenuArtifactError("MENU_SOURCE_REQUIRED", "A menu needs a stable source identity.");
  const items = menu.sections.flatMap(section => section.items);
  if (!items.length) throw new MenuArtifactError("MENU_EMPTY", "There are no menu items to print.", 409);
  if (items.some(item => !item.name.trim())) throw new MenuArtifactError("MENU_ITEM_NAME_REQUIRED", "Every menu item needs a name.");
}

// ---------------------------------------------------------------- identity

const safeName = (value: string) => String(value).trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Existing Hospitality convention: `date-time-company-destination` (for example `2026-08-25-12-00-FIKA-MNK`). */
export function menuArtifactFileName(menu: NormalizedMenu) {
  if (menu.fileName?.trim()) return menu.fileName.trim();
  return [menu.serviceDate, menu.serviceTime, menu.source.clientName, menu.siteLabel].map(value => safeName(String(value ?? ""))).filter(Boolean).join("-");
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Identity of the thing being printed, independent of revision: site + date/time + source. */
export function menuArtifactSourceKey(menu: NormalizedMenu) {
  return sha([menu.siteKey, menu.serviceDate, menu.serviceTime || "", menu.source.workflow, menu.source.id].join("|"));
}

/** Identity of one exact revision of that menu. A retry yields the same key; an amendment yields a new one. */
export function menuArtifactKey(menu: NormalizedMenu, templateKey: string) {
  return sha([menuArtifactSourceKey(menu), `v${menu.source.version}`, menu.source.revisionStamp || "", templateKey].join("|"));
}

export function menuArtifactId(menu: NormalizedMenu, templateKey: string) {
  return `menu-artifact:${menu.siteKey}:${menu.serviceDate}:${menu.source.workflow}:${menu.source.id}:v${menu.source.version}:${menuArtifactKey(menu, templateKey).slice(0, 12)}`;
}

// ---------------------------------------------------------------- templates

export type MenuColor = { red: number; green: number; blue: number };

export type MenuLayoutConfig = {
  layout: "single-box";
  /** EMU insets from the slide edges that bound the white content panel. */
  contentLeft: number; contentRight: number; contentTop: number; contentBottom: number;
  itemFontSize: number; allergenFontSize: number;
  minItemFontSize: number;
  itemColor: MenuColor; allergenColor: MenuColor;
};

export type MenuTemplate = {
  key: string;
  siteKey: string;
  label: string;
  templateId: string;
  layout: MenuLayoutConfig;
};

type TemplateFamily = {
  siteKey: string; label: string; oplocIds: string[]; envKeys: string[]; layout: MenuLayoutConfig;
};

const NAVY: MenuColor = { red: 0.06, green: 0.3, blue: 0.42 };
const RED: MenuColor = { red: 1, green: 0, blue: 0 };

/**
 * Site -> template family. Add a site by adding a row; the renderer never
 * branches on workflow. MNK's geometry is the proven baseline deck: portrait
 * page, white panel inset 450k/450k/1.8m/700k EMU, Montserrat 15pt bold navy
 * items with 10pt red allergen lines.
 */
const TEMPLATE_FAMILIES: TemplateFamily[] = [
  {
    siteKey: "mnk", label: "MNK",
    oplocIds: ["oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f"],
    envKeys: ["GOOGLE_MENU_TEMPLATE_ID_MNK", "GOOGLE_MENU_TEMPLATE_ID"],
    layout: { layout: "single-box", contentLeft: 450_000, contentRight: 450_000, contentTop: 1_800_000, contentBottom: 700_000, itemFontSize: 15, allergenFontSize: 10, minItemFontSize: 10, itemColor: NAVY, allergenColor: RED },
  },
  {
    siteKey: "angel-court", label: "One Angel Court",
    oplocIds: ["oploc:24a93500-d75d-4fe0-8beb-672d36f9da10"],
    envKeys: ["GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT"],
    // Angel Court reserves a brown rail on the left; keep content in the white panel.
    layout: { layout: "single-box", contentLeft: 1_750_000, contentRight: 350_000, contentTop: 1_700_000, contentBottom: 900_000, itemFontSize: 15, allergenFontSize: 11, minItemFontSize: 10, itemColor: { red: 0.54, green: 0.3, blue: 0.13 }, allergenColor: RED },
  },
];

export function menuSiteKeyForOploc(oplocId?: string) {
  const canonical = canonicalOplocId(oplocId);
  return TEMPLATE_FAMILIES.find(family => family.oplocIds.includes(canonical || ""))?.siteKey;
}

export function menuTemplateSiteKeys() { return TEMPLATE_FAMILIES.map(family => family.siteKey); }

export function menuDriveResourceId(value?: string) {
  const raw = value?.trim().replace(/[),.;]+$/, "");
  if (!raw) return undefined;
  const match = raw.match(/\/folders\/([A-Za-z0-9_-]+)/) || raw.match(/\/d\/([A-Za-z0-9_-]+)/);
  return (match?.[1] || raw).replace(/[),.;]+$/, "");
}

/**
 * Resolves the site template. Fails safely rather than producing an
 * incorrectly branded artifact: an unknown site or an unconfigured template is
 * an actionable error, never a silent fallback.
 */
export function resolveMenuTemplate(input: { siteKey?: string; oplocId?: string; templateIdOverride?: string }, env: Record<string, string | undefined> = process.env): MenuTemplate {
  const requested = input.siteKey?.trim().toLowerCase() || menuSiteKeyForOploc(input.oplocId);
  const family = TEMPLATE_FAMILIES.find(candidate => candidate.siteKey === requested);
  if (!family) throw new MenuArtifactError("MENU_TEMPLATE_SITE_UNSUPPORTED", `No menu template is defined for site "${input.siteKey || input.oplocId || "unknown"}". Supported sites: ${menuTemplateSiteKeys().join(", ")}.`, 422);
  const templateId = menuDriveResourceId(input.templateIdOverride) || family.envKeys.map(key => menuDriveResourceId(env[key])).find(Boolean);
  if (!templateId) throw new MenuArtifactError("MENU_TEMPLATE_NOT_CONFIGURED", `The ${family.label} menu template is not configured. Set ${family.envKeys[0]} (or the site's Google menu template in Hospitality settings) to the approved Google Slides template.`, 409);
  return { key: `${family.siteKey}-portrait-v1`, siteKey: family.siteKey, label: family.label, templateId, layout: family.layout };
}

// ---------------------------------------------------------------- layout

const EMU_PER_PT = 12_700;

export type MenuTextRun = { text: string; kind: "section" | "item" | "allergen" | "gap" };
export type MenuLayout = {
  runs: MenuTextRun[];
  itemFontSize: number; allergenFontSize: number; sectionFontSize: number;
  fontScaled: boolean;
};

function estimateLines(text: string, fontPt: number, widthPt: number) {
  if (!text) return 1;
  const charsPerLine = Math.max(8, Math.floor(widthPt / (fontPt * 0.64)));
  return text.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

/**
 * Builds the printable run list and fits it into the content panel. Fonts
 * shrink from the template size toward a floor; if the menu still cannot fit
 * it fails with an actionable error instead of clipping or overflowing.
 */
export function layoutMenu(menu: NormalizedMenu, template: Pick<MenuTemplate, "layout">, page: { width: number; height: number }): MenuLayout {
  assertNormalizedMenu(menu);
  const config = template.layout;
  const widthPt = (page.width - config.contentLeft - config.contentRight - 360_000) / EMU_PER_PT;
  const heightPt = (page.height - config.contentTop - config.contentBottom - 360_000) / EMU_PER_PT;
  const labelled = menu.sections.filter(section => section.items.length).length > 1 && menu.sections.every(section => section.label);
  const runs: MenuTextRun[] = [];
  menu.sections.filter(section => section.items.length).forEach((section, sectionIndex) => {
    if (sectionIndex > 0) runs.push({ text: "", kind: "gap" });
    if (labelled) runs.push({ text: section.label!.toLocaleUpperCase("en-GB"), kind: "section" });
    section.items.forEach((item, index) => {
      if (index > 0 || labelled) runs.push({ text: "", kind: "gap" });
      runs.push({ text: item.name.trim(), kind: "item" });
      const allergen = menuAllergenLine(item);
      if (allergen) runs.push({ text: allergen, kind: "allergen" });
    });
  });
  const measure = (itemPt: number) => {
    // Allergen text is safety-relevant: never smaller than 8pt.
    const allergenPt = Math.max(8, Math.round(itemPt * (config.allergenFontSize / config.itemFontSize) * 2) / 2);
    const sectionPt = Math.max(allergenPt + 1, itemPt - 3);
    const total = runs.reduce((sum, run) => {
      const size = run.kind === "allergen" ? allergenPt : run.kind === "section" ? sectionPt : itemPt;
      return sum + estimateLines(run.text, size, widthPt) * size * 1.2;
    }, 0);
    return { allergenPt, sectionPt, total };
  };
  let itemPt = config.itemFontSize; let fit = measure(itemPt);
  while (fit.total > heightPt && itemPt > config.minItemFontSize) { itemPt -= 0.5; fit = measure(itemPt); }
  if (fit.total > heightPt) throw new MenuArtifactError("MENU_OVERFLOW", `This menu has too many or too long items to fit the ${template.layout.layout} template at a readable size. Shorten the menu or split it across two service times.`, 422);
  return { runs, itemFontSize: itemPt, allergenFontSize: fit.allergenPt, sectionFontSize: fit.sectionPt, fontScaled: itemPt !== config.itemFontSize };
}

// ---------------------------------------------------------------- Slides requests

export type SlidesPresentation = {
  pageSize?: { width?: { magnitude?: number }; height?: { magnitude?: number } };
  slides?: Array<{ objectId: string; pageElements?: Array<{
    objectId: string;
    size?: { width?: { magnitude?: number }; height?: { magnitude?: number } };
    transform?: { translateX?: number; translateY?: number };
    shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } };
  }> }>;
};

const textOf = (element: NonNullable<NonNullable<SlidesPresentation["slides"]>[number]["pageElements"]>[number]) => element.shape?.text?.textElements?.map(item => item.textRun?.content || "").join("") || "";

/** A visible `{{MENU_ITEMS}}` token wins; otherwise any slide works and the panel bounds come from the template config. */
function targetSlide(presentation: SlidesPresentation) {
  for (const slide of presentation.slides || []) for (const element of slide.pageElements || []) {
    if (textOf(element).includes("{{MENU_ITEMS}}")) return { slide, tokenElementId: element.objectId };
  }
  const slide = presentation.slides?.[0];
  return slide ? { slide, tokenElementId: undefined } : undefined;
}

function longDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export const MENU_CONTENT_OBJECT_ID = "fika-menu-content";

export function buildMenuSlidesRequests(menu: NormalizedMenu, template: Pick<MenuTemplate, "layout">, presentation: SlidesPresentation) {
  const page = { width: presentation.pageSize?.width?.magnitude || 10_000_000, height: presentation.pageSize?.height?.magnitude || 5_625_000 };
  const target = targetSlide(presentation);
  if (!target) throw new MenuArtifactError("MENU_TEMPLATE_EMPTY", "The configured menu template has no slides.", 409);
  const config = template.layout;
  const layout = layoutMenu(menu, template, page);
  const text = layout.runs.map(run => run.text).join("\n");
  const width = page.width - config.contentLeft - config.contentRight;
  const padding = 180_000;
  const height = Math.max(1_000_000, page.height - config.contentTop - config.contentBottom - padding * 2);
  const requests: Array<Record<string, unknown>> = [];
  if (target.tokenElementId) requests.push({ deleteObject: { objectId: target.tokenElementId } });
  requests.push(
    { createShape: { objectId: MENU_CONTENT_OBJECT_ID, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: target.slide.objectId, size: { width: { magnitude: width, unit: "EMU" }, height: { magnitude: height, unit: "EMU" } }, transform: { scaleX: 1, scaleY: 1, translateX: config.contentLeft, translateY: config.contentTop + padding, unit: "EMU" } } } },
    { insertText: { objectId: MENU_CONTENT_OBJECT_ID, text } },
    { updateShapeProperties: { objectId: MENU_CONTENT_OBJECT_ID, shapeProperties: { contentAlignment: "MIDDLE" }, fields: "contentAlignment" } },
    { updateTextStyle: { objectId: MENU_CONTENT_OBJECT_ID, style: { fontFamily: "Montserrat", fontSize: { magnitude: layout.itemFontSize, unit: "PT" }, bold: true, foregroundColor: { opaqueColor: { rgbColor: config.itemColor } } }, textRange: { type: "ALL" }, fields: "fontFamily,fontSize,bold,foregroundColor" } },
    { updateParagraphStyle: { objectId: MENU_CONTENT_OBJECT_ID, style: { alignment: "CENTER" }, textRange: { type: "ALL" }, fields: "alignment" } },
  );
  let cursor = 0;
  // Items take the base style above; only allergen and section runs need their own.
  for (const run of layout.runs) {
    const start = cursor; const end = cursor + run.text.length; cursor = end + 1;
    if (run.kind === "item" || run.kind === "gap") continue;
    const isAllergen = run.kind === "allergen";
    requests.push({ updateTextStyle: { objectId: MENU_CONTENT_OBJECT_ID, style: { fontFamily: "Montserrat", fontSize: { magnitude: isAllergen ? layout.allergenFontSize : layout.sectionFontSize, unit: "PT" }, bold: !isAllergen, foregroundColor: { opaqueColor: { rgbColor: isAllergen ? config.allergenColor : config.itemColor } } }, textRange: { type: "FIXED_RANGE", startIndex: start, endIndex: end }, fields: "fontFamily,fontSize,bold,foregroundColor" } });
  }
  const replace = (token: string, value: string) => ({ replaceAllText: { containsText: { text: `{{${token}}}`, matchCase: true }, replaceText: value } });
  requests.push(
    replace("MENU_TITLE", menu.title), replace("BOOKING_ID", menu.source.id), replace("SOURCE_ID", menu.source.id),
    replace("SITE_NAME", menu.siteLabel), replace("SERVICE_DATE", longDate(menu.serviceDate)), replace("SERVICE_TIME", menu.serviceTime || ""),
  );
  return requests;
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
  artifactKey: string; artifactId: string; templateKey: string;
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
  const fetchImpl: FetchLike = input.fetch || ((url, init) => fetch(url, init));
  const headers = { ...input.headers, "content-type": "application/json" };
  const artifactKey = menuArtifactKey(input.menu, input.template.key);
  const sourceKey = menuArtifactSourceKey(input.menu);
  const fileName = menuArtifactFileName(input.menu);
  const drive = "https://www.googleapis.com/drive/v3/files";
  const find = (property: string, value: string) => api<{ files?: Array<{ id: string; webViewLink?: string; appProperties?: Record<string, string> }> }>(fetchImpl,
    `${drive}?q=${encodeURIComponent(`appProperties has { key='${property}' and value='${value}' } and trashed = false`)}&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=${encodeURIComponent("files(id,webViewLink,appProperties)")}&pageSize=50`,
    { headers }, "Google Drive menu lookup");
  const existing = (await find("fikaMenuArtifactKey", artifactKey)).files?.[0];
  let file = existing;
  if (!file) {
    file = await api<{ id: string; webViewLink?: string; appProperties?: Record<string, string> }>(fetchImpl,
      `${drive}/${encodeURIComponent(input.template.templateId)}/copy?supportsAllDrives=true&fields=id,webViewLink`,
      { method: "POST", headers, body: JSON.stringify({ name: fileName, parents: [input.folderId], appProperties: { fikaMenuArtifactKey: artifactKey, fikaMenuSourceKey: sourceKey } }) }, "Google Drive template copy");
  }
  if (file.appProperties?.fikaMenuMaterialised !== "ready") {
    const presentation = await api<SlidesPresentation>(fetchImpl, `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(file.id)}`, { headers }, "Google Slides template read");
    const requests = buildMenuSlidesRequests(input.menu, input.template, presentation);
    await api(fetchImpl, `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(file.id)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests }) }, "Google Slides menu update");
    await api(fetchImpl, `${drive}/${encodeURIComponent(file.id)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ appProperties: { fikaMenuArtifactKey: artifactKey, fikaMenuSourceKey: sourceKey, fikaMenuMaterialised: "ready" } }) }, "Google Drive menu finalise");
  }
  const retired: string[] = [];
  for (const earlier of (await find("fikaMenuSourceKey", sourceKey)).files || []) {
    if (earlier.id === file.id) continue;
    await api(fetchImpl, `${drive}/${encodeURIComponent(earlier.id)}?supportsAllDrives=true`, { method: "PATCH", headers, body: JSON.stringify({ trashed: true }) }, "Google Drive superseded menu retire");
    retired.push(earlier.id);
  }
  const presentationUrl = `https://docs.google.com/presentation/d/${file.id}/edit`;
  return { fileId: file.id, presentationUrl, driveUrl: file.webViewLink || presentationUrl, fileName, artifactKey, artifactId: menuArtifactId(input.menu, input.template.key), templateKey: input.template.key, reused: Boolean(existing && existing.appProperties?.fikaMenuMaterialised === "ready"), retiredFileIds: retired };
}
