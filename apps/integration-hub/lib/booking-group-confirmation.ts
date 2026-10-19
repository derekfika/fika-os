import { db } from "./firebase-admin";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { groupEventKey, groupNotificationId, groupNotificationRecord } from "./booking-group-notifications";
import { MAX_GROUP_SERVICES, validateBookingGroup } from "./hospitality-group-commercial";
import { explicitMenuProductionRouting } from "./connections-service";
import { hospitalityPlatformOf, isGovernedRoutingPlatform, planHospitalityCpuRouting, routingKeys } from "./hospitality-cpu-routing";

/**
 * Only CPU hand-offs committed at or after this instant can create a consolidated group confirmation. Groups handed
 * off earlier already received their per-service confirmations; they are never re-confirmed or resent.
 */
export const GROUP_CONFIRMATION_EFFECTIVE_FROM = "2026-10-19T17:30:00.000Z";

const CONFIRMED_STATES = ["Sent to CPU", "Approved", "Completed"];
const sentToCpuAt = (child: CanonicalBooking) => [...(child.statusHistory || [])].reverse().find(entry => entry.status === "Sent to CPU")?.changedAt;

export type GroupConfirmationOutcome = "queued" | "exists" | "waiting" | "not_applicable" | "historical";

/**
 * One consolidated confirmation per group, queued only when EVERY active service is confirmed: either handed off to CPU,
 * or (explicit routing) produced entirely in house. Until then nothing is sent, so a partly confirmed group is never
 * described as confirmed. Runs after the hand-off commits; the deterministic notification ID makes retries safe.
 */
export async function queueGroupConfirmation(bookingGroupId: string): Promise<GroupConfirmationOutcome> {
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(db.collection("fikaBookings").where("bookingGroup.id", "==", bookingGroupId).limit(MAX_GROUP_SERVICES + 1));
    if (!snapshot.size) return "not_applicable" as const;
    const children = validateBookingGroup(bookingGroupId, snapshot.docs.map(document => document.data() as CanonicalBooking));
    const active = children.filter(child => child.lifecycleStatus !== "Cancelled");
    if (!active.length) return "not_applicable" as const;
    const confirmedByCpu = active.filter(child => CONFIRMED_STATES.includes(child.lifecycleStatus) && sentToCpuAt(child));
    const pending = active.filter(child => !confirmedByCpu.includes(child));
    // A pending service only counts as confirmed when its routing explicitly says no CPU production is required.
    for (const child of pending) {
      const platform = hospitalityPlatformOf(child);
      if (!platform || !isGovernedRoutingPlatform(platform) || !["Quoted", "Completed"].includes(child.lifecycleStatus)) return "waiting" as const;
      const routes = await explicitMenuProductionRouting(child.order.items.flatMap(item => routingKeys(item, platform)), transaction);
      if (planHospitalityCpuRouting(child.order.items, platform, routes).status !== "no_cpu_production") return "waiting" as const;
    }
    if (!confirmedByCpu.length) return "not_applicable" as const;
    const anchor = [...confirmedByCpu].sort((a, b) => String(sentToCpuAt(b)).localeCompare(String(sentToCpuAt(a))))[0];
    const at = sentToCpuAt(anchor)!;
    if (at < GROUP_CONFIRMATION_EFFECTIVE_FROM) return "historical" as const;
    const eventKey = groupEventKey([bookingGroupId, active.map(child => [child.canonicalId, child.commercialVersion || 1])]);
    const ref = db.collection("fikaBookingNotifications").doc(groupNotificationId(bookingGroupId, "confirmed", eventKey));
    if ((await transaction.get(ref)).exists) return "exists" as const;
    // createdAt is the anchor's authoritative hand-off instant: the delivery worker re-checks it against the anchor's history.
    const notification = groupNotificationRecord({ kind: "confirmed", children, anchor, eventKey, createdAt: at });
    transaction.create(ref, notification);
    return "queued" as const;
  });
}
