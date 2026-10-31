/**
 * Contextual product-quantity minimums. Pure and shared by the Hub and the booking portals so display, controls and
 * server enforcement resolve the same number. The canonical catalogue minimum is never rewritten; the booking context
 * (customer + site) lowers the effective minimum at resolution time.
 *
 * Precedence (the result is the lowest applicable value, and never exceeds the catalogue minimum):
 *   1. catalogue minimum (Item default or governed site exception; 1 when unset)
 *   2. Gallagher bookings: any minimum above GALLAGHER_PRODUCT_MINIMUM_CAP is capped (established rule, site-agnostic)
 *   3. Site standard-minimum override: only a minimum equal to STANDARD_PRODUCT_MINIMUM is lowered, so fixed pack
 *      sizes and genuine product minimums (e.g. 12, 20) are left intact.
 * Quantity increments, platter sizes and option-group minimums are separate rules and are not touched here.
 */
export const STANDARD_PRODUCT_MINIMUM = 8;
export const GALLAGHER_PRODUCT_MINIMUM_CAP = 5;

/** Portal site key -> effective minimum for items that carry the standard minimum. Add a site here, nowhere else. */
export const SITE_STANDARD_MINIMUM_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({ "munich-re": 5 });

export type MinimumContext = { gallagher: boolean; siteId?: string | null };

export function normaliseMinimumContext(context: boolean | MinimumContext | undefined): MinimumContext {
  return typeof context === "object" && context !== null ? context : { gallagher: context === true };
}

export function effectiveProductMinimum(catalogueMinimum: number | undefined, context: boolean | MinimumContext | undefined): number {
  const { gallagher, siteId } = normaliseMinimumContext(context);
  const base = Number.isFinite(catalogueMinimum) && (catalogueMinimum as number) >= 1 ? (catalogueMinimum as number) : 1;
  let effective = base;
  if (gallagher) effective = Math.min(effective, GALLAGHER_PRODUCT_MINIMUM_CAP);
  const override = siteId ? SITE_STANDARD_MINIMUM_OVERRIDES[siteId] : undefined;
  if (override !== undefined && base === STANDARD_PRODUCT_MINIMUM) effective = Math.min(effective, override);
  return effective;
}
