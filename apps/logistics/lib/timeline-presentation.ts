export type TimelineEventPresentation = {
  destination: string;
  time: string;
  loadCount: number;
  vehicle?: string;
  lane: "delivery" | "collection";
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

export function timelineEventAreaHtml(presentation: TimelineEventPresentation) {
  return `<span class="fika-event-card"><time>${escapeTimelineHtml(presentation.time)}</time><strong>${escapeTimelineHtml(presentation.destination)}</strong><small>${escapeTimelineHtml(formatLoadCount(presentation.loadCount))}</small></span>`;
}

export function timelineEventInlineHtml(presentation: TimelineEventPresentation) {
  return `<span class="fika-event-inline-content"><time>${escapeTimelineHtml(presentation.time)}</time><strong>${escapeTimelineHtml(presentation.destination)}</strong><small>${escapeTimelineHtml(formatLoadCount(presentation.loadCount))}</small></span>`;
}

export function formatLoadCount(loadCount: number) {
  const count = Math.max(1, Math.round(loadCount));
  return `${count} load${count === 1 ? "" : "s"}`;
}
