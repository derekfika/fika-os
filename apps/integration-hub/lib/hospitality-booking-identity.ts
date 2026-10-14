import crypto from "node:crypto";

export const SHARED_PORTAL_PROVIDER = "hospitality-booking-platform" as const;
export const BOOKING_IDENTITY_SCHEME = "fika.booking-identity.legacy-v1" as const;
export type BookingIdentityNamespace = "mnk-booking-platform" | "rcoa-booking-platform";
export type BookingIdentityEvidence = { scheme: typeof BOOKING_IDENTITY_SCHEME; namespace: BookingIdentityNamespace };

/** Frozen identity format. These strings are historical namespaces, not current provenance. */
function legacyBookingIdentity(sourceBookingId: string, namespace: BookingIdentityNamespace) {
  const digest = crypto.createHash("sha256").update(`${namespace}:${sourceBookingId.trim()}`).digest("hex").slice(0, 32);
  return {
    canonicalId: `booking:${namespace === "rcoa-booking-platform" ? "rcoa" : "mnk"}:${digest}`,
    scheme: BOOKING_IDENTITY_SCHEME,
    namespace,
  };
}

export function portalBookingIdentity(sourceBookingId: string, portalSiteId?: string) {
  return legacyBookingIdentity(sourceBookingId, portalSiteId === "rcoa" ? "rcoa-booking-platform" : "mnk-booking-platform");
}

/** Calendar retains its pre-transition namespace selection and source references. */
export function calendarBookingIdentity(sourceBookingId: string, legacySiteId?: string) {
  return legacyBookingIdentity(sourceBookingId, legacySiteId === "rcoa" ? "rcoa-booking-platform" : "mnk-booking-platform");
}
