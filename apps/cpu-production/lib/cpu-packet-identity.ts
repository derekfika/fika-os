import type { PlannedMenuItem } from "../app/lib/production-plan";
import type { ProductionLine, ProductionOrder } from "./production-types";

/**
 * Resolve the identity written into the signed daily packet from the current
 * authoritative ProductionOrder.  PlannedMenuItem.sourceLineId is the CPU
 * production-line identity, while Delivered-In needs the governed Menu
 * canonical dish identity for Menu Planning orders.
 */
function correspondingProductionLine(item: PlannedMenuItem, order: ProductionOrder, itemIndex: number): ProductionLine | undefined {
  const sourceLineId = item.sourceLineId?.trim();
  if (sourceLineId) {
    const byStableIdentity = order.lines.find(line => [line.canonicalId, line.sourceBookingLineId, line.sourceMenuItemId].includes(sourceLineId));
    if (byStableIdentity) return byStableIdentity;
    return undefined;
  }
  // Older CPU-created plans may not have sourceLineId. Their menu projection
  // is created in ProductionOrder line order, so this is a deterministic
  // compatibility fallback and deliberately does not compare display names.
  return order.lines[itemIndex];
}

function primaryPacketIdentity(item: PlannedMenuItem, order: ProductionOrder, itemIndex: number): string {
  const line = correspondingProductionLine(item, order, itemIndex);
  if (line) {
    if (order.origin === "menu_planning") return line.sourceMenuItemId || line.sourceBookingLineId || line.canonicalId;
    return line.sourceBookingLineId || line.sourceMenuItemId || line.canonicalId;
  }
  return item.sourceLineId || item.id;
}

/** Build packet items while preserving deterministic identities for sub-items. */
export function buildCpuPacketItems(menuItems: PlannedMenuItem[], order: ProductionOrder) {
  return menuItems.flatMap((item, itemIndex) => {
    const primaryId = primaryPacketIdentity(item, order, itemIndex);
    return item.subItems.map((sub, subIndex) => ({
      menuItemId: subIndex === 0 ? primaryId : `${primaryId}:sub:${sub.id}`,
      menuItemName: sub.name || item.name,
      allergens: sub.allergens,
      allergenState: sub.evidenceStatus === "completed" ? undefined : "unrecorded" as const,
    }));
  });
}
