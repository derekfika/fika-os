import { CANONICAL_ALLERGEN_KEYS, type CanonicalAllergenMap } from "./fika-contracts";
import type { RollingEntry } from "./rolling-menu-types";

type Evidence = { allergen: string; value: "contains" | "free_from" | "may_contain" | "unknown" };
export type CanonicalDishAllergenSource = { canonicalId: string; displayName: string; allergenEvidence: Evidence[]; mayContainReviewed: boolean; mayContainNotes?: string };
const emptyMap = (): CanonicalAllergenMap => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, "clear" as const]));
const validEvidence = (value: string) => value === "contains" || value === "free_from" || value === "may_contain";

/** Resolves the exact operational allergen snapshot used by readiness, preview, hashing and publication. */
export function resolveAllergenSnapshot(entry: Pick<RollingEntry, "allergens" | "allergenReviewInvalidated" | "itemId" | "itemLabel">, canonicalDish?: CanonicalDishAllergenSource) {
  const explicit = entry.allergens || {};
  const hasExplicitReview = entry.allergenReviewInvalidated === false || Object.entries(explicit).some(([key, value]) => CANONICAL_ALLERGEN_KEYS.includes(key as typeof CANONICAL_ALLERGEN_KEYS[number]) && value !== "clear");
  if (hasExplicitReview) return { allergens: { ...emptyMap(), ...explicit }, mayContainNotes: undefined as string | undefined, unresolved: [] as string[] };
  if (entry.allergenReviewInvalidated === true) return { allergens: emptyMap(), mayContainNotes: undefined, unresolved: ["The menu-entry allergen review was invalidated after the dish changed."] };
  if (!canonicalDish || (entry.itemId && canonicalDish.canonicalId !== entry.itemId)) return { allergens: emptyMap(), mayContainNotes: undefined, unresolved: ["No governed allergen evidence is available for this dish."] };
  const unresolved = canonicalDish.allergenEvidence.filter(evidence => evidence.value === "unknown" || !validEvidence(evidence.value)).map(evidence => evidence.allergen);
  if (!canonicalDish.mayContainReviewed) unresolved.push("review");
  if (unresolved.length) return { allergens: emptyMap(), mayContainNotes: canonicalDish.mayContainNotes, unresolved };
  const allergens = emptyMap();
  for (const evidence of canonicalDish.allergenEvidence as Evidence[]) {
    if (!CANONICAL_ALLERGEN_KEYS.includes(evidence.allergen as typeof CANONICAL_ALLERGEN_KEYS[number])) continue;
    if (evidence.value === "contains" || evidence.value === "may_contain") allergens[evidence.allergen as keyof CanonicalAllergenMap] = evidence.value;
  }
  if (allergens.no_key_allergens !== "clear" && Object.entries(allergens).some(([key, value]) => key !== "no_key_allergens" && value !== "clear")) allergens.no_key_allergens = "clear";
  return { allergens, mayContainNotes: canonicalDish.mayContainNotes, unresolved: [] as string[] };
}
