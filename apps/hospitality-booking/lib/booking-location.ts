/**
 * Authoritative delivery-location fields for a booking service. Values are trimmed and blanks become undefined, so a
 * historical record with no floor or room stays truthfully missing. The combined `location` label is never parsed here.
 */
export type BookingLocation = { floorLevel?: string; roomOrArea?: string; deliveryPoint?: string };

export function bookingLocation(source: BookingLocation): BookingLocation {
  return {
    floorLevel: source.floorLevel?.trim() || undefined,
    roomOrArea: source.roomOrArea?.trim() || undefined,
    deliveryPoint: source.deliveryPoint?.trim() || undefined,
  };
}

const sameLocation = (a: BookingLocation, b: BookingLocation) => a.floorLevel === b.floorLevel && a.roomOrArea === b.roomOrArea && a.deliveryPoint === b.deliveryPoint;

/** One shared location when every service matches exactly; otherwise each service keeps its own floor and room. */
export function groupLocationView<T extends BookingLocation>(services: readonly T[]) {
  const rows = services.map(service => bookingLocation(service));
  const first = rows[0] ?? {};
  const shared = rows.every(row => sameLocation(row, first));
  return { shared, first, rows, missingFloorOrRoom: rows.some(row => !row.floorLevel || !row.roomOrArea) };
}
