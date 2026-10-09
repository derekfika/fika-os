/**
 * LIVE verification of the menu-artifact path against real Google Drive + Slides (local OAuth or hosted DWD).
 *
 *   npx tsx packages/server-shared/tools/live-menu-check.ts
 *
 * Writes clearly named `LIVECHECK_*` files under <the MNK OPLOC menu parent>/Generated Menus/WC_2026-10-05 and verifies, from Drive/Slides
 * metadata: the folder path, tablet + flat-label generation, retry idempotency, amendment supersession scoped per format, label paging and
 * the absence of leftover template elements. Results go to artifacts/live-check/result.json (git-ignored). Test files are left in place for
 * visual review; superseded ones are in the Drive trash. Nothing is permanently deleted.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureGeneratedMenusFolder, menuDestinationToken, publishMenuArtifact, resolveMenuDestination, resolveMenuTemplate, type MenuOutputFormat, type NormalizedMenu, type NormalizedMenuItem } from "../src/menu-artifact";

// Credentials come from the environment, exactly as the apps resolve them:
//   local:  FIKA_RUNTIME_MODE=local + GOOGLE_OAUTH_CLIENT_FILE / GOOGLE_OAUTH_TOKEN_FILE
//   hosted: GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON + GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F (NODE_ENV=production)
// Required: GOOGLE_MENU_TEMPLATE_ID_MNK, GOOGLE_MENU_LABEL_TEMPLATE_ID_MNK, and the MNK OPLOC destination (GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_<KEY> + GOOGLE_MENU_PARENT_FOLDER_ID_OPLOC_<KEY>).
const need = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value; };
const env = { GOOGLE_MENU_TEMPLATE_ID_MNK: need("GOOGLE_MENU_TEMPLATE_ID_MNK"), GOOGLE_MENU_LABEL_TEMPLATE_ID_MNK: need("GOOGLE_MENU_LABEL_TEMPLATE_ID_MNK") };
const MNK_OPLOC = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const item = (id: string, name: string, contains: string[] = []): NormalizedMenuItem => ({ id, name, contains, mayContain: [], ...(contains.length ? {} : { noKeyAllergens: true }) });
const dishes = {
  salads: [item("s1", "Mixed Leaves, Tomato, Cucumber & Pink Pickled Onions", ["sulphites"]), item("s2", "Fika Slaw with Pineapple & Jalapeño Dressing", ["sulphites", "eggs"]), item("s3", "Caesar Salad", ["gluten", "fish", "eggs", "milk", "mustard"]), item("s4", "Roasted Beetroot, Goat's Cheese, Walnuts & Rocket", ["milk", "tree_nuts", "sulphites"]), item("s5", "Quinoa, Charred Broccoli, Edamame & Lemon Tahini", ["sesame", "soya"])],
  hot: [item("m1", "Roasted Sweet Potato, Charred Corn, Roasted Pepper & Baby Spinach", ["milk"]), item("m2", "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", ["gluten", "eggs", "mustard", "sulphites"])],
  sides: [item("e1", "Roasted Potatoes with Rosemary"), item("e2", "Vegan Feta, Pesto, Vegan Mayo, Salad", ["tree_nuts", "gluten", "soya"])],
};
const menu = (sourceId: string, version: number, extra: Partial<NormalizedMenu> = {}, items = dishes): NormalizedMenu => ({
  siteKey: "mnk", siteLabel: "MNK", oplocId: MNK_OPLOC, serviceDate: "2026-10-07", title: "MENU", fileName: `LIVECHECK_${stamp}_MNK_2026-10-07`,
  sections: [{ key: "salads", label: "Salads", items: items.salads }, { key: "hot_mains", label: "Hot mains", items: items.hot }, { key: "sides_extras", label: "Sides & extras", items: items.sides }],
  source: { workflow: "delivered-in", id: `livecheck:${stamp}`, version, revisionStamp: `rev-${version}` }, ...extra,
});

type Meta = { id: string; name: string; parents?: string[]; trashed?: boolean; appProperties?: Record<string, string>; webViewLink?: string; mimeType?: string };
async function main() {
  const destination = resolveMenuDestination({ oplocId: MNK_OPLOC });
  const token = await menuDestinationToken(destination);
  const headers = { Authorization: `Bearer ${token}` };
  const get = async <T>(url: string) => { const response = await fetch(url, { headers }); if (!response.ok) throw new Error(`${response.status} ${url.split("?")[0]} ${(await response.text()).slice(0, 200)}`); return await response.json() as T; };
  const meta = (id: string) => get<Meta>(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true&fields=id,name,parents,trashed,appProperties,webViewLink,mimeType`);
  const pathOf = async (id: string): Promise<string> => { const names: string[] = []; let current: Meta | undefined = await meta(id); while (current) { names.unshift(current.name); current = current.parents?.[0] ? await meta(current.parents[0]).catch(() => undefined) : undefined; } return names.join(" / "); };
  const parent = destination.parentFolderId;
  const log: Array<Record<string, unknown>> = [];
  const note = (step: string, data: Record<string, unknown>) => { log.push({ step, ...data }); console.log(step, JSON.stringify(data)); };

  const filing = await ensureGeneratedMenusFolder({ parentId: parent, serviceDate: "2026-10-07", headers });
  const filing2 = await ensureGeneratedMenusFolder({ parentId: parent, serviceDate: "2026-10-08", headers });
  note("folders", { path: await pathOf(filing.folderId), week: filing.weekFolderName, sameFolderOnSecondCall: filing.folderId === filing2.folderId, generatedMenusReused: filing.generatedMenusFolderId === filing2.generatedMenusFolderId });

  const publish = (value: NormalizedMenu, format: MenuOutputFormat) => publishMenuArtifact({ menu: value, template: resolveMenuTemplate({ siteKey: "mnk", format }, env), folderId: filing.folderId, headers });
  const slides = async (id: string) => {
    const presentation = await get<{ slides?: Array<{ objectId: string; pageElements?: Array<{ objectId: string; shape?: { shapeType?: string; text?: { textElements?: Array<{ textRun?: { content?: string } }> } }; elementGroup?: unknown }> }> }>(`https://slides.googleapis.com/v1/presentations/${id}`);
    return (presentation.slides || []).map(slide => {
      const elements = slide.pageElements || []; const texts = elements.filter(element => element.shape?.shapeType === "TEXT_BOX").map(element => (element.shape?.text?.textElements || []).map(run => run.textRun?.content || "").join("").trim());
      return { elements: elements.length, groups: elements.filter(element => element.elementGroup).length, textBoxes: texts.length, emptyTextBoxes: texts.filter(text => !text).length, sample: texts.filter(Boolean).slice(0, 3) };
    });
  };
  const describe = async (label: string, result: Awaited<ReturnType<typeof publish>>) => {
    const file = await meta(result.fileId);
    note(label, { fileId: result.fileId, url: result.presentationUrl, name: file.name, path: await pathOf(result.fileId), reused: result.reused, retired: result.retiredFileIds, pages: result.pageCount, format: file.appProperties?.fikaMenuFormat, materialised: file.appProperties?.fikaMenuMaterialised, trashed: file.trashed, slides: await slides(result.fileId) });
  };

  const t1 = await publish(menu(`x`, 1), "tablet"); await describe("tablet v1", t1);
  const t1b = await publish(menu(`x`, 1), "tablet"); note("tablet v1 retry", { reused: t1b.reused, sameFile: t1b.fileId === t1.fileId });
  const f1 = await publish(menu(`x`, 1), "flat-label"); await describe("flat v1", f1);
  const f1b = await publish(menu(`x`, 1), "flat-label"); note("flat v1 retry", { reused: f1b.reused, sameFile: f1b.fileId === f1.fileId });
  const t2 = await publish(menu(`x`, 2), "tablet"); await describe("tablet v2 (amended)", t2);
  note("after tablet v2", { t1Trashed: (await meta(t1.fileId)).trashed, f1Trashed: (await meta(f1.fileId)).trashed, retired: t2.retiredFileIds });
  const f2 = await publish(menu(`x`, 2), "flat-label"); await describe("flat v2 (amended)", f2);
  note("after flat v2", { f1Trashed: (await meta(f1.fileId)).trashed, t2Trashed: (await meta(t2.fileId)).trashed, retired: f2.retiredFileIds });

  const many = { salads: Array.from({ length: 14 }, (_, index) => item(`b${index}`, `Salad number ${index + 1} with seasonal leaves`, index % 3 ? ["gluten"] : [])), hot: Array.from({ length: 8 }, (_, index) => item(`h${index}`, `Hot main ${index + 1}`, ["milk"])), sides: Array.from({ length: 8 }, (_, index) => item(`z${index}`, `Side ${index + 1}`)) };
  const big = menu(`x-big`, 1, { fileName: `LIVECHECK_${stamp}_MNK_2026-10-07_30dishes` }, many);
  const f3 = await publish(big, "flat-label"); await describe("flat 30 dishes (2 pages)", f3);
  mkdirSync("artifacts/live-check", { recursive: true });
  writeFileSync("artifacts/live-check/result.json", JSON.stringify({ stamp, folder: await pathOf(filing.folderId), log }, null, 2));
}
main().catch(error => { console.error("LIVE CHECK FAILED:", error.message); process.exit(1); });
