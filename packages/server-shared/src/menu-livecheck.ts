import { ensureGeneratedMenusFolder, publishMenuArtifact, resolveMenuTemplate, menuArtifactKey, menuArtifactSourceKey, type MenuOutputFormat, type NormalizedMenu, type NormalizedMenuItem } from "./menu-artifact";
import type { MenuDestination } from "./menu-destination";

/**
 * Real Google Drive + Slides verification of the shared menu-artifact path with SYNTHETIC `LIVECHECK_` menus.
 * Runs through the real publish code (template copy, Slides manipulation, filing, retries, supersession), verifies the outcome
 * from Drive/Slides metadata (not from the publisher's own return values) and reports explicit pass/fail checks.
 *
 * Stateless per call so it fits a request timeout: pass the same `runId` to each group.
 *   core    folders (created once, reused), tablet + flat v1, retry idempotency, format independence, deck inspection
 *   amend   tablet + flat v2: per-format supersession (the other format is never retired), content reflects the amendment
 *   paging  30 dishes -> 2 label pages, no orphaned cards
 */

export type LiveCheckGroup = "core" | "amend" | "paging";
export type LiveCheckReport = { group: LiveCheckGroup; runId: string; passed: boolean; checks: Array<{ check: string; ok: boolean; detail?: unknown }>; artifacts: Array<{ label: string; url: string; fileId: string; path?: string }>; folderPath?: string };

const MNK_OPLOC = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";
const SERVICE_DATE = "2026-10-07"; // a Wednesday: week commencing Monday 2026-10-05
const item = (id: string, name: string, contains: string[] = []): NormalizedMenuItem => ({ id, name, contains, mayContain: [], ...(contains.length ? {} : { noKeyAllergens: true }) });

const BASE = {
  salads: [item("s1", "Mixed Leaves, Tomato, Cucumber & Pink Pickled Onions", ["sulphites"]), item("s2", "Fika Slaw with Pineapple & Jalapeño Dressing", ["sulphites", "eggs"]), item("s3", "Caesar Salad", ["gluten", "fish", "eggs", "milk", "mustard"]), item("s4", "Roasted Beetroot, Goat's Cheese, Walnuts & Rocket", ["milk", "tree_nuts", "sulphites"]), item("s5", "Quinoa, Charred Broccoli, Edamame & Lemon Tahini", ["sesame", "soya"])],
  hot: [item("m1", "Roasted Sweet Potato, Charred Corn, Roasted Pepper & Baby Spinach", ["milk"]), item("m2", "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", ["gluten", "eggs", "mustard", "sulphites"])],
  sides: [item("e1", "Roasted Potatoes with Rosemary"), item("e2", "Vegan Feta, Pesto, Vegan Mayo, Salad", ["tree_nuts", "gluten", "soya"])],
};

function menuFor(runId: string, version: number, suffix: string, items = BASE): NormalizedMenu {
  return {
    siteKey: "mnk", siteLabel: "MNK", oplocId: MNK_OPLOC, serviceDate: SERVICE_DATE, title: "MENU", fileName: `LIVECHECK_${runId}_MNK_${SERVICE_DATE}${suffix}`,
    sections: [{ key: "salads", label: "Salads", items: items.salads }, { key: "hot_mains", label: "Hot mains", items: items.hot }, { key: "sides_extras", label: "Sides & extras", items: items.sides }],
    source: { workflow: "delivered-in", id: `livecheck:${runId}${suffix}`, version, revisionStamp: `rev-${version}` },
  };
}
const dishCount = (menu: NormalizedMenu) => menu.sections.reduce((sum, section) => sum + section.items.length, 0);

type Meta = { id: string; name: string; parents?: string[]; trashed?: boolean; appProperties?: Record<string, string> };
type SlidesElement = { objectId: string; elementGroup?: unknown; shape?: { shapeType?: string; text?: { textElements?: Array<{ textRun?: { content?: string } }> } } };

export async function runMenuLiveCheck(input: { destination: MenuDestination; token: string; group: LiveCheckGroup; runId: string; fetch?: typeof fetch }): Promise<LiveCheckReport> {
  const { destination, group, runId } = input;
  const fetchImpl = input.fetch || fetch;
  const headers = { Authorization: `Bearer ${input.token}` };
  const checks: LiveCheckReport["checks"] = []; const artifacts: LiveCheckReport["artifacts"] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ check: name, ok, ...(detail === undefined ? {} : { detail }) }); return ok; };
  const get = async <T>(url: string) => { const response = await fetchImpl(url, { headers }); const text = await response.text(); if (!response.ok) throw new Error(`${response.status} ${url.split("?")[0]} ${text.slice(0, 200)}`); return JSON.parse(text) as T; };
  const meta = (id: string) => get<Meta>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,parents,trashed,appProperties`);
  const pathOf = async (id: string) => { const names: string[] = []; let current: Meta | undefined = await meta(id); while (current) { names.unshift(current.name); current = current.parents?.[0] ? await meta(current.parents[0]).catch(() => undefined) : undefined; } return names.join(" / "); };
  const findByKey = async (property: string, value: string) => (await get<{ files?: Meta[] }>(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`appProperties has { key='${property}' and value='${value}' }`)}&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=${encodeURIComponent("files(id,name,parents,trashed,appProperties)")}&pageSize=50`)).files || [];
  const slides = async (id: string) => {
    const presentation = await get<{ slides?: Array<{ pageElements?: SlidesElement[] }> }>(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}`);
    return (presentation.slides || []).map(slide => {
      const elements = slide.pageElements || [];
      const texts = elements.filter(element => element.shape?.shapeType === "TEXT_BOX").map(element => (element.shape?.text?.textElements || []).map(run => run.textRun?.content || "").join("").trim());
      return { elements: elements.length, groups: elements.filter(element => element.elementGroup).length, textBoxes: texts.length, emptyTextBoxes: texts.filter(text => !text).length, text: texts.join("\n") };
    });
  };
  const publish = (menu: NormalizedMenu, format: MenuOutputFormat, folderId: string) => publishMenuArtifact({ menu, template: resolveMenuTemplate({ siteKey: "mnk", format }), folderId, headers });
  const keyOf = (menu: NormalizedMenu, format: MenuOutputFormat) => menuArtifactKey(menu, resolveMenuTemplate({ siteKey: "mnk", format }).key, format);
  const sourceKeyOf = (menu: NormalizedMenu, format: MenuOutputFormat) => menuArtifactSourceKey(menu, format);

  const filing = await ensureGeneratedMenusFolder({ parentId: destination.parentFolderId, serviceDate: SERVICE_DATE, headers, fetch: fetchImpl });
  const folderPath = await pathOf(filing.folderId);

  if (group === "core") {
    const again = await ensureGeneratedMenusFolder({ parentId: destination.parentFolderId, serviceDate: "2026-10-08", headers, fetch: fetchImpl });
    check("filed under <parent>/Generated Menus/WC_2026-10-05", /Generated Menus \/ WC_2026-10-05$/.test(folderPath), folderPath);
    check("the parent folder is the configured one", (await meta((await meta(filing.generatedMenusFolderId)).parents?.[0] || "")).id === destination.parentFolderId);
    check("folders are reused, never duplicated (same week -> same folder)", again.folderId === filing.folderId && again.generatedMenusFolderId === filing.generatedMenusFolderId);
    const siblings = await get<{ files?: Meta[] }>(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${destination.parentFolderId}' in parents and name = 'Generated Menus' and trashed = false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)&pageSize=10`);
    check("exactly one 'Generated Menus' folder under the parent", (siblings.files || []).length === 1, (siblings.files || []).length);
    const v1 = menuFor(runId, 1, "");
    const t1 = await publish(v1, "tablet", filing.folderId); const t1b = await publish(v1, "tablet", filing.folderId);
    const f1 = await publish(v1, "flat-label", filing.folderId); const f1b = await publish(v1, "flat-label", filing.folderId);
    artifacts.push({ label: "tablet v1", url: t1.presentationUrl, fileId: t1.fileId, path: await pathOf(t1.fileId) }, { label: "flat labels v1", url: f1.presentationUrl, fileId: f1.fileId, path: await pathOf(f1.fileId) });
    check("tablet retry reuses the same file", t1b.reused && t1b.fileId === t1.fileId, { first: t1.fileId, retry: t1b.fileId });
    check("flat retry reuses the same file", f1b.reused && f1b.fileId === f1.fileId, { first: f1.fileId, retry: f1b.fileId });
    check("tablet and labels never collide", t1.fileId !== f1.fileId && t1.artifactKey !== f1.artifactKey && t1.artifactId !== f1.artifactId && t1.fileName !== f1.fileName, { tablet: t1.fileName, labels: f1.fileName });
    const [tm, fm] = [await meta(t1.fileId), await meta(f1.fileId)];
    check("both files sit in the week folder, neither is trashed", tm.parents?.[0] === filing.folderId && fm.parents?.[0] === filing.folderId && !tm.trashed && !fm.trashed);
    check("exactly one live file per artifact key (no retry duplicates)", (await findByKey("fikaMenuArtifactKey", t1.artifactKey)).filter(file => !file.trashed).length === 1 && (await findByKey("fikaMenuArtifactKey", f1.artifactKey)).filter(file => !file.trashed).length === 1);
    const [tablet] = await slides(t1.fileId); const flat = await slides(f1.fileId);
    const hot = tablet.text.indexOf("HOT MAINS"), sides = tablet.text.indexOf("SIDES & EXTRAS"), salads = tablet.text.indexOf("SALADS");
    check("tablet reads mains, sides, then salads", hot >= 0 && hot < sides && sides < salads, { hot, sides, salads });
    check("tablet shows bracketed allergens and no placeholder tokens", /\(Gluten, Eggs, Mustard, Sulphites\)/.test(tablet.text) && !/\{\{|Contains:|May contain/.test(tablet.text));
    check("tablet has no leftover empty text boxes", tablet.emptyTextBoxes === 0, tablet);
    check("flat labels: one slide, one label per dish, no leftover groups/placeholders", flat.length === 1 && flat[0].textBoxes === dishCount(v1) && flat[0].emptyTextBoxes === 0 && flat[0].groups === 0, { slides: flat.length, textBoxes: flat[0]?.textBoxes, dishes: dishCount(v1), groups: flat[0]?.groups });
    check("flat labels: no orphaned cards (elements = 4 per used card + 1 text box each)", flat[0].elements === dishCount(v1) * 5, { elements: flat[0].elements, expected: dishCount(v1) * 5 });
    check("flat labels: allergens bracketed, clear dishes silent", /\(Gluten, Eggs, Mustard, Sulphites\)/.test(flat[0].text) && !/Contains:|May contain|No key allergens/.test(flat[0].text));
  }

  if (group === "amend") {
    const v1 = menuFor(runId, 1, ""); const amended = { ...BASE, hot: [...BASE.hot, item("m3", "Amended Dish Added In Version Two", ["milk", "gluten"])] };
    const v2 = menuFor(runId, 2, "", amended);
    const t1key = keyOf(v1, "tablet"), f1key = keyOf(v1, "flat-label");
    const t2 = await publish(v2, "tablet", filing.folderId);
    const afterTablet = { t1: (await findByKey("fikaMenuArtifactKey", t1key))[0], f1: (await findByKey("fikaMenuArtifactKey", f1key))[0] };
    check("tablet amendment creates a new, distinct file", t2.artifactKey !== t1key && !t2.reused, t2.fileId);
    check("tablet v1 is retired (trashed), not deleted", Boolean(afterTablet.t1?.trashed) && t2.retiredFileIds.includes(afterTablet.t1?.id), { retired: t2.retiredFileIds });
    check("flat labels v1 is NOT retired by a tablet amendment", afterTablet.f1 !== undefined && !afterTablet.f1.trashed);
    const f2 = await publish(v2, "flat-label", filing.folderId);
    const afterFlat = { f1: (await findByKey("fikaMenuArtifactKey", f1key))[0], t2: await meta(t2.fileId) };
    check("flat v1 is retired by the flat amendment", Boolean(afterFlat.f1?.trashed) && f2.retiredFileIds.includes(afterFlat.f1?.id), { retired: f2.retiredFileIds });
    check("the current tablet v2 is untouched by the flat amendment", !afterFlat.t2.trashed);
    check("only the newest revision of each format is live", (await findByKey("fikaMenuSourceKey", sourceKeyOf(v2, "tablet"))).filter(file => !file.trashed).length === 1 && (await findByKey("fikaMenuSourceKey", sourceKeyOf(v2, "flat-label"))).filter(file => !file.trashed).length === 1);
    artifacts.push({ label: "tablet v2", url: t2.presentationUrl, fileId: t2.fileId, path: await pathOf(t2.fileId) }, { label: "flat labels v2", url: f2.presentationUrl, fileId: f2.fileId, path: await pathOf(f2.fileId) });
    check("the amended content is in both decks", (await slides(t2.fileId))[0].text.includes("Amended Dish Added In Version Two") && (await slides(f2.fileId)).some(slide => slide.text.includes("Amended Dish Added In Version Two")));
    const flat2 = await slides(f2.fileId);
    check("flat v2: one label per dish, nothing orphaned", flat2[0].textBoxes === dishCount(v2) && flat2[0].elements === dishCount(v2) * 5 && flat2[0].emptyTextBoxes === 0, flat2[0]);
  }

  if (group === "paging") {
    const many = { salads: Array.from({ length: 14 }, (_, index) => item(`b${index}`, `Salad number ${index + 1} with seasonal leaves`, index % 3 ? ["gluten"] : [])), hot: Array.from({ length: 8 }, (_, index) => item(`h${index}`, `Hot main ${index + 1}`, ["milk"])), sides: Array.from({ length: 8 }, (_, index) => item(`z${index}`, `Side ${index + 1}`)) };
    const big = menuFor(runId, 1, "_30dishes", many);
    const result = await publish(big, "flat-label", filing.folderId); const retry = await publish(big, "flat-label", filing.folderId);
    artifacts.push({ label: "flat labels, 30 dishes", url: result.presentationUrl, fileId: result.fileId, path: await pathOf(result.fileId) });
    const deck = await slides(result.fileId);
    check("30 dishes paginate to 2 pages", result.pageCount === 2 && deck.length === 2, { reported: result.pageCount, slides: deck.length });
    check("page 1 holds 24 labels, page 2 holds 6", deck[0]?.textBoxes === 24 && deck[1]?.textBoxes === 6, deck.map(slide => slide.textBoxes));
    check("no orphaned cards or placeholders on either page", deck.every(slide => slide.emptyTextBoxes === 0 && slide.groups === 0) && deck[0].elements === 24 * 5 && deck[1].elements === 6 * 5, deck.map(slide => slide.elements));
    check("retry of the paged deck reuses it", retry.reused && retry.fileId === result.fileId);
  }

  return { group, runId, passed: checks.every(entry => entry.ok), checks, artifacts, folderPath };
}
