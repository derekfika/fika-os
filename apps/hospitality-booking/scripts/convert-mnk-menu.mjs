import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../../../sites/mnk/booking-platform/01_MenuData.js");
const outputPath = path.resolve(here, "../generated/mnk-hospitality-menu.v1.json");
const source = await readFile(sourcePath, "utf8");
const context = vm.createContext({ Object });
vm.runInContext(`${source}\nglobalThis.__MENU_SCHEMA__ = MENU_SCHEMA;`, context, { filename: sourcePath });
const items = JSON.parse(JSON.stringify(context.__MENU_SCHEMA__));
const missing = [];
const catalogue = items.map((item, index) => {
  if (!item.id) missing.push({ sourceIndex: index, field: "id", reason: "No source item ID." });
  if (!item.dietaryTags?.length) missing.push({ sourceId: item.id, field: "dietaryInformation", reason: "Legacy source provides an empty dietary tag list." });
  if (!item.allergens?.length) missing.push({ sourceId: item.id, field: "allergenInformation", reason: "Legacy source provides an empty allergen list." });
  missing.push({ sourceId: item.id, field: "vatRate", reason: "Legacy menu source does not provide an item-level VAT rate." });
  return { canonicalId: `hospitality-menu-item:mnk:${item.id}`, source: { provider: "mnk-booking-platform", sourcePath: "01_MenuData.js:MENU_SCHEMA", sourceItemId: item.id }, name: item.name, description: item.description || undefined, category: item.category, pricing: { unitPrice: item.unitPrice, currency: "GBP", basis: item.priceType, servingInfo: item.servingInfo, vatRate: null }, orderingConstraints: { minimumQuantity: item.minimumQuantity, minimumGuests: item.minimumGuests, noticeRequiredDays: item.noticeRequiredDays, serves: item.serves, suggestionType: item.suggestionType, suggestionLabel: item.suggestionLabel, suggestionUnit: item.suggestionUnit }, optionGroups: (item.choices || []).map(group => ({ id: group.id, label: group.label, selectionType: group.type, required: Boolean(group.required), options: group.options.map(value => ({ id: `${group.id}:${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`, label: value })) })), dietaryInformation: item.dietaryTags || [], allergenInformation: item.allergens || [], lifecycleState: item.available ? "active" : "archived", sortOrder: item.sortOrder };
});
const output = { schemaVersion: "fika.hospitality-menu-catalogue.v1", generatedAt: "deterministic-from-source", source: { path: "sites/mnk/booking-platform/01_MenuData.js", itemCount: items.length }, categories: [...new Set(catalogue.map(item => item.category))].map(name => ({ canonicalId: `hospitality-menu-category:mnk:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name })), items: catalogue, validationReport: { sourceItemCount: items.length, generatedItemCount: catalogue.length, missingCanonicalFields: missing } };
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated ${catalogue.length} MNK catalogue items.`);
