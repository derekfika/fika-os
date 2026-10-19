import type { Transaction } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { groupEventKey, groupNotificationId, groupNotificationRecord } from "./booking-group-notifications";
import type { BookingNotificationRecord } from "./booking-notifications";
import { MAX_GROUP_SERVICES, validateBookingGroup } from "./hospitality-group-commercial";
import { explicitMenuProductionRouting } from "./connections-service";
import { hospitalityPlatformOf, isGovernedRoutingPlatform, planHospitalityCpuRouting, routingKeys } from "./hospitality-cpu-routing";

/**
 * Only CPU hand-offs committed at or after this instant can create a consolidated group confirmation. Groups handed
 * off earlier already received their per-service confirmations; they are never re-confirmed or resent.
 */
export const GROUP_CONFIRMATION_EFFECTIVE_FROM = "2026-10-19T17:30:00.000Z";

const CONFIRMED_STATES = ["Sent to CPU", "Approved", "Completed"];
export const sentToCpuAt = (child: CanonicalBooking) => [...(child.statusHistory || [])].reverse().find(entry => entry.status === "Sent to CPU")?.changedAt;

export type GroupConfirmationOutcome = "queued" | "exists" | "waiting" | "not_applicable" | "historical";

/** Everything the decision needs, read inside ONE transaction before any write. */
export type GroupConfirmationContext = {
  bookingGroupId: string;
  children: CanonicalBooking[];
  /** Pending services whose explicit routing says no CPU production is required. */
  inHouse: Set<string>;
  /** Notification IDs already present (a confirmation can only be created once per event key). */
  existing: Set<string>;
};

/**
 * Reads the group, the routing verdict of every service that is not yet handed off, and whether the confirmation for
 * the current commercial state already exists. `handingOffId` is the service being handed off in the calling
 * transaction: it is CPU-routed by definition and is not routing-checked. Performs reads only.
 */
export async function loadGroupConfirmationContext(transaction: Transaction, bookingGroupId: string, handingOffId?: string): Promise<GroupConfirmationContext | undefined> {
  const snapshot = await transaction.get(db.collection("fikaBookings").where("bookingGroup.id", "==", bookingGroupId).limit(MAX_GROUP_SERVICES + 1));
  if (!snapshot.size) return undefined;
  const children = validateBookingGroup(bookingGroupId, snapshot.docs.map(document => document.data() as CanonicalBooking));
  const inHouse = new Set<string>();
  for (const child of children) {
    if (child.lifecycleStatus === "Cancelled" || child.canonicalId === handingOffId || (CONFIRMED_STATES.includes(child.lifecycleStatus) && sentToCpuAt(child))) continue;
    const platform = hospitalityPlatformOf(child);
    if (!platform || !isGovernedRoutingPlatform(platform) || !["Quoted", "Completed"].includes(child.lifecycleStatus)) continue;
    const routes = await explicitMenuProductionRouting(child.order.items.flatMap(item => routingKeys(item, platform)), transaction);
    if (planHospitalityCpuRouting(child.order.items, platform, routes).status === "no_cpu_production") inHouse.add(child.canonicalId);
  }
  const key = confirmationEventKey(bookingGroupId, children);
  const id = groupNotificationId(bookingGroupId, "confirmed", key);
  const existing = new Set<string>();
  if ((await transaction.get(db.collection("fikaBookingNotifications").doc(id))).exists) existing.add(id);
  return { bookingGroupId, children, inHouse, existing };
}

/** The event key depends only on commercial state, which a CPU hand-off never changes: it can be computed before the hand-off. */
export const confirmationEventKey = (bookingGroupId: string, children: CanonicalBooking[]) =>
  groupEventKey([bookingGroupId, children.filter(child => child.lifecycleStatus !== "Cancelled").map(child => [child.canonicalId, child.commercialVersion || 1])]);

/**
 * Pure decision. `after` replaces a service with its post-hand-off state (the calling transaction's pending write).
 * Confirms only when EVERY active service is handed off or explicitly in house, so a partly confirmed group is never
 * described as confirmed.
 */
export function evaluateGroupConfirmation(context: GroupConfirmationContext, after?: CanonicalBooking): { outcome: GroupConfirmationOutcome; notification?: BookingNotificationRecord } {
  const children = context.children.map(child => after && child.canonicalId === after.canonicalId ? after : child);
  const active = children.filter(child => child.lifecycleStatus !== "Cancelled");
  if (!active.length) return { outcome: "not_applicable" };
  const handedOff = active.filter(child => CONFIRMED_STATES.includes(child.lifecycleStatus) && sentToCpuAt(child));
  if (active.some(child => !handedOff.includes(child) && !context.inHouse.has(child.canonicalId))) return { outcome: "waiting" };
  if (!handedOff.length) return { outcome: "not_applicable" };
  const anchor = [...handedOff].sort((a, b) => String(sentToCpuAt(b)).localeCompare(String(sentToCpuAt(a))))[0];
  const at = sentToCpuAt(anchor)!;
  if (at < GROUP_CONFIRMATION_EFFECTIVE_FROM) return { outcome: "historical" };
  const eventKey = confirmationEventKey(context.bookingGroupId, children);
  if (context.existing.has(groupNotificationId(context.bookingGroupId, "confirmed", eventKey))) return { outcome: "exists" };
  // createdAt is the anchor's authoritative hand-off instant: the delivery worker re-checks it against the anchor's history.
  return { outcome: "queued", notification: groupNotificationRecord({ kind: "confirmed", children, anchor, eventKey, createdAt: at }) };
}

/**
 * Recovery / reconciliation entry point (idempotent). The primary guarantee is that the final hand-off transaction
 * creates the confirmation atomically; this re-evaluates committed state and queues it if it is missing, so any later
 * trigger (a repeated hand-off, a completed group quote) repairs a gap without ever duplicating or resending.
 */
export async function queueGroupConfirmation(bookingGroupId: string): Promise<GroupConfirmationOutcome> {
  return db.runTransaction(async transaction => {
    const context = await loadGroupConfirmationContext(transaction, bookingGroupId);
    if (!context) return "not_applicable" as const;
    const result = evaluateGroupConfirmation(context);
    if (result.notification) transaction.create(db.collection("fikaBookingNotifications").doc(result.notification.notificationId), result.notification);
    return result.outcome;
  });
}
