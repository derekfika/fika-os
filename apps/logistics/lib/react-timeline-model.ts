export const TIMELINE_DAY_MINUTES = 24 * 60;
export const TIMELINE_SLOT_MINUTES = 15;

export function snapTimelineMinute(clientX: number, viewportLeft: number, scrollLeft: number, grabOffset: number, pixelsPerMinute: number): number {
  const minute = (clientX - viewportLeft + scrollLeft - grabOffset) / pixelsPerMinute;
  return Math.max(0, Math.min(TIMELINE_DAY_MINUTES - TIMELINE_SLOT_MINUTES, Math.round(minute / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES));
}

export function formatTimelineMinute(minute: number): string {
  const safe = Math.max(0, Math.min(TIMELINE_DAY_MINUTES - TIMELINE_SLOT_MINUTES, minute));
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

export function timelineQueueDuplicatesCanonical(workIds: string[], canonicalIds: Set<string>): boolean {
  return workIds.some((id) => canonicalIds.has(id));
}
