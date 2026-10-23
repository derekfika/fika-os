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
      : /^(HOT MAIN|HOT MEAT)/.test(slot) ? "HOT MAIN"
        : slot.startsWith("FISH") ? "FISH"
          : /^(VEGAN MAIN|HOT VEG VEGAN)/.test(slot) ? "VEGAN MAIN"
            : slot.startsWith("SOUP") ? "SOUP"
              : /^(STARCH\/SIDE|EXTRAS|SIDE)/.test(slot) ? "STARCH/SIDE"
                : slot.startsWith("GARNISH") ? "GARNISH"
                  : slot.startsWith("SAUCE") ? "SAUCE"
                    : slot.startsWith("DESSERT") ? "DESSERTS" : "OTHER";
  const order = ["SALADS", "COLD PROTEIN", "HOT MAIN", "FISH", "VEGAN MAIN", "SOUP", "STARCH/SIDE", "GARNISH", "SAUCE", "OTHER", "DESSERTS"];
  return order.map(group => [group, slots.filter(slot => groupFor(slot) === group)] as [string, string[]]).filter(([, values]) => values.length);
}
