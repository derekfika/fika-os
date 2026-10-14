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
const { config, menu: sourceMenu } = JSON.parse(evaluated);
// FIKA OS catalogue overrides are intentionally applied here so the legacy
// Apps Script source and dashboards remain untouched.
const menu = sourceMenu.map((item) => {
  if (item.id === "cookie_box") return { ...item, name: "Cookie Box", unitPrice: 64, servingInfo: "Feeds 20 people" };
  if (item.id === "tray_bake_box") return { ...item, name: "Traybake Box — Contains Nuts", unitPrice: 75, servingInfo: "Feeds 24 or 48 smaller bites", allergens: ["Nuts"] };
  if (item.id === "glow_bowl") return {
    ...item,
    name: "Propper Salads",
    description: "Menu 1: Cajun Chicken & Avo Mex Bowl or Vegan BBQ & Avo Mex Bowl. Menu 2: Hot Honey Roasted Sweet Potato Jerk Chicken & Quinoa Bowl or Hot Honey Roasted Sweet Potato & Quinoa Bowl. Menu 3: Roasted Miso Salmon & Edamame Bowl or Char-Sui Smoked Tofu & Edamame Bowl. Menu 4: Mediterranean Chicken & Halloumi Bowl or Mediterranean Falafel Bowl.",
    unitPrice: 12.5,
    minimumQuantity: 25,
    minimumGuests: 8,
    servingInfo: "Per person · minimum 25",
    choices: [{ id: "bowl", label: "Choose Propper Salads option", type: "select", required: true, options: [
      "Menu 1 — Cajun Chicken & Avo Mex Bowl",
      "Menu 1 — Vegan BBQ & Avo Mex Bowl",
      "Menu 2 — Hot Honey Roasted Sweet Potato Jerk Chicken & Quinoa Bowl",
      "Menu 2 — Hot Honey Roasted Sweet Potato & Quinoa Bowl",
      "Menu 3 — Roasted Miso Salmon & Edamame Bowl",
      "Menu 3 — Char-Sui Smoked Tofu & Edamame Bowl",
      "Menu 4 — Mediterranean Chicken & Halloumi Bowl",
      "Menu 4 — Mediterranean Falafel Bowl",
    ] }],
  };
  return item;
});
menu.push(
  { id: "loaf_cake", name: "Loaf Cake", description: "Loaf cake.", category: "Sweet treats", unitPrice: 38, priceType: "per item", servingInfo: "Feeds 14 people", minimumQuantity: 1, minimumGuests: null, noticeRequiredDays: 3, serves: 14, suggestionType: "ceil_by_guests", suggestionLabel: "people", suggestionUnit: "people", choices: [], dietaryTags: [], allergens: [], available: true, sortOrder: 10000 },
  { id: "tray_bake_box_nut_free", name: "Traybake Box — Nut Free", description: "Nut free traybake box. Feeds 24 or 48 smaller bites.", category: "Sweet treats", unitPrice: 75, priceType: "per item", servingInfo: "Feeds 24 or 48 smaller bites", minimumQuantity: 1, minimumGuests: null, noticeRequiredDays: 3, serves: 24, suggestionType: "fixed", suggestionLabel: "boxes", suggestionUnit: "boxes", choices: [], dietaryTags: [], allergens: [], available: true, sortOrder: 10001 },
  { id: "doughnut_box", name: "Doughnut Box", description: "Doughnut box.", category: "Sweet treats", unitPrice: 42, priceType: "per item", servingInfo: "Feeds 12 people", minimumQuantity: 1, minimumGuests: null, noticeRequiredDays: 3, serves: 12, suggestionType: "ceil_by_guests", suggestionLabel: "people", suggestionUnit: "people", choices: [], dietaryTags: [], allergens: [], available: true, sortOrder: 10002 },
);
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const categories = [...new Set(menu.map((item) => item.category))];
const catalogue = {
  schemaVersion: "fika.hospitality-menu-catalogue.v1",
  generatedAt: "2026-10-14T00:00:00.000Z",
  source: { path: "FIKA OS RCoA catalogue conversion with site menu source plus FIKA OS commercial overrides", itemCount: menu.length },
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

const outputPath = path.join(repositoryDirectory, "packages/server-shared/src/hospitality-catalogue/rcoa-hospitality-menu.v1.json");
await writeFile(outputPath, `${JSON.stringify(catalogue, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${catalogue.items.length} RCoA menu items at ${outputPath}\n`);
