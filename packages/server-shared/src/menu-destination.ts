/** Menu destinations are scoped snapshots; a one-off is never a Hub OPLOC. */
export type OneOffMenuDestination = {
  kind: "one-off";
  id: string;
  sourceDayId: string;
  label: string;
  address: string;
  contact?: string;
  deliveryInstructions?: string;
};
export type MenuDestination = { kind: "governed"; id: string; label: string } | OneOffMenuDestination;
export type MenuDestinationAllocation = {
  destinationId?: string;
  oneOffDestinationId?: string;
  destinationLabel: string;
  destinationAddress?: string;
  destination?: MenuDestination;
};
type RegisteredOneOff = { id: string; label: string; address?: string; addressStatus: "pending" | "confirmed"; contact?: string; deliveryInstructions?: string };
const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 422, code: "MENU_DESTINATION_INVALID" }); };

export function assertOneOffMenuDestination(value: OneOffMenuDestination, sourceDayId: string): OneOffMenuDestination {
  if (value.kind !== "one-off" || value.sourceDayId !== sourceDayId || typeof value.id !== "string" || !value.id.startsWith(`${sourceDayId}:one-off:`) || value.id.length <= `${sourceDayId}:one-off:`.length) fail("The one-off destination identity does not belong to this service day. Select its recorded one-off location again.");
  if (typeof value.label !== "string" || !value.label.trim()) fail("The one-off destination needs a location name.");
  if (typeof value.address !== "string" || !value.address.trim()) fail(`${value.label}: add and confirm a delivery address before publication.`);
  if ((value.contact !== undefined && typeof value.contact !== "string") || (value.deliveryInstructions !== undefined && typeof value.deliveryInstructions !== "string")) fail("The one-off destination contains invalid routing information.");
  return value;
}

/** Resolve working allocations using the recorded day identity, or validate an immutable published snapshot. */
export function menuDestination(allocation: MenuDestinationAllocation, sourceDayId: string, registered?: readonly RegisteredOneOff[]): MenuDestination {
  if (allocation.destination?.kind === "one-off") {
    if (allocation.destinationId) fail("A one-off destination cannot also declare a governed OPLOC.");
    if (allocation.oneOffDestinationId && allocation.oneOffDestinationId !== allocation.destination.id) fail("The one-off destination identities do not match.");
    if (registered) return menuDestination({ ...allocation, destination: undefined, oneOffDestinationId: allocation.destination.id }, sourceDayId, registered);
    return assertOneOffMenuDestination(allocation.destination, sourceDayId);
  }
  if (allocation.oneOffDestinationId || !allocation.destinationId) {
    // Historical allocations lack the ID. Recover it only from one unambiguous,
    // already-recorded day destination, never from Hub names or another day.
    const candidates = (registered || []).filter(item => allocation.oneOffDestinationId
      ? item.id === allocation.oneOffDestinationId
      : item.label === allocation.destinationLabel && (item.address || "") === (allocation.destinationAddress || ""));
    if (candidates.length !== 1) fail(`${allocation.destinationLabel}: unresolved destination: select the recorded one-off location for this day; its identity is missing or ambiguous.`);
    if (allocation.destinationId) fail("A one-off destination cannot also declare a governed OPLOC.");
    const item = candidates[0];
    if (item.addressStatus !== "confirmed") fail(`${item.label}: add and confirm a delivery address before publication.`);
    return assertOneOffMenuDestination({ kind: "one-off", id: item.id, sourceDayId, label: item.label, address: item.address || "", ...(item.contact ? { contact: item.contact } : {}), ...(item.deliveryInstructions ? { deliveryInstructions: item.deliveryInstructions } : {}) }, sourceDayId);
  }
  if (allocation.destination && (allocation.destination.kind !== "governed" || allocation.destination.id !== allocation.destinationId)) fail("The governed destination snapshot does not match its OPLOC identity.");
  return { kind: "governed", id: allocation.destinationId, label: allocation.destinationLabel };
}

export const menuDestinationKey = (allocation: MenuDestinationAllocation) => allocation.destination?.id || allocation.oneOffDestinationId || allocation.destinationId;

/** Firestore map key ordering must not turn identical routing evidence into an amendment. */
export function sameMenuDestination(left: MenuDestination | undefined, right: MenuDestination | undefined) {
  if (!left || !right) return left === right;
  if (left.kind !== right.kind || left.id !== right.id) return false;
  if (left.kind === "one-off" && right.kind === "one-off") return left.sourceDayId === right.sourceDayId && left.label === right.label && left.address === right.address && (left.contact || "") === (right.contact || "") && (left.deliveryInstructions || "") === (right.deliveryInstructions || "");
  return true;
}
