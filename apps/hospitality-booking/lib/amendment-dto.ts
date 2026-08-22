import type { CanonicalBooking } from "../../integration-hub/lib/hospitality-booking-service";

export type AmendmentDraft = {
  client: CanonicalBooking["client"];
  service: CanonicalBooking["service"];
  order: CanonicalBooking["order"];
  notes: string;
  deliveryChargeRequired: boolean;
};

/** Build the strict Integration Hub amendment shape from editable dashboard data. */
export function amendmentPatchDto(draft: AmendmentDraft) {
  const { client, service, order } = draft;
  return {
    client: {
      name: client.name,
      email: client.email,
      ...(client.phone ? { phone: client.phone } : {}),
      companyName: client.companyName,
      ...(client.requester ? { requester: {
        name: client.requester.name,
        email: client.requester.email,
        ...(client.requester.phone ? { phone: client.requester.phone } : {}),
        companyName: client.requester.companyName,
      } } : {}),
      ...(client.clientName ? { clientName: client.clientName } : {}),
      ...(client.clientCompany ? { clientCompany: client.clientCompany } : {}),
      ...(client.invoiceReference ? { invoiceReference: client.invoiceReference } : {}),
    },
    service: {
      eventDate: service.eventDate,
      startTime: service.startTime,
      ...(service.endTime ? { endTime: service.endTime } : {}),
      guestCount: service.guestCount,
      ...(service.floorLevel ? { floorLevel: service.floorLevel } : {}),
      ...(service.roomOrArea ? { roomOrArea: service.roomOrArea } : {}),
      ...(service.deliveryPoint ? { deliveryPoint: service.deliveryPoint } : {}),
      ...(service.onsiteContactName ? { onsiteContactName: service.onsiteContactName } : {}),
      ...(service.onsiteContactPhone ? { onsiteContactPhone: service.onsiteContactPhone } : {}),
    },
    order: {
      ...(order.eventType ? { eventType: order.eventType } : {}),
      items: order.items.map(({ itemId, itemName, category, description, servingInfo, unitPrice, quantity, choices, comments }) => ({
        itemId,
        ...(itemName ? { itemName } : {}),
        ...(category ? { category } : {}),
        ...(description ? { description } : {}),
        ...(servingInfo ? { servingInfo } : {}),
        unitPrice,
        quantity,
        ...(choices ? { choices } : {}),
        ...(comments ? { comments } : {}),
      })),
    },
    ...(draft.notes ? { notes: draft.notes } : {}),
    deliveryChargeRequired: draft.deliveryChargeRequired,
  };
}
