import { hospitalityCalendarDay } from "../../shared/hospitality-menu-date";
import { productMenuChoicesForDate, type ProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";

/** Calendar-only calculation: dates are UK business dates, not local or UTC instants. */
export function previewChoices(configuration: ProductMenuConfiguration, eventDate: string) {
  if (!Number.isFinite(hospitalityCalendarDay(eventDate))) return undefined;
  return productMenuChoicesForDate(configuration, eventDate);
}

/** A response from an earlier request must never be shown as the current site/date. */
export function previewScopeMatches(value: { itemId: string; siteId: string; eventDate: string; draftOnly: boolean }, itemId: string, siteId: string, eventDate: string) {
  return value.draftOnly === true && value.itemId === itemId && value.siteId === siteId && value.eventDate === eventDate;
}
