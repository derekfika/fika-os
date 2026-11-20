import { hospitalityCalendarDay, hospitalityMenuDate, hospitalityRotationWeek } from "../../shared/hospitality-menu-date";

export const categories = ["meat", "fish", "vegetarian", "vegan", "salad", "dessert", "other"] as const;

export type StudioActor = { id: string; name: string; canManage: boolean; canPublish: boolean };
export type Dish = {
  id: string;
  version: number;
  name: string;
  category: (typeof categories)[number];
  temperature: "hot" | "cold" | null;
  customerDescription: string;
  kitchenDescription: string;
  assortment: {
    expectedTotal: number;
    unit: string;
    components: { id: string; name: string; quantity: number }[];
  } | null;
  updatedAt: string;
};

export type Section = {
  id: string;
  name: string;
  catalogueItemId: string;
  mode: "static" | "rotation";
  staticDishIds: string[];
  weeks: string[][];
};

export type Menu = {
  id: string;
  version: number;
  name: string;
  kind: "seasonal" | "collection";
  startDate: string;
  endDate: string;
  anchorMonday: string;
  sections: Section[];
  updatedAt: string;
};

export type PublicationScope = { sectionId?: string; week?: number; dishId?: string };
export type DraftVersion = {
  version: number;
  savedAt: string;
  actorId: string;
  restoredFromVersion?: number;
};
export type Publication = {
  id: string;
  menuId: string;
  menuName: string;
  revision: number;
  effectiveDate: string;
  publishedAt: string;
  publishedBy: string;
  scope: PublicationScope;
  sourceDraftVersion?: number;
  contentHash?: string;
};
export type Review = {
  canPublish: boolean;
  issues: string[];
  changes: string[];
  reviewToken: string | null;
  impact: { status: "unavailable" } | {
    status: "available";
    coverage?: "complete" | "partial";
    reasons?: string[];
    bookings: { id: string; eventDate: string; site: string; selections: string[]; selectionIds?: string[] }[];
  };
  safety: { status: "unavailable" | "unverified" | "verified" };
};

export const londonDate = hospitalityMenuDate;
export const calendarDay = hospitalityCalendarDay;

export function rotationWeek(anchorMonday: string, eventDate: string): number {
  return hospitalityRotationWeek(anchorMonday, eventDate, 6);
}
