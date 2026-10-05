export const ARRIVAL_MARKER_WIDTH_PX = 14;

/** Explicit windows occupy exactly their elapsed time at the current scale. */
export function timelineBlockWidth(startMinute: number, endMinute: number | undefined, pixelsPerMinute: number): number {
  return endMinute === undefined
    ? ARRIVAL_MARKER_WIDTH_PX
    : Math.max(0, endMinute - startMinute) * pixelsPerMinute;
}

export function timelineDurationMinutes(startMinute: number, endMinute: number | undefined, defaultArrivalMinutes = 15): number {
  return endMinute === undefined ? defaultArrivalMinutes : Math.max(0, endMinute - startMinute);
}
