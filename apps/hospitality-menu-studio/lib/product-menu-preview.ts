import { deliveryWeekday, resolveHospitalityOffering, type CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";
import { publishedStudioChoicePolicy, type StudioPreviewOffering } from "../../shared/hospitality-menu-studio-selection";

export function productMenuPreviewOffering(catalogue: CataloguePackage, itemId: string, siteId: string, eventDate: string): StudioPreviewOffering {
  const scope = { itemId, siteId, eventDate, draftOnly: true as const };
  const resolved = resolveHospitalityOffering(catalogue, itemId, siteId, { serviceDate: eventDate });
  if (!resolved.available || resolved.offering.bookingPolicy?.fridayUnavailable && deliveryWeekday(eventDate) === 5) {
    return { ...scope, state: "unavailable" };
  }
  const { name, price, constraints, configuration, quoteRequired } = resolved.offering;
  if (quoteRequired) return { ...scope, state: "quote-only" };
  if (!price) return { ...scope, state: "unavailable" };
  const policy = publishedStudioChoicePolicy(configuration);
  const verified = policy.status === "verified" && policy.replacesChoiceGroupId;
  return {
    ...scope, state: "priced", name, price, ...constraints,
    ...(verified ? { minimumDishQuantity: policy.minimumQuantity } : {}),
    supportedPresentations: verified ? ["dropdown", "quantities"] : [],
  };
}
