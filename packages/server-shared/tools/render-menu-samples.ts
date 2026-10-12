/**
 * Offline sample renderings of the menu output formats (no Google credentials).
 *
 *   npx tsx packages/server-shared/tools/render-menu-samples.ts [outDir]
 *
 * Writes HTML pages (and an index) to `artifacts/menu-previews/` by default, which is
 * git-ignored. Brand bitmaps are NOT committed: put the four PNGs named in ASSETS into
 * `<outDir>/assets/` (they are extracted from the MNK reference decks) to see logos;
 * without them the preview marks the missing assets.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { planMenuLayout, type MenuOutputFormat, type NormalizedMenu, type NormalizedMenuItem } from "../src/menu-artifact";
import { renderMenuPlanHtml } from "../src/menu-preview";

const ASSETS: Record<string, string> = {
  "mnk-tablet-header": "assets/mnk-tablet-header.png",
  "mnk-group-logo-white": "assets/mnk-group-logo-white.png",
  "fika-logo-white": "assets/fika-logo-white.png",
  "fika-tagline-white": "assets/fika-tagline-white.png",
};

const item = (id: string, name: string, contains: string[] = [], mayContain: string[] = []): NormalizedMenuItem => ({ id, name, contains, mayContain, ...(contains.length || mayContain.length ? {} : { noKeyAllergens: true }) });

const menu = (items: NormalizedMenuItem[], sections?: NormalizedMenu["sections"]): NormalizedMenu => ({
  siteKey: "mnk", siteLabel: "MNK", oplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f", serviceDate: "2026-08-25", serviceTime: "12:00", title: "MENU",
  sections: sections || [{ key: "menu", items }],
  source: { workflow: "hospitality", id: "booking:mnk:sample", version: 1, clientName: "FIKA" },
});

const hotLunch = [
  item("1", "Roasted Sweet Potato, Charred Corn, Roasted Pepper & Baby Spinach", ["milk"]),            // contains
  item("2", "Fika Slaw with Pineapple & Jalapeño Dressing", ["sulphites"], ["tree_nuts"]),             // contains + may contain
  item("3", "Mixed Leaves"),                                                                           // positively clear
  item("4", "Tomato, Cucumber, Avocado & Pink Pickled Onions", [], ["sulphites", "mustard"]),          // may contain only
  item("5", "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", ["gluten", "eggs", "mustard", "sulphites"]),
  item("6", "Vegan Feta, Pesto, Vegan Mayo, Salad", ["tree_nuts", "gluten", "soya"], ["peanuts"]),
  item("7", "Caesar Salad", ["gluten", "fish", "eggs", "milk", "mustard"]),
  item("8", "Fruit Pot"),
];

const samples: Array<{ file: string; title: string; format: MenuOutputFormat; menu: NormalizedMenu }> = [
  { file: "mnk-tablet", title: "MNK tablet menu (5 salads, 2 mains, 2 sides)", format: "tablet", menu: menu([], [
    { key: "salads", label: "Salads", items: [
      item("s1", "Mixed Leaves, Tomato, Cucumber & Pink Pickled Onions", ["sulphites"]),
      item("s2", "Fika Slaw with Pineapple & Jalapeño Dressing", ["sulphites", "eggs"]),
      item("s3", "Caesar Salad", ["gluten", "fish", "eggs", "milk", "mustard"]),
      item("s4", "Roasted Beetroot, Goat's Cheese, Walnuts & Rocket", ["milk", "tree_nuts", "sulphites"]),
      item("s5", "Quinoa, Charred Broccoli, Edamame & Lemon Tahini", ["sesame", "soya"]),
    ] },
    { key: "hot_mains", label: "Hot mains", items: [
      item("m1", "Roasted Sweet Potato, Charred Corn, Roasted Pepper & Baby Spinach", ["milk"]),
      item("m2", "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", ["gluten", "eggs", "mustard", "sulphites"]),
    ] },
    { key: "sides_extras", label: "Sides & extras", items: [
      item("e1", "Roasted Potatoes with Rosemary", ["sulphites"]),
      item("e2", "Vegan Feta, Pesto, Vegan Mayo, Salad", ["tree_nuts", "gluten", "soya"]),
    ] },
  ]) },
  { file: "mnk-flat-labels", title: "MNK flat labels (8 dishes, one page)", format: "flat-label", menu: menu(hotLunch) },
  { file: "mnk-tent-labels", title: "MNK tent labels (8 dishes, one page)", format: "tent-label", menu: menu(hotLunch) },
  { file: "mnk-flat-labels-paged", title: "MNK flat labels (30 dishes, two pages)", format: "flat-label", menu: menu(Array.from({ length: 30 }, (_, index) => hotLunch[index % hotLunch.length]).map((dish, index) => ({ ...dish, id: `${dish.id}-${index}`, name: dish.name }))) },
];

const outDir = path.resolve(process.argv[2] || "artifacts/menu-previews");
mkdirSync(outDir, { recursive: true });
const rows: string[] = [];
for (const sample of samples) {
  const plan = planMenuLayout(sample.menu, sample.format);
  writeFileSync(path.join(outDir, `${sample.file}.html`), renderMenuPlanHtml(plan, { title: sample.title, assets: ASSETS }));
  rows.push(`<li><a href="${sample.file}.html">${sample.title}</a> — ${plan.pages.length} page(s), layout ${plan.masterKey}</li>`);
  console.log(`${sample.file}.html  ${plan.format}  pages=${plan.pages.length}  dishes=${plan.itemCount}`);
}
writeFileSync(path.join(outDir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Menu previews</title><body style="font:14px sans-serif;padding:16px"><h1>Menu output previews</h1><ul>${rows.join("")}</ul></body>`);
