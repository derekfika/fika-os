import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(appDirectory, "..", "..");
const configPath = path.join(repositoryDirectory, "sites/rcoa/booking-platform/00_Config.js");
const menuPath = path.join(repositoryDirectory, "sites/rcoa/booking-platform/01_MenuData.js");
const [configSource, menuSource] = await Promise.all([
  readFile(configPath, "utf8"),
  readFile(menuPath, "utf8"),
]);

// The source files contain only frozen configuration/data declarations and
// helper definitions. No Apps Script service is invoked during conversion.
const evaluated = vm.runInNewContext(
  `${configSource}\n${menuSource}\nJSON.stringify({ config: SITE_CONFIG, menu: MENU_SCHEMA })`,
  Object.create(null),
  { timeout: 1000 },
);
const { config, menu } = JSON.parse(evaluated);
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const categories = [...new Set(menu.map((item) => item.category))];
const catalogue = {
  schemaVersion: "fika.hospitality-menu-catalogue.v1",
  generatedAt: "2026-10-05T00:00:00.000Z",
  source: { path: "sites/rcoa/booking-platform/01_MenuData.js", itemCount: menu.length },
  categories: categories.map((name) => ({
    canonicalId: `hospitality-menu-category:rcoa:${slug(name)}`,
    name,
  })),
  items: menu.map((item) => ({
    canonicalId: `hospitality-menu-item:rcoa:${item.id}`,
    source: {
      provider: "rcoa-hospitality-brochure",
      sourcePath: "sites/rcoa/booking-platform/01_MenuData.js",
      sourceItemId: item.id,
    },
    name: item.name,
    description: item.description,
    category: item.category,
    pricing: {
      unitPrice: item.unitPrice,
      currency: "GBP",
      basis: item.priceType,
      servingInfo: item.servingInfo,
      vatRate: config.integration.vatRate,
    },
    orderingConstraints: {
      minimumQuantity: item.minimumQuantity,
      minimumGuests: item.minimumGuests,
      noticeRequiredDays: item.noticeRequiredDays,
      serves: item.serves,
      suggestionType: item.suggestionType,
      suggestionLabel: item.suggestionLabel,
      suggestionUnit: item.suggestionUnit,
    },
    optionGroups: item.choices.map((group) => ({
      id: group.id,
      label: group.label,
      selectionType: group.type,
      required: group.required,
      options: group.options.map((label) => ({ id: slug(label), label })),
    })),
    // The Apps Script catalogue declares empty dietary/allergen fields. Keep
    // them empty so consumers preserve unknown states as unknown.
    dietaryInformation: item.dietaryTags,
    allergenInformation: item.allergens,
    lifecycleState: item.available ? "active" : "archived",
    sortOrder: item.sortOrder,
  })),
  validationReport: {
    sourceItemCount: menu.length,
    generatedItemCount: menu.length,
    missingCanonicalFields: [
      {
        field: "dietaryInformation",
        reason: "The legacy RCoA catalogue contains no structured dietary data.",
      },
      {
        field: "allergenInformation",
        reason: "The legacy RCoA catalogue contains no structured allergen data; an empty list is not a clear declaration.",
      },
    ],
  },
};

const outputPath = path.join(appDirectory, "generated/rcoa-hospitality-menu.v1.json");
await writeFile(outputPath, `${JSON.stringify(catalogue, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${catalogue.items.length} RCoA menu items at ${outputPath}\n`);
