import { normaliseOperationalAllergens } from "./allergen-contract";

export type SemanticAllergenMatrixItem = {
  sourceLineId?: string;
  name: string;
  subItems: Array<{
    productionItemId?: string;
    name: string;
    quantity: number | null;
    allergens: Record<string, string>;
    mayContainNotes?: string;
  }>;
};

/** Canonical signed meaning shared by CPU server code and browser review code. */
export function canonicalAllergenMatrixForHash(items: SemanticAllergenMatrixItem[]) {
  return items.map(item => ({
    sourceLineId: item.sourceLineId || null,
    name: item.name,
    subItems: item.subItems.map(sub => ({
      productionItemId: sub.productionItemId || null,
      name: sub.name,
      quantity: sub.quantity,
      allergens: Object.fromEntries(Object.entries(normaliseOperationalAllergens(sub.allergens)).sort(([left], [right]) => left.localeCompare(right))),
      mayContainNotes: sub.mayContainNotes || "",
    })),
  }));
}
