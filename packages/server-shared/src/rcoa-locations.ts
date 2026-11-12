/** Governed room directory for the canonical RCoA Hospitality OPLOC. */
export const RCOA_FLOORS = ["Ground Floor", "First Floor", "Second Floor", "Third Floor"] as const;
export type RcoaFloor = typeof RCOA_FLOORS[number];

export const RCOA_LOCATIONS_BY_FLOOR: Readonly<Record<RcoaFloor, readonly string[]>> = {
  "Ground Floor": ["Conference Suite"],
  "First Floor": ["Boardroom 1", "Boardroom 2", "Boardroom 3"],
  "Second Floor": Array.from({ length: 14 }, (_, index) => `Meeting Room ${index + 1}`),
  "Third Floor": ["Executive Boardroom"],
};

export function rcoaLocationsForFloor(floor: string): readonly string[] {
  return Object.hasOwn(RCOA_LOCATIONS_BY_FLOOR, floor) ? RCOA_LOCATIONS_BY_FLOOR[floor as RcoaFloor] : [];
}

export function isRcoaFloor(value: string): value is RcoaFloor {
  return (RCOA_FLOORS as readonly string[]).includes(value);
}

/** Historical bookings may keep both fields blank; every assigned location must be a complete valid pair. */
export function isValidRcoaLocationPair(floor: string | undefined, location: string | undefined): boolean {
  const level = floor?.trim() || "";
  const room = location?.trim() || "";
  if (!level && !room) return true;
  return isRcoaFloor(level) && rcoaLocationsForFloor(level).includes(room);
}

export function rcoaFloorChange(floor: string, currentLocation: string): { floor: string; location: string } {
  return { floor, location: rcoaLocationsForFloor(floor).includes(currentLocation) ? currentLocation : "" };
}
