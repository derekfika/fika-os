import { PERMANENT_DESSERT_SLOTS, plannerSlotsForWeek, type RollingSnapshot } from "./rolling-menu-types";

export function groupedSlots(snapshot: RollingSnapshot) {
  const slots = Array.from(new Set([
    ...plannerSlotsForWeek(snapshot.week),
    ...(snapshot.week.customSlots || []),
    ...snapshot.entries.map(entry => entry.slot),
  ])).filter(slot => !snapshot.week.removedSlots?.includes(slot)
    || (snapshot.week.status === "draft" && (PERMANENT_DESSERT_SLOTS as readonly string[]).includes(slot)));
  const groupFor = (slot: string) => slot.startsWith("SALAD ") ? "SALADS"
    : slot.startsWith("COLD PROTEIN") ? "COLD PROTEIN"
      : /^(HOT MAIN|HOT MEAT|FISH|VEGAN MAIN|HOT VEG VEGAN|SOUP)/.test(slot) ? "HOT MAINS"
              : /^(STARCH\/SIDE|EXTRAS|SIDE)/.test(slot) ? "STARCH/SIDE"
                : slot.startsWith("GARNISH") ? "GARNISH"
                  : slot.startsWith("SAUCE") ? "SAUCE"
                    : slot.startsWith("DESSERT") ? "DESSERTS" : "OTHER";
  const hotMainsSubgroupOrder = (slot: string) => /^(HOT MAIN|HOT MEAT)/.test(slot) ? 0
    : slot.startsWith("FISH") ? 1
      : /^(VEGAN MAIN|HOT VEG VEGAN)/.test(slot) ? 2
        : slot.startsWith("SOUP") ? 3 : -1;
  const order = ["SALADS", "COLD PROTEIN", "HOT MAINS", "STARCH/SIDE", "GARNISH", "SAUCE", "OTHER", "DESSERTS"];
  return order.map(group => {
    const grouped = slots.filter(slot => groupFor(slot) === group);
    if (group === "HOT MAINS") grouped.sort((left, right) => hotMainsSubgroupOrder(left) - hotMainsSubgroupOrder(right));
    return [group, grouped] as [string, string[]];
  }).filter(([, values]) => values.length);
}
