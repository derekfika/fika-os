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
};
export type Review = {
  canPublish: boolean;
  issues: string[];
  changes: string[];
  reviewToken: string | null;
  impact: { status: "unavailable" } | {
    status: "available";
    bookings: { id: string; eventDate: string; site: string; selections: string[] }[];
  };
  safety: { status: "unavailable" | "unverified" | "verified" };
};

const dayMs = 86_400_000;
const londonCalendar = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});

export function londonDate(now = new Date()): string {
  const parts = Object.fromEntries(londonCalendar.formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function calendarDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : NaN;
}

export function rotationWeek(anchorMonday: string, eventDate: string): number {
  const week = Math.floor((calendarDay(eventDate) - calendarDay(anchorMonday)) / (7 * dayMs));
  return ((week % 6 + 6) % 6) + 1;
}
