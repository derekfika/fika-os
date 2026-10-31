import { catalogueMinimums, type MinimumContext } from "@fika/server-shared/hospitality-effective-offering";
import { GALLAGHER_MINIMUM_GUESTS } from "./gallagher-rules";
import type { PortalMenuItem } from "./mnk-contract";

type GuestLine = { itemId: string; quantity: number };

/** Only explicit guest policies count here. Ordered units, pack sizes and serving suggestions are independent. */
export function effectiveGuestMinimum(lines: readonly GuestLine[], menu: readonly PortalMenuItem[], context: MinimumContext = { gallagher: false }): number | null {
  let minimum = context.gallagher ? GALLAGHER_MINIMUM_GUESTS : 1;
  for (const line of lines.filter(line => line.quantity > 0)) {
    const item = menu.find(item => item.id === line.itemId);
    if (!item) return null; // Restored/unavailable selections cannot silently lose their policy.
    const guests = catalogueMinimums(item, context).guests;
    if (!Number.isSafeInteger(guests) || guests < 1) return null;
    minimum = Math.max(minimum, guests);
  }
  return minimum;
}

export function guestCountMessage(count: number, minimum: number | null, allowBlank = false): string {
  if (minimum === null) return "The guest minimum for a selected item is unavailable. Refresh the menu before continuing.";
  if (allowBlank && count === 0) return "";
  if (!Number.isSafeInteger(count)) return `Enter a whole number of at least ${minimum} ${minimum === 1 ? "guest" : "guests"}.`;
  return count < minimum ? `Enter at least ${minimum} ${minimum === 1 ? "guest" : "guests"}.` : "";
}
