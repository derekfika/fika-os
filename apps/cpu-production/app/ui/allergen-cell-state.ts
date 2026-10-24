import { deriveNoKeyAllergens, normaliseOperationalAllergens, type OperationalAllergenState } from "../../../shared/allergen-contract";
import { rowPositives } from "../../../shared/allergen-review";

/** A row with no recorded assessment carries no allergen values; every cell then renders neutral. */
export function emptyAllergens(): Record<string, OperationalAllergenState> {
  return {};
}

/** Missing values stay absent (unrecorded). Only states actually stored are hydrated. */
export function hydrateSavedAllergens(saved: Record<string, unknown> | undefined): Record<string, OperationalAllergenState> {
  return Object.keys(saved || {}).length ? normaliseOperationalAllergens(saved) : emptyAllergens();
}

/**
 * "No key allergens" is a consequence of the 14 named allergens, never an input: any positive named state makes it clear,
 * all named explicitly clear makes it contains, otherwise it stays unrecorded. Named evidence is never altered by it.
 */
export function derivedNoKeyState(allergens: Record<string, OperationalAllergenState> | undefined): OperationalAllergenState {
  return deriveNoKeyAllergens({ ...(allergens || {}) }).no_key_allergens;
}

export function cellState(allergens: Record<string, OperationalAllergenState> | undefined, key: string): OperationalAllergenState {
  return allergens?.[key] || "unrecorded";
}

/** Unrecorded is neutral/blank on screen; it is never rendered as an explicit clear and still blocks completion. */
export function cellLabel(state: OperationalAllergenState): string {
  return state === "may_contain" ? "MC" : "";
}

/**
 * What clicking an allergen cell does in the CPU review. "No key allergens" is derived and never changes. A white cell (clear or
 * not yet confirmed) behaves as white: the first click declares Contains, then May Contain, then back to white (unrecorded).
 * Nothing is recorded as Clear by a click: any edit reopens the row, so Clears that came from an earlier confirmation revert to
 * unrecorded and only the chef's explicit positives remain until the row is confirmed again with Mark checked.
 */
export function applyHospitalityCellClick(allergens: Record<string, OperationalAllergenState>, key: string): Record<string, OperationalAllergenState> {
  if (key === "no_key_allergens") return allergens;
  const next = { ...rowPositives(allergens) } as Record<string, OperationalAllergenState>;
  if (next[key] === "contains") next[key] = "may_contain";
  else if (next[key] === "may_contain") delete next[key];
  else next[key] = "contains";
  return deriveNoKeyAllergens(next);
}
