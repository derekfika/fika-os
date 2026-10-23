import type { GrabAndGoProduct } from "./grab-and-go";

export type StandingSlotProductMapping = {
  sourceProductId: string;
  sourceName: string;
  targetProductId: string;
  targetName: string;
  category: GrabAndGoProduct["category"];
  quantity: number;
};

export type StandingSlotCopyMapping =
  | { ok: true; mappings: StandingSlotProductMapping[] }
  | { ok: false; reason: string };

/**
 * Match governed products by category and their unique catalogue position within that category.
 * Recipe IDs and names can legitimately differ between rotation weeks; quantities cannot be
 * copied unless every source product has exactly one target counterpart.
 */
export function mapStandingSlotProducts(
  sourceProducts: GrabAndGoProduct[],
  targetProducts: GrabAndGoProduct[],
  sourceQuantities: Record<string, number>,
): StandingSlotCopyMapping {
  const sourceIds = new Set(sourceProducts.map(product => product.productId));
  const targetIds = new Set(targetProducts.map(product => product.productId));
  if (sourceIds.size !== sourceProducts.length || targetIds.size !== targetProducts.length) {
    return { ok: false, reason: "The catalogue contains duplicate product identities, so the copy cannot be mapped safely." };
  }
  if (Object.keys(sourceQuantities).some(productId => !sourceIds.has(productId))) {
    return { ok: false, reason: "A source quantity belongs to a product that is no longer available in its governed catalogue." };
  }

  const categories = [...new Set([...sourceProducts.map(product => product.category), ...targetProducts.map(product => product.category)])].sort();
  const mappings: StandingSlotProductMapping[] = [];
  for (const category of categories) {
    const ordered = (products: GrabAndGoProduct[]) => products
      .filter(product => product.category === category)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.productId.localeCompare(b.productId));
    const source = ordered(sourceProducts);
    const target = ordered(targetProducts);
    if (source.length !== target.length) {
      return { ok: false, reason: `Week catalogues have different numbers of ${category} products; choose an explicit product mapping instead.` };
    }
    if (new Set(source.map(product => product.sortOrder)).size !== source.length || new Set(target.map(product => product.sortOrder)).size !== target.length) {
      return { ok: false, reason: `The ${category} catalogue positions are not unique, so the copy is ambiguous.` };
    }
    for (let index = 0; index < source.length; index++) {
      const sourceProduct = source[index];
      const targetProduct = target[index];
      mappings.push({
        sourceProductId: sourceProduct.productId,
        sourceName: sourceProduct.name,
        targetProductId: targetProduct.productId,
        targetName: targetProduct.name,
        category,
        quantity: sourceQuantities[sourceProduct.productId] || 0,
      });
    }
  }
  return { ok: true, mappings };
}
