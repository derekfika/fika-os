import type { StudioChoicePresentation } from "./hospitality-menu-studio-selection";

/** Applies the allocation invariants shared by preview and the customer portal. */
export function validStudioAllocation(dishIds: readonly string[], presentation: StudioChoicePresentation | undefined, minimum: number, choice: unknown, quantity: number): choice is Record<string, number> {
  if (!choice || typeof choice !== "object" || Array.isArray(choice) || presentation === "checkboxes" || !Number.isSafeInteger(minimum) || minimum < 1) return false;
  const available = new Set(dishIds);
  let total = 0, selected = 0;
  for (const [id, count] of Object.entries(choice)) {
    if (!available.has(id) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 0 && count < minimum) return false;
    total += count;
    if (count > 0) selected++;
  }
  return selected > 0 && total === quantity && (presentation !== "dropdown" || selected === 1);
}
