import { isDeepStrictEqual } from "node:util";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { z } from "zod";
import { readStudioKitchenSpec, type StudioKitchenSpec } from "../../shared/hospitality-menu-studio-kitchen";
import { isStudioDishChoice } from "../../shared/hospitality-menu-studio-selection";
import type { QuoteRevision } from "./booking-workflow";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { kitchenSpecsMatchBookedChoices } from "./hospitality-studio-choice-evidence";
import { QUOTE_ENGINE_CONTRACT_VERSION, type QuoteCommercialSnapshot } from "./quote-engine";

export const ACCEPTED_STUDIO_KITCHEN_CONTRACT = "fika.hospitality-accepted-studio-kitchen.v1";

const identity = z.string().min(1).max(256);
const acceptedSchema = z.strictObject({
  contract: z.literal(ACCEPTED_STUDIO_KITCHEN_CONTRACT),
  bookingId: identity,
  quoteRevisionId: identity,
  commercialVersion: z.int().positive(),
  eventDate: z.iso.date(),
  destinationOplocId: identity,
  acceptedBy: identity,
  acceptedAt: z.iso.datetime(),
  lines: z.array(z.strictObject({
    itemId: identity,
    menuItemId: identity.optional(),
    customerQuantity: z.number().finite().positive(),
    spec: z.unknown(),
  })).min(1),
});

export const acceptedStudioKitchenEvidenceRef = (booking: DocumentReference, quoteRevisionId: string) =>
  booking.collection("private").doc(`studio-kitchen-v1-${stableDocumentId(quoteRevisionId)}`);

export const hospitalityBookingLineId = (bookingId: string, index: number) => `${bookingId}:line:${index + 1}`;

export function invalidStudioKitchenEvidence() {
  return Object.assign(new Error("The accepted kitchen specification does not match the current Booking and Quote Revision."), {
    status: 422,
    code: "STUDIO_KITCHEN_SPEC_INTEGRITY_FAILURE",
  });
}

export function requiresStudioKitchenEvidence(booking: CanonicalBooking) {
  if (booking.studioKitchenEvidenceVersion === 1) return true;
  if (booking.studioKitchenEvidenceVersion !== undefined || booking.order.items.some(line => line.choices?.some(isStudioDishChoice))) {
    throw invalidStudioKitchenEvidence();
  }
  return false;
}

/** Reads only Hub-owned accepted evidence. The booking acceptance flow must verify the immutable
 * publication and signed evidence, then persist this private record atomically with activation.
 * A Studio booking has a server-written marker and a private record per immutable quote.
 */
export async function acceptedStudioKitchenSpecs(transaction: Transaction, bookingRef: DocumentReference, booking: CanonicalBooking, quote: QuoteRevision) {
  const specs = new Map<string, StudioKitchenSpec>();
  if (!requiresStudioKitchenEvidence(booking)) return specs;
  const snapshot = await transaction.get(acceptedStudioKitchenEvidenceRef(bookingRef, quote.id));
  if (!snapshot.exists) throw invalidStudioKitchenEvidence();

  const parsed = acceptedSchema.safeParse(snapshot.data());
  const frozenQuote = quote.snapshot as (Partial<QuoteCommercialSnapshot> & {
    service?: { oplocId?: string };
  }) | undefined;
  const commercialVersion = booking.commercialVersion ?? 1;
  if (!parsed.success || booking.canonicalId !== bookingRef.id || parsed.data.bookingId !== booking.canonicalId ||
      parsed.data.quoteRevisionId !== quote.id || parsed.data.commercialVersion !== commercialVersion ||
      quote.commercialVersion !== commercialVersion || parsed.data.eventDate !== booking.service.eventDate ||
      parsed.data.destinationOplocId !== booking.service.oplocId ||
      frozenQuote?.contractVersion !== QUOTE_ENGINE_CONTRACT_VERSION || frozenQuote.bookingId !== booking.canonicalId ||
      frozenQuote.service?.eventDate !== booking.service.eventDate || frozenQuote.service.oplocId !== booking.service.oplocId ||
      !Array.isArray(frozenQuote.order?.lines) || frozenQuote.order.lines.length !== booking.order.items.length) {
    throw invalidStudioKitchenEvidence();
  }

  const lines = new Map(booking.order.items.map((item, index) => [
    hospitalityBookingLineId(booking.canonicalId, index), { item, quoted: frozenQuote.order!.lines[index] },
  ] as const));
  for (const evidence of parsed.data.lines) {
    const lineId = (evidence.spec as Partial<StudioKitchenSpec> | null | undefined)?.bookingLineId;
    const source = typeof lineId === "string" ? lines.get(lineId) : undefined;
    const spec = readStudioKitchenSpec(evidence.spec, booking.canonicalId, lineId);
    if (!spec || !source?.quoted || specs.has(spec.bookingLineId) || evidence.itemId !== source.item.itemId ||
        evidence.menuItemId !== source.item.menuItemId || evidence.customerQuantity !== source.item.quantity ||
        evidence.itemId !== source.quoted.itemId || evidence.customerQuantity !== source.quoted.quantity ||
        (source.quoted.servingInfo || "") !== (source.item.servingInfo || "") ||
        !isDeepStrictEqual(source.quoted.choices, source.item.choices)) {
      throw invalidStudioKitchenEvidence();
    }
    specs.set(spec.bookingLineId, spec);
  }
  if (!kitchenSpecsMatchBookedChoices(booking.order.items,
    index => specs.get(hospitalityBookingLineId(booking.canonicalId, index)), specs.size)) throw invalidStudioKitchenEvidence();
  return specs;
}
