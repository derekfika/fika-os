import { CANONICAL_ALLERGEN_KEYS, deriveNoKeyAllergens, isCompleteOperationalAllergenMap, normaliseOperationalAllergens, type CanonicalAllergenKey, type CanonicalAllergenMap } from "./allergen-contract";

/**
 * Row-level allergen confirmation. A blank named allergen means "not present" ONLY on a row a chef has
 * explicitly confirmed. Before confirmation a blank stays unrecorded; confirmation records the blanks as
 * explicit `clear`, keeps every explicit contains/may_contain, and stamps who confirmed and when.
 * The review record is workflow evidence: it is NOT part of the allergen matrix content hash.
 */
export const ROW_CONFIRMATION_STATEMENT = "recipe-ingredients-allergens-verified";
export const ROW_CONFIRMATION_SEMANTICS = 2;
export type AllergenRowReview = {
  status: "confirmed";
  semantics: typeof ROW_CONFIRMATION_SEMANTICS;
  confirmedBy: string;
  confirmedAt: string;
  statement: typeof ROW_CONFIRMATION_STATEMENT;
  inputFingerprint: string;
};
type Positive = "contains" | "may_contain";
const NAMED_KEYS = CANONICAL_ALLERGEN_KEYS.filter((key): key is Exclude<CanonicalAllergenKey, "no_key_allergens"> => key !== "no_key_allergens");

/** Only explicit contains / may_contain values; blanks and clears are not evidence of presence. */
export function rowPositives(allergens: Record<string, unknown> | undefined): Record<string, Positive> {
  const normalised = normaliseOperationalAllergens(allergens);
  const result: Record<string, Positive> = {};
  for (const key of NAMED_KEYS) {
    const value = normalised[key];
    if (value === "contains" || value === "may_contain") result[key] = value;
  }
  return result;
}

/** Stable, hash-free identity of exactly what a chef reviewed: row identity, positives and may-contain notes. */
export function rowFingerprint(identity: string, allergens: Record<string, unknown> | undefined, mayContainNotes?: string): string {
  const positives = rowPositives(allergens);
  return JSON.stringify([identity.trim().toLocaleLowerCase("en-GB"), NAMED_KEYS.filter((key) => positives[key]).map((key) => [key, positives[key]]), (mayContainNotes || "").trim()]);
}

export type ConfirmRowInput = { allergens: Record<string, unknown> | undefined; identity: string; mayContainNotes?: string; actor: string; now: string };
export type ConfirmedRow = { allergens: CanonicalAllergenMap; review: AllergenRowReview };

/** unchecked -> confirmed. Refuses an unnamed row or an unattributed confirmation. */
export function confirmRow(input: ConfirmRowInput): ConfirmedRow {
  if (!input.identity?.trim()) throw new Error("A named dish or row is required before an allergen review can be confirmed.");
  if (!input.actor?.trim()) throw new Error("An authenticated reviewer is required to confirm an allergen review.");
  const positives = rowPositives(input.allergens);
  const allergens = deriveNoKeyAllergens(Object.fromEntries(NAMED_KEYS.map((key) => [key, positives[key] ?? "clear"])));
  return { allergens, review: { status: "confirmed", semantics: ROW_CONFIRMATION_SEMANTICS, confirmedBy: input.actor.trim(), confirmedAt: input.now, statement: ROW_CONFIRMATION_STATEMENT, inputFingerprint: rowFingerprint(input.identity, positives, input.mayContainNotes) } };
}

/** confirmed -> unchecked. Derived clears revert to unrecorded; only explicit positives survive. */
export function reopenRow(allergens: Record<string, unknown> | undefined): CanonicalAllergenMap {
  return deriveNoKeyAllergens(rowPositives(allergens));
}

/** A row is confirmed only if the record is current-semantics, attributed, matches the present inputs and the map is complete. */
export function isRowConfirmed(row: { allergens: Record<string, unknown> | undefined; review?: Partial<AllergenRowReview> | null; identity: string; mayContainNotes?: string }): boolean {
  const review = row.review;
  return Boolean(review && review.status === "confirmed" && review.semantics === ROW_CONFIRMATION_SEMANTICS && review.statement === ROW_CONFIRMATION_STATEMENT && review.confirmedBy && review.confirmedAt
    && review.inputFingerprint === rowFingerprint(row.identity, row.allergens, row.mayContainNotes)
    && isCompleteOperationalAllergenMap(normaliseOperationalAllergens(row.allergens)));
}

/** Whether a material edit (identity, positives or may-contain note) invalidates an existing confirmation. */
export function confirmationInvalidatedBy(review: Partial<AllergenRowReview> | null | undefined, next: { identity: string; allergens: Record<string, unknown> | undefined; mayContainNotes?: string }): boolean {
  return Boolean(review?.inputFingerprint) && review!.inputFingerprint !== rowFingerprint(next.identity, next.allergens, next.mayContainNotes);
}
