const HOT_FORK_BUFFET_IDS = new Set([
  "hospitality-menu-item:rcoa:hot_fork_buffet_gold",
  "hospitality-menu-item:rcoa:hot_fork_buffet_silver",
  "hospitality-menu-item:mnk:hot_fork_buffet_gold",
  "hospitality-menu-item:mnk:hot_fork_buffet_silver",
]);
const LEGACY_HOT_FORK_BUFFET_IDS = new Set(["hot_fork_buffet_gold", "hot_fork_buffet_silver"]);

/** Classify by governed canonical Item IDs, retaining only exact known provider source IDs for historical bookings. */
export function isHotForkBuffetBooking(booking: { source?: { provider?: string }; order?: { items?: Array<{ itemId?: string; menuItemId?: string }> } }) {
  const provider = booking.source?.provider;
  return (booking.order?.items || []).some(item => {
    const canonicalId = item.menuItemId || item.itemId || "";
    if (HOT_FORK_BUFFET_IDS.has(canonicalId)) return true;
    return (provider === "rcoa-booking-platform" || provider === "mnk-booking-platform") && LEGACY_HOT_FORK_BUFFET_IDS.has(item.itemId || "");
  });
}