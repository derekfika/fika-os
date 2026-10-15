import { normaliseOperationalAllergens, type OperationalAllergenState } from "../../../shared/allergen-contract";

/** A row with no recorded assessment carries no allergen values; every cell then renders neutral. */
export function emptyAllergens(): Record<string, OperationalAllergenState> {
  return {};
}

/** Missing values stay absent (unrecorded). Only states actually stored are hydrated. */
export function hydrateSavedAllergens(saved: Record<string, unknown> | undefined): Record<string, OperationalAllergenState> {
  return Object.keys(saved || {}).length ? normaliseOperationalAllergens(saved) : emptyAllergens();
}

export function cellState(allergens: Record<string, OperationalAllergenState> | undefined, key: string): OperationalAllergenState {
  return allergens?.[key] || "unrecorded";
}

/** Unrecorded is neutral/blank on screen; it is never rendered as an explicit clear and still blocks completion. */
export function cellLabel(state: OperationalAllergenState): string {
  return state === "may_contain" ? "MC" : "";
}
