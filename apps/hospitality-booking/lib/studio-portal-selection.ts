import { studioDishChoiceId, type StudioPortalChoices } from "../../shared/hospitality-menu-studio-selection";
import { validStudioAllocation } from "../../shared/hospitality-menu-studio-choice-rules";

export function supportsStudioPortalChoices(choices: StudioPortalChoices) {
  // Earlier staged packages contain the original flat quantities contract.
  if (choices.presentation === undefined) return choices.groups === undefined;
  if (!["dropdown", "quantities"].includes(choices.presentation) ||
      !/^[a-f0-9]{64}$/.test(choices.publicationHash) || !choices.replacesChoiceGroupId ||
      !Array.isArray(choices.dishes) || choices.dishes.length === 0 ||
      choices.dishes.some(dish => !dish?.id || !dish.name || typeof dish.description !== "string")) return false;
  const choicesById = new Set(choices.dishes.map(dish => dish.id));
  if (choicesById.size !== choices.dishes.length) return false;
  if (choices.groups === undefined || Array.isArray(choices.groups) && !choices.groups.length) return true;
  if (choices.presentation !== "quantities" || !Array.isArray(choices.groups) ||
      choices.groups.some(group => !group?.id || !group.name || group.presentation !== "quantities" ||
        !Array.isArray(group.dishIds) || !group.dishIds.length)) return false;
  const grouped = choices.groups.flatMap(group => group.dishIds);
  return new Set(choices.groups.map(group => group.id)).size === choices.groups.length &&
    grouped.length === choicesById.size && new Set(grouped).size === grouped.length && grouped.every(id => choicesById.has(id));
}

export function validStudioPortalAllocation(studio: StudioPortalChoices, choice: unknown, quantity: number): choice is Record<string, number> {
  return supportsStudioPortalChoices(studio) && validStudioAllocation(studio.dishes.map(dish => dish.id), studio.presentation, studio.minimumQuantity ?? 1, choice, quantity);
}

export function serializeStudioPortalChoice(studio: StudioPortalChoices, choice: unknown, quantity: number) {
  if (!validStudioPortalAllocation(studio, choice, quantity)) throw new Error("Choose the current published dishes before continuing.");
  const { publicationHash, presentation } = studio;
  return {
    id: studioDishChoiceId, quantities: choice, publicationHash,
    ...(presentation ? { studioPresentation: presentation } : {}),
  };
}
