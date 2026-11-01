/**
 * Provisional, presentation-only menu section ordering for FIKA OS.
 *
 * The top-level sequence and Hot Mains subgroups reflect the provisional
 * interpretation recorded on issue #132. They are not Brian-approved and
 * must not be treated as a taxonomy or persistence migration. No consumer
 * imports this module yet; changing these constants currently changes no UI,
 * publication, projection, totals or historical evidence.
 */
export const PROVISIONAL_MENU_SECTION_ORDER = [
  "HOT MAINS",
  "SOUP",
  "SALADS",
  "SAUCES",
  "GARNISHES",
  "DESSERTS",
  "OTHER",
] as const;

export const PROVISIONAL_HOT_MAIN_SUBGROUP_ORDER = [
  "HOT MEAT / HOT MAIN",
  "HOT FISH",
  "HOT VEG / VEGAN",
] as const;

export const SALAD_SLOT_ORDER = [
  "SALAD 1",
  "SALAD 2",
  "SALAD 3",
  "SALAD 4",
  "SALAD 5",
  "SALAD 6",
] as const;

export type MenuSectionId =
  | "hot-mains"
  | "soup"
  | "salads"
  | "sauces"
  | "garnishes"
  | "desserts"
  | "other";

export type HotMainSubgroupId = "hot-meat-main" | "hot-fish" | "hot-veg-vegan";

export interface MenuSectionDescriptor {
  id: MenuSectionId;
  label: (typeof PROVISIONAL_MENU_SECTION_ORDER)[number];
  order: number;
  subgroupId?: HotMainSubgroupId;
  subgroupLabel?: (typeof PROVISIONAL_HOT_MAIN_SUBGROUP_ORDER)[number];
  subgroupOrder?: number;
  saladSlotOrder?: number;
}

export interface MenuSectionOrderEntry {
  slot: string;
  /** Position in the authored Week Planner sequence when it is available. */
  originalIndex?: number;
  /** Stable identity tie-break for entries that otherwise have equal order. */
  sourceEntryId?: string;
}

const SECTION_ORDER: Record<MenuSectionId, number> = {
  "hot-mains": 0,
  soup: 1,
  salads: 2,
  sauces: 3,
  garnishes: 4,
  desserts: 5,
  other: 6,
};

function normalizedSlot(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function saladSlotOrder(slot: string): number | undefined {
  const index = (SALAD_SLOT_ORDER as readonly string[]).indexOf(slot);
  if (index >= 0) return index;
  return slot === "SALAD" || slot.startsWith("SALAD ") ? SALAD_SLOT_ORDER.length : undefined;
}

function hotMainSubgroup(slot: string): Pick<MenuSectionDescriptor, "subgroupId" | "subgroupLabel" | "subgroupOrder"> | undefined {
  if (/^(HOT MAIN|HOT MEAT)(?:\s|$)/.test(slot)) {
    return { subgroupId: "hot-meat-main", subgroupLabel: PROVISIONAL_HOT_MAIN_SUBGROUP_ORDER[0], subgroupOrder: 0 };
  }
  if (/^(FISH|HOT FISH)(?:\s|$)/.test(slot)) {
    return { subgroupId: "hot-fish", subgroupLabel: PROVISIONAL_HOT_MAIN_SUBGROUP_ORDER[1], subgroupOrder: 1 };
  }
  if (/^(VEGAN MAIN|HOT VEG VEGAN)(?:\s|$)/.test(slot)) {
    return { subgroupId: "hot-veg-vegan", subgroupLabel: PROVISIONAL_HOT_MAIN_SUBGROUP_ORDER[2], subgroupOrder: 2 };
  }
  return undefined;
}

/** Classifies canonical, legacy and unknown slots without dropping entries. */
export function menuSectionForSlot(value: string): MenuSectionDescriptor {
  const slot = normalizedSlot(value);
  const hotMain = hotMainSubgroup(slot);
  if (hotMain) {
    return { id: "hot-mains", label: "HOT MAINS", order: SECTION_ORDER["hot-mains"], ...hotMain };
  }

  const saladOrder = saladSlotOrder(slot);
  if (saladOrder !== undefined) {
    return { id: "salads", label: "SALADS", order: SECTION_ORDER.salads, saladSlotOrder: saladOrder };
  }

  if (/^SOUP(?:\s|$)/.test(slot)) {
    return { id: "soup", label: "SOUP", order: SECTION_ORDER.soup };
  }
  if (/^SAUCE(?:S|\s|$)/.test(slot)) {
    return { id: "sauces", label: "SAUCES", order: SECTION_ORDER.sauces };
  }
  if (/^GARNISH(?:ES|\s|$)/.test(slot)) {
    return { id: "garnishes", label: "GARNISHES", order: SECTION_ORDER.garnishes };
  }
  if (/^DESSERT(?:S|\s|$)/.test(slot)) {
    return { id: "desserts", label: "DESSERTS", order: SECTION_ORDER.desserts };
  }

  return { id: "other", label: "OTHER", order: SECTION_ORDER.other };
}

function compareNumber(a: number | undefined, b: number | undefined): number {
  const left = Number.isFinite(a) ? a! : Number.MAX_SAFE_INTEGER;
  const right = Number.isFinite(b) ? b! : Number.MAX_SAFE_INTEGER;
  return left - right;
}

/**
 * Compares entries by provisional section/subgroup, then by authored sequence.
 * It never sorts dishes by display name. Unknown slots remain in OTHER.
 */
export function compareMenuEntries(
  left: MenuSectionOrderEntry,
  right: MenuSectionOrderEntry,
): number {
  const leftSection = menuSectionForSlot(left.slot);
  const rightSection = menuSectionForSlot(right.slot);
  return leftSection.order - rightSection.order
    || compareNumber(leftSection.subgroupOrder, rightSection.subgroupOrder)
    || compareNumber(leftSection.saladSlotOrder, rightSection.saladSlotOrder)
    || compareNumber(left.originalIndex, right.originalIndex)
    || compareStableId(left.sourceEntryId, right.sourceEntryId);
}

/** Returns a sorted copy; array position supplies a deterministic legacy fallback. */
export function orderMenuEntries<T extends MenuSectionOrderEntry>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => compareMenuEntries(
      { ...left.entry, originalIndex: left.entry.originalIndex ?? left.index },
      { ...right.entry, originalIndex: right.entry.originalIndex ?? right.index },
    ))
    .map(({ entry }) => entry);
}

function compareStableId(left: string | undefined, right: string | undefined): number {
  const a = left ?? "";
  const b = right ?? "";
  return a < b ? -1 : a > b ? 1 : 0;
}
