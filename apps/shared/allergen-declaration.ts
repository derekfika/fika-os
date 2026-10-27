import { CANONICAL_ALLERGEN_KEYS, toCanonicalAllergenKey, type CanonicalAllergenKey, type CanonicalAllergenMap, type OperationalAllergenState } from "./allergen-contract";
import { ROW_CONFIRMATION_STATEMENT, isRowConfirmed, type AllergenRowReview } from "./allergen-review";

/**
 * FEAT-034 explicit No Key declaration.
 *
 * "No key allergens" is a chef declaration, never an inference. It is stored in the existing `no_key_allergens` slot:
 *   - `contains`  = the chef declared "No key allergens" (displayed Yes once the row is checked)
 *   - `clear`     = the chef reviewed named allergens and at least one is present
 *   - absent / `unrecorded` = no declaration
 * Nothing in this module derives the declaration from the 14 named allergens, and nothing here changes the behaviour of
 * `allergen-contract.ts` or `allergen-review.ts`, which legacy consumers (semantics 2 reviews) still use unchanged.
 */
export const EXPLICIT_REVIEW_SEMANTICS = 3 as const;
export type ExplicitRowReview = Omit<AllergenRowReview, "semantics"> & { semantics: typeof EXPLICIT_REVIEW_SEMANTICS };
type Positive = "contains" | "may_contain";
type NamedKey = Exclude<CanonicalAllergenKey, "no_key_allergens">;
const NAMED_KEYS = CANONICAL_ALLERGEN_KEYS.filter((key): key is NamedKey => key !== "no_key_allergens");

/** Reads a stored allergen map exactly as recorded: legacy keys are mapped, nothing is derived, unknown keys are dropped. */
export function readExplicitAllergens(input: Record<string, unknown> | undefined): CanonicalAllergenMap {
  const result: CanonicalAllergenMap = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = toCanonicalAllergenKey(rawKey);
    if (key && (rawValue === "clear" || rawValue === "contains" || rawValue === "may_contain" || rawValue === "unrecorded")) result[key] = rawValue;
  }
  return result;
}

export function namedPositives(input: Record<string, unknown> | undefined): Record<string, Positive> {
  const map = readExplicitAllergens(input);
  const result: Record<string, Positive> = {};
  for (const key of NAMED_KEYS) if (map[key] === "contains" || map[key] === "may_contain") result[key] = map[key] as Positive;
  return result;
}

export const isNoKeyDeclared = (input: Record<string, unknown> | undefined) => readExplicitAllergens(input).no_key_allergens === "contains";

/** blank = nothing recorded; positives = named allergens only; declared = No key declared only; conflict = both (never a valid review). */
export type RowDeclarationState = "blank" | "positives" | "declared" | "conflict";
export function rowDeclarationState(input: Record<string, unknown> | undefined): RowDeclarationState {
  const positives = Object.keys(namedPositives(input)).length > 0;
  const declared = isNoKeyDeclared(input);
  return positives && declared ? "conflict" : declared ? "declared" : positives ? "positives" : "blank";
}

/** Identity of exactly what the chef reviewed. Unlike the semantics-2 fingerprint it includes the explicit No Key declaration. */
export function explicitRowFingerprint(identity: string, input: Record<string, unknown> | undefined, mayContainNotes?: string): string {
  const positives = namedPositives(input);
  return JSON.stringify([
    "v3", identity.trim().toLocaleLowerCase("en-GB"),
    NAMED_KEYS.filter((key) => positives[key]).map((key) => [key, positives[key]]),
    isNoKeyDeclared(input),
    (mayContainNotes || "").trim(),
  ]);
}

export type DeclarationResult = { ok: true; allergens: CanonicalAllergenMap } | { ok: false; reason: "named_positives_present"; positives: Record<string, Positive> };

/** Chef selects No key allergens. Never erases recorded Contains / May contain: the conflict is returned for the chef to resolve. */
export function declareNoKey(input: Record<string, unknown> | undefined): DeclarationResult {
  const positives = namedPositives(input);
  if (Object.keys(positives).length) return { ok: false, reason: "named_positives_present", positives };
  return { ok: true, allergens: { ...readExplicitAllergens(input), no_key_allergens: "contains" } };
}

/** Chef withdraws the No key declaration. The row returns to blank; named values are untouched. */
export function withdrawNoKey(input: Record<string, unknown> | undefined): CanonicalAllergenMap {
  const map = readExplicitAllergens(input);
  delete map.no_key_allergens;
  return map;
}

export type SelectResult = { ok: true; allergens: CanonicalAllergenMap } | { ok: false; reason: "no_key_declared" };

/**
 * Chef sets a named allergen to Contains / May contain, or back to blank (null). While No key is declared a named positive is
 * refused until the chef deliberately acknowledges that they are withdrawing the declaration; the declaration is preserved until then.
 */
export function selectNamedAllergen(input: Record<string, unknown> | undefined, key: NamedKey, next: Positive | null, options: { acknowledgeNoKeyWithdrawal?: boolean } = {}): SelectResult {
  const map = readExplicitAllergens(input);
  if (next && isNoKeyDeclared(map) && !options.acknowledgeNoKeyWithdrawal) return { ok: false, reason: "no_key_declared" };
  const result = next && isNoKeyDeclared(map) ? withdrawNoKey(map) : map;
  if (next) result[key] = next; else delete result[key];
  return { ok: true, allergens: result };
}

export type ConfirmExplicitInput = { allergens: Record<string, unknown> | undefined; identity: string; mayContainNotes?: string; actor: string; now: string };
export type ConfirmedExplicitRow = { allergens: CanonicalAllergenMap; review: ExplicitRowReview };

/**
 * Mark checked. Requires a named row, an attributed reviewer and a real declaration: at least one named allergen, or an explicit
 * No key declaration. Blank named allergens become confirmed Clear; recorded Contains / May contain are kept; the No key slot is
 * `contains` for a declaration and `clear` otherwise. A conflicting row is refused.
 */
export function confirmRowExplicit(input: ConfirmExplicitInput): ConfirmedExplicitRow {
  if (!input.identity?.trim()) throw new Error("A named dish or row is required before an allergen review can be confirmed.");
  if (!input.actor?.trim()) throw new Error("An authenticated reviewer is required to confirm an allergen review.");
  const state = rowDeclarationState(input.allergens);
  if (state === "conflict") throw new Error("No key allergens conflicts with recorded Contains or May contain values. Resolve the conflict before marking this row checked.");
  if (state === "blank") throw new Error("Record at least one allergen or declare No key allergens before marking this row checked.");
  const positives = namedPositives(input.allergens);
  const allergens: CanonicalAllergenMap = Object.fromEntries(NAMED_KEYS.map((key) => [key, (positives[key] ?? "clear") as OperationalAllergenState]));
  allergens.no_key_allergens = state === "declared" ? "contains" : "clear";
  return {
    allergens,
    review: { status: "confirmed", semantics: EXPLICIT_REVIEW_SEMANTICS, confirmedBy: input.actor.trim(), confirmedAt: input.now, statement: ROW_CONFIRMATION_STATEMENT, inputFingerprint: explicitRowFingerprint(input.identity, allergens, input.mayContainNotes) },
  };
}

/** checked -> unchecked. Confirmed Clears revert to blank; Contains / May contain and an explicit declaration are kept, pending re-check. */
export function reopenRowExplicit(input: Record<string, unknown> | undefined): CanonicalAllergenMap {
  const map = readExplicitAllergens(input);
  const result: CanonicalAllergenMap = { ...namedPositives(map) };
  if (isNoKeyDeclared(map)) result.no_key_allergens = "contains";
  return result;
}

const isExplicitComplete = (map: CanonicalAllergenMap) => CANONICAL_ALLERGEN_KEYS.every((key) => map[key] === "clear" || map[key] === "contains" || map[key] === "may_contain");

/** A semantics-3 review is valid only for the exact reviewed inputs, with a complete, conflict-free map and a consistent No key slot. */
export function isExplicitRowConfirmed(row: { allergens: Record<string, unknown> | undefined; review?: Partial<ExplicitRowReview> | null; identity: string; mayContainNotes?: string }): boolean {
  const review = row.review;
  const map = readExplicitAllergens(row.allergens);
  const state = rowDeclarationState(map);
  if (!review || review.status !== "confirmed" || review.semantics !== EXPLICIT_REVIEW_SEMANTICS || review.statement !== ROW_CONFIRMATION_STATEMENT || !review.confirmedBy || !review.confirmedAt) return false;
  if (review.inputFingerprint !== explicitRowFingerprint(row.identity, map, row.mayContainNotes)) return false;
  if (!isExplicitComplete(map) || state === "conflict" || state === "blank") return false;
  return state === "declared" ? true : map.no_key_allergens === "clear";
}

/** Server-stamped record of a chef's pending (not yet checked) No key declaration. Distinguishes it from a legacy derived value. */
export type NoKeyDeclarationRecord = { declared: true; declaredBy: string; declaredAt: string };

/**
 * The allergen map as the explicit workflow must read it. Legacy rows store a *derived* `no_key_allergens` (contains when every
 * named allergen was clear); that is not a chef declaration. The slot is honoured only when the row carries a semantics-3 review
 * or an explicit declaration record; otherwise it is dropped so a legacy value is never reinterpreted as a declaration.
 */
export function storedExplicitAllergens(allergens: Record<string, unknown> | undefined, context: { review?: { semantics?: number } | null; declaration?: Partial<NoKeyDeclarationRecord> | null }): CanonicalAllergenMap {
  const map = readExplicitAllergens(allergens);
  const explicit = context.review?.semantics === EXPLICIT_REVIEW_SEMANTICS || Boolean(context.declaration?.declared);
  if (!explicit) delete map.no_key_allergens;
  return map;
}

/** A review exactly as stored: any semantics version, any shape. */
export type StoredRowReview = { semantics?: number; status?: string; confirmedBy?: string; confirmedAt?: string; statement?: string; inputFingerprint?: string };
export type RowReviewStatus = "unchecked" | "checked" | "checked_legacy" | "conflict";
/**
 * Row-level status. A semantics-2 review (No key was derived at the time) stays valid but is reported as `checked_legacy`;
 * it is never reinterpreted as an explicit declaration and never rewritten.
 */
export function rowReviewStatus(row: { allergens: Record<string, unknown> | undefined; review?: StoredRowReview | null; declaration?: Partial<NoKeyDeclarationRecord> | null; identity: string; mayContainNotes?: string }): RowReviewStatus {
  const stored = storedExplicitAllergens(row.allergens, { review: row.review, declaration: row.declaration });
  if (rowDeclarationState(stored) === "conflict") return "conflict";
  if (row.review?.semantics === EXPLICIT_REVIEW_SEMANTICS) return isExplicitRowConfirmed({ ...row, allergens: stored } as unknown as Parameters<typeof isExplicitRowConfirmed>[0]) ? "checked" : "unchecked";
  if (row.review?.semantics === 2) return isRowConfirmed(row as unknown as Parameters<typeof isRowConfirmed>[0]) ? "checked_legacy" : "unchecked";
  return "unchecked";
}

/** Material edit check: a previous confirmation no longer applies if identity, positives, the declaration or the note changed. */
export function explicitConfirmationInvalidatedBy(review: { inputFingerprint?: string } | null | undefined, next: { identity: string; allergens: Record<string, unknown> | undefined; mayContainNotes?: string }): boolean {
  return Boolean(review?.inputFingerprint) && review!.inputFingerprint !== explicitRowFingerprint(next.identity, next.allergens, next.mayContainNotes);
}
