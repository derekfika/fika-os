import { hospitalityCalendarDay, hospitalityMenuDate, hospitalityRotationWeek } from "../../shared/hospitality-menu-date";

export { categories } from "../../shared/hospitality-menu-studio-content";
export type { Dish, Menu, Section, PublicationScope } from "../../shared/hospitality-menu-studio-content";
import type { PublicationScope } from "../../shared/hospitality-menu-studio-content";
import type { StudioPublicationPilot } from "./hub-publication";

export type StudioActor = { id: string; name: string; canManage: boolean; canPublish: boolean; publicationPilot?: StudioPublicationPilot };

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
