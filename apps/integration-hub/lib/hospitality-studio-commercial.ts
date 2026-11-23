import { deliveryWeekday, type CatalogueChoice } from "@fika/server-shared/hospitality-effective-offering";

export type StudioCommercialOffering = {
  itemId: string;
  offeringMode: string;
  quoteRequired?: true;
  price?: { amount: number; vatRate?: number | null };
  bookingPolicy?: { fridayUnavailable?: boolean };
  configuration?: Record<string, unknown>;
};

export function studioOfferingIsBookable(offering: StudioCommercialOffering, date: string) {
  return offering.offeringMode === "standard" && !offering.quoteRequired && Boolean(offering.price) &&
    !(offering.bookingPolicy?.fridayUnavailable && deliveryWeekday(date) === 5);
}

/** Use the governed effective Offering. Never infer a choice group from a display name. */
export function studioChoicePolicy(configuration: StudioCommercialOffering["configuration"]) {
  const groups = Array.isArray(configuration?.choices) ? configuration.choices as CatalogueChoice[] : [];
  const variety = groups.find(group => group?.id === "variety" && (group.controlType || group.selectionType) === "quantities");
  const legacyStyle = groups.find(group => group?.id === "selection" &&
    (group.controlType || group.selectionType) === "select" && Array.isArray(group.options) &&
    group.options.some(option => option?.id === "selection:mixed-brochure-selection"));
  if (variety && legacyStyle) throw Object.assign(new Error("The Studio item has conflicting catalogue variety controls."), { status: 422 });
  const replacesChoiceGroupId = (variety || legacyStyle)?.id;
  const minimumQuantity = variety?.minimumQuantity ?? 1;
  if (!Number.isSafeInteger(minimumQuantity) || minimumQuantity < 1) {
    throw Object.assign(new Error("The Studio item has an invalid catalogue variety minimum."), { status: 422 });
  }
  return { minimumQuantity, ...(replacesChoiceGroupId ? { replacesChoiceGroupId } : {}) };
}
