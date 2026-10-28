/** UI-only view types. Replace the adapter mapping when the authoritative Hub contract is published. */
export type RotationStatus = "draft" | "scheduled" | "active";

export type RotationDish = {
  canonicalId: string;
  recipeRevision: number;
  name: string;
  category: string;
};

export type OrderingRules = {
  guests: { minimum: number | null; maximum: number | null; increment: number | null };
  distinctDishes: { minimum: number | null; maximum: number | null };
  quantityPerDish: { minimum: number | null; maximum: number | null; increment: number | null };
  quantityUnit: string;
};

export type RotationCategory = { id: string; label: string };

export type RotationGroup = {
  id: string;
  name: string;
  categoryId: string;
  archived?: boolean;
  catalogueItemId: string | null;
  catalogueItemLabel: string | null;
  dishBank: RotationDish[];
  rules: OrderingRules;
};

export type RotationVersion = {
  id: string;
  name: string;
  status: RotationStatus;
  effectiveFrom: string;
  revision: number;
  weeklySelections: Record<string, Record<number, string[]>>;
};

export type RotationWorkspace = {
  globalCycle: {
    lengthWeeks: number;
    anchorDate: string;
    timezone: string;
  };
  categories: RotationCategory[];
  groups: RotationGroup[];
  versions: RotationVersion[];
};
