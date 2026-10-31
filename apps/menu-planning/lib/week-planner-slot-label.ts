const SALAD_SLOT_LABELS: Readonly<Record<string, string>> = {
  "SALAD 1": "Leaf Salad",
  "SALAD 2": "Slaw",
  "SALAD 3": "Starch",
  "SALAD 4": "Veg",
  "SALAD 5": "Grain/Pulse",
  "SALAD 6": "FIKA Seasonal",
};

/** Use owner-approved display names without changing slot identity or generic labels elsewhere. */
export function weekPlannerSlotLabel(slot: string, genericLabel: string) {
  return SALAD_SLOT_LABELS[slot] || genericLabel;
}
