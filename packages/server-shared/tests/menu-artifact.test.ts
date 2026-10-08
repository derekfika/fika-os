import assert from "node:assert/strict";
import test from "node:test";
import {
  MenuArtifactError, allergensFromStates, buildMenuSlidesRequests, layoutMenu, menuAllergenLabel, menuAllergenLine, menuArtifactFileName,
  menuArtifactKey, menuArtifactSourceKey, publishMenuArtifact, resolveMenuTemplate, type NormalizedMenu, type SlidesPresentation,
} from "../src/menu-artifact";

const MNK_OPLOC = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";
const portrait = { width: 6_300_200, height: 10_076_675 }; // the proven MNK deck page
const mnkEnv = { GOOGLE_MENU_TEMPLATE_ID_MNK: "tpl-mnk" };
const item = (id: string, name: string, contains: string[] = [], mayContain: string[] = []) => ({ id, name, contains, mayContain });

// The reference deck 2026-08-25-12-00-FIKA-MNK.pptx, as normalized input.
function deckMenu(over: Partial<NormalizedMenu> = {}, workflow: "hospitality" | "delivered-in" = "hospitality"): NormalizedMenu {
  return {
    siteKey: "mnk", siteLabel: "MNK", oplocId: MNK_OPLOC, serviceDate: "2026-08-25", serviceTime: "12:00", title: "MENU",
    sections: [{ key: "menu", items: [
      item("1", "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", ["gluten", "eggs", "mustard", "sulphites"]),
      item("2", "Vegan Feta, Pesto, Vegan Mayo, Salad", ["tree_nuts", "gluten", "soya"]),
      item("3", "Caesar Salad", ["gluten", "fish", "eggs", "milk", "mustard"]),
      item("4", "Test Salad 1"),
      item("5", "Test Salad 2", ["peanuts", "gluten", "soya"]),
    ] }],
    source: { workflow, id: "booking:mnk:deck", version: 3, clientName: "FIKA" },
    ...over,
  };
}
const presentation: SlidesPresentation = { pageSize: { width: { magnitude: portrait.width }, height: { magnitude: portrait.height } }, slides: [{ objectId: "slide-1", pageElements: [] }] };
const template = () => resolveMenuTemplate({ siteKey: "mnk" }, mnkEnv);

test("allergens: labels are display text, may-contain is never dropped, unrecorded is never clear", () => {
  assert.equal(menuAllergenLabel("tree_nuts"), "Tree Nuts");
  assert.equal(menuAllergenLine({ contains: ["gluten"], mayContain: ["milk", "gluten"] }), "(Gluten, Milk)");
  assert.equal(menuAllergenLine({ contains: ["no_key_allergens"], mayContain: [] }), "");
  const states = allergensFromStates({ gluten: "contains", milk: "may_contain", fish: "unrecorded", eggs: "clear", no_key_allergens: "contains" });
  assert.deepEqual(states, { contains: ["gluten"], mayContain: ["milk"], unrecorded: ["fish"] });
});

test("identity: existing file name convention, deterministic keys, revision-sensitive artifact key", () => {
  const menu = deckMenu();
  assert.equal(menuArtifactFileName(menu), "2026-08-25-12-00-FIKA-MNK");
  const key = menuArtifactKey(menu, "mnk-portrait-v1");
  assert.equal(key, menuArtifactKey(deckMenu(), "mnk-portrait-v1"), "a retry has the same key");
  const amended = deckMenu({ source: { ...menu.source, version: 4 } });
  assert.notEqual(menuArtifactKey(amended, "mnk-portrait-v1"), key, "an amendment is a distinct artifact");
  assert.equal(menuArtifactSourceKey(amended), menuArtifactSourceKey(menu), "but it belongs to the same source");
  assert.notEqual(menuArtifactSourceKey(deckMenu({ serviceTime: "13:00" })), menuArtifactSourceKey(menu));
});

test("template resolution is site based and fails safely", () => {
  assert.equal(resolveMenuTemplate({ siteKey: "mnk" }, mnkEnv).templateId, "tpl-mnk");
  assert.equal(resolveMenuTemplate({ oplocId: MNK_OPLOC }, mnkEnv).siteKey, "mnk");
  assert.equal(resolveMenuTemplate({ siteKey: "mnk" }, { GOOGLE_MENU_TEMPLATE_ID: "legacy-tpl" }).templateId, "legacy-tpl", "legacy MNK env name still works");
  assert.equal(resolveMenuTemplate({ siteKey: "mnk", templateIdOverride: "https://docs.google.com/presentation/d/override-tpl/edit" }, mnkEnv).templateId, "override-tpl");
  assert.equal(resolveMenuTemplate({ siteKey: "angel-court" }, { GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT: "tpl-ac" }).layout.contentLeft, 1_750_000);
  assert.throws(() => resolveMenuTemplate({ siteKey: "mnk" }, {}), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_NOT_CONFIGURED" && error.status === 409 && /GOOGLE_MENU_TEMPLATE_ID_MNK/.test(error.message));
  assert.throws(() => resolveMenuTemplate({ siteKey: "haleon" }, mnkEnv), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_SITE_UNSUPPORTED");
  assert.throws(() => resolveMenuTemplate({ oplocId: "oploc:unknown" }, mnkEnv), /No menu template is defined/);
});

test("layout reproduces the reference deck: text, order and allergens directly under each item", () => {
  const layout = layoutMenu(deckMenu(), template(), portrait);
  assert.deepEqual(layout.runs.map(run => run.text), [
    "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", "(Gluten, Eggs, Mustard, Sulphites)", "",
    "Vegan Feta, Pesto, Vegan Mayo, Salad", "(Tree Nuts, Gluten, Soya)", "",
    "Caesar Salad", "(Gluten, Fish, Eggs, Milk, Mustard)", "",
    "Test Salad 1", "",
    "Test Salad 2", "(Peanuts, Gluten, Soya)",
  ]);
  assert.equal(layout.itemFontSize, 15);
  assert.equal(layout.allergenFontSize, 10);
  assert.equal(layout.fontScaled, false);
});

test("slides requests match the baseline geometry and typography (navy bold items, red 10pt allergens)", () => {
  const requests = buildMenuSlidesRequests(deckMenu(), template(), presentation) as Array<Record<string, any>>;
  const shape = requests.filter(request => request.createShape);
  assert.equal(shape.length, 1);
  assert.deepEqual(shape[0].createShape.elementProperties.transform, { scaleX: 1, scaleY: 1, translateX: 450_000, translateY: 1_800_000 + 180_000, unit: "EMU" });
  assert.equal(shape[0].createShape.elementProperties.size.width.magnitude, portrait.width - 900_000);
  const text: string = requests.find(request => request.insertText)!.insertText.text;
  const base = requests.find(request => request.updateTextStyle?.textRange.type === "ALL")!.updateTextStyle.style;
  assert.equal(base.fontFamily, "Montserrat"); assert.equal(base.fontSize.magnitude, 15); assert.equal(base.bold, true);
  assert.deepEqual(base.foregroundColor.opaqueColor.rgbColor, { red: 0.06, green: 0.3, blue: 0.42 });
  const allergenStyles = requests.filter(request => request.updateTextStyle?.textRange.type === "FIXED_RANGE").map(request => request.updateTextStyle);
  assert.equal(allergenStyles.length, 4);
  for (const entry of allergenStyles) {
    assert.equal(entry.style.fontSize.magnitude, 10); assert.equal(entry.style.bold, false);
    assert.deepEqual(entry.style.foregroundColor.opaqueColor.rgbColor, { red: 1, green: 0, blue: 0 });
    const covered = text.slice(entry.textRange.startIndex, entry.textRange.endIndex);
    assert.match(covered, /^\(.*\)$/, "each styled range is exactly one allergen line");
  }
  // The allergen line immediately follows its own item.
  assert.match(text, /Caesar Salad\n\(Gluten, Fish, Eggs, Milk, Mustard\)\n\nTest Salad 1\n\nTest Salad 2\n\(Peanuts, Gluten, Soya\)$/);
  assert.ok(requests.some(request => request.replaceAllText?.containsText.text === "{{MENU_TITLE}}" && request.replaceAllText.replaceText === "MENU"));
});

test("a visible {{MENU_ITEMS}} token is replaced instead of left on the slide", () => {
  const withToken: SlidesPresentation = { ...presentation, slides: [{ objectId: "s", pageElements: [{ objectId: "tok", shape: { text: { textElements: [{ textRun: { content: "{{MENU_ITEMS}}" } }] } } }] }] };
  const requests = buildMenuSlidesRequests(deckMenu(), template(), withToken) as Array<Record<string, any>>;
  assert.deepEqual(requests[0], { deleteObject: { objectId: "tok" } });
});

test("rendering does not depend on the source workflow", () => {
  const strip = (requests: Array<Record<string, any>>) => requests.filter(request => !request.replaceAllText);
  const hospitality = buildMenuSlidesRequests(deckMenu({}, "hospitality"), template(), presentation) as Array<Record<string, any>>;
  const deliveredIn = buildMenuSlidesRequests(deckMenu({ source: { workflow: "delivered-in", id: "publication-day:mnk:2026-08-25", version: 9 } }, "delivered-in"), template(), presentation) as Array<Record<string, any>>;
  assert.deepEqual(strip(hospitality), strip(deliveredIn));
});

test("sections render as labelled groups; long menus shrink; impossible menus fail instead of clipping", () => {
  const sectioned = deckMenu({ sections: [
    { key: "salads", label: "Salads", items: [item("a", "Mixed Leaf Salad", ["mustard"])] },
    { key: "hot_mains", label: "Hot mains", items: [item("b", "Roast Chicken", [], ["milk"])] },
  ] });
  const runs = layoutMenu(sectioned, template(), portrait).runs.map(run => `${run.kind}:${run.text}`);
  assert.deepEqual(runs, ["section:SALADS", "gap:", "item:Mixed Leaf Salad", "allergen:(Mustard)", "gap:", "section:HOT MAINS", "gap:", "item:Roast Chicken", "allergen:(Milk)"]);

  const many = deckMenu({ sections: [{ key: "menu", items: Array.from({ length: 14 }, (_, index) => item(String(index), `Long dish name number ${index + 1} with sauce`, ["gluten", "milk"])) }] });
  const shrunk = layoutMenu(many, template(), portrait);
  assert.ok(shrunk.fontScaled && shrunk.itemFontSize < 15 && shrunk.itemFontSize >= 10 && shrunk.allergenFontSize >= 8, `shrunk to ${shrunk.itemFontSize}`);
  const insane = deckMenu({ sections: [{ key: "menu", items: Array.from({ length: 120 }, (_, index) => item(String(index), `Very long dish name ${index} with a lot of extra description words to wrap`, ["gluten", "milk", "eggs"])) }] });
  assert.throws(() => layoutMenu(insane, template(), portrait), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_OVERFLOW");
});

test("an empty or unnamed menu is rejected rather than generating a blank artifact", () => {
  assert.throws(() => layoutMenu(deckMenu({ sections: [{ key: "menu", items: [] }] }), template(), portrait), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_EMPTY");
  assert.throws(() => layoutMenu(deckMenu({ sections: [{ key: "menu", items: [item("x", "  ")] }] }), template(), portrait), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ITEM_NAME_REQUIRED");
});

// ----------------------------------------------------------------- stateful fake Drive/Slides

type FakeFile = { id: string; name: string; parents: string[]; appProperties: Record<string, string>; trashed: boolean };
function fakeGoogle() {
  const files: FakeFile[] = []; const batches: Array<{ id: string; requests: unknown[] }> = []; let copies = 0;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET"; const parsed = new URL(url);
    if (parsed.hostname === "slides.googleapis.com") {
      const id = decodeURIComponent(parsed.pathname.split("/")[3].replace(":batchUpdate", ""));
      if (parsed.pathname.endsWith(":batchUpdate")) { batches.push({ id, requests: JSON.parse(String(init!.body)).requests }); return reply({}); }
      return reply(presentation);
    }
    if (method === "GET") {
      const q = parsed.searchParams.get("q") || ""; const match = q.match(/key='(\w+)' and value='(\w+)'/)!;
      return reply({ files: files.filter(file => !file.trashed && file.appProperties[match[1]] === match[2]).map(file => ({ id: file.id, appProperties: file.appProperties, webViewLink: `https://drive/${file.id}` })) });
    }
    if (method === "POST" && parsed.pathname.endsWith("/copy")) {
      copies += 1; const body = JSON.parse(String(init!.body));
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
  return { files, batches, fetchImpl, get copies() { return copies; } };
}

test("publication is idempotent per revision: retries reuse the artifact and never duplicate files", async () => {
  const google = fakeGoogle(); const menu = deckMenu();
  const publish = (value: NormalizedMenu) => publishMenuArtifact({ menu: value, template: template(), folderId: "folder-1", headers: { Authorization: "Bearer t" }, fetch: google.fetchImpl });
  const first = await publish(menu);
  assert.equal(first.reused, false); assert.equal(google.copies, 1); assert.equal(first.fileName, "2026-08-25-12-00-FIKA-MNK");
  assert.equal(google.batches.length, 1);
  const retry = await publish(deckMenu());
  assert.equal(retry.reused, true); assert.equal(retry.fileId, first.fileId);
  assert.equal(google.copies, 1, "no second copy"); assert.equal(google.batches.length, 1, "no second Slides write");
  assert.equal(google.files.filter(file => !file.trashed).length, 1);
});

test("an amendment creates a newer artifact and retires the earlier revision so it cannot look current", async () => {
  const google = fakeGoogle();
  const publish = (version: number) => publishMenuArtifact({ menu: deckMenu({ source: { workflow: "hospitality", id: "booking:mnk:deck", version, clientName: "FIKA" } }), template: template(), folderId: "folder-1", headers: {}, fetch: google.fetchImpl });
  const v3 = await publish(3);
  const v4 = await publish(4);
  assert.notEqual(v4.fileId, v3.fileId);
  assert.deepEqual(v4.retiredFileIds, [v3.fileId]);
  assert.deepEqual(google.files.filter(file => !file.trashed).map(file => file.id), [v4.fileId]);
  const retryOfV4 = await publish(4);
  assert.equal(retryOfV4.reused, true); assert.deepEqual(retryOfV4.retiredFileIds, []);
  assert.equal(google.copies, 2);
});

test("a different site or date is never retired by another menu's amendment", async () => {
  const google = fakeGoogle();
  const publish = (menu: NormalizedMenu) => publishMenuArtifact({ menu, template: template(), folderId: "f", headers: {}, fetch: google.fetchImpl });
  await publish(deckMenu());
  await publish(deckMenu({ serviceDate: "2026-08-26" }));
  assert.equal(google.files.filter(file => !file.trashed).length, 2);
});

test("a half-finished artifact (copied but not materialised) is completed, not duplicated", async () => {
  const google = fakeGoogle(); const menu = deckMenu();
  const key = menuArtifactKey(menu, "mnk-portrait-v1");
  google.files.push({ id: "file-pre", name: "x", parents: ["folder-1"], appProperties: { fikaMenuArtifactKey: key, fikaMenuSourceKey: menuArtifactSourceKey(menu) }, trashed: false });
  const result = await publishMenuArtifact({ menu, template: template(), folderId: "folder-1", headers: {}, fetch: google.fetchImpl });
  assert.equal(result.fileId, "file-pre"); assert.equal(result.reused, false); assert.equal(google.copies, 0); assert.equal(google.batches.length, 1);
  assert.equal(google.files[0].appProperties.fikaMenuMaterialised, "ready");
});
