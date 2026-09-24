import type { FulfilmentWorkstream } from "../../shared/fulfilment-workstream";

export type TimelineEventPresentation = {
  destination: string;
  time: string;
  workstream: FulfilmentWorkstream | string;
  quantity?: string;
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
    `Workstream: ${presentation.workstream}`,
    `Time: ${presentation.time}`,
    presentation.quantity ? `Quantity: ${presentation.quantity}` : undefined,
    `Operation: ${presentation.lane === "collection" ? "Collection" : "Delivery"}`,
  ].filter(Boolean).join("\n");
}

export function timelineEventAreaHtml(presentation: TimelineEventPresentation) {
  const quantity = presentation.quantity ? ` · ${presentation.quantity}` : "";
  return `<span class="fika-event-label-content"><strong>${escapeTimelineHtml(presentation.destination)}</strong><small>${escapeTimelineHtml(`${presentation.workstream}${quantity}`)}</small></span>`;
}

export function timelineEventInlineHtml(presentation: TimelineEventPresentation) {
  return `<span class="fika-event-inline-content"><strong>${escapeTimelineHtml(presentation.time)}</strong><small>${escapeTimelineHtml(presentation.workstream)}</small></span>`;
}

