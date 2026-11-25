import type { StudioChoicePresentation } from "./hospitality-menu-studio-selection";

/** Applies the allocation invariants shared by preview and the customer portal. */
export function validStudioAllocation(dishIds: readonly string[], presentation: StudioChoicePresentation | undefined, minimum: number, choice: unknown, quantity: number): choice is Record<string, number> {
  if (!choice || typeof choice !== "object" || Array.isArray(choice) || presentation === "checkboxes" || !Number.isSafeInteger(minimum) || minimum < 1 || !Number.isSafeInteger(quantity) || quantity < 1) return false;
  const available = new Set(dishIds);
  let total = 0, selected = 0;
  for (const [id, count] of Object.entries(choice)) {
    if (!available.has(id) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 0 && count < minimum) return false;
    total += count;
    if (count > 0) selected++;
  }
  return selected > 0 && Number.isSafeInteger(total) && total === quantity && (presentation !== "dropdown" || selected === 1);
}

/** A grouped customer choice partitions the published dishes; each group allocates only its own IDs. */
export function validStudioGroupedAllocation(
  dishIds: readonly string[],
  presentation: StudioChoicePresentation | undefined,
  groups: readonly { id?: string; presentation: StudioChoicePresentation; dishIds: readonly string[] }[] | undefined,
  minimum: number,
  choice: unknown,
  quantity: number,
): choice is Record<string, number> {
  if (!groups?.length) return validStudioAllocation(dishIds, presentation, minimum, choice, quantity);
  if (presentation !== "quantities" || !choice || typeof choice !== "object" || Array.isArray(choice) || !Number.isSafeInteger(minimum) || minimum < 1 ||
      !Number.isSafeInteger(quantity) || quantity < 1) return false;
  const all = new Set(dishIds);
  if (!all.size || all.size !== dishIds.length || groups.some(group => !group.id || !group.dishIds.length) ||
      new Set(groups.map(group => group.id)).size !== groups.length) return false;
  const assigned = groups.flatMap(group => [...group.dishIds]);
  if (new Set(assigned).size !== assigned.length || assigned.length !== all.size || assigned.some(id => !all.has(id))) return false;
  const allocation = choice as Record<string, unknown>;
  let total = 0;
  for (const [id, count] of Object.entries(allocation)) {
    if (!all.has(id) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 ||
        (count > 0 && count < minimum)) return false;
    total += count;
  }
  if (!Number.isSafeInteger(total) || total !== quantity || total < 1) return false;
  for (const group of groups) {
    if (group.presentation !== "quantities") return false;
  }
  return true;
}
