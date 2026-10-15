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

import { composeRcoaDraft, rcoaChildReference, type RcoaGroupDraft } from "./rcoa-portal";

/**
 * One request per service moment. A single moment keeps exactly today's request (same reference, no group metadata); several
 * moments get deterministic child references `<groupId>-01..NN` plus structured `bookingGroup` metadata.
 */
export function buildRcoaGroupClientRequests(group: RcoaGroupDraft, menu: readonly PortalMenuItem[], identity: { groupId: string; submittedAt: string }) {
  const size = group.moments.length;
  return group.moments.map((_, index) => {
    const base = buildRcoaClientRequest(composeRcoaDraft(group, index), menu, { bookingId: size === 1 ? identity.groupId : rcoaChildReference(identity.groupId, index + 1), submittedAt: identity.submittedAt });
    return size === 1 ? base : { ...base, bookingGroup: { id: identity.groupId, sequence: index + 1, size } };
  });
}
