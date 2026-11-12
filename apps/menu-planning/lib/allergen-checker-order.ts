import { canonicalMenuSlotIdFor, CANONICAL_MENU_SLOTS, menuSectionForSlot, orderMenuEntries, type MenuSectionId } from "../../shared/menu-section-order";

export type AllergenOrderEntry = { id: string; slot: string; itemId?: string; itemLabel: string };
export type AllergenEntryGroup<T extends AllergenOrderEntry> = { id: MenuSectionId; label: string; entries: T[] };

const canonicalPosition = new Map(CANONICAL_MENU_SLOTS.map((slot, index) => [slot.id, index]));
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleUpperCase("en-GB");
const sectionLabels: Record<MenuSectionId, string> = {
  salads: "Salads", "cold-proteins": "Cold Proteins", "hot-main": "Hot Mains", "starch-sides": "Starch/Sides",
  garnish: "Garnishes", sauce: "Sauces", desserts: "Desserts", other: "Additional menu rows",
};

/** Shared canonical menu order, with stable deterministic placement for legitimate custom/historical rows. */
export function orderAllergenCheckerEntries<T extends AllergenOrderEntry>(entries: readonly T[]): T[] {
  const stableInput = entries.map((entry) => {
    const canonical = canonicalMenuSlotIdFor(entry.slot);
    const exact = canonical && normalize(entry.slot) === normalize(canonical);
    return { entry, canonical, exact, normalizedSlot: normalize(entry.slot) };
  }).sort((a, b) => {
    const ai = a.canonical ? canonicalPosition.get(a.canonical) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const bi = b.canonical ? canonicalPosition.get(b.canonical) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return ai - bi || Number(b.exact) - Number(a.exact) || a.normalizedSlot.localeCompare(b.normalizedSlot)
      || a.entry.itemLabel.localeCompare(b.entry.itemLabel) || (a.entry.itemId ?? "").localeCompare(b.entry.itemId ?? "") || a.entry.id.localeCompare(b.entry.id);
  });
  // `orderMenuEntries` is the same ordering authority used by Week Planner; the deterministic seed only resolves
  // its historical/custom-slot ties without relying on database or insertion order.
  const orderedIds = orderMenuEntries(stableInput.map(({ entry }, originalIndex) => ({ id: entry.id, slot: entry.slot, originalIndex, sourceEntryId: entry.id }))).map((entry) => entry.id);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  return orderedIds.map((id) => entriesById.get(id)!).filter(Boolean);
}

export function groupAllergenCheckerEntries<T extends AllergenOrderEntry>(entries: readonly T[]): AllergenEntryGroup<T>[] {
  const grouped = new Map<MenuSectionId, T[]>();
  for (const entry of orderAllergenCheckerEntries(entries)) {
    const section = menuSectionForSlot(entry.slot).id;
    grouped.set(section, [...(grouped.get(section) ?? []), entry]);
  }
  const sectionOrder: MenuSectionId[] = ["salads", "cold-proteins", "hot-main", "starch-sides", "garnish", "sauce", "desserts", "other"];
  return sectionOrder.filter((id) => grouped.has(id)).map((id) => ({ id, label: sectionLabels[id], entries: grouped.get(id)! }));
}

/** Number repeated occurrences of the same dish in the same original placement without changing their identities. */
export function occurrenceLabels<T extends AllergenOrderEntry>(entries: readonly T[]): Map<string, string> {
  const byPlacement = new Map<string, T[]>();
  for (const entry of entries) {
    const key = `${entry.slot}\u0000${entry.itemId || entry.itemLabel}`;
    byPlacement.set(key, [...(byPlacement.get(key) ?? []), entry]);
  }
  const labels = new Map<string, string>();
  for (const group of byPlacement.values()) if (group.length > 1) {
    [...group].sort((a, b) => a.id.localeCompare(b.id)).forEach((entry, index) => labels.set(entry.id, `Occurrence ${index + 1} of ${group.length}`));
  }
  return labels;
}
