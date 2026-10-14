import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../../../sites/mnk/booking-platform/01_MenuData.js");
const outputPath = path.resolve(here, "../../../packages/server-shared/src/hospitality-catalogue/mnk-hospitality-menu.v1.json");
const source = await readFile(sourcePath, "utf8");
const context = vm.createContext({ Object });
vm.runInContext(`${source}\nglobalThis.__MENU_SCHEMA__ = MENU_SCHEMA;`, context, { filename: sourcePath });
const sourceItems = JSON.parse(JSON.stringify(context.__MENU_SCHEMA__));
// Keep legacy MNK dashboard data intact. These FIKA OS-only overrides feed the
// checked-in local fallback; the live MNK portal reads effective-dated Hub data.
const menuPairs = [
  "Menu 1 — Cajun Chicken & Avo Mex Bowl",
  "Menu 1 — Vegan BBQ & Avo Mex Bowl",
  "Menu 2 — Hot Honey Roasted Sweet Potato Jerk Chicken & Quinoa Bowl",
  "Menu 2 — Hot Honey Roasted Sweet Potato & Quinoa Bowl",
  "Menu 3 — Roasted Miso Salmon & Edamame Bowl",
  "Menu 3 — Char-Sui Smoked Tofu & Edamame Bowl",
  "Menu 4 — Mediterranean Chicken & Halloumi Bowl",
  "Menu 4 — Mediterranean Falafel Bowl",
];
const menuDescription = menuPairs.join("; ");
const items = sourceItems.map(item => {
  if (item.id === "cookie_box") return { ...item, name: "Cookie Box", unitPrice: 64, servingInfo: "Feeds 20 people" };
  if (item.id === "tray_bake_box") return { ...item, name: "Traybake Box — Contains Nuts", unitPrice: 75, servingInfo: "Feeds 24 or 48 smaller bites", allergens: ["Nuts"] };
  if (item.id === "glow_bowl") return { ...item, name: "Propper Salads", description: menuDescription, unitPrice: 12.5, servingInfo: "Per person · minimum 25", minimumQuantity: 25, choices: [{ id: "bowl", label: "Choose Propper Salads option", type: "select", required: true, options: menuPairs }] };
  return item;
});
items.push(
  { id: "loaf_cake", name: "Loaf Cake", description: "Loaf cake.", category: "Sweet treats", unitPrice: 38, priceType: "per item", servingInfo: "Feeds 14 people", minimumQuantity: 1, minimumGuests: null, noticeRequiredDays: 3, serves: 14, suggestionType: "ceil_by_guests", suggestionLabel: "people", suggestionUnit: "people", choices: [], dietaryTags: [], allergens: [], available: true, sortOrder: 10000 },
  { id: "tray_bake_box_nut_free", name: "Traybake Box — Nut Free", description: "Nut free traybake box. Feeds 24 or 48 smaller bites.", category: "Sweet treats", unitPrice: 75, priceType: "per item", servingInfo: "Feeds 24 or 48 smaller bites", minimumQuantity: 1, minimumGuests: null, noticeRequiredDays: 3, serves: 24, suggestionType: "fixed", suggestionLabel: "boxes", suggestionUnit: "boxes", choices: [], dietaryTags: [], allergens: [], available: true, sortOrder: 10001 },
  { id: "doughnut_box", name: "Doughnut Box", description: "Doughnut box.", category: "Sweet treats", unitPrice: 42, priceType: "per item", servingInfo: "Feeds 12 people", minimumQuantity: 1, minimumGuests: null, noticeRequiredDays: 3, serves: 12, suggestionType: "ceil_by_guests", suggestionLabel: "people", suggestionUnit: "people", choices: [], dietaryTags: [], allergens: [], available: true, sortOrder: 10002 },
);
const missing = [];
const catalogue = items.map((item, index) => {
  if (!item.id) missing.push({ sourceIndex: index, field: "id", reason: "No source item ID." });
  if (!item.dietaryTags?.length) missing.push({ sourceId: item.id, field: "dietaryInformation", reason: "Legacy source provides an empty dietary tag list." });
  if (!item.allergens?.length) missing.push({ sourceId: item.id, field: "allergenInformation", reason: "Legacy source provides an empty allergen list." });
  missing.push({ sourceId: item.id, field: "vatRate", reason: "Legacy menu source does not provide an item-level VAT rate." });
  return { canonicalId: `hospitality-menu-item:mnk:${item.id}`, source: { provider: "mnk-booking-platform", sourcePath: "01_MenuData.js:MENU_SCHEMA", sourceItemId: item.id }, name: item.name, description: item.description || undefined, category: item.category, pricing: { unitPrice: item.unitPrice, currency: "GBP", basis: item.priceType, servingInfo: item.servingInfo, vatRate: null }, orderingConstraints: { minimumQuantity: item.minimumQuantity, minimumGuests: item.minimumGuests, noticeRequiredDays: item.noticeRequiredDays, serves: item.serves, suggestionType: item.suggestionType, suggestionLabel: item.suggestionLabel, suggestionUnit: item.suggestionUnit }, optionGroups: (item.choices || []).map(group => ({ id: group.id, label: group.label, selectionType: group.type, required: Boolean(group.required), options: group.options.map(value => ({ id: `${group.id}:${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`, label: value })) })), dietaryInformation: item.dietaryTags || [], allergenInformation: item.allergens || [], lifecycleState: item.available ? "active" : "archived", sortOrder: item.sortOrder };
});
const output = { schemaVersion: "fika.hospitality-menu-catalogue.v1", generatedAt: "deterministic-from-source", source: { path: "FIKA OS MNK conversion with site menu source plus FIKA OS commercial overrides", itemCount: items.length }, categories: [...new Set(catalogue.map(item => item.category))].map(name => ({ canonicalId: `hospitality-menu-category:mnk:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name })), items: catalogue, validationReport: { sourceItemCount: items.length, generatedItemCount: catalogue.length, missingCanonicalFields: missing } };
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated ${catalogue.length} MNK catalogue items.`);
