import type { CpuProductionWorkstream } from "../../shared/production-workstreams";

// Transitional provider identities retained by older hospitality hand-offs.
// These are exact source IDs, not display-name matching.
export const LEGACY_HOSPITALITY_MENU_ROUTING: Record<string, CpuProductionWorkstream[]> = {
  "deli-style-sandwich": ["sandwiches"],
  "deli_sandwich_lunch": ["sandwiches"],
  "exotic-fruit-box": ["hospitality"],
  "exotic_fruit_box": ["hospitality"],
  "mini-traybake-bites": ["hospitality"],
  mini_pastries: ["hospitality"],
  filled_savoury_croissant: ["hospitality"],
  cookie_box: ["hospitality"],
  large_pastries: ["hospitality"],
  tray_bake_box: ["hospitality"],
  vegan_savoury_croissant: ["hospitality"],
};

export type HospitalityMenuRoutingSuggestion = {
  workstreams: CpuProductionWorkstream[];
  confidence: "medium" | "none";
  reason: string;
};

/** Suggestions use exact retained provider identifiers only; display names are never evidence. */
export function suggestHospitalityMenuRouting(providerMappings: unknown): HospitalityMenuRoutingSuggestion {
  const mappings = Array.isArray(providerMappings) ? providerMappings : [];
  const matches = mappings.flatMap(mapping => {
    if (!mapping || typeof mapping !== "object") return [];
    const sourceItemId = String((mapping as Record<string, unknown>).sourceItemId || "");
    const workstreams = LEGACY_HOSPITALITY_MENU_ROUTING[sourceItemId];
    return workstreams ? [{ sourceItemId, workstreams }] : [];
  });
  const unique = new Map(matches.map(match => [match.sourceItemId, match.workstreams]));
  if (unique.size === 1) {
    const [sourceItemId, workstreams] = [...unique.entries()][0];
    return {
      workstreams,
      confidence: "medium",
      reason: `Exact provider source ID “${sourceItemId}” has a retained legacy production mapping. Confirm it before saving.`,
    };
  }
  if (unique.size > 1) {
    const assignments = new Set([...unique.values()].map(values => values.join(",")));
    if (assignments.size === 1) {
      const [sourceItemId] = [...unique.keys()];
      return {
        workstreams: [...unique.values()][0],
        confidence: "medium",
        reason: `Multiple exact provider source IDs agree with the retained legacy mapping (including “${sourceItemId}”). Confirm it before saving.`,
      };
    }
    return {
      workstreams: [],
      confidence: "none",
      reason: "Exact provider source IDs have conflicting retained legacy mappings. Choose the outcome manually.",
    };
  }
  return {
    workstreams: [],
    confidence: "none",
    reason: "No exact provider source ID has a retained routing decision. Choose the outcome manually; the item name was not used.",
  };
}
