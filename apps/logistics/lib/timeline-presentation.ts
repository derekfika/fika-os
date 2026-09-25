export type TimelineEventPresentation = {
  destination: string;
  time: string;
  loadCount: number;
  vehicle?: string;
  lane: "delivery" | "collection";
  visualWidth?: number;
};

export function escapeTimelineHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

export function timelineEventTooltip(presentation: TimelineEventPresentation) {
  return [
    `Destination: ${presentation.destination}`,
    `Time: ${presentation.time}`,
    formatLoadCount(presentation.loadCount),
    presentation.vehicle ? `Vehicle: ${presentation.vehicle}` : undefined,
    `Operation: ${presentation.lane === "collection" ? "Collection" : "Delivery"}`,
  ].filter(Boolean).join("\n");
}

export function timelineEventCardWidth(minutesToNextStop: number | undefined, cellWidth: number) {
  const standardWidth = 124;
  if (minutesToNextStop === undefined || minutesToNextStop >= 45) return standardWidth;
  return Math.max(36, Math.min(standardWidth, Math.floor((minutesToNextStop / 15) * cellWidth) - 4));
}

export function timelineEventHtml(presentation: TimelineEventPresentation) {
  const visualWidth = Math.max(36, Math.min(140, Math.round(presentation.visualWidth || 124)));
  const compactClass = visualWidth < 124 ? " compact" : "";
  return `<span class="fika-event-card${compactClass}" style="--fika-event-card-width:${visualWidth}px"><time>${escapeTimelineHtml(presentation.time)}</time><strong>${escapeTimelineHtml(presentation.destination)}</strong><small>${escapeTimelineHtml(formatLoadCount(presentation.loadCount))}</small></span>`;
}

export function formatLoadCount(loadCount: number) {
  const count = Math.max(1, Math.round(loadCount));
  return `${count} load${count === 1 ? "" : "s"}`;
}
