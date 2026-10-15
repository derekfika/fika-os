import type { PortalMenuItem } from "./mnk-contract";
import type { RcoaBookingDraft } from "./rcoa-portal";

export function buildRcoaClientRequest(
  draft: RcoaBookingDraft,
  menu: readonly PortalMenuItem[],
  identity: { bookingId: string; submittedAt: string },
) {
  const availableIds = new Set(menu.map((item) => item.id));
  return {
    ...identity,
    client: {
      name: draft.contact.name,
      email: draft.contact.email,
      phone: draft.contact.phone,
      companyName: draft.contact.companyName,
      ...(draft.contact.invoiceReference.trim() ? { invoiceReference: draft.contact.invoiceReference } : {}),
    },
    event: {
      eventDate: draft.event.eventDate,
      startTime: draft.event.startTime,
      ...(draft.event.endTime ? { endTime: draft.event.endTime } : {}),
      guestCount: draft.event.guestCount,
      ...(draft.event.floorLevel.trim() ? { floorLevel: draft.event.floorLevel } : {}),
      ...(draft.event.roomOrArea.trim() ? { roomOrArea: draft.event.roomOrArea } : {}),
      ...(draft.event.deliveryPoint.trim() ? { deliveryPoint: draft.event.deliveryPoint } : {}),
      ...(draft.event.onsiteContactName.trim() ? { onsiteContactName: draft.event.onsiteContactName } : {}),
      ...(draft.event.onsiteContactPhone.trim() ? { onsiteContactPhone: draft.event.onsiteContactPhone } : {}),
    },
    order: {
      eventType: draft.occasion,
      items: draft.lines.filter((line) => line.quantity > 0 && availableIds.has(line.itemId)).map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        choices: Object.entries(line.choices).map(([id, value]) => ({ id, value })),
      })),
    },
    dietaries: draft.dietaries,
    acknowledgements: draft.acknowledgements,
    specialInstructions: draft.specialInstructions,
  };
}

import { composeServiceDraft, sortedAllDayServices, type AllDayDraft } from "./rcoa-all-day";
import { rcoaChildReference } from "./rcoa-portal";

/**
 * One request per service row, submitted in time order. Child references are deterministic `<groupId>-01..NN` and every child carries
 * the structured `bookingGroup` link, so a retry of the same request produces the same identities.
 */
export function buildAllDayClientRequests(draft: AllDayDraft, menu: readonly PortalMenuItem[], identity: { groupId: string; submittedAt: string }) {
  const services = sortedAllDayServices(draft);
  const size = services.length;
  return {
    bookingGroup: { id: identity.groupId, size },
    requests: services.map((service, index) => ({
      ...buildRcoaClientRequest(composeServiceDraft(draft, service.id), menu, { bookingId: rcoaChildReference(identity.groupId, index + 1), submittedAt: identity.submittedAt }),
      bookingGroup: { id: identity.groupId, sequence: index + 1, size },
    })),
  };
}
