import { menuAllergenLines, type MenuAllergenLineKind } from "./menu-allergens";
import { assertNormalizedMenu } from "./menu-validation";
import { MenuArtifactError, type MenuOutputFormat, type NormalizedMenu, type NormalizedMenuItem } from "./menu-types";

/**
 * Menu output formats: layout masters + site branding + layout planners.
 *
 *   NormalizedMenu + MenuOutputFormat + SiteBranding
 *     -> planMenuLayout()  (pure, deterministic, unit-tested; no Google types)
 *     -> MenuLayoutPlan    (pages of positioned elements, all units in points)
 *     -> menu-slides.ts    (Google Slides requests) / menu-preview.ts (offline HTML)
 *
 * Geometry lives in LAYOUT_MASTERS and branding in SITE_BRANDING, so a second site
 * with the same physical layout adds a branding row and (if it has its own Drive
 * master deck) env keys, not new layout code.
 *
 * ---------------------------------------------------------------------------
 * Where the numbers come from (all points; 1pt = 12 700 EMU)
 * ---------------------------------------------------------------------------
 * "MNK Tablet Template" (Google Slides 1A3xn63K..., read via the Slides SVG export,
 * cross-checked against the generated 2026-08-25-12-00-FIKA-MNK.pptx):
 *   page 6 300 200 x 10 076 675 EMU = 496.08 x 793.44pt, portrait.
 *   header image 0,0 496.9x139.9; accent rule y=139.9 h=3.8 (#49A5B5);
 *   footer bar y=748 h=45.7 (#0F4C6A); MNK mark 32.8,63.4 88.8x29.3;
 *   "MENU" 34pt Montserrat white in 272.6,42.3 188.9x71.4;
 *   footer Fika wordmark 22.7,762.4 42.9x18.3, tagline 343.3,763.8 136.8x14.0.
 *   The template has no content box; the generated deck's text box 35.4,155.9
 *   425.2x568.3 (the deck used Montserrat 15pt bold #0F4D6B items, 10pt red allergens; dishes are now 13pt with larger section titles) is the
 *   proven content region and is kept.
 *
 * "MNK Label Template.pptx" (page 9 720 250 x 6 858 000 EMU = 765.37 x 540pt, landscape):
 *   slide 1 = TENT cards, 4 cols x 3 rows = 12/page. Each card is 168.1 x 153.0:
 *     an upright front face (white, 0.72pt #45C1B6 outline, navy bar at the bottom)
 *     below a navy (#134D6B) rear face carrying the MNK mark rotated 180 deg, so
 *     the card folds on the seam between the two faces.
 *   slide 2 = FLAT labels, 4 cols x 6 rows = 24/page, each 168.1 x 76.5: the same
 *     front face on its own, no rear face, no rotation.
 *   Both: bar = bottom 18.5pt (#134D6B) with the MNK mark bottom-left (28.0x9.3 at
 *   +5.5,+5.4 in the bar) and the white Fika mark bottom-right (17.7x7.6).
 *   Text placement/typography come from the Hospitality hot-lunch label deck that
 *   uses the same cards: centred Montserrat bold 9pt #134D6B dish names with
 *   7.65pt side / 3.8pt top-bottom insets, over the white face.
 *   Group transforms were composed (chOff/chExt scale 0.625) to get absolute origins;
 *   rows are not on a perfectly regular pitch in the source, so origins are listed
 *   as extracted rather than computed.
 */

export type Rect = { x: number; y: number; w: number; h: number };
type ColorRole = "primary" | "panel" | "accent" | "rule" | "text" | "allergen" | "surface" | "onPrimary";
type AssetRole = "header-bg" | "brand-mark" | "house-mark" | "tagline";

export type ChromeShape =
  | { kind: "rect"; rect: Rect; fill: ColorRole; stroke?: { color: ColorRole; width: number } }
  | { kind: "image"; role: AssetRole; rect: Rect; rotation?: number }
  | { kind: "text"; text: string; rect: Rect; fontPt: number; color: ColorRole; align: "left" | "center" | "right"; bold?: boolean };

export type TabletType = { itemMax: number; itemMin: number; allergenMax: number; allergenMin: number; lineHeight: number };
export type LabelType = { nameMax: number; nameMin: number; allergenMax: number; allergenMin: number; lineHeight: number };

export type TabletMaster = {
  kind: "tablet"; key: string; version: number;
  page: { w: number; h: number };
  chrome: ChromeShape[];
  content: Rect; padding: number; type: TabletType;
  /** A tablet menu is one page; a menu that cannot fit fails with MENU_OVERFLOW. */
  pagination: "single";
  masterSlideIndex: number;
};

export type LabelMaster = {
  kind: "flat-label" | "tent-label"; key: string; version: number;
  page: { w: number; h: number };
  /** Size of one whole card (flat: the face; tent: rear + front faces). */
  card: { w: number; h: number };
  /** Absolute card origins, row-major, as extracted from the reference. */
  cells: Array<{ x: number; y: number }>;
  /** Card-local chrome, drawn by the Drive master deck. */
  chrome: ChromeShape[];
  /** Card-local rectangle of the front face's printable text area (above the bar). */
  face: Rect; insetX: number; insetY: number;
  type: LabelType;
  masterSlideIndex: number;
};

export type LayoutMaster = TabletMaster | LabelMaster;

const PT_PER_EMU = 1 / 12_700;
const TABLET_PAGE = { w: +(6_300_200 * PT_PER_EMU).toFixed(2), h: +(10_076_675 * PT_PER_EMU).toFixed(2) };
const LABEL_PAGE = { w: +(9_720_250 * PT_PER_EMU).toFixed(2), h: +(6_858_000 * PT_PER_EMU).toFixed(2) };
const CARD = { w: 168.1, h: 76.5 };
/** Montserrat's natural line height as Slides applies it at 100% line spacing. */
export const NATURAL_LINE_HEIGHT = 1.22;

const LABEL_BAR = 18.5;
const frontFaceChrome = (y: number): ChromeShape[] => [
  { kind: "rect", rect: { x: 0, y, w: CARD.w, h: CARD.h }, fill: "surface", stroke: { color: "accent", width: 0.72 } },
  { kind: "rect", rect: { x: 0, y: y + CARD.h - LABEL_BAR, w: CARD.w, h: LABEL_BAR }, fill: "panel" },
  { kind: "image", role: "brand-mark", rect: { x: 5.5, y: y + 63.4, w: 28, h: 9.3 } },
  { kind: "image", role: "house-mark", rect: { x: 144.3, y: y + 63.4, w: 17.7, h: 7.6 } },
];

const grid = (xs: number[][], ys: number[]) => ys.flatMap((y, row) => xs[row].map(x => ({ x, y })));

const MNK_TABLET_V1: TabletMaster = {
  kind: "tablet", key: "mnk-tablet", version: 1, page: TABLET_PAGE, masterSlideIndex: 0,
  chrome: [
    { kind: "image", role: "header-bg", rect: { x: 0, y: 0, w: 496.9, h: 139.9 } },
    { kind: "rect", rect: { x: 0, y: 139.9, w: 496.08, h: 3.8 }, fill: "rule" },
    { kind: "rect", rect: { x: 0, y: 748, w: 496.08, h: 45.7 }, fill: "primary" },
    { kind: "image", role: "brand-mark", rect: { x: 32.8, y: 63.4, w: 88.8, h: 29.3 } },
    { kind: "text", text: "MENU", rect: { x: 272.6, y: 42.3, w: 188.9, h: 71.4 }, fontPt: 34, color: "onPrimary", align: "right", bold: true },
    { kind: "image", role: "house-mark", rect: { x: 22.7, y: 762.4, w: 42.9, h: 18.3 } },
    { kind: "image", role: "tagline", rect: { x: 343.3, y: 763.8, w: 136.8, h: 14 } },
  ],
  content: { x: 35.4, y: 155.9, w: 425.2, h: 568.3 }, padding: 14,
  type: { itemMax: 13, itemMin: 10, allergenMax: 10, allergenMin: 8, lineHeight: NATURAL_LINE_HEIGHT },
  pagination: "single",
};

/** Angel Court keeps its proven inset panel (brown rail on the left); no reference deck was supplied, so no chrome is modelled. */
const ANGEL_COURT_TABLET_V1: TabletMaster = {
  ...MNK_TABLET_V1, key: "angel-court-tablet", chrome: [],
  content: { x: 137.8, y: 133.9, w: 330.7, h: 588.6 },
  type: { ...MNK_TABLET_V1.type, allergenMax: 11 },
};

const flatCells = grid(Array.from({ length: 6 }, () => [26.5, 205.8, 385.1, 567.9]), [7.9, 97.0, 186.0, 275.1, 364.2, 453.2]);
const tentCells = grid([[27.2, 206.4, 385.7, 568.6], [28.7, 208.0, 387.3, 570.1], [29.0, 208.3, 387.6, 570.4]], [21.4, 189.8, 361.4]);
/** Labels run tighter than Slides' natural single spacing (90%) so a long dish name and both allergen lines fit the 58pt face. */
const LABEL_TYPE: LabelType = { nameMax: 10, nameMin: 8, allergenMax: 8, allergenMin: 7, lineHeight: 1.1 };

const MNK_FLAT_LABEL_V1: LabelMaster = {
  kind: "flat-label", key: "mnk-flat-label", version: 1, page: LABEL_PAGE, masterSlideIndex: 1,
  card: { w: CARD.w, h: CARD.h }, cells: flatCells, chrome: frontFaceChrome(0),
  face: { x: 0, y: 0, w: CARD.w, h: CARD.h - LABEL_BAR }, insetX: 7.65, insetY: 3.8, type: LABEL_TYPE,
};

const MNK_TENT_LABEL_V1: LabelMaster = {
  kind: "tent-label", key: "mnk-tent-label", version: 1, page: LABEL_PAGE, masterSlideIndex: 0,
  card: { w: CARD.w, h: CARD.h * 2 }, cells: tentCells,
  chrome: [
    { kind: "rect", rect: { x: 0, y: 0, w: CARD.w, h: CARD.h }, fill: "panel" },
    { kind: "image", role: "brand-mark", rect: { x: 48.9, y: 25.9, w: 70.3, h: 23.3 }, rotation: 180 },
    ...frontFaceChrome(CARD.h),
  ],
  face: { x: 0, y: CARD.h, w: CARD.w, h: CARD.h - LABEL_BAR }, insetX: 7.65, insetY: 3.8, type: LABEL_TYPE,
};

export const LAYOUT_MASTERS: Record<string, LayoutMaster> = {
  [`${MNK_TABLET_V1.key}-v1`]: MNK_TABLET_V1,
  [`${ANGEL_COURT_TABLET_V1.key}-v1`]: ANGEL_COURT_TABLET_V1,
  [`${MNK_FLAT_LABEL_V1.key}-v1`]: MNK_FLAT_LABEL_V1,
  [`${MNK_TENT_LABEL_V1.key}-v1`]: MNK_TENT_LABEL_V1,
};

// ---------------------------------------------------------------- branding

export type SiteBranding = {
  siteKey: string; siteLabel: string; oplocIds: string[];
  fontFamily: string;
  /** Hex colours by role. Structural layout never contains a colour. */
  colors: Record<ColorRole, string>;
  /** Logical assets the Drive master deck carries; generation never fetches a site or logo URL. */
  assets: Partial<Record<AssetRole, string>>;
  tagline?: string;
  /** Per format: which layout master the site uses and which env keys name its Drive master deck. */
  formats: Partial<Record<MenuOutputFormat, { master: string; envKeys: string[] }>>;
};

const MNK_LABEL_ENV = ["GOOGLE_MENU_LABEL_TEMPLATE_ID_MNK"];

export const SITE_BRANDING: SiteBranding[] = [
  {
    siteKey: "mnk", siteLabel: "MNK", oplocIds: ["oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f"],
    fontFamily: "Montserrat",
    // primary/rule/text are the tablet deck's #0F4C6A/#49A5B5/#0F4D6B; panel/accent are the label deck's #134D6B/#45C1B6.
    colors: { primary: "#0F4C6A", panel: "#134D6B", accent: "#45C1B6", rule: "#49A5B5", text: "#0F4D6B", allergen: "#FF0000", surface: "#FFFFFF", onPrimary: "#FFFFFF" },
    assets: { "header-bg": "mnk-tablet-header", "brand-mark": "mnk-group-logo-white", "house-mark": "fika-logo-white", tagline: "fika-tagline-white" },
    tagline: "A fresh force for good",
    formats: {
      tablet: { master: "mnk-tablet-v1", envKeys: ["GOOGLE_MENU_TEMPLATE_ID_MNK", "GOOGLE_MENU_TEMPLATE_ID"] },
      "flat-label": { master: "mnk-flat-label-v1", envKeys: MNK_LABEL_ENV },
      "tent-label": { master: "mnk-tent-label-v1", envKeys: MNK_LABEL_ENV },
    },
  },
  {
    siteKey: "angel-court", siteLabel: "One Angel Court", oplocIds: ["oploc:24a93500-d75d-4fe0-8beb-672d36f9da10"],
    fontFamily: "Montserrat",
    colors: { primary: "#8A4D21", panel: "#8A4D21", accent: "#8A4D21", rule: "#8A4D21", text: "#8A4D21", allergen: "#FF0000", surface: "#FFFFFF", onPrimary: "#FFFFFF" },
    assets: {},
    formats: { tablet: { master: "angel-court-tablet-v1", envKeys: ["GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT"] } },
  },
];

export function siteBrandingFor(siteKey: string) { return SITE_BRANDING.find(site => site.siteKey === siteKey); }

// ---------------------------------------------------------------- plan model

export type PlanParagraph = {
  text: string;
  role: "item" | "section" | "name" | "allergen";
  allergenKind?: MenuAllergenLineKind;
  fontPt: number; bold: boolean; italic?: boolean; color: string;
  spaceBeforePt: number;
};

export type PlanElement =
  | { type: "rect"; layer: "master"; rect: Rect; fill: string; stroke?: { color: string; width: number } }
  | { type: "image"; layer: "master"; asset: string; role: AssetRole; rect: Rect; rotation: number }
  | { type: "static-text"; layer: "master"; text: string; rect: Rect; fontPt: number; color: string; align: "left" | "center" | "right"; bold: boolean }
  | { type: "text"; layer: "content"; id: string; slot: number; rect: Rect; insetX: number; insetY: number; anchor: "top" | "middle"; align: "center"; lineHeight: number; paragraphs: PlanParagraph[]; itemId?: string };

export type MenuLayoutPage = { index: number; elements: PlanElement[] };

export type MenuLayoutPlan = {
  format: MenuOutputFormat;
  masterKey: string;
  fontFamily: string;
  page: { w: number; h: number };
  pages: MenuLayoutPage[];
  /** Cards per page (labels) or 1 (tablet). */
  capacityPerPage: number;
  itemCount: number;
  /** Tablet only: true when text shrank below the template size. */
  fontScaled: boolean;
};

// ---------------------------------------------------------------- text fitting

function charWidthEm(char: string) {
  if (char === " ") return 0.3;
  if (/[A-Z]/.test(char)) return 0.78;
  if (/[a-z]/.test(char)) return 0.62;
  if (/[0-9]/.test(char)) return 0.68;
  return 0.42;
}

/**
 * Conservative greedy word-wrap using Montserrat-like advance widths. Bold is
 * wider. Used for fit decisions; the offline preview re-measures in a real browser.
 */
export function estimateLines(text: string, fontPt: number, widthPt: number, bold = false) {
  if (!text) return 1;
  const em = (word: string) => [...word].reduce((sum, char) => sum + charWidthEm(char), 0) * (bold ? 1.07 : 1) * fontPt;
  let lines = 1; let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const width = em(word);
    const spaced = used ? width + em(" ") : width;
    if (used && used + spaced > widthPt) { lines += 1; used = 0; }
    if (width > widthPt) { lines += Math.floor(width / widthPt); used = width % widthPt; continue; }
    used += used ? spaced : width;
  }
  return lines;
}

export function paragraphHeight(paragraph: PlanParagraph, widthPt: number, lineHeight: number) {
  return estimateLines(paragraph.text, paragraph.fontPt, widthPt, paragraph.bold) * paragraph.fontPt * lineHeight + paragraph.spaceBeforePt;
}

const allergenStyle = (color: string) => ({
  bold: false, color,
});

const flattenItems = (menu: NormalizedMenu) => menu.sections.flatMap(section => section.items);

// ---------------------------------------------------------------- planning

export function resolveLayoutMaster(branding: SiteBranding, format: MenuOutputFormat): LayoutMaster {
  const entry = branding.formats[format];
  const master = entry && LAYOUT_MASTERS[entry.master];
  if (!entry || !master) throw new MenuArtifactError("MENU_FORMAT_UNSUPPORTED", `${branding.siteLabel} does not support the "${format}" menu format. Supported: ${Object.keys(branding.formats).join(", ")}.`, 422);
  return master;
}

export function layoutTemplateKey(branding: SiteBranding, format: MenuOutputFormat) {
  const master = resolveLayoutMaster(branding, format);
  return `${master.key}-v${master.version}`;
}

function chromeElements(chrome: ChromeShape[], origin: { x: number; y: number }, branding: SiteBranding): PlanElement[] {
  return chrome.map((shape): PlanElement => {
    const rect = (r: Rect): Rect => ({ x: +(origin.x + r.x).toFixed(2), y: +(origin.y + r.y).toFixed(2), w: r.w, h: r.h });
    if (shape.kind === "rect") return { type: "rect", layer: "master", rect: rect(shape.rect), fill: branding.colors[shape.fill], ...(shape.stroke ? { stroke: { color: branding.colors[shape.stroke.color], width: shape.stroke.width } } : {}) };
    if (shape.kind === "image") return { type: "image", layer: "master", asset: branding.assets[shape.role] || shape.role, role: shape.role, rect: rect(shape.rect), rotation: shape.rotation || 0 };
    return { type: "static-text", layer: "master", text: shape.text, rect: rect(shape.rect), fontPt: shape.fontPt, color: branding.colors[shape.color], align: shape.align, bold: Boolean(shape.bold) };
  });
}

const TABLET_SECTION_ORDER: Record<string, number> = { hot_mains: 0, sides_extras: 1, salads: 2 };

function planTablet(menu: NormalizedMenu, branding: SiteBranding, master: TabletMaster): MenuLayoutPlan {
  const { type, content, padding } = master;
  const widthPt = content.w - padding * 2;
  const heightPt = content.h - padding * 2;
  // Tablet reading order: mains, sides, then salads. Other section keys keep their order after these (stable sort).
  const sections = menu.sections.filter(section => section.items.length)
    .map((section, index) => ({ section, index }))
    .sort((a, b) => (TABLET_SECTION_ORDER[a.section.key] ?? 99) - (TABLET_SECTION_ORDER[b.section.key] ?? 99) || a.index - b.index)
    .map(entry => entry.section);
  const labelled = sections.length > 1 && sections.every(section => section.label);
  const colors = branding.colors;
  const build = (itemPt: number) => {
    const allergenPt = Math.max(type.allergenMin, Math.round(itemPt * (type.allergenMax / type.itemMax) * 2) / 2);
    // Section headings read as titles: clearly larger than the dishes beneath them.
    const sectionPt = Math.max(allergenPt + 1, Math.round(itemPt * 1.55 * 2) / 2);
    const paragraphs: PlanParagraph[] = [];
    sections.forEach((section, sectionIndex) => {
      if (labelled) paragraphs.push({ text: section.label!.toLocaleUpperCase("en-GB"), role: "section", fontPt: sectionPt, bold: true, color: colors.text, spaceBeforePt: sectionIndex ? itemPt * 1.6 : 0 });
      section.items.forEach((item, index) => {
        paragraphs.push({ text: item.name.trim(), role: "item", fontPt: itemPt, bold: true, color: colors.text, spaceBeforePt: !paragraphs.length ? 0 : labelled && index === 0 ? itemPt * 0.5 : itemPt });
        for (const line of menuAllergenLines(item)) paragraphs.push({ text: line.text, role: "allergen", allergenKind: line.kind, fontPt: allergenPt, ...allergenStyle(colors.allergen), spaceBeforePt: 0 });
      });
    });
    const total = paragraphs.reduce((sum, paragraph) => sum + paragraphHeight(paragraph, widthPt, type.lineHeight), 0);
    return { paragraphs, total };
  };
  let itemPt = type.itemMax; let fit = build(itemPt);
  while (fit.total > heightPt && itemPt > type.itemMin) { itemPt -= 0.5; fit = build(itemPt); }
  if (fit.total > heightPt) throw new MenuArtifactError("MENU_OVERFLOW", `This menu has too many or too long items to fit the tablet layout at a readable size (minimum ${type.itemMin}pt dishes, ${type.allergenMin}pt allergens). Shorten the menu, use flat labels, or split it across two service times.`, 422);
  const element: PlanElement = { type: "text", layer: "content", id: "fika-menu-content", slot: 0, rect: content, insetX: padding, insetY: padding, anchor: "middle", align: "center", lineHeight: type.lineHeight, paragraphs: fit.paragraphs };
  return {
    format: "tablet", masterKey: `${master.key}-v${master.version}`, fontFamily: branding.fontFamily, page: master.page,
    pages: [{ index: 0, elements: [...chromeElements(master.chrome, { x: 0, y: 0 }, branding), element] }],
    capacityPerPage: 1, itemCount: flattenItems(menu).length, fontScaled: itemPt !== type.itemMax,
  };
}

/** Fits one dish on one label face. Dish name stays dominant; allergens never go below `allergenMin` or get dropped. */
export function fitLabelFace(item: NormalizedMenuItem, branding: SiteBranding, master: LabelMaster): PlanParagraph[] {
  const { type } = master;
  const widthPt = master.face.w - master.insetX * 2;
  const heightPt = master.face.h - master.insetY * 2;
  const lines = menuAllergenLines(item);
  const name = item.name.trim();
  const build = (namePt: number, allergenPt: number) => {
    const paragraphs: PlanParagraph[] = [{ text: name, role: "name", fontPt: namePt, bold: true, color: branding.colors.panel, spaceBeforePt: 0 }];
    for (const line of lines) paragraphs.push({ text: line.text, role: "allergen", allergenKind: line.kind, fontPt: allergenPt, ...allergenStyle(branding.colors.allergen), spaceBeforePt: paragraphs.length === 1 ? 2 : 0 });
    return paragraphs;
  };
  const height = (paragraphs: PlanParagraph[]) => paragraphs.reduce((sum, paragraph) => sum + paragraphHeight(paragraph, widthPt, type.lineHeight), 0);
  for (let namePt = type.nameMax; namePt >= type.nameMin; namePt -= 0.5) {
    // The allergen size follows the name down but stays within its own band.
    const allergenPt = Math.max(type.allergenMin, Math.min(type.allergenMax, Math.round(namePt * 0.6 * 2) / 2));
    const paragraphs = build(namePt, allergenPt);
    if (height(paragraphs) <= heightPt) return paragraphs;
  }
  const smallest = build(type.nameMin, type.allergenMin);
  if (height(smallest) <= heightPt) return smallest;
  throw new MenuArtifactError("MENU_LABEL_OVERFLOW", `"${name}" and its allergens do not fit one label at a safe size (dish ${type.nameMin}pt, allergens ${type.allergenMin}pt). Shorten the dish name; allergens are never truncated or dropped.`, 422);
}

function planLabels(menu: NormalizedMenu, branding: SiteBranding, master: LabelMaster, format: MenuOutputFormat): MenuLayoutPlan {
  const items = flattenItems(menu);
  const capacity = master.cells.length;
  const pages: MenuLayoutPage[] = [];
  items.forEach((item, index) => {
    const pageIndex = Math.floor(index / capacity); const slot = index % capacity;
    const origin = master.cells[slot];
    const page = pages[pageIndex] || (pages[pageIndex] = { index: pageIndex, elements: [] });
    page.elements.push(...chromeElements(master.chrome, origin, branding));
    page.elements.push({
      type: "text", layer: "content", id: `fika-menu-p${pageIndex}-s${slot}`, slot, itemId: item.id,
      rect: { x: +(origin.x + master.face.x).toFixed(2), y: +(origin.y + master.face.y).toFixed(2), w: master.face.w, h: master.face.h },
      insetX: master.insetX, insetY: master.insetY, anchor: "middle", align: "center", lineHeight: master.type.lineHeight, paragraphs: fitLabelFace(item, branding, master),
    });
  });
  return { format, masterKey: `${master.key}-v${master.version}`, fontFamily: branding.fontFamily, page: master.page, pages, capacityPerPage: capacity, itemCount: items.length, fontScaled: false };
}

export function planMenuLayout(menu: NormalizedMenu, format: MenuOutputFormat, branding: SiteBranding = siteBrandingFor(menu.siteKey) as SiteBranding): MenuLayoutPlan {
  assertNormalizedMenu(menu);
  if (!branding) throw new MenuArtifactError("MENU_TEMPLATE_SITE_UNSUPPORTED", `No menu branding is defined for site "${menu.siteKey}".`, 422);
  const master = resolveLayoutMaster(branding, format);
  if (master.kind === "tablet") return planTablet(menu, branding, master);
  return planLabels(menu, branding, master, format);
}
