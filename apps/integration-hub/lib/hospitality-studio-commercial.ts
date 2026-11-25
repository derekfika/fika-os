import { deliveryWeekday } from "@fika/server-shared/hospitality-effective-offering";
import { publishedStudioChoicePolicy } from "../../shared/hospitality-menu-studio-selection";

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
  const policy = publishedStudioChoicePolicy(configuration);
  if (policy.status === "conflict") throw Object.assign(new Error("The Studio item has conflicting catalogue variety controls."), { status: 422 });
  if (policy.status === "invalid-minimum") {
    throw Object.assign(new Error("The Studio item has an invalid catalogue variety minimum."), { status: 422 });
  }
  const { status: _status, ...verified } = policy;
  return verified;
}
