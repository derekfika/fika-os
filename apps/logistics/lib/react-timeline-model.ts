import { LAST_SCHEDULABLE_MINUTE, SCHEDULE_SLOT_MINUTES } from "./scheduling";

export const TIMELINE_DAY_MINUTES = 24 * 60;
export const TIMELINE_SLOT_MINUTES = SCHEDULE_SLOT_MINUTES;

export function snapTimelineMinute(clientX: number, trackLeft: number, scrollLeft: number, grabOffset: number, pixelsPerMinute: number, durationMinutes?: number): number {
  // trackLeft is the measured track rectangle, so its origin already reflects
  // horizontal scrolling. Keep scrollLeft in the contract for callers whose
  // coordinate is viewport-relative; the mounted interaction passes the track
  // content origin and zero here.
  const minute = (clientX - trackLeft + scrollLeft - grabOffset) / pixelsPerMinute;
  const requested = Math.round(minute / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES;
  const duration = durationMinutes === undefined ? TIMELINE_SLOT_MINUTES : Math.max(TIMELINE_SLOT_MINUTES, durationMinutes);
  const latestStart = Math.max(0, LAST_SCHEDULABLE_MINUTE - (durationMinutes === undefined ? 0 : duration));
  return Math.max(0, Math.min(latestStart, requested));
}

export function snapTimelineEndMinute(clientX: number, trackLeft: number, pixelsPerMinute: number, startMinute: number, grabOffset = 0): number {
  const latestEnd = LAST_SCHEDULABLE_MINUTE;
  const earliestEnd = startMinute + TIMELINE_SLOT_MINUTES;
  const requested = Math.round(((clientX - trackLeft - grabOffset) / pixelsPerMinute) / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES;
  return Math.max(earliestEnd, Math.min(latestEnd, requested));
}

export function schedulableTimelineRuns<T extends { runId: string }>(runs: T[]): T[] {
  return runs.filter((run) => !run.runId.startsWith("projection-run:") && run.runId.length > 0);
}

export function formatTimelineMinute(minute: number): string {
  const safe = Math.max(0, Math.min(LAST_SCHEDULABLE_MINUTE, minute));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export type TimelineInterval = { id: string; startMinute: number; durationMinutes: number };

/** First-fit interval packing is deterministic and affects presentation only. */
export function timelineVisualSubrows<T extends TimelineInterval>(items: T[]): Map<string, number> {
  const rows: number[] = [];
  const result = new Map<string, number>();
  for (const item of [...items].sort((a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id))) {
    const end = item.startMinute + Math.max(TIMELINE_SLOT_MINUTES, item.durationMinutes);
    let row = rows.findIndex((rowEnd) => rowEnd <= item.startMinute);
    if (row < 0) { row = rows.length; rows.push(end); } else rows[row] = end;
    result.set(item.id, row);
  }
  return result;
}

export type CanonicalTimelinePlacement = {
  workIds: Set<string>;
  runId: string;
  lane: "delivery" | "collection";
  start: string;
};

/** Suppress a queue overlay only when matching canonical work is renderable at that placement. */
export function timelineQueueDuplicatesCanonical(
  workIds: string[],
  canonical: CanonicalTimelinePlacement[],
  proposed: { runId: string; lane: "delivery" | "collection"; start: string },
): boolean {
  return canonical.some((item) => item.runId === proposed.runId && item.lane === proposed.lane && item.start === proposed.start && workIds.some((id) => item.workIds.has(id)));
}
