import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import type { AllergenMap, RollingEntry } from "../lib/rolling-menu-types";
import { CANONICAL_ALLERGEN_KEYS } from "../../shared/allergen-contract";

const menuDataRoot = process.env.FIKA_MENU_DATA_ROOT || join(process.cwd(), "..", "..", "Menu Data");
const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
const allergenColumns: Array<[string, string]> = CANONICAL_ALLERGEN_KEYS.map((key) => [key === "no_key_allergens" ? "NO KEY ALLERGENS" : key === "tree_nuts" ? "ALL OTHER NUTS" : key.toUpperCase(), key]);
const normalise = (value: unknown) => String(value ?? "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
const headerText = (value: unknown) => String(value ?? "").trim().toLocaleUpperCase();
const marker = (value: unknown) => String(value ?? "").trim().toLocaleUpperCase();

function readAllergenRows() {
  const index = new Map<string, { allergens: AllergenMap; mayContainNotes?: string; source: string }>();
  for (const fileName of readdirSync(menuDataRoot).filter((name) => name.toLocaleLowerCase().endsWith(".xlsx"))) {
    const workbook = XLSX.read(readFileSync(join(menuDataRoot, fileName)), { type: "buffer", cellDates: false });
    for (const sheetName of workbook.SheetNames.filter((name) => /^fika/i.test(name))) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "" });
      const headerIndex = rows.findIndex((row) => row.some((value) => headerText(value) === "DISH / FOOD / PRODUCT"));
      if (headerIndex < 0) continue;
      const header = rows[headerIndex] || [];
      const columns = allergenColumns.map(([label, key]) => ({ key, index: header.findIndex((value) => headerText(value).startsWith(label)) })).filter((column) => column.index >= 0);
      const mayContainIndexes = header.map((value, index) => ({ value: headerText(value), index })).filter(({ value }) => value.includes("MAY CONTAIN"));
      for (const row of rows.slice(headerIndex + 1)) {
        const name = String(row[0] ?? "").trim();
        if (!name) continue;
        const allergens = Object.fromEntries(allergenColumns.map(([, key]) => [key, "clear"])) as AllergenMap;
        for (const column of columns) {
          const value = marker(row[column.index]);
          if (["X", "✓", "YES", "1", "TRUE"].includes(value)) allergens[column.key] = "contains";
          else if (["MC", "MAY CONTAIN", "MAY_CONTAIN"].includes(value)) allergens[column.key] = "may_contain";
        }
        const notes = mayContainIndexes.map(({ index }) => String(row[index] ?? "").trim()).filter((value) => value && !["X", "MC", "✓"].includes(marker(value))).join("; ") || undefined;
        const key = normalise(name);
        if (!index.has(key) || fileName.toLocaleLowerCase().includes("2026")) index.set(key, { allergens, mayContainNotes: notes, source: `${fileName} / ${sheetName}` });
      }
    }
  }
  return index;
}

const data = JSON.parse(readFileSync(rollingFile, "utf8")) as { version: number; weeks: unknown[]; days: unknown[]; entries: RollingEntry[] };
const allergenRows = readAllergenRows();
let imported = 0;
const unmatched = new Set<string>();
for (const entry of data.entries) {
  const row = allergenRows.get(normalise(entry.itemLabel));
  if (!row) { unmatched.add(entry.itemLabel); continue; }
  entry.allergens = row.allergens;
  entry.mayContainNotes = row.mayContainNotes;
  entry.audit.push({ action: "allergens-imported", at: new Date().toISOString(), by: "menu-data-allergen-importer" });
  imported += 1;
}
if (!existsSync(rollingFile)) throw new Error(`Rolling menu data was not found: ${rollingFile}`);
const temporary = `${rollingFile}.tmp`;
writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", "utf8");
renameSync(temporary, rollingFile);
console.log(JSON.stringify({ menuDataRoot, imported, totalEntries: data.entries.length, unmatched: [...unmatched].sort() }, null, 2));
