export const ROLLING_SLOTS = ["SALAD 1", "SALAD 2", "SALAD 3", "SALAD 4", "SALAD 5", "SALAD 6", "COLD PROTEIN", "SOUP", "HOT MEAT", "HOT VEG VEGAN", "EXTRAS 1", "EXTRAS 2", "EXTRAS 3", "EXTRAS 4", "EXTRAS 5", "EXTRAS 6"] as const;
export type RollingSlot = typeof ROLLING_SLOTS[number];
export type RollingWeekStatus = "draft" | "needs_review" | "ready" | "published" | "archived";
export type AllergenState = "clear" | "contains" | "may_contain";
export type AllergenMap = Record<string, AllergenState>;
export interface RollingAllocation { destinationId?: string; destinationLabel: string; quantity: number; sourceLabel?: string; }
export interface RollingEntry { id: string; dayId: string; date: string; slot: string; itemId?: string; itemLabel: string; portions: number; allocations: RollingAllocation[]; allergens: AllergenMap; mayContainNotes?: string; source?: { workbook: string; sheet: string; range: string; rawText?: string }; audit: Array<{ action: string; at: string; by: string }>; }
export interface RollingDay { id: string; date: string; dayName: string; entryIds: string[]; }
export interface RollingWeek { id: string; weekCommencing: string; weekEnding: string; status: RollingWeekStatus; version: number; dayIds: string[]; entryIds: string[]; sourceFiles: string[]; customSlots?: string[]; removedSlots?: string[]; audit: Array<{ action: string; at: string; by: string }>; }
export interface RollingSnapshot { week: RollingWeek; days: RollingDay[]; entries: RollingEntry[]; }
