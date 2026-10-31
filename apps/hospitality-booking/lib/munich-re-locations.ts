/**
 * Client-safe copy of the Munich RE booking-form locations (the server-shared module pulls every site catalogue into
 * the bundle, so the browser keeps its own list). tests/munich-re-portal.test.ts asserts it equals the shared source.
 */
export type MunichReLocation = { id: string; label: string; kind: "meeting-room" | "collection-point"; capacity?: number; combines?: readonly string[] };

export const MUNICH_RE_LOCATIONS: readonly MunichReLocation[] = [
  { id: "acacia", label: "Acacia", kind: "meeting-room", capacity: 20 },
  { id: "aloe", label: "Aloe", kind: "meeting-room", capacity: 5 },
  { id: "ginko", label: "Ginko", kind: "meeting-room", capacity: 5 },
  { id: "ironbark", label: "Ironbark", kind: "meeting-room", capacity: 14 },
  { id: "avon", label: "Avon", kind: "meeting-room", capacity: 16 },
  { id: "amazon", label: "Amazon", kind: "meeting-room", capacity: 16 },
  { id: "flex", label: "Flex", kind: "meeting-room", combines: ["avon", "amazon"] },
  { id: "collection-level-2-pantry", label: "Collection from Level 2 Pantry", kind: "collection-point" },
  { id: "collection-level-3-reception", label: "Collection from Level 3 Reception", kind: "collection-point" },
  { id: "collection-level-5-cafe", label: "Collection from Level 5 Cafe", kind: "collection-point" },
];

export function munichReLocationDisplay(location: MunichReLocation): string {
  if (location.kind === "collection-point") return location.label;
  if (location.combines) return `${location.label} (${location.combines.map((id) => MUNICH_RE_LOCATIONS.find((l) => l.id === id)!.label).join(" and ")} combined)`;
  return `${location.label} (${location.capacity} seater)`;
}

/** Rooms persist in roomOrArea; collection points persist in deliveryPoint (never both). */
export function munichReLocationFields(id: string): { roomOrArea: string; deliveryPoint: string } {
  const location = MUNICH_RE_LOCATIONS.find((l) => l.id === id);
  if (!location) return { roomOrArea: "", deliveryPoint: "" };
  return location.kind === "collection-point" ? { roomOrArea: "", deliveryPoint: location.label } : { roomOrArea: location.label, deliveryPoint: "" };
}

export function munichReLocationIdFor(details: { roomOrArea?: string; deliveryPoint?: string }): string {
  return MUNICH_RE_LOCATIONS.find((l) => (l.kind === "collection-point" ? l.label === details.deliveryPoint : l.label === details.roomOrArea))?.id || "";
}
