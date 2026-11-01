import { PERMANENT_DESSERT_SLOTS, plannerSlotsForWeek, type RollingEntry, type RollingSnapshot } from "./rolling-menu-types";
import { categoriesForMenuSlot, normaliseDishCategory } from "./dish-categories";
import { normaliseSaladSubtype, SALAD_SLOT_SUBTYPES } from "./dish-editor";

export type DishReferenceState = "active" | "archived" | "merged" | "unresolved";
export type DishReference = {
  entryId: string;
  requestedId?: string;
  state: DishReferenceState;
  classification?: { category: string; subcategory?: string };
  successor?: { id: string; name: string; category: string; subcategory?: string };
  reason?: "missing_id" | "not_found" | "archive_unavailable" | "mapping_unverified" | "integrity_failed";
  provenance?: { catalogueRevision?: number; catalogueSourceHash?: string; archiveId?: string; archiveDigest?: string; mappingVersion?: number; mappingDigest?: string };
};
export type DishReferences = { schemaVersion: "menu-planning.dish-references.v1"; weekId: string; weekVersion: number; byEntryId: Record<string, DishReference> };
export type DishReferenceNotice = { state: "reclassified" | "archived" | "merged" | "unresolved"; label: string; message: string };

/** Returns only metadata bound to this exact saved entry and its requested ID. */
export function dishReferenceForEntry(entry: Pick<RollingEntry, "id" | "itemId" | "slot">, references: DishReferences | undefined, expectedWeek: { id: string; version: number }): DishReferenceNotice | undefined {
  if (!references || references.schemaVersion !== "menu-planning.dish-references.v1" || references.weekId !== expectedWeek.id || references.weekVersion !== expectedWeek.version) return undefined;
  const reference = references.byEntryId?.[entry.id];
  if (!reference || reference.entryId !== entry.id) return undefined;
  if (reference.requestedId !== undefined && reference.requestedId !== (entry.itemId || "")) return undefined;
  if (reference.requestedId === undefined && !(reference.state === "unresolved" && reference.reason === "missing_id" && !entry.itemId)) return undefined;
  if (reference.state === "active") {
    const classification = reference.classification;
    if (!classification?.category) return undefined;
    const category = normaliseDishCategory(classification.category);
    const allowed = categoriesForMenuSlot(entry.slot);
    const expectedSaladSubtype = SALAD_SLOT_SUBTYPES.find(item => item.slot === entry.slot)?.subtype;
    const actualSaladSubtype = normaliseSaladSubtype(classification.subcategory);
    const categoryMismatch = !allowed.includes(category);
    const subtypeMismatch = category === "Salad" && Boolean(expectedSaladSubtype && actualSaladSubtype && expectedSaladSubtype !== actualSaladSubtype);
    if (!categoryMismatch && !subtypeMismatch) return undefined;
    const detail = [classification.category, classification.subcategory].filter(Boolean).join(" · ");
    return { state: "reclassified", label: "Reclassified", message: `Current Dish Library classification: ${detail}. This saved placement remains in ${entry.slot}; its label and quantities are unchanged.` };
  }
  if (reference.state === "archived") return { state: "archived", label: "Archived", message: "This dish is archived. Its saved label and placement remain unchanged, and it is unavailable for new selections." };
  if (reference.state === "merged" && reference.requestedId && reference.successor?.id && reference.successor.id !== reference.requestedId && reference.successor.name && reference.provenance?.mappingVersion !== undefined && reference.provenance.mappingDigest) {
    return { state: "merged", label: "Merged", message: `This saved placement still refers to the original dish. Use ${reference.successor.name} for new selections.` };
  }
  if (reference.state === "merged" || reference.state === "unresolved") return { state: "unresolved", label: "Needs classification", message: "The historical dish reference could not be verified. Its saved label and placement remain unchanged; no successor is shown." };
  return undefined;
}

/** Active catalogue responses remain authoritative for picker choices; this only guards IDs explicitly classified as historical. */
export function selectableDishIds<T extends { id: string }>(dishes: readonly T[], references: DishReferences | undefined, entries: readonly Pick<RollingEntry, "id" | "itemId">[] = []): T[] {
  const entriesById = new Map(entries.map(entry => [entry.id, entry]));
  const unavailable = new Set(Object.values(references?.byEntryId || {}).filter(reference => {
    const entry = entriesById.get(reference.entryId);
    return Boolean(entry && reference.requestedId && reference.requestedId === entry.itemId && (reference.state === "archived" || reference.state === "merged"));
  }).map(reference => reference.requestedId!));
  return dishes.filter(dish => !unavailable.has(dish.id));
}

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
