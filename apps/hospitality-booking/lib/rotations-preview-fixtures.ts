import type { RotationDish, RotationWorkspace } from "./rotations-ui-types";

const dishes: RotationDish[] = [
  { canonicalId: "dish-preview-001", name: "Roasted tomato arancini", category: "Finger Food", recipeRevision: 1 },
  { canonicalId: "dish-preview-002", name: "Smoked salmon blinis", category: "Canapés", recipeRevision: 1 },
  { canonicalId: "dish-preview-003", name: "Crispy aubergine bowl", category: "Bowl Food", recipeRevision: 1 },
  { canonicalId: "dish-preview-004", name: "Grilled chicken salad", category: "Salad Proteins", recipeRevision: 1 },
  { canonicalId: "dish-preview-005", name: "Seasonal grain box", category: "Salad Boxes", recipeRevision: 1 },
  { canonicalId: "dish-preview-006", name: "Heritage beetroot tartlet", category: "Canapés", recipeRevision: 1 },
  { canonicalId: "dish-preview-007", name: "Lemon herb halloumi", category: "Salad Proteins", recipeRevision: 1 },
  { canonicalId: "dish-preview-008", name: "Pear and chicory salad", category: "Salad Boxes", recipeRevision: 1 },
];

const groups = [
  ["group-preview-1", "Finger Food", "category-preview-1", "item-preview-1", "Finger food selection", [dishes[0]!, dishes[1]!]],
  ["group-preview-2", "Canapés", "category-preview-2", "item-preview-2", "Canapés selection", [dishes[1]!, dishes[5]!]],
  ["group-preview-3", "Bowl Food", "category-preview-3", "item-preview-3", "Bowl food selection", [dishes[2]!]],
  ["group-preview-4", "Salad Proteins", "category-preview-4", "item-preview-4", "Salad protein selection", [dishes[3]!, dishes[6]!]],
  ["group-preview-5", "Salad Boxes", "category-preview-5", "item-preview-5", "Salad box selection", [dishes[4]!, dishes[7]!]],
] as const;

const selections = Object.fromEntries(groups.map(([groupId, , , , , bank], groupIndex) => [
  groupId,
  {
    1: bank.slice(0, 1).map((dish) => dish.canonicalId),
    2: bank.slice(-1).map((dish) => dish.canonicalId),
    3: groupIndex % 2 === 0 ? bank.map((dish) => dish.canonicalId) : [],
    4: [],
    5: bank.slice(0, 1).map((dish) => dish.canonicalId),
    6: bank.map((dish) => dish.canonicalId),
  },
]));

/** Synthetic records for the development-only preview route; never used as production truth. */
export const rotationPreviewFixtures = {
  library: dishes,
  workspace: {
    globalCycle: { lengthWeeks: 6, anchorDate: "2026-01-05", timezone: "Europe/London" },
    categories: groups.map(([, label, id]) => ({ id, label })),
    groups: groups.map(([id, name, categoryId, catalogueItemId, catalogueItemLabel, dishBank]) => ({
      id,
      name,
      categoryId,
      catalogueItemId,
      catalogueItemLabel,
      dishBank: [...dishBank],
      rules: { guests: { minimum: 6, maximum: 120, increment: 1 }, distinctDishes: { minimum: 3, maximum: 3 }, quantityPerDish: { minimum: 6, maximum: 60, increment: 6 }, quantityUnit: "pieces" },
    })),
    versions: [
      { id: "version-preview-active", name: "Core menu", status: "active" as const, effectiveFrom: "2026-01-05", revision: 1, weeklySelections: selections },
      { id: "version-preview-draft", name: "Spring planning", status: "draft" as const, effectiveFrom: "2026-04-06", revision: 2, weeklySelections: structuredClone(selections) },
      { id: "version-preview-scheduled", name: "Winter menu", status: "scheduled" as const, effectiveFrom: "2026-12-07", revision: 3, weeklySelections: structuredClone(selections) },
    ],
  } satisfies RotationWorkspace,
};
