import type { CanonicalBooking } from "../../lib/canonical-types";
import { bookingServiceInstant, bookingDateIssue, type CutoffItem } from "@fika/server-shared/hospitality-effective-offering";
import type { PortalMenuItem } from "../../lib/mnk-contract";
import { portalMenuFromCatalogue, type loadHospitalityPortalMenu } from "../../lib/hospitality-portal-catalogue";
import { filterRcoaMenu } from "../../lib/rcoa-portal";

type BookingDetails = Pick<CanonicalBooking, "service" | "order">;
export type AmendmentCatalogue = Awaited<ReturnType<typeof loadHospitalityPortalMenu>>;
export const staffDietaryField = (key: string) => ["vegetarian", "vegan", "glutenFree", "coeliac", "dairyFree", "halal", "otherCount", "freeText"].includes(key);

export function hospitalityAdminMenu(source: AmendmentCatalogue | undefined, booking: BookingDetails, oplocId?: string) {
  if (!source || !oplocId || source.catalogue.source === "cache-unverified") return [];
  const menu = portalMenuFromCatalogue(source.catalogue.catalogue, oplocId, booking.service.eventDate, false, booking.service.operationalAreaId);
  return booking.service.portalSiteId === "rcoa" ? filterRcoaMenu(menu, booking.order.eventType || "", "", "", source.visibility) : menu;
}

export function HospitalityAdminAddItem({ menu, order, onAdd }: { menu: PortalMenuItem[]; order: BookingDetails["order"]; onAdd(line: BookingDetails["order"]["items"][number]): void }) {
  const available = menu.filter(item => !order.items.some(line => line.quantity > 0 && [line.menuItemId, line.itemId].includes(item.canonicalId)));
  return <label>Add item from this site's catalogue
    <select value="" onChange={event => {
      const item = available.find(candidate => candidate.canonicalId === event.target.value);
      if (!item) return;
      const quantity = item.minimumQuantity || 1;
      onAdd({ itemId: item.canonicalId, itemName: item.name, category: item.category, description: item.description, unitPrice: item.unitPrice, quantity, lineTotal: item.unitPrice * quantity });
    }}>
      <option value="">Choose a menu item…</option>
      {available.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.name}</option>)}
    </select>
  </label>;
}

export function HospitalityAdminAmendmentReview({ before, after, items, now }: { before: BookingDetails; after: BookingDetails; items: CutoffItem[]; now: string }) {
  let late = false;
  try {
    const issue = bookingDateIssue(items, after.service.eventDate, now, { site: after.service.portalSiteId, occasion: after.order.eventType, startTime: after.service.startTime });
    late = bookingServiceInstant(before.service.eventDate, before.service.startTime) - Date.parse(now) < 72 * 3_600_000 ||
      issue?.code === "BOOKING_NOTICE" || issue?.code === "PRODUCT_NOTICE";
  } catch { /* The service-time field and Hub validation report invalid inputs. */ }
  const key = (item: BookingDetails["order"]["items"][number]) => item.menuItemId || item.itemId;
  const active = after.order.items.filter(item => item.quantity > 0);
  const added = active.filter(item => !before.order.items.some(prior => key(prior) === key(item)));
  const removed = before.order.items.filter(item => !active.some(next => key(next) === key(item)));
  return <div aria-live="polite">
    <p><strong>{late ? "Late amendment — Hospitality Admin override" : "Hospitality Admin amendment"}</strong></p>
    {late && <p>CPU or Logistics may already be preparing this service. Check with them before saving.</p>}
    <p>Guests {before.service.guestCount} → {after.service.guestCount}</p>
    {!!added.length && <p>Added items: {added.map(item => item.itemName || item.itemId).join(", ")}</p>}
    {!!removed.length && <p>Removed items: {removed.map(item => item.itemName || item.itemId).join(", ")}</p>}
  </div>;
}
