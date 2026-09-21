import {
  CANONICAL_ALLERGEN_COLUMNS,
  deriveNoKeyAllergens,
  type CanonicalAllergenKey,
  type OperationalAllergenState,
} from "../../../shared/allergen-contract";

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
 * A chef reviews named allergens. No-key allergens are a derived consequence
 * of that complete named review and must never be used to hide an unresolved
 * named state.
 */
export function completeAllergenReviewMap(
  states: Record<string, OperationalAllergenState> | undefined,
): AllergenReviewCompletion {
  const current = { ...(states || {}) };
  const unresolvedKeys = unresolvedNamedAllergenKeys(current);
  if (unresolvedKeys.length > 0) {
    return { complete: false, states: current, unresolvedKeys };
  }

  const resolved = deriveNoKeyAllergens(current);
  return { complete: true, states: resolved, unresolvedKeys: [] };
}

/**
 * Explicitly confirms the current CPU review. This is intentionally separate
 * from hydration/display logic: only an authorised row checkpoint may turn
 * upstream unrecorded or missing named states into reviewed clear states.
 */
export function confirmAllergenReviewMap(
  states: Record<string, OperationalAllergenState> | undefined,
): AllergenReviewCompletion {
  const confirmed = { ...(states || {}) };
  const unresolvedKeys = unresolvedNamedAllergenKeys(confirmed);
  for (const key of unresolvedKeys) confirmed[key] = "clear";
  return {
    complete: true,
    states: deriveNoKeyAllergens(confirmed),
    unresolvedKeys,
  };
}

export function allergenReviewCompletionMessage(
  unresolvedKeys: CanonicalAllergenKey[],
) {
  const labels = unresolvedKeys
    .flatMap((key) => {
      const column = CANONICAL_ALLERGEN_COLUMNS.find(([candidate]) => candidate === key);
      return column ? [column[1]] : [];
    });
  const noun = unresolvedKeys.length === 1 ? "state" : "states";
  return `Resolve ${unresolvedKeys.length} Not recorded allergen ${noun} before marking this dish checked.${labels.length ? ` Remaining: ${labels.join(", ")}.` : ""}`;
}

export function checkpointAllergenReviewRow(
  states: Record<string, Record<string, OperationalAllergenState>>,
  checkedRows: ReadonlySet<string>,
  rowKey: string,
  rowCount: number,
): AllergenReviewCheckpoint {
  const nextCheckedRows = new Set(checkedRows);
  const isChecked = nextCheckedRows.has(rowKey);
  let nextStates = states;
  if (!isChecked) {
    nextStates = { ...states, [rowKey]: confirmAllergenReviewMap(states[rowKey]).states };
    nextCheckedRows.add(rowKey);
  } else {
    nextCheckedRows.delete(rowKey);
  }
  if (nextCheckedRows.size === rowCount) {
    const canonicalStates = { ...nextStates };
    for (const checkedRowKey of nextCheckedRows) {
      canonicalStates[checkedRowKey] = confirmAllergenReviewMap(canonicalStates[checkedRowKey]).states;
    }
    nextStates = canonicalStates;
  }
  return {
    blocked: false,
    states: nextStates,
    checkedRows: nextCheckedRows,
    action: nextCheckedRows.size === rowCount ? "mark-planned" : "save-plan",
  };
}
