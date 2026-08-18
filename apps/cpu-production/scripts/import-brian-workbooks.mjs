import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

const allergens = ["noKeyAllergens", "peanuts", "otherNuts", "gluten", "sesame", "molluscs", "fish", "soya", "celery", "shellfish", "eggs", "milk", "mustard", "lupin", "sulphites"];
const categories = new Set(["Salad 1", "Salad 2", "Salad 3", "Salad 4", "Salad 5", "Salad 6", "Cold protein", "Soup", "Hot meat", "Hot veg / vegan", "Extras / sides"]);
const defaults = [
  "C:/Users/derek/Downloads/WC 20_07_2026 (1).xlsx",
  "C:/Users/derek/Downloads/_WC 13_07_2026.xlsx",
  "C:/Users/derek/Downloads/_ WC 06_07_2026.xlsx",
];
const daySheets = new Set(["mon", "tue", "wed", "thurs", "thu", "fri"]);

function text(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function titleCase(value) { return text(value).toLowerCase().replace(/\b[\p{L}\p{N}]/gu, (character) => character.toUpperCase()); }
function slug(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item"; }
function category(value) {
  const normalized = text(value).toLowerCase().replace(/[\/_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^salad\s*[1-6]$/.test(normalized)) return `Salad ${normalized.slice(-1)}`;
  if (normalized === "cold protein") return "Cold protein";
  if (normalized === "soup") return "Soup";
  if (normalized === "hot meat") return "Hot meat";
  if (normalized === "hot veg vegan") return "Hot veg / vegan";
  if (normalized === "extras sides" || normalized === "extras side") return "Extras / sides";
  return undefined;
}
function blankAllergens() { return Object.fromEntries(allergens.map((key) => [key, "clear"])); }
function mergeState(current, next) {
  if (current === "contains" || next === "contains") return "contains";
  if (current === "may_contain" || next === "may_contain") return "may_contain";
  return "clear";
}
function evidence(file, sheet, row) { return [`source:${path.basename(file)}`, `sheet:${sheet}`, `row:${row}`]; }

const files = process.argv.slice(2).length ? process.argv.slice(2) : defaults;
const items = new Map();
const allergenEvidence = new Map();
const report = { importedAt: "2026-08-17T00:00:00Z", sources: [], productionRows: 0, allergenRows: 0, categories: {}, fieldsUnavailable: ["effective price date", "site-specific quantities in the reusable catalogue", "recipe/ingredient detail"], conflicts: [] };

for (const file of files) {
  const workbook = XLSX.read(await fs.readFile(file), { cellDates: false });
  const source = { file: path.basename(file), sheets: workbook.SheetNames, productionRows: 0, allergenRows: 0 };
  report.sources.push(source);
  for (const sheetName of workbook.SheetNames) {
    const lower = sheetName.toLowerCase();
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
    if (daySheets.has(lower)) {
      for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || [];
        const rawTitle = text(row[1] || row[0]);
        if (!rawTitle || /^total$/i.test(rawTitle)) continue;
        const title = titleCase(rawTitle);
        if (/^allergen\s+matrix$/i.test(title)) continue;
        const key = slug(title);
        const parsedCategory = category(row[0]) || "Extras / sides";
        const existing = items.get(key);
        if (existing && existing.category !== parsedCategory && parsedCategory !== "Extras / sides") report.conflicts.push({ title, categories: [existing.category, parsedCategory], source: path.basename(file) });
        const item = existing || { id: `production:delivered-in-lunch:${key}`, title, category: parsedCategory, allergens: blankAllergens(), mayContainNotes: "", itemType: parsedCategory.startsWith("Salad ") ? "salad" : "other", parentMenuItemKey: "delivered-in-lunch", sourceEvidence: [], updatedAt: report.importedAt, updatedBy: "brian-workbook-import" };
        if (existing?.category === "Extras / sides" && parsedCategory !== "Extras / sides") item.category = parsedCategory;
        item.sourceEvidence = [...new Set([...item.sourceEvidence, ...evidence(file, sheetName, rowIndex + 1), `category:${parsedCategory}`])];
        items.set(key, item);
        source.productionRows += 1;
        report.productionRows += 1;
        report.categories[parsedCategory] = (report.categories[parsedCategory] || 0) + 1;
      }
    }
    if (lower.startsWith("fika")) {
      const headerIndex = rows.findIndex((row) => row.some((value) => /dish\s*\/\s*food\s*\/\s*product/i.test(text(value))));
      if (headerIndex < 0) continue;
      const header = rows[headerIndex] || [];
      const dishIndex = header.findIndex((value) => /dish\s*\/\s*food\s*\/\s*product/i.test(text(value)));
      for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || [];
        const rawTitle = text(row[dishIndex]);
        if (!rawTitle) continue;
        const title = titleCase(rawTitle);
        const key = slug(title);
        const current = allergenEvidence.get(key) || { allergens: blankAllergens(), notes: new Set(), evidence: [] };
        for (let offset = 1; offset <= allergens.length; offset += 1) {
          const value = text(row[dishIndex + offset]).toLowerCase();
          const state = /mc|may\s*contain/.test(value) ? "may_contain" : value ? "contains" : "clear";
          current.allergens[allergens[offset - 1]] = mergeState(current.allergens[allergens[offset - 1]], state);
        }
        const notes = text(row[dishIndex + allergens.length + 1]);
        if (notes) current.notes.add(notes);
        current.evidence.push(...evidence(file, sheetName, rowIndex + 1));
        allergenEvidence.set(key, current);
        source.allergenRows += 1;
        report.allergenRows += 1;
      }
    }
  }
}

for (const [key, evidenceRecord] of allergenEvidence) {
  const item = items.get(key);
  if (!item) continue;
  item.allergens = evidenceRecord.allergens;
  item.mayContainNotes = [...evidenceRecord.notes].join("; ");
  item.sourceEvidence = [...new Set([...item.sourceEvidence, ...evidenceRecord.evidence, "allergen-evidence:source-provided-no-inference"])]
}

const output = [...items.values()].sort((a, b) => a.title.localeCompare(b.title));
const dataDir = path.resolve("apps/cpu-production/data");
await fs.mkdir(dataDir, { recursive: true });
await fs.writeFile(path.join(dataDir, "delivered-in-lunch-items-seed.json"), `${JSON.stringify(output, null, 2)}\n`);
report.itemCount = output.length;
report.items = output.map(({ id, title, category, sourceEvidence }) => ({ id, title, category, sourceEvidence }));
await fs.writeFile(path.join(dataDir, "delivered-in-lunch-import-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Imported ${output.length} delivered-in items from ${files.length} workbook(s).`);
