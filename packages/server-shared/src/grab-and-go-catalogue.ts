export type GrabAndGoProductContract = {
  productId: string;
  name: string;
  category: "grab_250ml" | "stacking_salad_750ml";
  rotationWeeks: number[];
  allowedDeliveryWeekdays: string[];
  price?: number;
  active: boolean;
  sortOrder: number;
};
export type GrabAndGoCatalogue = { schemaVersion: 1; products: GrabAndGoProductContract[] };

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
export function parseGrabAndGoCatalogue(value: unknown): GrabAndGoCatalogue {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.products)) throw new Error("The Grab & Go catalogue package has an invalid shape.");
  const products = value.products.map((candidate): GrabAndGoProductContract => {
    if (!isRecord(candidate) || typeof candidate.productId !== "string" || !candidate.productId.trim() || candidate.productId.length > 200 || typeof candidate.name !== "string" || !candidate.name.trim() || candidate.name.length > 240 || !["grab_250ml", "stacking_salad_750ml"].includes(candidate.category as string) || !Array.isArray(candidate.rotationWeeks) || candidate.rotationWeeks.some(week => typeof week !== "number" || !Number.isInteger(week) || week < 1 || week > 4) || !Array.isArray(candidate.allowedDeliveryWeekdays) || candidate.allowedDeliveryWeekdays.some(day => typeof day !== "string" || !day.trim() || day.length > 20) || (candidate.price !== undefined && (typeof candidate.price !== "number" || !Number.isFinite(candidate.price) || candidate.price < 0)) || typeof candidate.active !== "boolean" || typeof candidate.sortOrder !== "number" || !Number.isInteger(candidate.sortOrder)) throw new Error("The Grab & Go catalogue package contains an invalid product.");
    return { productId: candidate.productId, name: candidate.name, category: candidate.category as GrabAndGoProductContract["category"], rotationWeeks: [...candidate.rotationWeeks] as number[], allowedDeliveryWeekdays: [...candidate.allowedDeliveryWeekdays] as string[], ...(candidate.price !== undefined ? { price: candidate.price } : {}), active: candidate.active, sortOrder: candidate.sortOrder };
  });
  const ids = new Set<string>();
  if (products.some(product => ids.has(product.productId) || (ids.add(product.productId), false))) throw new Error("The Grab & Go catalogue contains duplicate product IDs.");
  return { schemaVersion: 1, products };
}

export const GRAB_AND_GO_CATALOGUE_CONTRACT = "cpu-production.grab-and-go-catalogue.v1" as const;
export const GRAB_AND_GO_CATALOGUE_SCHEMA_VERSION = 1 as const;
