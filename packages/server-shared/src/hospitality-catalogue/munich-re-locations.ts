/**
 * Munich RE delivery locations exactly as offered by the live booking form (question 4, "What meeting room?").
 * Meeting rooms and collection points are distinct kinds. Flex is the Avon and Amazon rooms combined; its capacity is
 * NOT stated by the form and must be confirmed by the owner (it is deliberately left undefined, not summed).
 */
export type MunichReLocationKind = "meeting-room" | "collection-point";
export type MunichReLocation = { id: string; label: string; kind: MunichReLocationKind; capacity?: number; combines?: readonly string[]; level?: number };

export const MUNICH_RE_LOCATIONS: readonly MunichReLocation[] = Object.freeze([
  { id: "acacia", label: "Acacia", kind: "meeting-room", capacity: 20 },
  { id: "aloe", label: "Aloe", kind: "meeting-room", capacity: 5 },
  { id: "ginko", label: "Ginko", kind: "meeting-room", capacity: 5 },
  { id: "ironbark", label: "Ironbark", kind: "meeting-room", capacity: 14 },
  { id: "avon", label: "Avon", kind: "meeting-room", capacity: 16 },
  { id: "amazon", label: "Amazon", kind: "meeting-room", capacity: 16 },
  { id: "flex", label: "Flex", kind: "meeting-room", combines: Object.freeze(["avon", "amazon"]) },
  { id: "collection-level-2-pantry", label: "Collection from Level 2 Pantry", kind: "collection-point", level: 2 },
  { id: "collection-level-3-reception", label: "Collection from Level 3 Reception", kind: "collection-point", level: 3 },
  { id: "collection-level-5-cafe", label: "Collection from Level 5 Cafe", kind: "collection-point", level: 5 },
]);

export const munichReLocationById = (id: string) => MUNICH_RE_LOCATIONS.find((location) => location.id === id);

/** The text the booking form shows, e.g. "Acacia (20 seater)" or "Flex (Avon and Amazon combined)". */
export function munichReLocationDisplay(location: MunichReLocation): string {
  if (location.kind === "collection-point") return location.label;
  if (location.combines) return `${location.label} (${location.combines.map((id) => munichReLocationById(id)!.label).join(" and ")} combined)`;
  return `${location.label} (${location.capacity} seater)`;
}
