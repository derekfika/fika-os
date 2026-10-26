import { weekCommencingFor } from "./cpu-dashboard-adapter";

/**
 * Date state transitions for the CPU Production calendar. The visible Date
 * field, the displayed week and the Day view date are kept in step here so
 * the page and its tests use the same rules.
 */
export type CalendarDateInputPatch = { date: string; dayDate?: string; weekCommencing?: string };
export type CalendarWeekChangePatch = { date: string; weekCommencing: string };

/** A chosen Date: Day view sets the day, Week view sets the displayed week containing it. */
export function calendarDateInputPatch(value: string, view: string): CalendarDateInputPatch {
  if (view === "day") return { date: value, dayDate: value };
  if (view === "calendar" && value) return { date: value, weekCommencing: weekCommencingFor(value) };
  return { date: value };
}

/** Previous, next or this week: the displayed Monday also becomes the visible Date. */
export function calendarWeekChangePatch(nextWeek: string): CalendarWeekChangePatch {
  return { date: nextWeek, weekCommencing: nextWeek };
}
