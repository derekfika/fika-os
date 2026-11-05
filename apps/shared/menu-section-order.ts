/** Canonical, presentation-only culinary order. It does not change dish taxonomy. */
export const MENU_ORDER_VERSION = "fika.menu-order.v1" as const;

export type MenuSectionId = "salads" | "cold-proteins" | "hot-main" | "starch-sides" | "garnish" | "sauce" | "desserts" | "other";

export interface MenuPresentationSlot {
  id: string;
  sectionId: Exclude<MenuSectionId, "other">;
  sectionLabel: string;
  label: string;
  order: number;
}

const slot = (id: string, sectionId: MenuPresentationSlot["sectionId"], sectionLabel: string, label: string, order: number): MenuPresentationSlot => ({ id, sectionId, sectionLabel, label, order });

/** 29 distinct daily placements, including repeated display labels. */
export const CANONICAL_MENU_SLOTS = [
  slot("SALAD 1", "salads", "SALADS", "Leaf Salad", 0),
  slot("SALAD 2", "salads", "SALADS", "Slaw", 1),
  slot("SALAD 3", "salads", "SALADS", "Starch", 2),
  slot("SALAD 4", "salads", "SALADS", "Veg", 3),
  slot("SALAD 5", "salads", "SALADS", "Grain/Pulse", 4),
  slot("SALAD 6", "salads", "SALADS", "FIKA Seasonal", 5),
  slot("COLD PROTEIN MEAT", "cold-proteins", "COLD PROTEINS", "Meat", 6),
  slot("COLD PROTEIN FISH", "cold-proteins", "COLD PROTEINS", "Fish", 7),
  slot("COLD PROTEIN VEGAN", "cold-proteins", "COLD PROTEINS", "Vegan", 8),
  slot("HOT MAIN", "hot-main", "HOT MAINS", "Hot Main", 9),
  slot("HOT FISH", "hot-main", "HOT MAINS", "Fish", 10),
  slot("HOT VEGAN", "hot-main", "HOT MAINS", "Vegan/Veggie", 11),
  slot("SOUP", "hot-main", "HOT MAINS", "Soup", 12),
  ...Array.from({ length: 4 }, (_, i) => slot(`STARCH/SIDE ${i + 1}`, "starch-sides", "STARCH/SIDES", "Starch/Side", 13 + i)),
  ...Array.from({ length: 4 }, (_, i) => slot(`GARNISH ${i + 1}`, "garnish", "GARNISHES", "Garnish", 17 + i)),
  ...Array.from({ length: 4 }, (_, i) => slot(`SAUCE ${i + 1}`, "sauce", "SAUCES", "Sauce", 21 + i)),
  ...Array.from({ length: 4 }, (_, i) => slot(`DESSERT ${i + 1}`, "desserts", "DESSERTS", "Dessert", 25 + i)),
] as const satisfies readonly MenuPresentationSlot[];

export interface MenuSectionDescriptor {
  id: MenuSectionId;
  label: string;
  order: number;
  slotOrder?: number;
}

export interface MenuSectionOrderEntry {
  slot: string;
  originalIndex?: number;
  sourceEntryId?: string;
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const bySlot = new Map<string, MenuPresentationSlot>(CANONICAL_MENU_SLOTS.map(item => [normalize(item.id), item]));
const legacyAliases: Record<string, string> = {
  "HOT MEAT": "HOT MAIN", "HOT MEAT 1": "HOT MAIN", "VEGAN MAIN": "HOT VEGAN", "HOT VEG VEGAN": "HOT VEGAN",
  "FISH": "HOT FISH", "COLD PROTEIN": "COLD PROTEIN MEAT", "COLD PROTEIN 1": "COLD PROTEIN MEAT",
  "SOUP 1": "SOUP", "STARCH/SIDE": "STARCH/SIDE 1", "SIDE 1": "STARCH/SIDE 1", "EXTRAS 1": "STARCH/SIDE 1",
  "EXTRAS 2": "STARCH/SIDE 2", "EXTRAS 3": "STARCH/SIDE 3", "EXTRAS 4": "STARCH/SIDE 4",
};
const orderedSections = ["SALADS", "COLD PROTEINS", "HOT MAINS", "STARCH/SIDES", "GARNISHES", "SAUCES", "DESSERTS"] as const;

export function menuSectionForSlot(value: string): MenuSectionDescriptor {
  const normalized = normalize(value);
  const alias = legacyAliases[normalized]
    || (/^HOT MEAT(?: \d+)?$/.test(normalized) ? "HOT MAIN" : undefined)
    || (/^(FISH|HOT FISH)(?: \d+)?$/.test(normalized) ? "HOT FISH" : undefined)
    || (/^(VEGAN MAIN|HOT VEG VEGAN)(?: \d+)?$/.test(normalized) ? "HOT VEGAN" : undefined)
    || (/^SOUP(?: \d+)?$/.test(normalized) ? "SOUP" : undefined)
    || (/^COLD PROTEIN(?: \d+)?$/.test(normalized) ? "COLD PROTEIN MEAT" : undefined)
    || (/^EXTRAS (\d+)$/.test(normalized) ? `STARCH/SIDE ${normalized.match(/\d+/)?.[0]}` : undefined)
    || (/^(GARNISH|SAUCE|DESSERT) (\d+)$/.test(normalized) ? normalized : undefined);
  const canonical = bySlot.get(normalized) || bySlot.get(normalize(alias || ""));
  if (canonical) return { id: canonical.sectionId, label: canonical.sectionLabel, order: orderedSections.indexOf(canonical.sectionLabel as typeof orderedSections[number]), slotOrder: canonical.order };
  // Unknown/historical slots remain visible after canonical slots in stable authored order.
  return { id: "other", label: "OTHER", order: orderedSections.length };
}

/** Resolve only a known canonical placement or a deliberate legacy alias. */
export function canonicalMenuSlotIdFor(value: string): string | undefined {
  const normalized = normalize(value);
  const alias = legacyAliases[normalized]
    || (/^HOT MEAT(?: \d+)?$/.test(normalized) ? "HOT MAIN" : undefined)
    || (/^(?:FISH|HOT FISH)(?: \d+)?$/.test(normalized) ? "HOT FISH" : undefined)
    || (/^(?:VEGAN MAIN|HOT VEG VEGAN)(?: \d+)?$/.test(normalized) ? "HOT VEGAN" : undefined)
    || (/^SOUP(?: \d+)?$/.test(normalized) ? "SOUP" : undefined)
    || (/^COLD PROTEIN(?: \d+)?$/.test(normalized) ? "COLD PROTEIN MEAT" : undefined)
    || (/^(?:GARNISH|SAUCE|DESSERT) (\d+)$/.test(normalized) ? normalized : undefined);
  const canonical = bySlot.get(normalized) || bySlot.get(normalize(alias || ""));
  return canonical?.id;
}

function compareNumber(a?: number, b?: number): number {
  return (Number.isFinite(a) ? a! : Number.MAX_SAFE_INTEGER) - (Number.isFinite(b) ? b! : Number.MAX_SAFE_INTEGER);
}

export function compareMenuEntries(left: MenuSectionOrderEntry, right: MenuSectionOrderEntry): number {
  const a = menuSectionForSlot(left.slot); const b = menuSectionForSlot(right.slot);
  return a.order - b.order || compareNumber(a.slotOrder, b.slotOrder)
    || compareNumber(left.originalIndex, right.originalIndex)
    || (left.sourceEntryId ?? "").localeCompare(right.sourceEntryId ?? "");
}

export function orderMenuEntries<T extends MenuSectionOrderEntry>(entries: readonly T[]): T[] {
  return entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => compareMenuEntries({ ...a.entry, originalIndex: a.entry.originalIndex ?? a.index }, { ...b.entry, originalIndex: b.entry.originalIndex ?? b.index }))
    .map(({ entry }) => entry);
}
