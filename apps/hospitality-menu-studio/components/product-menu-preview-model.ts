import { hospitalityCalendarDay } from "../../shared/hospitality-menu-date";
import { productMenuChoicesForDate, type ProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";
import { validStudioAllocation } from "../../shared/hospitality-menu-studio-choice-rules";
import type { StudioChoicePresentation } from "../../shared/hospitality-menu-studio-selection";

/** Calendar-only calculation: dates are UK business dates, not local or UTC instants. */
export function previewChoices(configuration: ProductMenuConfiguration, eventDate: string) {
  if (!Number.isFinite(hospitalityCalendarDay(eventDate))) return undefined;
  return productMenuChoicesForDate(configuration, eventDate);
}

/** A response from an earlier request must never be shown as the current site/date. */
export function previewScopeMatches(value: { itemId: string; siteId: string; eventDate: string; draftOnly: boolean }, itemId: string, siteId: string, eventDate: string) {
  return value.draftOnly === true && value.itemId === itemId && value.siteId === siteId && value.eventDate === eventDate;
}

/** Keep the same day of the week and rotation cycle while explicitly moving the preview. */
export function previewDateForWeek(configuration: ProductMenuConfiguration, eventDate: string, editorWeek: number) {
  const current = previewChoices(configuration, eventDate);
  if (!current || !("week" in current) || current.week === undefined || configuration.schedule.kind !== "rotation" ||
      !Number.isInteger(editorWeek) || editorWeek < 0 || editorWeek >= configuration.schedule.weeks.length) return undefined;
  const shifted = hospitalityCalendarDay(eventDate) + (editorWeek + 1 - current.week) * 7 * 86_400_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function evaluatePreviewSelection(input: { dishIds: string[]; presentation: StudioChoicePresentation; quantities: Record<string, number>; minimumDish: number; minimumTotal: number; minimumGuests: number; guests: string; unitPrice: number; supported: boolean }) {
  const totalQuantity = Object.values(input.quantities).reduce((sum, quantity) => sum + quantity, 0);
  const validSelection = input.supported && validStudioAllocation(input.dishIds, input.presentation, input.minimumDish, input.quantities, totalQuantity);
  const guestCount = Number(input.guests);
  const validGuests = input.guests !== "" && Number.isSafeInteger(guestCount) && guestCount >= input.minimumGuests;
  const valid = validSelection && totalQuantity >= input.minimumTotal && validGuests;
  return { totalQuantity, validSelection, validGuests, valid, ...(valid ? { netTotal: Number((input.unitPrice * totalQuantity).toFixed(2)) } : {}) };
}
