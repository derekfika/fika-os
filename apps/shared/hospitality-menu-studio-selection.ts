/** Public choice references only. Hub resolves the publication itself. */
export const studioDishChoiceId = "studio-published-dishes";

export type StudioPortalChoices = {
  publicationHash: string;
  dishes: { id: string; name: string; description: string }[];
};

export function isStudioDishChoice(value: unknown) {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id === studioDishChoiceId);
}
