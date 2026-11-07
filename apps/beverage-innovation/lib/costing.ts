import type { IngredientLine } from "./domain";

const MAX_INTEGER = 1_000_000_000;

function scaledDecimal(value: number | string, places: number, label: string): bigint {
  const raw = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match || (match[2]?.length ?? 0) > places) throw new Error(`${label} must be a non-negative decimal with at most ${places} decimal places.`);
  const scale = 10n ** BigInt(places);
  return BigInt(match[1]) * scale + BigInt((match[2] || "").padEnd(places, "0") || "0");
}

export function amountToMilliunits(amount: number | string): number {
  const scaled = scaledDecimal(amount, 3, "Quantity");
  if (scaled <= 0n || scaled > BigInt(MAX_INTEGER)) throw new Error("Quantity must be positive and within the supported range.");
  return Number(scaled);
}

export function poundsToMicropounds(amount: number | string): number {
  const scaled = scaledDecimal(amount, 6, "Unit cost");
  if (scaled > BigInt(MAX_INTEGER)) throw new Error("Unit cost is outside the supported range.");
  return Number(scaled);
}

export function poundsToPence(amount: number | string): number {
  const scaled = scaledDecimal(amount, 2, "Selling price");
  if (scaled > BigInt(MAX_INTEGER)) throw new Error("Selling price is outside the supported range.");
  return Number(scaled);
}

export function penceToPounds(pence: number | undefined): number | undefined {
  return pence === undefined ? undefined : pence / 100;
}

export function lineCostPence(line: IngredientLine): number | undefined {
  const quantityMilli = line.quantityMilli ?? (line.amount === undefined ? undefined : amountToMilliunits(line.amount));
  const unitCostMicropounds = line.unitCostMicropounds ?? (line.costPerUnit === undefined ? undefined : poundsToMicropounds(line.costPerUnit));
  const quantityUnit = line.unit?.trim().toLowerCase();
  const costUnit = (line.costUnit || line.unit)?.trim().toLowerCase();
  if (quantityMilli === undefined || unitCostMicropounds === undefined || !quantityUnit || quantityUnit !== costUnit) return undefined;
  // quantityMilli × unitCostMicropounds / 10,000,000 rounds GBP to the nearest penny.
  const total = BigInt(quantityMilli) * BigInt(unitCostMicropounds);
  return Number((total + 5_000_000n) / 10_000_000n);
}

export type CostCalculation = {
  currency: "GBP";
  basis: "per-serving-ex-vat";
  costStatus: "complete" | "incomplete";
  costPerPortionPence: number | null;
  sellingPriceExVatPence: number | null;
  grossProfitPence: number | null;
  grossProfitBasisPoints: number | null;
};

export function calculateCosting(lines: IngredientLine[], sellingPriceExVatPence?: number): CostCalculation {
  const lineCosts = lines.map(lineCostPence);
  const complete = lineCosts.length > 0 && lineCosts.every(cost => cost !== undefined);
  const totalCost = complete ? lineCosts.reduce((sum, cost) => sum + (cost ?? 0), 0) : null;
  const validPrice = Number.isSafeInteger(sellingPriceExVatPence) && (sellingPriceExVatPence ?? 0) > 0 ? sellingPriceExVatPence! : null;
  const grossProfit = totalCost !== null && validPrice !== null ? validPrice - totalCost : null;
  const basisPoints = grossProfit === null || validPrice === null
    ? null
    : Number((BigInt(grossProfit) * 10_000n + (grossProfit < 0 ? -1n : 1n) * BigInt(validPrice) / 2n) / BigInt(validPrice));
  return {
    currency: "GBP",
    basis: "per-serving-ex-vat",
    costStatus: complete ? "complete" : "incomplete",
    costPerPortionPence: totalCost,
    sellingPriceExVatPence: validPrice,
    grossProfitPence: grossProfit,
    grossProfitBasisPoints: basisPoints,
  };
}

export function normaliseIngredientLine(line: IngredientLine): IngredientLine {
  const name = line.name.trim();
  if (!name) throw new Error("Ingredient name is required.");
  const quantityMilli = line.quantityMilli ?? (line.amount === undefined ? undefined : amountToMilliunits(line.amount));
  const unitCostMicropounds = line.unitCostMicropounds ?? (line.costPerUnit === undefined ? undefined : poundsToMicropounds(line.costPerUnit));
  const unit = line.unit?.trim().toLowerCase();
  const costUnit = (line.costUnit || line.unit)?.trim().toLowerCase();
  if (quantityMilli !== undefined && (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 || quantityMilli > MAX_INTEGER)) throw new Error(`Quantity for ${name} is invalid.`);
  if (unitCostMicropounds !== undefined && (!Number.isSafeInteger(unitCostMicropounds) || unitCostMicropounds < 0 || unitCostMicropounds > MAX_INTEGER)) throw new Error(`Unit cost for ${name} is invalid.`);
  if (quantityMilli !== undefined && !unit) throw new Error(`Choose a unit for ${name}.`);
  if (unitCostMicropounds !== undefined && (!costUnit || costUnit !== unit)) throw new Error(`Cost basis unit must match the recipe unit for ${name}.`);
  return {
    id: line.id.trim(),
    name,
    ...(quantityMilli !== undefined ? { quantityMilli, amount: quantityMilli / 1000 } : {}),
    ...(unit ? { unit } : {}),
    ...(unitCostMicropounds !== undefined ? { unitCostMicropounds, costPerUnit: unitCostMicropounds / 1_000_000, costUnit } : {}),
    sourceStatus: line.sourceStatus,
  };
}
