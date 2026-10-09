import { NATURAL_LINE_HEIGHT, planMenuLayout, resolveLayoutMaster, type LabelMaster, type MenuLayoutPlan, type PlanElement, type PlanParagraph, type Rect, type SiteBranding, type TabletMaster } from "./menu-formats";
import { MenuArtifactError, type MenuOutputFormat, type NormalizedMenu } from "./menu-types";

/**
 * MenuLayoutPlan -> Google Slides batchUpdate requests.
 *
 * The Drive "master" deck for a format carries the branded chrome (logos, bars,
 * panels) that Slides cannot ingest from a local file. This module never
 * hard-codes object ids: it reads the copied deck, locates cards by geometry
 * (the layout master's extracted card origins), keeps the cards it needs,
 * duplicates the page for more dishes, removes unused cards and writes text.
 */

const EMU_PER_PT = 12_700;
const DEFAULT_INSET_X_PT = 7.2; // Slides text boxes cannot change insets; box rects are adjusted to hit the planned text area.
const DEFAULT_INSET_Y_PT = 3.6;

type Dimension = { magnitude?: number; unit?: string };
type Transform = { scaleX?: number; scaleY?: number; shearX?: number; shearY?: number; translateX?: number; translateY?: number; unit?: string };

export type SlidesPageElement = {
  objectId: string;
  size?: { width?: Dimension; height?: Dimension };
  transform?: Transform;
  elementGroup?: { children?: SlidesPageElement[] };
  shape?: { shapeType?: string; text?: { textElements?: Array<{ textRun?: { content?: string } }> } };
};

export type SlidesPresentation = {
  pageSize?: { width?: { magnitude?: number }; height?: { magnitude?: number } };
  slides?: Array<{ objectId: string; pageElements?: SlidesPageElement[] }>;
};

const textOf = (element: SlidesPageElement) => element.shape?.text?.textElements?.map(item => item.textRun?.content || "").join("") || "";
const emu = (pt: number) => Math.round(pt * EMU_PER_PT);

// ---------------------------------------------------------------- geometry

type Affine = [number, number, number, number, number, number]; // a b c d e f : x' = a x + c y + e ; y' = b x + d y + f
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const unitScale = (unit?: string) => (unit === "PT" ? EMU_PER_PT : 1);

function toAffine(transform?: Transform): Affine {
  if (!transform) return IDENTITY;
  const k = unitScale(transform.unit);
  return [transform.scaleX ?? 1, transform.shearY ?? 0, transform.shearX ?? 0, transform.scaleY ?? 1, (transform.translateX ?? 0) * k, (transform.translateY ?? 0) * k];
}
const compose = (parent: Affine, child: Affine): Affine => [
  parent[0] * child[0] + parent[2] * child[1], parent[1] * child[0] + parent[3] * child[1],
  parent[0] * child[2] + parent[2] * child[3], parent[1] * child[2] + parent[3] * child[3],
  parent[0] * child[4] + parent[2] * child[5] + parent[4], parent[1] * child[4] + parent[3] * child[5] + parent[5],
];

export type FlatElement = { objectId: string; group: boolean; depth: number; box: Rect; emptyTextBox: boolean };

/** Absolute point-space bounding boxes for every element on a slide, including grouped children. */
export function flattenSlideElements(elements: SlidesPageElement[] = [], parent: Affine = IDENTITY, depth = 0): FlatElement[] {
  const result: FlatElement[] = [];
  for (const element of elements) {
    const own = compose(parent, toAffine(element.transform));
    const children = element.elementGroup?.children;
    const width = (element.size?.width?.magnitude ?? 0) * unitScale(element.size?.width?.unit);
    const height = (element.size?.height?.magnitude ?? 0) * unitScale(element.size?.height?.unit);
    const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => [own[0] * x + own[2] * y + own[4], own[1] * x + own[3] * y + own[5]]);
    const xs = corners.map(point => point[0]); const ys = corners.map(point => point[1]);
    const box = { x: Math.min(...xs) / EMU_PER_PT, y: Math.min(...ys) / EMU_PER_PT, w: (Math.max(...xs) - Math.min(...xs)) / EMU_PER_PT, h: (Math.max(...ys) - Math.min(...ys)) / EMU_PER_PT };
    if (children) {
      result.push({ objectId: element.objectId, group: true, depth, box, emptyTextBox: false });
      result.push(...flattenSlideElements(children, own, depth + 1));
    } else {
      result.push({ objectId: element.objectId, group: false, depth, box, emptyTextBox: element.shape?.shapeType === "TEXT_BOX" && !textOf(element).trim() });
    }
  }
  return result;
}

const centre = (box: Rect) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const within = (point: { x: number; y: number }, rect: Rect, tolerance = 2) => point.x >= rect.x - tolerance && point.x <= rect.x + rect.w + tolerance && point.y >= rect.y - tolerance && point.y <= rect.y + rect.h + tolerance;

// ---------------------------------------------------------------- text

function textRequests(objectId: string, paragraphs: PlanParagraph[], fontFamily: string, lineHeight: number) {
  const text = paragraphs.map(paragraph => paragraph.text).join("\n");
  const requests: Array<Record<string, unknown>> = [
    { insertText: { objectId, text } },
    { updateTextStyle: { objectId, style: { fontFamily }, textRange: { type: "ALL" }, fields: "fontFamily" } },
    { updateParagraphStyle: { objectId, style: { alignment: "CENTER", lineSpacing: Math.round((lineHeight / NATURAL_LINE_HEIGHT) * 100) }, textRange: { type: "ALL" }, fields: "alignment,lineSpacing" } },
  ];
  let cursor = 0;
  for (const paragraph of paragraphs) {
    const startIndex = cursor; const endIndex = cursor + paragraph.text.length; cursor = endIndex + 1;
    requests.push({ updateTextStyle: { objectId, style: { fontFamily, fontSize: { magnitude: paragraph.fontPt, unit: "PT" }, bold: paragraph.bold, italic: Boolean(paragraph.italic), foregroundColor: { opaqueColor: { rgbColor: hexToRgb(paragraph.color) } } }, textRange: { type: "FIXED_RANGE", startIndex, endIndex }, fields: "fontFamily,fontSize,bold,italic,foregroundColor" } });
    if (paragraph.spaceBeforePt) requests.push({ updateParagraphStyle: { objectId, style: { spaceAbove: { magnitude: paragraph.spaceBeforePt, unit: "PT" } }, textRange: { type: "FIXED_RANGE", startIndex, endIndex: Math.max(endIndex, startIndex + 1) }, fields: "spaceAbove" } });
  }
  return requests;
}

export function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return { red: parseInt(value.slice(0, 2), 16) / 255, green: parseInt(value.slice(2, 4), 16) / 255, blue: parseInt(value.slice(4, 6), 16) / 255 };
}

function createTextBox(element: Extract<PlanElement, { type: "text" }>, pageObjectId: string, objectId: string, scale = { x: 1, y: 1 }) {
  const box: Rect = {
    x: (element.rect.x + element.insetX - DEFAULT_INSET_X_PT) * scale.x, y: (element.rect.y + element.insetY - DEFAULT_INSET_Y_PT) * scale.y,
    w: (element.rect.w - (element.insetX - DEFAULT_INSET_X_PT) * 2) * scale.x, h: (element.rect.h - (element.insetY - DEFAULT_INSET_Y_PT) * 2) * scale.y,
  };
  return [
    { createShape: { objectId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId, size: { width: { magnitude: emu(box.w), unit: "EMU" }, height: { magnitude: emu(box.h), unit: "EMU" } }, transform: { scaleX: 1, scaleY: 1, translateX: emu(box.x), translateY: emu(box.y), unit: "EMU" } } } },
    { updateShapeProperties: { objectId, shapeProperties: { contentAlignment: element.anchor === "middle" ? "MIDDLE" : "TOP", autofit: { autofitType: "NONE" } }, fields: "contentAlignment,autofit.autofitType" } },
  ] as Array<Record<string, unknown>>;
}

function longDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function replaceTokens(menu: NormalizedMenu) {
  const replace = (token: string, value: string) => ({ replaceAllText: { containsText: { text: `{{${token}}}`, matchCase: true }, replaceText: value } });
  return [
    replace("MENU_TITLE", menu.title), replace("BOOKING_ID", menu.source.id), replace("SOURCE_ID", menu.source.id),
    replace("SITE_NAME", menu.siteLabel), replace("SERVICE_DATE", longDate(menu.serviceDate)), replace("SERVICE_TIME", menu.serviceTime || ""),
  ];
}

// ---------------------------------------------------------------- per format

export const MENU_CONTENT_OBJECT_ID = "fika-menu-content";

const mismatch = (message: string) => new MenuArtifactError("MENU_TEMPLATE_MISMATCH", message, 409);

function pageSizePt(presentation: SlidesPresentation) {
  return { w: (presentation.pageSize?.width?.magnitude || 0) / EMU_PER_PT, h: (presentation.pageSize?.height?.magnitude || 0) / EMU_PER_PT };
}

/** A visible `{{MENU_ITEMS}}` token wins; otherwise the layout master's slide is used. */
function tabletSlide(presentation: SlidesPresentation, master: TabletMaster) {
  for (const slide of presentation.slides || []) for (const element of slide.pageElements || []) {
    if (textOf(element).includes("{{MENU_ITEMS}}")) return { slide, tokenElementId: element.objectId };
  }
  const slide = presentation.slides?.[master.masterSlideIndex] || presentation.slides?.[0];
  return slide ? { slide, tokenElementId: undefined } : undefined;
}

function buildTabletRequests(menu: NormalizedMenu, plan: MenuLayoutPlan, master: TabletMaster, presentation: SlidesPresentation) {
  const page = pageSizePt(presentation);
  const target = tabletSlide(presentation, master);
  if (!target) throw new MenuArtifactError("MENU_TEMPLATE_EMPTY", "The configured menu template has no slides.", 409);
  // A deck whose page differs from the master (for example a differently sized site deck) is scaled proportionally, never refused.
  const scale = page.w && page.h ? { x: page.w / master.page.w, y: page.h / master.page.h } : { x: 1, y: 1 };
  const element = plan.pages[0].elements.find((candidate): candidate is Extract<PlanElement, { type: "text" }> => candidate.type === "text")!;
  const requests: Array<Record<string, unknown>> = [];
  if (target.tokenElementId) requests.push({ deleteObject: { objectId: target.tokenElementId } });
  requests.push(...createTextBox(element, target.slide.objectId, MENU_CONTENT_OBJECT_ID, scale), ...textRequests(MENU_CONTENT_OBJECT_ID, element.paragraphs, plan.fontFamily, element.lineHeight), ...replaceTokens(menu));
  return requests;
}

function buildLabelRequests(menu: NormalizedMenu, plan: MenuLayoutPlan, master: LabelMaster, presentation: SlidesPresentation) {
  const page = pageSizePt(presentation);
  if (Math.abs(page.w - master.page.w) > 2 || Math.abs(page.h - master.page.h) > 2) throw mismatch(`The label template page is ${page.w.toFixed(1)}x${page.h.toFixed(1)}pt but the ${master.key} layout needs ${master.page.w}x${master.page.h}pt. Use the MNK Label Template deck.`);
  const slides = presentation.slides || [];
  const masterSlide = slides[master.masterSlideIndex];
  if (!masterSlide) throw mismatch(`The label template has no slide ${master.masterSlideIndex + 1}; the ${master.key} layout expects the MNK Label Template (slide 1 tent, slide 2 flat).`);

  const flat = flattenSlideElements(masterSlide.pageElements);
  const leaves = flat.filter(element => !element.group);
  const cellRects = master.cells.map(cell => ({ x: cell.x, y: cell.y, w: master.card.w, h: master.card.h }));
  const membership = leaves.map(leaf => cellRects.findIndex(rect => within(centre(leaf.box), rect)));
  const perCell = cellRects.map((_, cell) => leaves.filter((_, index) => membership[index] === cell && !leaves[index].emptyTextBox));
  const thin = perCell.findIndex(found => found.length < master.chrome.length);
  if (thin >= 0) throw mismatch(`The label template does not match the ${master.key} layout: card ${thin + 1} has ${perCell[thin].length} of ${master.chrome.length} expected elements. Use the MNK Label Template deck.`);

  const requests: Array<Record<string, unknown>> = [];
  // Slides other than the layout master's are not part of this output.
  for (const [index, slide] of slides.entries()) if (index !== master.masterSlideIndex) requests.push({ deleteObject: { objectId: slide.objectId } });
  // Flatten groups so each card element can be kept or removed independently (outermost level first).
  const groupIds = flat.filter(element => element.group);
  for (const depth of [...new Set(groupIds.map(group => group.depth))].sort((a, b) => a - b)) requests.push({ ungroupObjects: { objectIds: groupIds.filter(group => group.depth === depth).map(group => group.objectId) } });

  const pageCount = plan.pages.length;
  const idFor = (pageIndex: number, leafIndex: number) => (pageIndex === 0 ? leaves[leafIndex].objectId : `fika-menu-p${pageIndex}-e${leafIndex}`);
  const slideIdFor = (pageIndex: number) => (pageIndex === 0 ? masterSlide.objectId : `fika-menu-slide-${pageIndex}`);
  for (let pageIndex = 1; pageIndex < pageCount; pageIndex += 1) {
    requests.push({ duplicateObject: { objectId: masterSlide.objectId, objectIds: { [masterSlide.objectId]: slideIdFor(pageIndex), ...Object.fromEntries(leaves.map((leaf, leafIndex) => [leaf.objectId, idFor(pageIndex, leafIndex)])) } } });
  }
  for (const layoutPage of plan.pages) {
    const used = new Set(layoutPage.elements.filter((element): element is Extract<PlanElement, { type: "text" }> => element.type === "text").map(element => element.slot));
    leaves.forEach((leaf, leafIndex) => {
      const cell = membership[leafIndex];
      const stray = leaf.emptyTextBox; // blank placeholder text boxes in the template are never kept
      if (stray || (cell >= 0 && !used.has(cell))) requests.push({ deleteObject: { objectId: idFor(layoutPage.index, leafIndex) } });
    });
    for (const element of layoutPage.elements) {
      if (element.type !== "text") continue;
      const objectId = `${element.id}`;
      requests.push(...createTextBox(element, slideIdFor(layoutPage.index), objectId), ...textRequests(objectId, element.paragraphs, plan.fontFamily, element.lineHeight));
    }
  }
  requests.push(...replaceTokens(menu));
  return requests;
}

/**
 * Slides requests for one menu in one output format. Throws (never clips,
 * truncates or omits allergens) when the menu cannot be laid out safely.
 */
export function buildMenuSlidesRequests(menu: NormalizedMenu, template: { format: MenuOutputFormat; branding: SiteBranding }, presentation: SlidesPresentation) {
  const plan = planMenuLayout(menu, template.format, template.branding);
  const master = resolveLayoutMaster(template.branding, template.format);
  return master.kind === "tablet" ? buildTabletRequests(menu, plan, master, presentation) : buildLabelRequests(menu, plan, master, presentation);
}
