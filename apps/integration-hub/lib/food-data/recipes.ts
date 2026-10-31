import { columnIndex, type FoodBundle } from "./bundle";

const REQUIRED = ["Reference", "Recipe Name", "Description", "Menu", "Celery/ Celeriac", "No allergens", "Energy (kJ)", "Energy (kCal)", "Fat (g)", "Saturates (g)", "Carbohydrates (g)", "Fibre (g)", "Sugars (g)", "Protein (g)", "Salt (g)", "# Servings", "Recipe size", "Values per", "Recipe cost", "Actual Price", "Cost # Servings", "Target GP%", "Plate cost", "Sale Price", "Additive free", "Enter nutritional values manually", "Enter recipe cost manually"] as const;
const NUTRITION = [["Energy", "Energy (kJ)", "kJ"], ["Energy", "Energy (kCal)", "kcal"], ["Fat", "Fat (g)", "g"], ["Saturates", "Saturates (g)", "g"], ["Carbohydrates", "Carbohydrates (g)", "g"], ["Fibre", "Fibre (g)", "g"], ["Sugars", "Sugars (g)", "g"], ["Protein", "Protein (g)", "g"], ["Salt", "Salt (g)", "g"]] as const;
const COSTING = [["Recipe cost", "Recipe cost"], ["Actual price", "Actual Price"], ["Cost per servings count", "Cost # Servings"], ["Target GP %", "Target GP%"], ["Plate cost", "Plate cost"], ["Sale price", "Sale Price"]] as const;
const YIELD = [["Servings", "# Servings"], ["Recipe size", "Recipe size"], ["Values per", "Values per"]] as const;

export type RecipeRecord = {
  index: number; name: string; reference: string; description: string; menu: string;
  allergens: { allergen: string; value: string }[]; allergensRecorded: boolean;
  nutrition: { label: string; value: string; unit: string }[]; yields: { label: string; value: string }[]; costing: { label: string; value: string }[];
  /** Dietary / suitability flags the source marks "Y". */
  flags: string[]; manualNutrition: string; manualCost: string;
  /** The untouched positional row, kept so nothing exported is lost. */
  row: string[];
};
export type RecipeGroup = {
  name: string; members: number[]; exactDuplicateRows: number;
  /** Source columns whose values differ between members of this name group. */
  conflicts: { column: string; values: string[] }[];
};
export type RecipeIndex = {
  records: RecipeRecord[]; columns: string[]; groups: RecipeGroup[];
  /** Groups matching the text, in name order. Pure in-memory work. */
  search(text: string): RecipeGroup[];
};

const norm = (value: string) => value.toLocaleLowerCase("en-GB");

export function buildRecipeRecords(bundle: FoodBundle): RecipeRecord[] {
  const positions = columnIndex(bundle.columns, REQUIRED, "recipes"); const at = (name: string) => positions.get(name)!;
  const first = at("Celery/ Celeriac"); const last = at("No allergens");
  // The recipe allergen block is contiguous in the export; resolve it by name and fail if that stops being true.
  const allergenColumns = bundle.columns.slice(Math.min(first, last), Math.max(first, last) + 1).map((allergen, offset) => ({ allergen, position: Math.min(first, last) + offset }));
  if (first > last || !allergenColumns.length) throw new Error("Allergen columns are out of order in the recipes export.");
  const flagStart = at("Additive free"); const flagEnd = at("Enter nutritional values manually");
  const flagColumns = bundle.columns.slice(flagStart, flagEnd).map((label, offset) => ({ label, position: flagStart + offset }));
  return bundle.rows.map((row, index) => {
    const allergens = allergenColumns.map(({ allergen, position }) => ({ allergen, value: row[position] }));
    return {
      index, name: row[at("Recipe Name")], reference: row[at("Reference")], description: row[at("Description")], menu: row[at("Menu")],
      allergens, allergensRecorded: allergens.some(entry => entry.value.trim() !== ""),
      nutrition: NUTRITION.map(([label, column, unit]) => ({ label, value: row[at(column)], unit })),
      yields: YIELD.map(([label, column]) => ({ label, value: row[at(column)] })),
      costing: COSTING.map(([label, column]) => ({ label, value: row[at(column)] })),
      flags: flagColumns.filter(({ position }) => row[position] === "Y").map(({ label }) => label),
      manualNutrition: row[at("Enter nutritional values manually")], manualCost: row[at("Enter recipe cost manually")],
      row,
    };
  });
}

export function buildRecipeIndex(records: RecipeRecord[], columns: string[]): RecipeIndex {
  const byName = new Map<string, number[]>();
  records.forEach(record => { const list = byName.get(record.name); if (list) list.push(record.index); else byName.set(record.name, [record.index]); });
  const groups: RecipeGroup[] = [...byName.entries()].map(([name, members]) => {
    const rows = members.map(position => records[position].row);
    const conflicts: RecipeGroup["conflicts"] = [];
    if (members.length > 1) columns.forEach((column, position) => {
      const values = [...new Set(rows.map(row => row[position]))];
      if (values.length > 1) conflicts.push({ column, values });
    });
    const unique = new Set(rows.map(row => JSON.stringify(row)));
    return { name, members, exactDuplicateRows: rows.length - unique.size, conflicts };
  }).sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
  const haystacks = groups.map(group => norm(group.name));
  return {
    records, columns, groups,
    search(text) {
      const tokens = norm(text).split(/\s+/).filter(Boolean);
      return tokens.length ? groups.filter((_, position) => tokens.every(token => haystacks[position].includes(token))) : groups;
    },
  };
}
