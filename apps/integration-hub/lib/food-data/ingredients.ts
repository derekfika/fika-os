import { columnIndex, type FoodBundle } from "./bundle";

const C = {
  name: "Product Name", supplier: "Supplier Name", productCode: "Product Code", category: "Category (365 Kitchen Management)", supplierCode: "Supplier Code", brand: "Brand",
  allergenFirst: "Gluten Source Wheat", allergenLast: "No allergens",
  energyKj: "Energy (kJ)", energyKcal: "Energy (kCal)", fat: "Fat (g)", saturates: "Saturates (g)", carbs: "Carbohydrates (g)", fibre: "Fibre (g)", sugars: "Sugars (g)", protein: "Protein (g)", salt: "Salt (g)",
  quantity: "Quantity (per Pack, Total)", uom: "UoM [g, ml, etc]", price: "Price inc VAT (£)", vat: "VAT %",
  vegetarian: "Suitable for Vegetarian diet", vegan: "Suitable for Vegan diet", kosher: "Suitable for Kosher diet", halal: "Suitable for Halal diet", organic: "Organic",
  composite: "Composite Ingredients", customerName: "Customer facing name", origin: "Country of origin / place of provenance", recipeName: "Recipe Name", status: "Purchase Status", lock: "Lock",
} as const;

export const NUTRITION_COLUMNS = [
  ["Energy", C.energyKj, "kJ"], ["Energy", C.energyKcal, "kcal"], ["Fat", C.fat, "g"], ["Saturates", C.saturates, "g"], ["Carbohydrates", C.carbs, "g"],
  ["Fibre", C.fibre, "g"], ["Sugars", C.sugars, "g"], ["Protein", C.protein, "g"], ["Salt", C.salt, "g"],
] as const;
const DIET_COLUMNS = [["Vegetarian", C.vegetarian], ["Vegan", C.vegan], ["Kosher", C.kosher], ["Halal", C.halal], ["Organic", C.organic]] as const;

export type AllergenValue = { allergen: string; value: string };
export type UnitCost = { per: "kg" | "litre"; incVat: number; exVat: number | null };
export type PackPricing = {
  packQuantity: number | null; unit: string; priceIncVat: number | null; vatRate: number | null;
  /** Derived from the VAT-inclusive source price; null when the VAT rate is not a valid number. */
  priceExVat: number | null; unitCost: UnitCost | null; unitCostNote: string;
};
export type IngredientRecord = {
  /** Zero-based position in the source export, so duplicates remain individually addressable. */
  index: number; name: string; supplier: string; productCode: string; supplierCode: string; brand: string; category: string;
  status: string; locked: string; customerFacingName: string; origin: string; declaration: string; linkedRecipeName: string;
  pricing: PackPricing; allergens: AllergenValue[]; allergensRecorded: boolean;
  nutrition: { label: string; value: string; unit: string }[]; diets: { label: string; value: string }[];
};

const DECIMAL = /^\d+(?:\.\d+)?$/;
function parseDecimal(raw: string) { const text = raw.trim(); return DECIMAL.test(text) ? Number(text) : null; }

/**
 * Pack pricing. Source prices are VAT-inclusive. A per-kg / per-litre cost is derived only for weight or volume
 * units; "pack", "ea", "case" or blank quantities are never guessed at.
 */
export function computePackPricing(quantityRaw: string, unitRaw: string, priceRaw: string, vatRaw: string): PackPricing {
  const packQuantity = parseDecimal(quantityRaw); const priceIncVat = parseDecimal(priceRaw); const vatRate = parseDecimal(vatRaw);
  const unit = unitRaw.trim();
  const priceExVat = priceIncVat !== null && vatRate !== null ? priceIncVat / (1 + vatRate / 100) : null;
  const factor: { per: "kg" | "litre"; multiplier: number } | undefined = { g: { per: "kg" as const, multiplier: 1000 }, kg: { per: "kg" as const, multiplier: 1 }, ml: { per: "litre" as const, multiplier: 1000 }, l: { per: "litre" as const, multiplier: 1 } }[unit.toLowerCase()];
  let unitCost: UnitCost | null = null; let unitCostNote = "";
  if (priceIncVat === null) unitCostNote = "No pack price in the source.";
  else if (packQuantity === null || packQuantity <= 0) unitCostNote = "No usable pack quantity in the source.";
  else if (!factor) unitCostNote = unit ? `Unit "${unit}" cannot be converted safely to a weight or volume.` : "No unit in the source.";
  else {
    const incVat = priceIncVat / packQuantity * factor.multiplier;
    unitCost = { per: factor.per, incVat, exVat: vatRate !== null ? incVat / (1 + vatRate / 100) : null };
    if (vatRate === null) unitCostNote = "VAT rate missing, so no ex-VAT cost is calculated.";
  }
  return { packQuantity, unit, priceIncVat, vatRate, priceExVat, unitCost, unitCostNote };
}

export function buildIngredientRecords(bundle: FoodBundle): IngredientRecord[] {
  const positions = columnIndex(bundle.columns, Object.values(C), "ingredients");
  const at = (name: string) => positions.get(name)!;
  const first = at(C.allergenFirst); const last = at(C.allergenLast);
  if (last < first) throw new Error("Allergen columns are out of order in the ingredients export.");
  const allergenColumns = bundle.columns.slice(first, last + 1).map((allergen, offset) => ({ allergen, position: first + offset }));
  const nutrition = NUTRITION_COLUMNS.map(([label, column, unit]) => ({ label, position: at(column), unit }));
  const diets = DIET_COLUMNS.map(([label, column]) => ({ label, position: at(column) }));
  return bundle.rows.map((row, index) => {
    const allergens = allergenColumns.map(({ allergen, position }) => ({ allergen, value: row[position] }));
    return {
      index, name: row[at(C.name)], supplier: row[at(C.supplier)], productCode: row[at(C.productCode)], supplierCode: row[at(C.supplierCode)], brand: row[at(C.brand)], category: row[at(C.category)],
      status: row[at(C.status)], locked: row[at(C.lock)], customerFacingName: row[at(C.customerName)], origin: row[at(C.origin)], declaration: row[at(C.composite)], linkedRecipeName: row[at(C.recipeName)],
      pricing: computePackPricing(row[at(C.quantity)], row[at(C.uom)], row[at(C.price)], row[at(C.vat)]),
      allergens,
      // A wholly blank allergen block is "not recorded", never "clear".
      allergensRecorded: allergens.some(entry => entry.value.trim() !== ""),
      nutrition: nutrition.map(({ label, position, unit }) => ({ label, value: row[position], unit })),
      diets: diets.map(({ label, position }) => ({ label, value: row[position] })),
    };
  });
}

export type IngredientSearchField = "all" | "name" | "supplier" | "supplierCode" | "productCode" | "brand" | "category";
export type IngredientQuery = { text?: string; field?: IngredientSearchField; supplier?: string; category?: string; brand?: string; status?: string };
export type IngredientIndex = {
  records: IngredientRecord[]; suppliers: string[]; categories: string[]; brands: string[]; statuses: string[];
  /** Returns record positions in stable name order. Pure in-memory work: no network and no Firestore. */
  search(query: IngredientQuery): number[];
};

const collator = new Intl.Collator("en-GB", { sensitivity: "base" });
const norm = (value: string) => value.toLocaleLowerCase("en-GB");
const distinct = (values: string[]) => [...new Set(values.filter(value => value.trim() !== ""))].sort((a, b) => collator.compare(a, b));
const fieldValue = (record: IngredientRecord, field: Exclude<IngredientSearchField, "all">) => record[field];

export function buildIngredientIndex(records: IngredientRecord[]): IngredientIndex {
  const order = records.map((_, position) => position).sort((a, b) => collator.compare(records[a].name, records[b].name) || a - b);
  const haystacks = records.map(record => norm([record.name, record.customerFacingName, record.supplier, record.supplierCode, record.productCode, record.brand, record.category].join("\u0001")));
  const fields = records.map(record => ({ name: norm(record.name), supplier: norm(record.supplier), supplierCode: norm(record.supplierCode), productCode: norm(record.productCode), brand: norm(record.brand), category: norm(record.category) }));
  return {
    records, suppliers: distinct(records.map(record => record.supplier)), categories: distinct(records.map(record => record.category)), brands: distinct(records.map(record => record.brand)), statuses: distinct(records.map(record => record.status)),
    search(query) {
      const tokens = norm(query.text || "").split(/\s+/).filter(Boolean);
      const field = query.field && query.field !== "all" ? query.field : undefined;
      const result: number[] = [];
      for (const position of order) {
        const record = records[position];
        if (query.supplier && record.supplier !== query.supplier) continue;
        if (query.category && record.category !== query.category) continue;
        if (query.brand && record.brand !== query.brand) continue;
        if (query.status && record.status !== query.status) continue;
        if (tokens.length) {
          const target = field ? fields[position][field] : haystacks[position];
          if (!tokens.every(token => target.includes(token))) continue;
        }
        result.push(position);
      }
      return result;
    },
  };
}

export { fieldValue as ingredientFieldValue };
