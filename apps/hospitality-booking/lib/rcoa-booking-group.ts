import { z } from "zod";
import { buildTrustedRcoaHubPayload, RcoaBookingRequestSchema } from "./rcoa-booking-request";
import { RCOA_MAX_SERVICES, rcoaChildReference } from "./rcoa-portal";

const RCOA_REFERENCE = /^RCOA-[A-Z0-9-]{8,80}$/i;

/** One public submission with several service moments: the group id plus one ordinary RCoA request per moment. */
export const RcoaGroupSubmissionSchema = z.object({
  bookingGroup: z.object({ id: z.string().regex(RCOA_REFERENCE), size: z.number().int().min(2).max(RCOA_MAX_SERVICES) }).strict(),
  requests: z.array(RcoaBookingRequestSchema).min(2).max(RCOA_MAX_SERVICES),
}).strict();

export type RcoaTrustedHubPayload = ReturnType<typeof buildTrustedRcoaHubPayload>;

/** The extra line staff see in the booking notes for every linked booking (structured metadata is authoritative). */
export const rcoaGroupNote = (groupId: string, sequence: number, size: number) => `RCoA multi-service request ${groupId}: service ${sequence} of ${size}.`;

/**
 * Validates the WHOLE group before anything is created and returns the trusted Hub payloads in sequence order.
 * Throws (and so creates nothing) if any moment is invalid or the group is inconsistent. Pure: no I/O.
 */
export function buildRcoaGroupHubPayloads(value: unknown): { groupId: string; payloads: RcoaTrustedHubPayload[] } {
  const submission = RcoaGroupSubmissionSchema.parse(value);
  const { id: groupId, size } = submission.bookingGroup;
  if (submission.requests.length !== size) throw new Error("The number of services does not match the request.");
  const first = submission.requests[0];
  const payloads = submission.requests.map((request, index) => {
    const sequence = index + 1;
    const group = request.bookingGroup;
    if (!group || group.id.toUpperCase() !== groupId.toUpperCase() || group.size !== size || group.sequence !== sequence) throw new Error(`Service ${sequence} is not part of this request.`);
    if (request.bookingId.toUpperCase() !== rcoaChildReference(groupId, sequence).toUpperCase()) throw new Error(`Service ${sequence} has an unexpected reference.`);
    // Shared details are entered once; refuse a group whose children disagree about who and when (date).
    if (request.event.eventDate !== first.event.eventDate) throw new Error("All services in one request must be on the same date.");
    for (const key of ["name", "email", "phone", "companyName", "invoiceReference"] as const) {
      if ((request.client[key] || "").trim().toLowerCase() !== (first.client[key] || "").trim().toLowerCase()) throw new Error("Customer details must be the same for every service in the request.");
    }
    try { return buildTrustedRcoaHubPayload(request); }
    catch (error) { throw new Error(`Service ${sequence}: ${(error as Error).message}`); }
  });
  return {
    groupId,
    payloads: payloads.map((payload) => ({ ...payload, specialInstructions: [payload.specialInstructions.trim(), rcoaGroupNote(groupId, payload.bookingGroup!.sequence, size)].filter(Boolean).join("\n\n") })),
  };
}
