import assert from "node:assert/strict";
import test from "node:test";
import {
  LAYOUT_MASTERS, MenuArtifactError, SITE_BRANDING, menuFormatsForSite, siteBrandingFor, allergensFromStates, buildMenuSlidesRequests, flattenSlideElements, menuAllergenLabel, menuAllergenLines, menuArtifactFileName,
  ensureGeneratedMenusFolder, menuOwnerEnvKey, menuParentEnvKey, resolveMenuDestination, menuWeekCommencing, menuWeekFolderName, menuArtifactId, menuArtifactKey, menuArtifactSourceKey, planMenuLayout, publishMenuArtifact, resolveMenuTemplate,
  type LabelMaster, type MenuOutputFormat, type NormalizedMenu, type NormalizedMenuItem, type PlanElement, type SiteBranding, type SlidesPresentation,
} from "../src/menu-artifact";
import { renderMenuPlanHtml } from "../src/menu-preview";

const MNK_OPLOC = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";
const EMU = 12_700;
const portrait = { width: 6_300_200, height: 10_076_675 }; // the proven MNK tablet deck page
const landscape = { width: 9_720_250, height: 6_858_000 }; // the MNK Label Template page
const mnkEnv = { GOOGLE_MENU_TEMPLATE_ID_MNK: "tpl-mnk", GOOGLE_MENU_LABEL_TEMPLATE_ID_MNK: "tpl-mnk-labels" };
/** Dishes with an empty allergen list in these fixtures are positively clear (`noKeyAllergens`). Raw objects are used where "unknown" matters. */
const item = (id: string, name: string, contains: string[] = [], mayContain: string[] = []): NormalizedMenuItem => ({ id, name, contains, mayContain, ...(contains.length || mayContain.length ? {} : { noKeyAllergens: true }) });

// The reference deck 2026-08-25-12-00-FIKA-MNK.pptx, as normalized input.
function deckMenu(over: Partial<NormalizedMenu> = {}, workflow: "hospitality" | "delivered-in" = "hospitality"): NormalizedMenu {
  return {
    siteKey: "mnk", siteLabel: "MNK", oplocId: MNK_OPLOC, serviceDate: "2026-08-25", serviceTime: "12:00", title: "MENU",
    sections: [{ key: "menu", items: [
      item("1", "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", ["gluten", "eggs", "mustard", "sulphites"]),
      item("2", "Vegan Feta, Pesto, Vegan Mayo, Salad", ["tree_nuts", "gluten", "soya"]),
      item("3", "Caesar Salad", ["gluten", "fish", "eggs", "milk", "mustard"]),
      item("4", "Test Salad 1"),
      item("5", "Test Salad 2", ["peanuts", "gluten", "soya"], ["milk"]),
    ] }],
    source: { workflow, id: "booking:mnk:deck", version: 3, clientName: "FIKA" },
    ...over,
  };
}
const manyDishes = (count: number, over: Partial<NormalizedMenu> = {}) => deckMenu({ sections: [{ key: "menu", items: Array.from({ length: count }, (_, index) => item(`d${index}`, `Dish ${index + 1}`, index % 2 ? ["gluten"] : [], index % 3 === 0 ? ["milk"] : [])) }], ...over });
const template = (format: MenuOutputFormat = "tablet") => resolveMenuTemplate({ siteKey: "mnk", format }, mnkEnv);
const textElements = (plan: ReturnType<typeof planMenuLayout>) => plan.pages.flatMap(page => page.elements).filter((element): element is Extract<PlanElement, { type: "text" }> => element.type === "text");

// -------- a Slides-API shaped MNK Label Template deck, built from the extracted geometry (cards inside row groups) --------
type El = Record<string, any>;
function labelDeck(): SlidesPresentation {
  const dim = (pt: number) => ({ magnitude: Math.round(pt * EMU), unit: "EMU" });
  const leaf = (id: string, rect: { x: number; y: number; w: number; h: number }, rotation = 0, extra: El = {}): El => ({
    objectId: id, size: { width: dim(rect.w), height: dim(rect.h) },
    transform: rotation ? { scaleX: -1, scaleY: -1, translateX: Math.round((rect.x + rect.w) * EMU), translateY: Math.round((rect.y + rect.h) * EMU), unit: "EMU" } : { scaleX: 1, scaleY: 1, translateX: Math.round(rect.x * EMU), translateY: Math.round(rect.y * EMU), unit: "EMU" },
    ...extra,
  });
  const slideFor = (master: LabelMaster, slideId: string): El => {
    const cards = master.cells.map((cell, index) => ({ // a card is a group at its origin; row groups wrap the cards of one row (nested)
      cell, group: { objectId: `${slideId}-card${index}`, size: { width: dim(master.card.w), height: dim(master.card.h) }, transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: "EMU" },
        elementGroup: { children: master.chrome.map((shape, shapeIndex) => leaf(`${slideId}-c${index}-${shapeIndex}`, { x: cell.x + shape.rect.x, y: cell.y + shape.rect.y, w: shape.rect.w, h: shape.rect.h }, shape.kind === "image" ? shape.rotation || 0 : 0)) } },
    }));
    const rows: El[] = [];
    for (let start = 0; start < cards.length; start += 4) rows.push({ objectId: `${slideId}-row${start / 4}`, size: { width: dim(700), height: dim(80) }, transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: "EMU" }, elementGroup: { children: cards.slice(start, start + 4).map(card => card.group) } });
    const lastCell = master.cells[master.cells.length - 1];
    const stray = leaf(`${slideId}-blank`, { x: lastCell.x, y: lastCell.y + master.face.y, w: 160, h: 50 }, 0, { shape: { shapeType: "TEXT_BOX", text: { textElements: [{ textRun: { content: "\n" } }] } } });
    return { objectId: slideId, pageElements: [...rows, stray] };
  };
  return { pageSize: { width: { magnitude: landscape.width }, height: { magnitude: landscape.height } }, slides: [slideFor(LAYOUT_MASTERS["mnk-tent-label-v1"] as LabelMaster, "tent-slide"), slideFor(LAYOUT_MASTERS["mnk-flat-label-v1"] as LabelMaster, "flat-slide")] };
}
const tabletDeck: SlidesPresentation = { pageSize: { width: { magnitude: portrait.width }, height: { magnitude: portrait.height } }, slides: [{ objectId: "slide-1", pageElements: [] }] };
const requestsOf = (menu: NormalizedMenu, format: MenuOutputFormat, deck = format === "tablet" ? tabletDeck : labelDeck()) => buildMenuSlidesRequests(menu, { format, branding: siteBrandingFor("mnk")! }, deck) as Array<Record<string, any>>;
const lastIndexOf = (requests: Array<Record<string, any>>, key: string) => requests.map(request => Boolean(request[key])).lastIndexOf(true);

// ------------------------------------------------------------------ allergens

test("allergens: bracketed contains only, may-contain is not displayed, labels are human readable, unrecorded is never clear", () => {
  assert.equal(menuAllergenLabel("tree_nuts"), "Tree Nuts");
  assert.deepEqual(menuAllergenLines(item("a", "Granola", ["gluten", "milk"], ["tree_nuts"])).map(line => line.text), ["(Gluten, Milk)"], "may-contain is not shown");
  assert.deepEqual(menuAllergenLines(item("b", "Granola", ["tree_nuts"])).map(line => line.text), ["(Tree Nuts)"], "machine keys are humanised");
  assert.deepEqual(menuAllergenLines(item("c", "Fruit", [], ["tree_nuts"])), [], "a may-contain-only dish shows nothing");
  assert.deepEqual(menuAllergenLines(item("d", "Fruit Pot")), [], "a dish with no key allergens shows nothing - no text, no red");
  const states = allergensFromStates({ gluten: "contains", milk: "may_contain", fish: "unrecorded", eggs: "clear", no_key_allergens: "contains" });
  assert.deepEqual(states, { contains: ["gluten"], mayContain: ["milk"], unrecorded: ["fish"], noKeyAllergens: false });
});

test("allergen safety: unrecorded or unestablished allergens are refused in every format, and 'no key allergens' needs positive evidence", () => {
  assert.equal(allergensFromStates({ gluten: "clear", milk: "clear" }).noKeyAllergens, true);
  assert.equal(allergensFromStates({ no_key_allergens: "contains" }).noKeyAllergens, true, "the workflows' explicit marker");
  assert.equal(allergensFromStates({ gluten: "clear", milk: "unrecorded" }).noKeyAllergens, false);
  assert.equal(allergensFromStates({ gluten: "clear", milk: "mystery" }).noKeyAllergens, false, "unknown states are not clear");
  assert.equal(allergensFromStates({ gluten: "contains" }).noKeyAllergens, false);
  assert.equal(allergensFromStates({}).noKeyAllergens, false);
  const unrecorded = deckMenu({ sections: [{ key: "menu", items: [{ id: "x", name: "Mystery Wrap", contains: [], mayContain: [], unrecorded: ["gluten"] }] }] });
  const unknown = deckMenu({ sections: [{ key: "menu", items: [{ id: "y", name: "Blank Wrap", contains: [], mayContain: [] }] }] });
  for (const format of ["tablet", "flat-label", "tent-label"] as const) {
    assert.throws(() => planMenuLayout(unrecorded, format), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ALLERGENS_UNRECORDED" && error.status === 409);
    assert.throws(() => planMenuLayout(unknown, format), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ALLERGENS_NOT_ESTABLISHED", `${format}: empty is unknown, not clear`);
  }
  // Even a dish that also declares an allergen is refused if part of its state is unrecorded.
  assert.throws(() => menuAllergenLines({ id: "z", name: "Z", contains: ["milk"], mayContain: [], unrecorded: ["eggs"] }), /unrecorded/);
});

// ------------------------------------------------------------------ identity

test("identity: existing file name convention, deterministic keys, format- and revision-sensitive artifact key", () => {
  const menu = deckMenu();
  assert.equal(menuArtifactFileName(menu), "2026-08-25-12-00-FIKA-MNK", "the tablet file name is unchanged");
  const key = (value: NormalizedMenu, format: MenuOutputFormat) => menuArtifactKey(value, template(format).key, format);
  assert.equal(key(menu, "tablet"), key(deckMenu(), "tablet"), "a retry has the same key");
  assert.notEqual(key(deckMenu({ source: { ...menu.source, version: 4 } }), "tablet"), key(menu, "tablet"), "an amendment is a distinct artifact");
  assert.equal(menuArtifactSourceKey(deckMenu({ source: { ...menu.source, version: 4 } })), menuArtifactSourceKey(menu), "but it belongs to the same source");
  assert.notEqual(menuArtifactSourceKey(deckMenu({ serviceTime: "13:00" })), menuArtifactSourceKey(menu));
});

test("identity: a tablet artifact and a flat/tent label artifact for the same menu never collide", () => {
  const menu = deckMenu();
  const formats: MenuOutputFormat[] = ["tablet", "flat-label"];
  const unique = (values: string[]) => assert.equal(new Set(values).size, values.length, values.join(" | "));
  unique(formats.map(format => menuArtifactKey(menu, template(format).key, format)));
  unique(formats.map(format => menuArtifactSourceKey(menu, format)));
  unique(formats.map(format => menuArtifactId(menu, template(format).key, format)));
  unique(formats.map(format => menuArtifactFileName(menu, format)));
  assert.equal(menuArtifactFileName(menu, "flat-label"), "2026-08-25-12-00-FIKA-MNK-flat-labels");
  assert.equal(menuArtifactFileName(deckMenu({ fileName: "Governed Name" }), "tent-label"), "Governed Name-tent-labels");
  assert.match(menuArtifactId(menu, template("flat-label").key, "flat-label"), /:flat-label:v3:/);
  // The layout template version is part of identity too.
  assert.notEqual(menuArtifactKey(menu, "mnk-flat-label-v1", "flat-label"), menuArtifactKey(menu, "mnk-flat-label-v2", "flat-label"));
});

test("template resolution is site and format based and fails safely", () => {
  assert.equal(resolveMenuTemplate({ siteKey: "mnk" }, mnkEnv).templateId, "tpl-mnk");
  assert.equal(resolveMenuTemplate({ siteKey: "mnk" }, mnkEnv).key, "mnk-tablet-v1");
  assert.equal(resolveMenuTemplate({ oplocId: MNK_OPLOC }, mnkEnv).siteKey, "mnk");
  assert.equal(resolveMenuTemplate({ siteKey: "mnk" }, { GOOGLE_MENU_TEMPLATE_ID: "legacy-tpl" }).templateId, "legacy-tpl", "legacy MNK env name still works");
  assert.equal(resolveMenuTemplate({ siteKey: "mnk", templateIdOverride: "https://docs.google.com/presentation/d/override-tpl/edit" }, mnkEnv).templateId, "override-tpl");
  assert.equal(resolveMenuTemplate({ siteKey: "mnk", format: "flat-label", templateIdOverride: "override-tpl" }, mnkEnv).templateId, "tpl-mnk-labels", "a tablet override is never used as a label master");
  assert.deepEqual(menuFormatsForSite("mnk"), ["tablet", "flat-label"], "tent labels are not offered until a real tent layout is approved");
  assert.deepEqual(menuFormatsForSite("angel-court"), ["tablet"]);
  assert.deepEqual(menuFormatsForSite("unknown"), []);
  assert.throws(() => template("tent-label"), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_FORMAT_UNSUPPORTED" && /does not offer/.test(error.message));
  assert.equal(LAYOUT_MASTERS[resolveMenuTemplate({ siteKey: "angel-court" }, { GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT: "tpl-ac" }).key].kind, "tablet");
  assert.throws(() => resolveMenuTemplate({ siteKey: "mnk" }, {}), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_NOT_CONFIGURED" && error.status === 409 && /GOOGLE_MENU_TEMPLATE_ID_MNK/.test(error.message));
  assert.throws(() => resolveMenuTemplate({ siteKey: "mnk", format: "flat-label" }, { GOOGLE_MENU_TEMPLATE_ID_MNK: "tpl-mnk" }), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_NOT_CONFIGURED" && /GOOGLE_MENU_LABEL_TEMPLATE_ID_MNK/.test(error.message));
  assert.throws(() => resolveMenuTemplate({ siteKey: "angel-court", format: "flat-label" }, { GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT: "tpl-ac" }), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_FORMAT_UNSUPPORTED");
  assert.throws(() => resolveMenuTemplate({ siteKey: "mnk", format: "poster" as MenuOutputFormat }, mnkEnv), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_FORMAT_INVALID");
  assert.throws(() => resolveMenuTemplate({ siteKey: "haleon" }, mnkEnv), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_SITE_UNSUPPORTED");
  assert.throws(() => resolveMenuTemplate({ oplocId: "oploc:unknown" }, mnkEnv), /No menu template is defined/);
});

// ------------------------------------------------------------------ tablet

test("tablet: a realistic MNK menu keeps the template structure and reproduces the reference text with separate allergen lines", () => {
  const plan = planMenuLayout(deckMenu(), "tablet");
  assert.equal(plan.pages.length, 1);
  assert.deepEqual(plan.page, { w: 496.08, h: 793.44 });
  const [content] = textElements(plan);
  assert.deepEqual(content.paragraphs.map(paragraph => paragraph.text), [
    "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", "(Gluten, Eggs, Mustard, Sulphites)",
    "Vegan Feta, Pesto, Vegan Mayo, Salad", "(Tree Nuts, Gluten, Soya)",
    "Caesar Salad", "(Gluten, Fish, Eggs, Milk, Mustard)",
    "Test Salad 1",
    "Test Salad 2", "(Peanuts, Gluten, Soya)",
  ]);
  assert.deepEqual(content.rect, { x: 35.4, y: 155.9, w: 425.2, h: 568.3 });
  assert.ok(content.paragraphs.filter(paragraph => paragraph.role === "item").every(paragraph => paragraph.fontPt === 13 && !paragraph.bold && paragraph.color === "#0F4D6B"), "tablet dish titles are regular weight");
  const sectioned = textElements(planMenuLayout(deckMenu({ sections: [{ key: "salads", label: "Salads", items: [item("a", "Mixed Leaf Salad", ["mustard"])] }, { key: "hot_mains", label: "Hot mains", items: [item("b", "Roast Chicken", ["gluten"])] }] }), "tablet"))[0].paragraphs;
  assert.ok(sectioned.filter(paragraph => paragraph.role === "section").every(paragraph => paragraph.bold), "section titles stay bold");
  assert.ok(content.paragraphs.filter(paragraph => paragraph.role === "allergen").every(paragraph => paragraph.fontPt >= 8));
  assert.equal(plan.fontScaled, false);
  const chrome = plan.pages[0].elements.filter(element => element.layer === "master");
  assert.ok(chrome.some(element => element.type === "rect" && element.rect.y === 748 && element.fill === "#0F4C6A"), "footer bar");
  assert.ok(chrome.some(element => element.type === "image" && element.role === "header-bg" && element.rect.h === 139.9), "header");
  assert.ok(chrome.some(element => element.type === "static-text" && element.text === "MENU" && element.fontPt === 34));
});

test("tablet slides requests: one text box in the content region, typography per paragraph, nothing hard-coded to object ids", () => {
  const requests = requestsOf(deckMenu(), "tablet");
  const shapes = requests.filter(request => request.createShape);
  assert.equal(shapes.length, 1);
  const transform = shapes[0].createShape.elementProperties.transform;
  assert.ok(Math.abs(transform.translateX - (35.4 + 14 - 7.2) * EMU) <= 1); // content + padding, less Slides' own 7.2pt inset
  assert.ok(Math.abs(shapes[0].createShape.elementProperties.size.width.magnitude / EMU - (425.2 - 2 * (14 - 7.2))) < 0.01);
  const text: string = requests.find(request => request.insertText)!.insertText.text;
  assert.match(text, /Caesar Salad\n\(Gluten, Fish, Eggs, Milk, Mustard\)\nTest Salad 1\nTest Salad 2\n\(Peanuts, Gluten, Soya\)$/);
  const styles = requests.filter(request => request.updateTextStyle?.textRange.type === "FIXED_RANGE").map(request => request.updateTextStyle);
  const red = styles.filter(entry => entry.style.foregroundColor.opaqueColor.rgbColor.red === 1);
  assert.equal(red.length, 4, "only the four dishes that contain allergens have red text");
  for (const entry of red) assert.match(text.slice(entry.textRange.startIndex, entry.textRange.endIndex), /^\(.*\)$/, "each red range is exactly one bracketed allergen line");
  assert.ok(requests.some(request => request.replaceAllText?.containsText.text === "{{MENU_TITLE}}" && request.replaceAllText.replaceText === "MENU"));
  assert.deepEqual(requests.find(request => request.updateShapeProperties)!.updateShapeProperties.shapeProperties.autofit, { autofitType: "NONE" });
});

test("a visible {{MENU_ITEMS}} token is replaced instead of left on the slide", () => {
  const withToken: SlidesPresentation = { ...tabletDeck, slides: [{ objectId: "s", pageElements: [{ objectId: "tok", shape: { text: { textElements: [{ textRun: { content: "{{MENU_ITEMS}}" } }] } } }] }] };
  assert.deepEqual(requestsOf(deckMenu(), "tablet", withToken)[0], { deleteObject: { objectId: "tok" } });
});

test("rendering does not depend on the source workflow", () => {
  const strip = (requests: Array<Record<string, any>>) => requests.filter(request => !request.replaceAllText);
  const deliveredIn = deckMenu({ source: { workflow: "delivered-in", id: "publication-day:mnk:2026-08-25", version: 9 } }, "delivered-in");
  for (const format of ["tablet", "flat-label", "tent-label"] as const) assert.deepEqual(strip(requestsOf(deckMenu({}, "hospitality"), format)), strip(requestsOf(deliveredIn, format)));
});

test("tablet: sections render as labelled groups; long menus shrink within readable minimums; impossible menus fail instead of clipping", () => {
  const sectioned = deckMenu({ sections: [
    { key: "salads", label: "Salads", items: [item("a", "Mixed Leaf Salad", ["mustard"])] },
    { key: "hot_mains", label: "Hot mains", items: [item("b", "Roast Chicken", ["gluten"], ["milk"])] },
  ] });
  const paragraphs = textElements(planMenuLayout(sectioned, "tablet"))[0].paragraphs.map(paragraph => `${paragraph.role}:${paragraph.text}`);
  // Input order is salads then mains; the tablet reads mains, sides, then salads.
  assert.deepEqual(paragraphs, ["section:HOT MAINS", "item:Roast Chicken", "allergen:(Gluten)", "section:SALADS", "item:Mixed Leaf Salad", "allergen:(Mustard)"]);
  const three = deckMenu({ sections: [
    { key: "salads", label: "Salads", items: [item("a", "Mixed Leaf Salad", ["mustard"])] },
    { key: "sides_extras", label: "Sides & extras", items: [item("c", "Roasted Potatoes", ["sulphites"])] },
    { key: "hot_mains", label: "Hot mains", items: [item("b", "Roast Chicken", ["gluten"])] },
  ] });
  assert.deepEqual(textElements(planMenuLayout(three, "tablet"))[0].paragraphs.filter(paragraph => paragraph.role === "section").map(paragraph => paragraph.text), ["HOT MAINS", "SIDES & EXTRAS", "SALADS"]);
  assert.deepEqual(textElements(planMenuLayout(three, "flat-label")).map(label => label.paragraphs[0].text), ["Mixed Leaf Salad", "Roasted Potatoes", "Roast Chicken"], "labels keep the source order");

  const longNames = deckMenu({ sections: [{ key: "menu", items: Array.from({ length: 14 }, (_, index) => item(String(index), `Long dish name number ${index + 1} with sauce`, ["gluten", "milk"])) }] });
  const shrunk = planMenuLayout(longNames, "tablet");
  const sizes = textElements(shrunk)[0].paragraphs;
  assert.ok(shrunk.fontScaled, "14 long dishes need the text to shrink");
  assert.ok(sizes.every(paragraph => paragraph.fontPt >= (paragraph.role === "allergen" ? 8 : 10)), "never below 10pt dishes / 8pt allergens");
  assert.throws(() => planMenuLayout(manyDishes(120), "tablet"), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_OVERFLOW" && /flat labels/.test(error.message));
});

test("an empty or unnamed menu is rejected rather than generating a blank artifact", () => {
  assert.throws(() => planMenuLayout(deckMenu({ sections: [{ key: "menu", items: [] }] }), "tablet"), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_EMPTY");
  assert.throws(() => planMenuLayout(deckMenu({ sections: [{ key: "menu", items: [item("x", "  ")] }] }), "flat-label"), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ITEM_NAME_REQUIRED");
});

// ------------------------------------------------------------------ labels

test("flat labels: one dish per label at the extracted card origins, dish name dominant, allergens visible", () => {
  const plan = planMenuLayout(deckMenu(), "flat-label");
  assert.equal(plan.pages.length, 1); assert.equal(plan.capacityPerPage, 24);
  assert.deepEqual(plan.page, { w: 765.37, h: 540 });
  const labels = textElements(plan);
  assert.equal(labels.length, 5, "one label per dish");
  const flat = LAYOUT_MASTERS["mnk-flat-label-v1"] as LabelMaster;
  labels.forEach((label, index) => { assert.equal(label.rect.x, flat.cells[index].x); assert.equal(label.rect.y, flat.cells[index].y); assert.equal(label.rect.w, 168.1); });
  const [bbq, , , clear, both] = labels;
  assert.deepEqual(bbq.paragraphs.map(paragraph => paragraph.text), ["BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", "(Gluten, Eggs, Mustard, Sulphites)"]);
  assert.deepEqual(both.paragraphs.map(paragraph => paragraph.text), ["Test Salad 2", "(Peanuts, Gluten, Soya)"]);
  assert.deepEqual(clear.paragraphs.map(paragraph => paragraph.text), ["Test Salad 1"]);
  for (const label of labels) {
    const [name, ...allergens] = label.paragraphs;
    assert.ok(name.fontPt >= 8 && name.fontPt <= 10 && name.bold, `${name.text} ${name.fontPt}`);
    assert.equal(allergens.length, label.itemId === "4" ? 0 : 1, "dishes with allergens show one bracketed line; clear dishes show none");
    assert.ok(allergens.every(paragraph => paragraph.fontPt >= 7 && paragraph.fontPt <= name.fontPt), "allergen text keeps its 7pt safety floor");
  }
  // Short names stay at the maximum; only long names shrink.
  assert.equal(clear.paragraphs[0].fontPt, 10); assert.equal(both.paragraphs[0].fontPt, 10);
  const long = textElements(planMenuLayout(deckMenu({ sections: [{ key: "menu", items: [item("l", "Slow Roasted Sweet Potato, Charred Corn, Roasted Pepper, Baby Spinach & Toasted Seeds", ["milk"])] }] }), "flat-label"))[0];
  assert.ok(long.paragraphs[0].fontPt < 10 && long.paragraphs[0].fontPt >= 8, "a long name shrinks only as far as needed");
  // The label's chrome (card panel, bar, marks) travels with each label; flat labels have no rear face.
  const chrome = plan.pages[0].elements.filter(element => element.layer === "master");
  assert.equal(chrome.length, 5 * flat.chrome.length);
  assert.ok(!chrome.some(element => element.type === "image" && element.rotation === 180));
});

test("tent labels: the front face carries the dish, the rear face carries the rotated brand mark", () => {
  const plan = planMenuLayout(deckMenu(), "tent-label");
  assert.equal(plan.capacityPerPage, 12);
  const tent = LAYOUT_MASTERS["mnk-tent-label-v1"] as LabelMaster;
  assert.deepEqual(tent.card, { w: 168.1, h: 153 });
  const first = textElements(plan)[0];
  assert.equal(first.rect.y, tent.cells[0].y + 76.5, "dish text sits on the lower (front) face");
  const rotated = plan.pages[0].elements.filter(element => element.type === "image" && element.rotation === 180);
  assert.equal(rotated.length, 5, "one upside-down mark per card");
});

test("labels page automatically: more dishes than a sheet holds create additional pages", () => {
  assert.equal(planMenuLayout(manyDishes(24), "flat-label").pages.length, 1);
  const flat = planMenuLayout(manyDishes(25), "flat-label");
  assert.equal(flat.pages.length, 2);
  assert.deepEqual(flat.pages.map(page => page.elements.filter(element => element.type === "text").length), [24, 1]);
  assert.equal(planMenuLayout(manyDishes(13), "tent-label").pages.length, 2);
  const big = planMenuLayout(manyDishes(100), "flat-label");
  assert.equal(big.pages.length, 5); assert.equal(textElements(big).length, 100);
  assert.equal(new Set(textElements(big).map(element => element.id)).size, 100, "label ids are unique across pages");
  assert.equal(textElements(big)[24].rect.x, (LAYOUT_MASTERS["mnk-flat-label-v1"] as LabelMaster).cells[0].x, "page two restarts at the first cell");
});

test("label overflow fails safely: allergens are never truncated or dropped", () => {
  const long = deckMenu({ sections: [{ key: "menu", items: [item("l", "An extraordinarily long dish name ".repeat(8), ["gluten", "milk", "eggs", "tree_nuts", "peanuts"], ["fish", "soya", "mustard"])] }] });
  for (const format of ["flat-label", "tent-label"] as const) assert.throws(() => planMenuLayout(long, format), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_LABEL_OVERFLOW" && /never truncated/.test(error.message));
  const heavy = deckMenu({ sections: [{ key: "menu", items: [item("h", "Roasted Sweet Potato, Charred Corn, Roasted Pepper & Baby Spinach", ["gluten", "milk", "eggs", "soya"], ["tree_nuts", "peanuts"])] }] });
  const [label] = textElements(planMenuLayout(heavy, "flat-label"));
  assert.match(label.paragraphs.map(paragraph => paragraph.text).join("\n"), /\(Gluten, Milk, Eggs, Soya\)$/, "every contained allergen appears in full");
});

test("flat-label slides requests: slides are pruned, nested groups flattened, pages duplicated and unused cards removed", () => {
  const requests = requestsOf(manyDishes(30), "flat-label");
  assert.deepEqual(requests[0], { deleteObject: { objectId: "tent-slide" } }, "the tent slide is not part of a flat-label deck");
  const ungroups = requests.filter(request => request.ungroupObjects).map(request => request.ungroupObjects.objectIds as string[]);
  assert.equal(ungroups.length, 2, "two nesting levels");
  assert.ok(ungroups[0].every(id => id.includes("-row")) && ungroups[1].every(id => id.includes("-card")), "rows first, then cards");
  assert.ok(lastIndexOf(requests, "ungroupObjects") < requests.findIndex(request => request.duplicateObject), "ungroup before duplicate so every element has a stable id on every page");
  assert.equal(requests.filter(request => request.duplicateObject).length, 1, "30 dishes need two pages");
  const duplicate = requests.find(request => request.duplicateObject)!.duplicateObject;
  assert.equal(duplicate.objectIds["flat-slide"], "fika-menu-slide-1");
  assert.equal(Object.keys(duplicate.objectIds).length, 1 + 24 * 4 + 1, "slide + every card element + the blank placeholder");
  // Page two keeps 6 cards: 18 unused cards x 4 elements are removed there, plus the blank placeholder on both pages.
  const deletes = requests.filter(request => request.deleteObject).map(request => request.deleteObject.objectId as string);
  assert.equal(deletes.filter(id => id.startsWith("fika-menu-p1-")).length, 18 * 4 + 1);
  assert.equal(deletes.filter(id => id.startsWith("flat-slide-")).length, 1, "page one uses every card; only the blank placeholder goes");
  assert.equal(requests.filter(request => request.createShape).length, 30);
  assert.equal(requests.filter(request => request.createShape?.elementProperties.pageObjectId === "fika-menu-slide-1").length, 6);
  assert.equal(new Set(requests.filter(request => request.createShape).map(request => request.createShape.objectId)).size, 30);
  const first = requests.find(request => request.createShape)!.createShape;
  const flat = LAYOUT_MASTERS["mnk-flat-label-v1"] as LabelMaster;
  assert.equal(first.elementProperties.transform.translateX, Math.round((flat.cells[0].x + 7.65 - 7.2) * EMU));
  assert.equal(first.elementProperties.transform.translateY, Math.round((flat.cells[0].y + 3.8 - 3.6) * EMU));
});

test("tent-label slides requests use the tent slide and its rotated cards", () => {
  const requests = requestsOf(manyDishes(5), "tent-label");
  assert.deepEqual(requests[0], { deleteObject: { objectId: "flat-slide" } });
  assert.equal(requests.filter(request => request.duplicateObject).length, 0);
  const deletes = requests.filter(request => request.deleteObject).map(request => request.deleteObject.objectId as string);
  assert.equal(deletes.filter(id => id.startsWith("tent-slide-c")).length, 7 * 6, "the 7 unused cards lose all six elements");
  const first = requests.find(request => request.createShape)!.createShape;
  assert.equal(first.elementProperties.transform.translateY, Math.round(((LAYOUT_MASTERS["mnk-tent-label-v1"] as LabelMaster).cells[0].y + 76.5 + 3.8 - 3.6) * EMU), "text is placed on the front face");
});

test("group transforms are composed (including 180 degree rotation) to find cards on the master", () => {
  const deck = labelDeck();
  const tentBoxes = flattenSlideElements(deck.slides![0].pageElements);
  const rotated = tentBoxes.find(box => box.objectId === "tent-slide-c0-1")!;
  assert.deepEqual([rotated.box.x, rotated.box.y, rotated.box.w, rotated.box.h].map(value => Math.round(value * 10) / 10), [27.2 + 48.9, 21.4 + 25.9, 70.3, 23.3]);
  assert.equal(flattenSlideElements(deck.slides![1].pageElements).filter(box => !box.group).length, 24 * 4 + 1);
  // A shifted group (translate) moves its children.
  const moved = flattenSlideElements([{ objectId: "g", size: { width: { magnitude: 100 * EMU }, height: { magnitude: 50 * EMU } }, transform: { translateX: 10 * EMU, translateY: 20 * EMU, unit: "EMU" }, elementGroup: { children: [{ objectId: "k", size: { width: { magnitude: 40 * EMU }, height: { magnitude: 10 * EMU } }, transform: { translateX: 5 * EMU, translateY: 5 * EMU, unit: "EMU" } }] } }]);
  assert.deepEqual(moved.find(box => box.objectId === "k")!.box, { x: 15, y: 25, w: 40, h: 10 });
});

test("a label request against the wrong master deck fails safely instead of producing a misaligned sheet", () => {
  assert.throws(() => requestsOf(deckMenu(), "flat-label", tabletDeck), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_MISMATCH", "tablet deck page size");
  const damaged = labelDeck(); damaged.slides![1].pageElements = damaged.slides![1].pageElements!.slice(1);
  assert.throws(() => requestsOf(deckMenu(), "flat-label", damaged), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_MISMATCH" && /card 1/.test(error.message));
  const oneSlide = labelDeck(); oneSlide.slides = oneSlide.slides!.slice(0, 1);
  assert.throws(() => requestsOf(deckMenu(), "flat-label", oneSlide), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_MISMATCH");
});

// ------------------------------------------------------------------ branding vs geometry

test("site branding is data, separate from layout geometry", () => {
  assert.ok(!/#[0-9a-f]{6}/i.test(JSON.stringify(LAYOUT_MASTERS)), "layout masters contain no colours");
  assert.ok(!/"(x|y|w|h)"/.test(JSON.stringify(SITE_BRANDING)), "branding contains no geometry");
  const mnk = SITE_BRANDING.find(site => site.siteKey === "mnk")!;
  const rebranded: SiteBranding = { ...mnk, siteKey: "other", colors: { ...mnk.colors, panel: "#222222", text: "#333333", allergen: "#AA0000" }, fontFamily: "Lato" };
  for (const format of ["tablet", "flat-label", "tent-label"] as const) {
    const base = planMenuLayout(deckMenu(), format, mnk); const other = planMenuLayout(deckMenu(), format, rebranded);
    const rects = (plan: typeof base) => plan.pages.flatMap(page => page.elements.map(element => ("rect" in element ? element.rect : undefined)));
    assert.deepEqual(rects(other), rects(base), `${format}: identical geometry`);
    assert.notEqual(JSON.stringify(other), JSON.stringify(base), `${format}: different branding`);
    assert.equal(other.fontFamily, "Lato");
  }
  const label = textElements(planMenuLayout(deckMenu(), "flat-label", rebranded))[0].paragraphs;
  assert.equal(label[0].color, "#222222"); assert.equal(label[1].color, "#AA0000");
  const html = renderMenuPlanHtml(planMenuLayout(deckMenu(), "flat-label"), { title: "t", assets: { "fika-logo-white": "x.png" } });
  assert.match(html, /\(Gluten/); assert.match(html, /missing asset mnk-group-logo-white/);
});

// ----------------------------------------------------------------- stateful fake Drive/Slides

type FakeFile = { id: string; name: string; parents: string[]; appProperties: Record<string, string>; trashed: boolean };
function fakeGoogle() {
  const files: FakeFile[] = []; const batches: Array<{ id: string; requests: Array<Record<string, any>> }> = []; let copies = 0; const copiedFrom: string[] = [];
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET"; const parsed = new URL(url);
    if (parsed.hostname === "slides.googleapis.com") {
      const id = decodeURIComponent(parsed.pathname.split("/")[3].replace(":batchUpdate", ""));
      if (parsed.pathname.endsWith(":batchUpdate")) { batches.push({ id, requests: JSON.parse(String(init!.body)).requests }); return reply({}); }
      const file = files.find(candidate => candidate.id === id)!;
      return reply(file.appProperties.fikaMenuFormat === "tablet" || !file.appProperties.fikaMenuFormat ? tabletDeck : labelDeck());
    }
    if (method === "GET") {
      const q = parsed.searchParams.get("q") || ""; const match = q.match(/key='(\w+)' and value='(\w+)'/)!;
      return reply({ files: files.filter(file => !file.trashed && file.appProperties[match[1]] === match[2]).map(file => ({ id: file.id, appProperties: file.appProperties, webViewLink: `https://drive/${file.id}` })) });
    }
    if (method === "POST" && parsed.pathname.endsWith("/copy")) {
      copies += 1; const body = JSON.parse(String(init!.body)); copiedFrom.push(decodeURIComponent(parsed.pathname.split("/")[4]));
      const file = { id: `file-${copies}`, name: body.name, parents: body.parents, appProperties: body.appProperties || {}, trashed: false };
      files.push(file); return reply({ id: file.id, webViewLink: `https://drive/${file.id}` });
    }
    if (method === "PATCH") {
      const file = files.find(candidate => candidate.id === decodeURIComponent(parsed.pathname.split("/").pop()!))!; const body = JSON.parse(String(init!.body));
      if (body.appProperties) file.appProperties = { ...file.appProperties, ...body.appProperties };
      if (body.trashed) file.trashed = true; return reply({ id: file.id });
    }
    return reply({ error: "unexpected" }, 500);
  };
  return { files, batches, copiedFrom, fetchImpl, get copies() { return copies; } };
}
const publishWith = (google: ReturnType<typeof fakeGoogle>, menu: NormalizedMenu, format: MenuOutputFormat = "tablet", folderId = "folder-1") =>
  publishMenuArtifact({ menu, template: template(format), folderId, headers: { Authorization: "Bearer t" }, fetch: google.fetchImpl });

test("publication is idempotent per revision and format: retries reuse the artifact and never duplicate files", async () => {
  const google = fakeGoogle();
  for (const format of ["tablet", "flat-label"] as const) {
    const before = google.copies;
    const first = await publishWith(google, deckMenu(), format);
    assert.equal(first.reused, false); assert.equal(google.copies, before + 1); assert.equal(first.format, format);
    assert.equal(first.fileName, menuArtifactFileName(deckMenu(), format));
    const retry = await publishWith(google, deckMenu(), format);
    assert.equal(retry.reused, true); assert.equal(retry.fileId, first.fileId); assert.equal(retry.artifactKey, first.artifactKey);
    assert.equal(google.copies, before + 1, `${format}: no second copy`);
  }
  assert.equal(google.batches.length, 2, "one Slides write per format, none on retry");
  assert.equal(google.files.filter(file => !file.trashed).length, 2, "tablet and flat files coexist");
  assert.deepEqual(google.copiedFrom, ["tpl-mnk", "tpl-mnk-labels"]);
  assert.deepEqual(google.files.map(file => file.appProperties.fikaMenuFormat), ["tablet", "flat-label"]);
});

test("an amendment creates a newer artifact and retires only the earlier revision of the same format", async () => {
  const google = fakeGoogle();
  const at = (version: number) => deckMenu({ source: { workflow: "hospitality", id: "booking:mnk:deck", version, clientName: "FIKA" } });
  const tablet = await publishWith(google, at(3), "tablet");
  const labels3 = await publishWith(google, at(3), "flat-label");
  const labels4 = await publishWith(google, at(4), "flat-label");
  assert.notEqual(labels4.fileId, labels3.fileId);
  assert.deepEqual(labels4.retiredFileIds, [labels3.fileId]);
  assert.deepEqual(google.files.filter(file => !file.trashed).map(file => file.id).sort(), [tablet.fileId, labels4.fileId].sort(), "the tablet menu is not retired by a label amendment");
  const tablet4 = await publishWith(google, at(4), "tablet");
  assert.deepEqual(tablet4.retiredFileIds, [tablet.fileId]);
  const retry = await publishWith(google, at(4), "flat-label");
  assert.equal(retry.reused, true); assert.deepEqual(retry.retiredFileIds, []);
  assert.equal(google.copies, 4);
});

test("a different site or date is never retired by another menu's amendment", async () => {
  const google = fakeGoogle();
  await publishWith(google, deckMenu(), "flat-label", "f");
  await publishWith(google, deckMenu({ serviceDate: "2026-08-26" }), "flat-label", "f");
  assert.equal(google.files.filter(file => !file.trashed).length, 2);
});

test("a menu that cannot be laid out fails before any Drive file is created", async () => {
  const google = fakeGoogle();
  await assert.rejects(publishWith(google, manyDishes(120), "tablet"), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_OVERFLOW");
  await assert.rejects(publishWith(google, deckMenu({ sections: [{ key: "m", items: [{ id: "u", name: "Mystery", contains: [], mayContain: [], unrecorded: ["milk"] }] }] }), "flat-label"), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ALLERGENS_UNRECORDED");
  assert.equal(google.copies, 0); assert.equal(google.files.length, 0);
});

test("a half-finished artifact (copied but not materialised) is completed, not duplicated", async () => {
  const google = fakeGoogle(); const menu = deckMenu();
  const key = menuArtifactKey(menu, template().key, "tablet");
  google.files.push({ id: "file-pre", name: "x", parents: ["folder-1"], appProperties: { fikaMenuArtifactKey: key, fikaMenuSourceKey: menuArtifactSourceKey(menu, "tablet") }, trashed: false });
  const result = await publishWith(google, menu);
  assert.equal(result.fileId, "file-pre"); assert.equal(result.reused, false); assert.equal(google.copies, 0); assert.equal(google.batches.length, 1);
  assert.equal(google.files[0].appProperties.fikaMenuMaterialised, "ready");
});

test("publishing reports the page count so callers know how many label sheets were generated", async () => {
  const google = fakeGoogle();
  assert.equal((await publishWith(google, manyDishes(30), "flat-label")).pageCount, 2);
  assert.equal((await publishWith(google, deckMenu(), "tablet")).pageCount, 1);
});

// ------------------------------------------------------------------ Drive filing: Generated Menus / WC_<Monday>

function fakeFolders() {
  const folders: Array<{ id: string; name: string; parent: string }> = []; const created: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (!init?.method) {
      if (!new URL(url).searchParams.get("q")) return reply({ mimeType: "application/vnd.google-apps.folder" }); // parent folder check
      const q = new URL(url).searchParams.get("q")!; const parent = q.match(/'([^']+)' in parents/)![1]; const name = q.match(/name = '([^']+)'/)![1];
      return reply({ files: folders.filter(folder => folder.parent === parent && folder.name === name).map(folder => ({ id: folder.id })) });
    }
    const body = JSON.parse(String(init.body)); const id = `folder-${folders.length + 1}`;
    folders.push({ id, name: body.name, parent: body.parents[0] }); created.push(body.name); return reply({ id });
  };
  return { folders, created, fetchImpl };
}

test("week commencing is the Monday of the service week", () => {
  assert.equal(menuWeekCommencing("2026-08-24"), "2026-08-24", "a Monday is its own week commencing");
  assert.equal(menuWeekCommencing("2026-08-25"), "2026-08-24");
  assert.equal(menuWeekCommencing("2026-08-30"), "2026-08-24", "Sunday belongs to the week that began the previous Monday");
  assert.equal(menuWeekCommencing("2026-09-01"), "2026-08-31", "crosses a month boundary");
  assert.equal(menuWeekCommencing("2026-01-01"), "2025-12-29", "crosses a year boundary");
  assert.equal(menuWeekFolderName("2026-08-26"), "WC_2026-08-24");
  assert.throws(() => menuWeekCommencing("25/08/2026"), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_DATE_INVALID");
});

test("generated menus are filed in 'Generated Menus' / 'WC_<Monday>' and folders are never duplicated", async () => {
  const drive = fakeFolders();
  const filing = (serviceDate: string, parentId = "root") => ensureGeneratedMenusFolder({ parentId, serviceDate, headers: { Authorization: "Bearer t" }, fetch: drive.fetchImpl });
  const first = await filing("2026-08-26");
  assert.equal(first.weekFolderName, "WC_2026-08-24");
  assert.deepEqual(drive.created, ["Generated Menus", "WC_2026-08-24"]);
  assert.deepEqual(drive.folders.map(folder => `${folder.parent}>${folder.name}`), ["root>Generated Menus", "folder-1>WC_2026-08-24"]);
  assert.equal((await filing("2026-08-28")).folderId, first.folderId, "same week -> same folder");
  assert.equal(drive.created.length, 2, "nothing is re-created");
  const nextWeek = await filing("2026-08-31");
  assert.notEqual(nextWeek.folderId, first.folderId);
  assert.equal(nextWeek.generatedMenusFolderId, first.generatedMenusFolderId, "weeks share one Generated Menus folder");
  assert.deepEqual(drive.created, ["Generated Menus", "WC_2026-08-24", "WC_2026-08-31"]);
  const elsewhere = await filing("2026-08-26", "configured-folder");
  assert.equal(drive.folders.find(folder => folder.id === elsewhere.generatedMenusFolderId)!.parent, "configured-folder", "a configured parent gets its own Generated Menus folder");
});

// ------------------------------------------------------------------ OPLOC-scoped Drive destination

const MNK = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";
const ANGEL = "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10";
const MNK_ROOT_KEY = "GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F";
function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) { saved[key] = process.env[key]; if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; }
  try { return run(); } finally { for (const key of Object.keys(saved)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}
const hostedEnv = { NODE_ENV: "production", FIKA_RUNTIME_MODE: "staging", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "{}" };
const failure = (code: string, pattern: RegExp) => (error: unknown) => error instanceof MenuArtifactError && error.code === code && error.status === 409 && pattern.test(error.message);

test("drive destination: each OPLOC resolves its own explicit owner and menu parent (DWD impersonates that owner)", () => {
  assert.equal(menuOwnerEnvKey(MNK), "GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F");
  assert.equal(menuParentEnvKey(MNK), "GOOGLE_MENU_PARENT_FOLDER_ID_OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F");
  const config = { ...hostedEnv, [menuOwnerEnvKey(MNK)]: "mnk@fikacatering.com", [menuParentEnvKey(MNK)]: "https://drive.google.com/drive/folders/mnk-parent-1", [menuOwnerEnvKey(ANGEL)]: "angel@fikacatering.com", [menuParentEnvKey(ANGEL)]: "angel-parent-9" };
  withEnv(config, () => {
    const mnk = resolveMenuDestination({ oplocId: MNK }); const angel = resolveMenuDestination({ oplocId: ANGEL });
    assert.deepEqual([mnk.owner.workspaceEmail, mnk.parentFolderId, mnk.owner.authMode, mnk.parentSource], ["mnk@fikacatering.com", "mnk-parent-1", "dwd", "oploc-menu-parent"], "a pasted folder URL is reduced to its id");
    assert.deepEqual([angel.owner.workspaceEmail, angel.parentFolderId], ["angel@fikacatering.com", "angel-parent-9"]);
    assert.notEqual(mnk.owner.workspaceEmail, angel.owner.workspaceEmail, "owners are per site");
    assert.equal(resolveMenuDestination({ oplocId: MNK, parentFolderIdOverride: "site-setting-folder" }).parentFolderId, "site-setting-folder", "a site-scoped dashboard setting wins for that site only");
    assert.equal(resolveMenuDestination({ oplocId: ANGEL }).parentFolderId, "angel-parent-9");
  });
});

test("drive destination: nothing is guessed - no app-wide owner/folder, no My Drive root, no auto-created parent path", () => {
  const globals = { GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID: "global-output", GOOGLE_MENU_OUTPUT_FOLDER_ID: "global-menu", GOOGLE_DRIVE_ROOT_FOLDER_ID_APP_DELIVERED_IN: "global-root", GOOGLE_DRIVE_OWNER_EMAIL_APP_DELIVERED_IN: "delivered-in@fikacatering.com" };
  // Owner missing in hosted mode -> names the exact key.
  withEnv({ ...hostedEnv, ...globals, [menuOwnerEnvKey(MNK)]: undefined, [menuParentEnvKey(MNK)]: "p" }, () => assert.throws(() => resolveMenuDestination({ oplocId: MNK }), failure("MENU_DRIVE_OWNER_NOT_CONFIGURED", /GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_66E621FA/)));
  // Owner must be an email.
  withEnv({ ...hostedEnv, [menuOwnerEnvKey(MNK)]: "not-an-email", [menuParentEnvKey(MNK)]: "p" }, () => assert.throws(() => resolveMenuDestination({ oplocId: MNK }), failure("MENU_DRIVE_OWNER_INVALID", /email/)));
  // Parent missing: the app-wide values above never stand in for it, hosted or local.
  for (const mode of [hostedEnv, { NODE_ENV: "development", FIKA_RUNTIME_MODE: "local" }]) {
    withEnv({ ...mode, ...globals, [menuOwnerEnvKey(MNK)]: "mnk@fikacatering.com", [menuParentEnvKey(MNK)]: undefined, [MNK_ROOT_KEY]: undefined }, () =>
      assert.throws(() => resolveMenuDestination({ oplocId: MNK }), failure("MENU_PARENT_FOLDER_NOT_CONFIGURED", /GOOGLE_MENU_PARENT_FOLDER_ID_OPLOC_66E621FA/)));
  }
  // One site's configuration never serves another.
  withEnv({ ...hostedEnv, [menuOwnerEnvKey(MNK)]: "mnk@fikacatering.com", [menuParentEnvKey(MNK)]: "mnk-parent", [menuOwnerEnvKey(ANGEL)]: "angel@fikacatering.com", [menuParentEnvKey(ANGEL)]: undefined }, () =>
    assert.throws(() => resolveMenuDestination({ oplocId: ANGEL }), failure("MENU_PARENT_FOLDER_NOT_CONFIGURED", /OPLOC_24A93500/)));
  // The OPLOC's own Drive root is an accepted explicit parent when no menu parent is set.
  withEnv({ ...hostedEnv, [menuOwnerEnvKey(MNK)]: "mnk@fikacatering.com", [menuParentEnvKey(MNK)]: undefined, [MNK_ROOT_KEY]: "mnk-root" }, () => {
    const destination = resolveMenuDestination({ oplocId: MNK }); assert.deepEqual([destination.parentFolderId, destination.parentSource], ["mnk-root", "oploc-drive-root"]);
  });
  // A destination needs a canonical OPLOC.
  for (const oplocId of [undefined, "", "mnk", "oploc:not-a-uuid"]) assert.throws(() => resolveMenuDestination({ oplocId }), failure("MENU_DESTINATION_OPLOC_REQUIRED", /OPLOC/));
});

test("filing verifies the explicit parent folder before creating anything beneath it", async () => {
  const reply = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(ensureGeneratedMenusFolder({ parentId: "not-a-folder", serviceDate: "2026-08-26", headers: {}, fetch: reply({ mimeType: "application/vnd.google-apps.document" }) }), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_PARENT_FOLDER_INACCESSIBLE");
  await assert.rejects(ensureGeneratedMenusFolder({ parentId: "gone", serviceDate: "2026-08-26", headers: {}, fetch: reply({ mimeType: "application/vnd.google-apps.folder", trashed: true }) }), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_PARENT_FOLDER_INACCESSIBLE");
});
