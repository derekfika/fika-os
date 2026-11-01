import {
  CANONICAL_ALLERGEN_COLUMNS,
  type CanonicalAllergenKey,
  type OperationalAllergenState,
} from "../../../shared/allergen-contract";
import { namedPositives } from "../../../shared/allergen-declaration";
import { PENDING_DECLARATION, classifyRowAllergens, editableAllergens, type RowAllergenContext } from "./allergen-explicit";

const EXPLICIT_REVIEW_STATES = new Set<OperationalAllergenState>([
  "clear",
  "contains",
  "may_contain",
]);

export type AllergenReviewCompletion = {
  complete: boolean;
  states: Record<string, OperationalAllergenState>;
  unresolvedKeys: CanonicalAllergenKey[];
};

export type AllergenReviewCheckpoint = {
  blocked: boolean;
  states: Record<string, Record<string, OperationalAllergenState>>;
  checkedRows: Set<string>;
  action?: "save-plan" | "mark-planned";
  message?: string;
};

export function unresolvedNamedAllergenKeys(
  states: Record<string, OperationalAllergenState> | undefined,
) {
  return CANONICAL_ALLERGEN_COLUMNS
    .filter(([key]) => key !== "no_key_allergens")
    .filter(([key]) => !EXPLICIT_REVIEW_STATES.has(states?.[key] || "unrecorded"))
    .map(([key]) => key);
}

/**
 * Completion of a NAMED review. Issue 225: No Key Allergens is a deliberate declaration, never derived here, so this no longer
 * adds or changes it. It only reports whether every named allergen holds an explicit state.
 */
export function completeAllergenReviewMap(
  states: Record<string, OperationalAllergenState> | undefined,
): AllergenReviewCompletion {
  const current = { ...(states || {}) };
  const unresolvedKeys = unresolvedNamedAllergenKeys(current);
  return { complete: unresolvedKeys.length === 0, states: current, unresolvedKeys };
}

export type AllergenReviewConfirmation = AllergenReviewCompletion & {
  /** Why the row cannot be marked checked: it holds neither an allergen nor a deliberate No Key Allergens tick. */
  blocked?: "blank" | "legacy_unverified" | "conflict";
};

/**
 * Explicitly confirms the current CPU review of ONE row. Only an authorised row checkpoint may turn unticked named allergens into
 * reviewed Clear. A row must first hold at least one named allergen or a deliberate No Key Allergens tick: a blank row (or one whose
 * only No Key value is a legacy automatic one) is refused and returned unchanged.
 */
export function confirmAllergenReviewMap(
  states: Record<string, OperationalAllergenState> | undefined,
  context: RowAllergenContext = {},
): AllergenReviewConfirmation {
  const current = { ...(states || {}) };
  const attestation = classifyRowAllergens(current, context);
  if (attestation !== "positives" && attestation !== "declared") {
    return { complete: false, states: current, unresolvedKeys: unresolvedNamedAllergenKeys(current), blocked: attestation };
  }
  const positives = namedPositives(current);
  const confirmed: Record<string, OperationalAllergenState> = {};
  for (const [key] of CANONICAL_ALLERGEN_COLUMNS) if (key !== "no_key_allergens") confirmed[key] = positives[key] ?? "clear";
  confirmed.no_key_allergens = attestation === "declared" ? "contains" : "clear";
  return { complete: true, states: confirmed, unresolvedKeys: unresolvedNamedAllergenKeys(current) };
}

export const BLOCKED_ROW_MESSAGES = {
  blank: "Select the allergens this dish contains, or tick No Key Allergens, before marking it checked. A blank row is not verified.",
  legacy_unverified: "No Key Allergens was set automatically earlier and is not verified. Select the allergens or tick No Key Allergens yourself before marking it checked.",
  conflict: "No Key Allergens conflicts with a recorded allergen. Untick one before marking it checked.",
} as const;

export function checkpointAllergenReviewRow(
  states: Record<string, Record<string, OperationalAllergenState>>,
  checkedRows: ReadonlySet<string>,
  rowKey: string,
  rowCount: number,
  /** Rows where the chef deliberately ticked No Key Allergens in this review (or the server already holds a declaration). */
  explicitNoKeyRows: ReadonlySet<string> = new Set(),
): AllergenReviewCheckpoint {
  const contextFor = (key: string): RowAllergenContext => explicitNoKeyRows.has(key) ? { declaration: PENDING_DECLARATION } : {};
  const nextCheckedRows = new Set(checkedRows);
  const isChecked = nextCheckedRows.has(rowKey);
  let nextStates = states;
  if (!isChecked) {
    const confirmation = confirmAllergenReviewMap(states[rowKey], contextFor(rowKey));
    if (confirmation.blocked) return { blocked: true, states, checkedRows: new Set(checkedRows), message: BLOCKED_ROW_MESSAGES[confirmation.blocked] };
    nextStates = { ...states, [rowKey]: confirmation.states };
    nextCheckedRows.add(rowKey);
  } else {
    nextCheckedRows.delete(rowKey);
    // Unchecking reopens the row: confirmed Clears revert to blank; positives and a deliberate No Key tick remain.
    nextStates = { ...states, [rowKey]: editableAllergens(states[rowKey], contextFor(rowKey)) as Record<string, OperationalAllergenState> };
  }
  return {
    blocked: false,
    states: nextStates,
    checkedRows: nextCheckedRows,
    action: nextCheckedRows.size === rowCount ? "mark-planned" : "save-plan",
  };
}
