/** Public choice references only. Hub resolves the publication itself. */
export const studioDishChoiceId = "studio-published-dishes";

export type StudioChoicePresentation = "dropdown" | "checkboxes" | "quantities";
export type StudioChoiceGroup = {
  id: string;
  name: string;
  presentation: StudioChoicePresentation;
  dishIds: string[];
};
export type StudioPreviewOffering = {
  itemId: string;
  siteId: string;
  eventDate: string;
  draftOnly: true;
} & ({ state: "unavailable" | "quote-only" } | {
  state: "priced";
  name: string;
  price: { amount: number; vatRate: number; currency: "GBP" };
  minimumQuantity?: number;
  minimumGuests?: number;
  noticeRequiredDays?: number;
  minimumDishQuantity?: number;
  supportedPresentations: StudioChoicePresentation[];
});

export type StudioPortalChoices = {
  publicationHash: string;
  minimumQuantity?: number;
  replacesChoiceGroupId?: string;
  dishes: { id: string; name: string; description: string }[];
  /** A missing presentation means the original per-dish quantities contract. */
  presentation?: StudioChoicePresentation;
  groups?: StudioChoiceGroup[];
};

export function isStudioDishChoice(value: unknown) {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id === studioDishChoiceId);
}

/** Match the existing canonical variety controls by stable ID. */
export function publishedStudioChoicePolicy(configuration?: Record<string, unknown>) {
  const groups = Array.isArray(configuration?.choices) ? configuration.choices as {
    id?: string; controlType?: string; selectionType?: string; minimumQuantity?: number; options?: { id?: string }[];
  }[] : [];
  const variety = groups.find(group => group?.id === "variety" && (group.controlType || group.selectionType) === "quantities");
  const legacy = groups.find(group => group?.id === "selection" && (group.controlType || group.selectionType) === "select" &&
    Array.isArray(group.options) && group.options.some(option => option?.id === "selection:mixed-brochure-selection"));
  if (variety && legacy) return { status: "conflict" } as const;
  const minimumQuantity = variety?.minimumQuantity ?? 1;
  if (!Number.isSafeInteger(minimumQuantity) || minimumQuantity < 1) return { status: "invalid-minimum" } as const;
  const replacesChoiceGroupId = (variety || legacy)?.id;
  return { status: "verified" as const, minimumQuantity, ...(replacesChoiceGroupId ? { replacesChoiceGroupId } : {}) };
}
