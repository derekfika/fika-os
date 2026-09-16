import { CANONICAL_ALLERGEN_KEYS, deriveNoKeyAllergens, normaliseOperationalAllergens, type CanonicalAllergenMap } from "./fika-contracts";
import type { RollingEntry } from "./rolling-menu-types";

type Evidence = { allergen: string; value: "contains" | "free_from" | "may_contain" | "unknown" };
export type CanonicalDishAllergenSource = { canonicalId: string; displayName: string; allergenEvidence: Evidence[]; mayContainReviewed: boolean; mayContainNotes?: string };
const confirmedEmptyMap = (): CanonicalAllergenMap => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, "clear" as const]));
const missingMap = (): CanonicalAllergenMap => ({ no_key_allergens: "unrecorded" });
const validEvidence = (value: string) => value === "contains" || value === "free_from" || value === "may_contain";
const completeMap = (allergens: CanonicalAllergenMap) => CANONICAL_ALLERGEN_KEYS.every(key => allergens[key] === "clear" || allergens[key] === "contains" || allergens[key] === "may_contain");
export type AllergenEvidenceStatus = "confirmed" | "unreviewed" | "missing" | "conflicting";
export type AllergenResolution = { allergens: CanonicalAllergenMap; mayContainNotes?: string; unresolved: string[]; evidenceStatus: AllergenEvidenceStatus; evidenceReason?: string; structuralIssue?: boolean };

/** Resolves the exact operational allergen snapshot used by readiness, preview, hashing and publication. */
export function resolveAllergenSnapshot(entry: Pick<RollingEntry, "allergens" | "allergenReviewInvalidated" | "itemId" | "itemLabel">, canonicalDish?: CanonicalDishAllergenSource): AllergenResolution {
  const explicit = deriveNoKeyAllergens(normaliseOperationalAllergens(entry.allergens || {}));
  if (entry.itemId && (!canonicalDish || canonicalDish.canonicalId !== entry.itemId)) return { allergens: missingMap(), mayContainNotes: undefined, unresolved: ["The referenced canonical dish is not available from the authoritative catalogue."], evidenceStatus: "conflicting", evidenceReason: "authoritative-catalogue-dish-missing", structuralIssue: true };
  const hasExplicitReview = entry.allergenReviewInvalidated === false;
  if (hasExplicitReview) return { allergens: explicit, mayContainNotes: undefined, unresolved: completeMap(explicit) ? [] : ["The menu-entry allergen review is incomplete."], evidenceStatus: completeMap(explicit) ? "confirmed" : "unreviewed", evidenceReason: completeMap(explicit) ? undefined : "menu-entry-review-incomplete" };
  if (entry.allergenReviewInvalidated === true) return { allergens: missingMap(), mayContainNotes: undefined, unresolved: ["The menu-entry allergen review was invalidated after the dish changed."], evidenceStatus: "unreviewed", evidenceReason: "menu-entry-review-invalidated" };
  if (!canonicalDish) return { allergens: missingMap(), mayContainNotes: undefined, unresolved: ["No governed allergen evidence is available for this dish."], evidenceStatus: "missing", evidenceReason: "no-governed-allergen-evidence" };
  const unresolved = canonicalDish.allergenEvidence.filter(evidence => evidence.value === "unknown" || !validEvidence(evidence.value)).map(evidence => evidence.allergen);
  if (!canonicalDish.mayContainReviewed) unresolved.push("review");
  if (unresolved.length) return { allergens: missingMap(), mayContainNotes: canonicalDish.mayContainNotes, unresolved, evidenceStatus: unresolved.includes("review") && unresolved.length === 1 ? "unreviewed" : "conflicting", evidenceReason: unresolved.includes("review") && unresolved.length === 1 ? "may-contain-review-pending" : "catalogue-evidence-unresolved" };
  const allergens = confirmedEmptyMap();
  for (const evidence of canonicalDish.allergenEvidence as Evidence[]) {
    if (!CANONICAL_ALLERGEN_KEYS.includes(evidence.allergen as typeof CANONICAL_ALLERGEN_KEYS[number])) continue;
    if (evidence.value === "contains" || evidence.value === "may_contain") allergens[evidence.allergen as keyof CanonicalAllergenMap] = evidence.value;
  }
  return { allergens: deriveNoKeyAllergens(allergens), mayContainNotes: canonicalDish.mayContainNotes, unresolved: [] as string[], evidenceStatus: "confirmed" };
}
