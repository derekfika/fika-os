const SALAD_SLOT_LABELS: Readonly<Record<string, string>> = {
  "SALAD 1": "SALAD 1 · Leaf",
  "SALAD 2": "SALAD 2 · Slaw",
  "SALAD 3": "SALAD 3 · Starch",
  "SALAD 4": "SALAD 4 · Veg",
  "SALAD 5": "SALAD 5 · Grain/Pulse",
  "SALAD 6": "SALAD 6 · FIKA Seasonal",
};

/** Keep Week Planner's numbered salad labels distinct while preserving other slot labels. */
export function weekPlannerSlotLabel(slot: string, genericLabel: string) {
  return SALAD_SLOT_LABELS[slot] || genericLabel;
}
