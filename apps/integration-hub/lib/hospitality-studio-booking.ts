import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { dateSchema, idSchema } from "../../shared/hospitality-menu-studio-content";
import { publicationDigest } from "../../shared/hospitality-menu-studio-publication";
import { readStudioKitchenSpec, type StudioKitchenSpec } from "../../shared/hospitality-menu-studio-kitchen";
import { isStudioDishChoice, studioDishChoiceId } from "../../shared/hospitality-menu-studio-selection";
import { studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";
import { deliveryWeekday } from "@fika/server-shared/hospitality-effective-offering";
import { HubStudioPublications } from "./hospitality-studio-publications";
import { studioPilot } from "./hospitality-studio-pilot";
import {
  ACCEPTED_STUDIO_KITCHEN_CONTRACT, acceptedStudioKitchenEvidenceRef, hospitalityBookingLineId, invalidStudioKitchenEvidence,
} from "./hospitality-studio-kitchen-handoff";
import type { CanonicalBooking } from "./hospitality-booking-service";
import type { QuoteRevision } from "./booking-workflow";

const submittedChoice = z.strictObject({
  id: z.literal(studioDishChoiceId), publicationHash: publicationDigest,
  quantities: z.record(idSchema, z.int().nonnegative()),
});
const storedChoice = submittedChoice.extend({ quantityLabels: z.record(idSchema, z.string().min(1).max(200)) });
const frozenSelection = z.strictObject({
  index: z.int().nonnegative(), itemId: idSchema, menuItemId: idSchema.optional(),
  customerQuantity: z.number().positive(), choice: storedChoice,
  spec: z.unknown(),
});
const frozenBooking = z.strictObject({
  bookingId: z.string().min(1), eventDate: dateSchema, destinationOplocId: idSchema,
  acceptedBy: z.string().min(1), acceptedAt: z.iso.datetime(), lines: z.array(frozenSelection).min(1),
});

type CommercialOffering = { itemId: string; offeringMode: string; quoteRequired?: true;
  price?: { amount: number }; bookingPolicy?: { fridayUnavailable?: boolean } };

const stale = (message: string) => Object.assign(new Error(message), { status: 409, code: "STUDIO_BOOKING_SELECTION_CHANGED" });
const acceptedRef = (booking: DocumentReference) => booking.collection("private").doc("studio-accepted-menu-v1");
const rehearsalBookingId = /^STUDIO-UAT-[A-Z0-9-]+$/;

export function isStudioRehearsalBooking(booking: Pick<CanonicalBooking, "source" | "studioKitchenEvidenceVersion">) {
  return booking.studioKitchenEvidenceVersion === 1 && rehearsalBookingId.test(booking.source.sourceBookingId);
}

export function isStudioBookingPilot(booking: Pick<CanonicalBooking, "source" | "service">) {
  const pilot = studioPilot();
  const sourceId = process.env.FIKA_STUDIO_HUB_PILOT_SOURCE_BOOKING_ID;
  return Boolean(pilot && process.env.FIKA_STUDIO_HUB_PILOT_BOOKING_ENABLED === "true" &&
    process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED === "false" &&
    sourceId && rehearsalBookingId.test(sourceId) && sourceId === booking.source.sourceBookingId && pilot.oplocId === booking.service.oplocId &&
    pilot.firstDate <= booking.service.eventDate && booking.service.eventDate <= pilot.lastDate);
}

export async function prepareStudioBooking(transaction: Transaction, bookingRef: DocumentReference,
  booking: CanonicalBooking, acceptance: {
    allowed: boolean;
    actorId?: string;
    offerings: () => CommercialOffering[];
    publications: HubStudioPublications;
  }) {
  const submitted = booking.order.items.some(line => line.choices?.some(isStudioDishChoice));
  if (!acceptance.allowed) {
    if (submitted) throw stale("Studio menu choices are unavailable for this booking.");
    return () => {};
  }
  const oplocId = booking.service.oplocId;
  if (!oplocId || booking.bookingGroup && booking.bookingGroup.size > 1) throw stale("This Studio rehearsal accepts one canonical service.");
  const ids = booking.order.items.map(line => line.menuItemId || line.itemId);
  const current = await acceptance.publications.choices(transaction, oplocId, booking.service.eventDate, ids);
  if (!submitted && !current.managedItems.size) return () => {};
  const commercial = new Map(acceptance.offerings().map(offering => [offering.itemId, offering]));
  const lines = booking.order.items.flatMap((line, index) => {
    const itemId = ids[index];
    const markers = line.choices?.filter(isStudioDishChoice) || [];
    if (!markers.length && !current.managedItems.has(itemId)) return [];
    const live = current.items.get(itemId);
    const offering = commercial.get(itemId);
    const marker = submittedChoice.safeParse(markers[0]);
    if (!live || !offering || offering.offeringMode !== "standard" || offering.quoteRequired || !offering.price ||
        (offering.bookingPolicy?.fridayUnavailable && deliveryWeekday(booking.service.eventDate) === 5) ||
        line.unitPrice !== offering.price.amount || markers.length !== 1 ||
        !marker.success || marker.data.publicationHash !== live.publication.contentHash) {
      throw stale("The Studio menu or price changed. Refresh the choices for this event date.");
    }
    const quantities = Object.entries(marker.data.quantities);
    const chosen = quantities.filter(([, quantity]) => quantity > 0);
    const available = new Map(live.dishes.map(item => [item.dish.id, item]));
    if (!chosen.length || quantities.some(([id]) => !available.has(id)) ||
        chosen.reduce((sum, [, quantity]) => sum + quantity, 0) !== line.quantity) {
      throw stale("Choose available dishes whose quantities match the booked units.");
    }
    const spec: StudioKitchenSpec = { version: 1, bookingId: booking.canonicalId,
      bookingLineId: hospitalityBookingLineId(booking.canonicalId, index),
      selections: chosen.map(([id, quantity]) => {
        const { dish, safety } = available.get(id)!;
        return { selectionId: id, customerQuantity: quantity, subject: safety.subject,
          publication: { publicationId: live.publication.id, publicationRevision: live.publication.revision, contentHash: live.publication.contentHash },
          release: { releaseId: safety.releaseId, matrixHash: safety.matrixHash }, name: dish.name, kitchenDescription: dish.kitchenDescription,
          assortment: dish.assortment ? { boxCount: quantity, ...dish.assortment } : null };
      }) };
    if (!readStudioKitchenSpec(spec, booking.canonicalId, spec.bookingLineId)) throw invalidStudioKitchenEvidence();
    const choice = { ...marker.data, quantityLabels: Object.fromEntries(spec.selections.map(selection => [selection.selectionId, selection.name])) };
    line.choices = line.choices!.map(existing => isStudioDishChoice(existing) ? choice : existing);
    return [{ index, itemId: line.itemId, ...(line.menuItemId ? { menuItemId: line.menuItemId } : {}),
      customerQuantity: line.quantity, choice, spec }];
  });
  if (!lines.length) throw stale("Select a current Studio dish before booking.");
  booking.studioKitchenEvidenceVersion = 1;
  return () => transaction.create(acceptedRef(bookingRef), {
    bookingId: booking.canonicalId, eventDate: booking.service.eventDate, destinationOplocId: oplocId,
    acceptedBy: acceptance.actorId || booking.createdBy, acceptedAt: booking.createdAt, lines,
  });
}

export function studioPublicationsForBooking(db: Firestore) { return new HubStudioPublications(db, studioReviewStaging.projectId); }

export async function bindStudioQuote(transaction: Transaction, bookingRef: DocumentReference, booking: CanonicalBooking, quote: QuoteRevision) {
  if (booking.studioKitchenEvidenceVersion === undefined) return;
  const frozen = frozenBooking.safeParse((await transaction.get(acceptedRef(bookingRef))).data());
  if (!frozen.success || frozen.data.bookingId !== booking.canonicalId || frozen.data.eventDate !== booking.service.eventDate ||
      frozen.data.destinationOplocId !== booking.service.oplocId) throw invalidStudioKitchenEvidence();
  const { bookingId, eventDate, destinationOplocId, acceptedBy, acceptedAt } = frozen.data;
  const prepared = frozen.data.lines.map(({ index, choice, ...line }) => {
    const booked = booking.order.items[index];
    if (!booked || booked.itemId !== line.itemId || booked.menuItemId !== line.menuItemId || booked.quantity !== line.customerQuantity ||
        !isDeepStrictEqual(booked.choices?.filter(isStudioDishChoice), [choice]) ||
        !readStudioKitchenSpec(line.spec, bookingId, hospitalityBookingLineId(bookingId, index))) throw invalidStudioKitchenEvidence();
    return line;
  });
  transaction.create(acceptedStudioKitchenEvidenceRef(bookingRef, quote.id), {
    contract: ACCEPTED_STUDIO_KITCHEN_CONTRACT, bookingId, eventDate, destinationOplocId, acceptedBy, acceptedAt,
    quoteRevisionId: quote.id, commercialVersion: quote.commercialVersion, lines: prepared,
  });
}

export function assertFrozenStudioAmendment(current: CanonicalBooking, next: CanonicalBooking) {
  if (current.studioKitchenEvidenceVersion === undefined) {
    if (next.order.items.some(line => line.choices?.some(isStudioDishChoice))) throw stale("Studio dishes must enter through a verified booking.");
    return;
  }
  const selection = (booking: CanonicalBooking) => booking.order.items.map(line => [line.menuItemId || line.itemId, line.itemId, line.quantity, line.choices?.filter(isStudioDishChoice) || []]);
  if (current.service.eventDate !== next.service.eventDate || current.service.oplocId !== next.service.oplocId ||
      !isDeepStrictEqual(selection(current), selection(next))) {
    throw stale("This amendment changes a frozen Studio selection. Keep the original date, site and quantities.");
  }
}
