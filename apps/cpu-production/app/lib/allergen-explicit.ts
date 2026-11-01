import { CANONICAL_ALLERGEN_KEYS, type CanonicalAllergenMap, type OperationalAllergenState } from "../../../shared/allergen-contract";
import {
  declareNoKey, isExplicitRowConfirmed, namedPositives, readExplicitAllergens, reopenRowExplicit, rowDeclarationState, selectNamedAllergen,
  storedExplicitAllergens, withdrawNoKey, type NoKeyDeclarationRecord, type StoredRowReview,
} from "../../../shared/allergen-declaration";

/**
 * Issue 225: CPU wiring of the shared explicit No Key declaration.
 *
 * "No Key Allergens" is a chef declaration, never an inference. A row with no boxes is BLANK (unverified) and is not the same as
 * a row where the chef deliberately ticked No Key. Older rows stored No Key as a value derived from "all named allergens clear";
 * those are reported as legacy and unverified, never converted into a declaration and never rewritten by a read.
 */
export type RowAllergenContext = { review?: StoredRowReview | null; declaration?: Partial<NoKeyDeclarationRecord> | null };

/**
 * blank: nothing recorded.
 * positives: named Contains / May contain recorded.
 * declared: the chef deliberately ticked No Key Allergens.
 * legacy_unverified: only a derived/automatic No Key (or all-clear) value from before explicit declarations; shown as unverified.
 * conflict: No Key together with named allergens; never valid.
 */
export type RowAttestation = "blank" | "positives" | "declared" | "legacy_unverified" | "conflict";

export function classifyRowAllergens(allergens: Record<string, unknown> | undefined, context: RowAllergenContext = {}): RowAttestation {
  const raw = readExplicitAllergens(allergens);
  const state = rowDeclarationState(storedExplicitAllergens(raw, context));
  if (state !== "blank") return state;
  const legacyValue = raw.no_key_allergens === "contains" || Object.entries(raw).some(([key, value]) => key !== "no_key_allergens" && value === "clear");
  return legacyValue ? "legacy_unverified" : "blank";
}

/** What the editor shows and edits: the stored map minus any legacy automatic No Key value. Clears are not edit state. */
export function editableAllergens(allergens: Record<string, unknown> | undefined, context: RowAllergenContext = {}): CanonicalAllergenMap {
  return reopenRowExplicit(storedExplicitAllergens(allergens, context));
}

export const isNoKeyTicked = (allergens: Record<string, unknown> | undefined, context: RowAllergenContext = {}) =>
  readExplicitAllergens(storedExplicitAllergens(allergens, context)).no_key_allergens === "contains";

/** Clicking a named allergen cell: Contains -> May contain -> blank. Selecting any allergen clears No Key; removing the last one leaves the row blank. */
export function cycleNamedAllergen(current: Record<string, unknown> | undefined, key: string, context: RowAllergenContext = {}): CanonicalAllergenMap {
  const base = editableAllergens(current, context);
  const positive = namedPositives(base)[key];
  const next = positive === "contains" ? "may_contain" : positive === "may_contain" ? null : "contains";
  const result = selectNamedAllergen(base, key as never, next, { acknowledgeNoKeyWithdrawal: true });
  if (!result.ok) throw new Error("Unexpected refusal while acknowledging the No Key withdrawal.");
  return result.allergens;
}

/** Ticking No Key clears every named allergen. Unticking returns the row to blank (never to an inferred value). */
export function toggleNoKey(current: Record<string, unknown> | undefined, context: RowAllergenContext = {}): CanonicalAllergenMap {
  const base = editableAllergens(current, context);
  if (base.no_key_allergens === "contains") return withdrawNoKey(base);
  const declared = declareNoKey({});
  if (!declared.ok) throw new Error("Unexpected refusal while declaring No Key Allergens.");
  return declared.allergens;
}

/** A client-side provisional record so a pending tick is honoured in the browser. The server discards it and stamps its own. */
export const PENDING_DECLARATION: NoKeyDeclarationRecord = { declared: true, declaredBy: "pending-save", declaredAt: "" };

const NAMED = CANONICAL_ALLERGEN_KEYS.filter(key => key !== "no_key_allergens");
export const sameNamedAllergens = (left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined) => {
  const a = readExplicitAllergens(left); const b = readExplicitAllergens(right);
  return NAMED.every(key => (a[key] ?? "unrecorded") === (b[key] ?? "unrecorded"));
};

type RowLike = { name: string; allergens: Record<string, unknown> | undefined; evidenceStatus: string; allergenReview?: StoredRowReview | null; noKeyDeclaration?: Partial<NoKeyDeclarationRecord> | null; mayContainNotes?: string };

/**
 * Whether a row holds a chef-verified allergen declaration: checked, and either named allergens or an explicit No Key. A blank row,
 * a legacy automatic No Key and a conflicting row are never verified.
 */
export function rowAttestation(row: RowLike): RowAttestation {
  return classifyRowAllergens(row.allergens, { review: row.allergenReview, declaration: row.noKeyDeclaration });
}
export const isRowVerified = (row: RowLike) => row.evidenceStatus === "completed" && ["positives", "declared"].includes(rowAttestation(row));

/** Used by tests and the server: a freshly confirmed explicit review is valid for exactly these inputs. */
export const explicitReviewMatches = (row: RowLike & { identity: string }) => isExplicitRowConfirmed({ allergens: row.allergens, review: row.allergenReview as never, identity: row.identity, mayContainNotes: row.mayContainNotes });

export type { OperationalAllergenState };
