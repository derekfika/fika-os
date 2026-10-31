import { categoriesForMenuSlot, normaliseDishCategory } from "./dish-categories";
import { normaliseSaladSubtype, saladSubtypeForSlot } from "./dish-editor";
import { tagKey, type DishTag } from "./dish-tags";

export type SlotAwareDish = {
  category?: string;
  subcategory?: string;
  tagIds?: readonly string[];
};

export type SlotRecommendation = {
  recommended: boolean;
  score: number;
  reason?: string;
};

type SaladTagMatch = { subtype: string; labels: readonly string[] };

/**
 * Match descriptive registry labels only where the owner supplied a clear slot mapping.
 * SALAD 3 uses the explicit Bread descriptor only: a grain/pulse descriptor does not make a
 * dish a starch salad. SALAD 6 is always assigned explicitly through subcategory.
 */
const SALAD_TAG_MATCHES: readonly SaladTagMatch[] = [
  { subtype: "Leaf", labels: ["Leaf Salad"] },
  { subtype: "Slaw", labels: ["Slaw"] },
  { subtype: "Starch", labels: ["Bread"] },
  { subtype: "Veg", labels: ["Vegetable Side"] },
  { subtype: "Grain/Pulse", labels: ["Grain / Pulse"] },
];

function categoryEligible(dish: SlotAwareDish, slot: string) {
  return categoriesForMenuSlot(slot).includes(normaliseDishCategory(dish.category));
}

function matchesRegistryTag(dish: SlotAwareDish, labels: readonly string[], registry: readonly DishTag[]) {
  if (!dish.tagIds?.length) return false;
  const wanted = new Set(labels.map(tagKey));
  const selected = new Set(dish.tagIds);
  return registry.some((tag) => selected.has(tag.id) && [tag.label, ...tag.synonyms].some((label) => wanted.has(tagKey(label))));
}

/** Pure recommendation contract. Category remains the hard eligibility gate. */
export function dishSlotRecommendation(
  dish: SlotAwareDish,
  slot: string,
  registry: readonly DishTag[] = [],
): SlotRecommendation {
  if (!categoryEligible(dish, slot)) return { recommended: false, score: 0 };

  const desiredSubtype = saladSubtypeForSlot(slot);
  if (desiredSubtype) {
    const assignedSubtype = normaliseSaladSubtype(dish.subcategory);
    if (desiredSubtype === "FIKA Seasonal") {
      return assignedSubtype === desiredSubtype
        ? { recommended: true, score: 100, reason: "Explicitly assigned FIKA Seasonal" }
        : { recommended: false, score: 0 };
    }

    if (assignedSubtype === desiredSubtype) {
      return { recommended: true, score: 100, reason: "Explicit " + desiredSubtype + " salad slot" };
    }

    const tagMatch = SALAD_TAG_MATCHES.find((entry) => entry.subtype === desiredSubtype);
    if (tagMatch && matchesRegistryTag(dish, tagMatch.labels, registry)) {
      return { recommended: true, score: 80, reason: tagMatch.labels[0] + " tag" };
    }
    return { recommended: false, score: 0 };
  }

  const subtype = tagKey(dish.subcategory || "");
  const slotKey = tagKey(slot);
  if (subtype && (subtype === slotKey || subtype.includes(slotKey) || slotKey.includes(subtype))) {
    return { recommended: true, score: 40, reason: "Matching dish subcategory" };
  }
  return { recommended: false, score: 0 };
}

export function saladSlotMatches(
  dish: SlotAwareDish,
  slot: string,
  registry: readonly DishTag[] = [],
) {
  return dishSlotRecommendation(dish, slot, registry).recommended;
}

/** If no compatible dish has slot metadata, keep the default picker useful by showing all eligible dishes. */
export function saladRecommendationOptions<T extends { id: string }>(
  compatible: readonly T[],
  recommendedIds: ReadonlySet<string>,
) {
  if (recommendedIds.size === 0) return { items: [...compatible], usingFallback: true };
  return { items: compatible.filter(dish => recommendedIds.has(dish.id)), usingFallback: false };
}
