export const POC_DAY_START = 6 * 60;
export const POC_DAY_END = 14 * 60;
export const POC_SLOT_MINUTES = 15;
export const POC_SLOT_WIDTH = 38;
export const POC_CARD_WIDTH = 124;

export type PocLane = "delivery" | "collection";
export type PocVehicle = "van-1" | "van-2";

export type PocPlacement = {
  id: string;
  destination: string;
  vehicle: PocVehicle;
  lane: PocLane;
  startMinute: number;
  durationMinutes: number;
  loadCount: number;
  kind: "delivery" | "collection";
  explicitWindow?: boolean;
  state: "confirmed" | "pending";
};

export function snapPocMinute(clientX: number, viewportLeft: number, scrollLeft: number, grabOffsetPx: number) {
  const slot = Math.round((clientX - viewportLeft + scrollLeft - grabOffsetPx) / POC_SLOT_WIDTH);
  return Math.max(0, Math.min((POC_DAY_END - POC_DAY_START) / POC_SLOT_MINUTES, slot)) * POC_SLOT_MINUTES + POC_DAY_START;
}

export function clampPocMinute(minute: number, durationMinutes = POC_SLOT_MINUTES) {
  const lastStart = POC_DAY_END - Math.min(durationMinutes, POC_DAY_END - POC_DAY_START);
  const snapped = POC_DAY_START + Math.round((minute - POC_DAY_START) / POC_SLOT_MINUTES) * POC_SLOT_MINUTES;
  return Math.max(POC_DAY_START, Math.min(lastStart, snapped));
}

export function pocLeftPx(startMinute: number) {
  return ((startMinute - POC_DAY_START) / POC_SLOT_MINUTES) * POC_SLOT_WIDTH;
}

export function formatPocTime(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Packs readable display rectangles into visual subrows without changing their operational time anchors. */
export function pocVisualSubrows<T extends Pick<PocPlacement, "id" | "startMinute">>(items: T[], cardWidth = POC_CARD_WIDTH) {
  const rowEnds: number[] = [];
  const result = new Map<string, number>();
  const sorted = [...items].sort((a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id));
  for (const item of sorted) {
    const left = pocLeftPx(item.startMinute);
    const row = rowEnds.findIndex((end) => end <= left);
    const index = row < 0 ? rowEnds.length : row;
    rowEnds[index] = left + cardWidth;
    result.set(item.id, index);
  }
  return result;
}

export function adjustedPocPlacement(placement: PocPlacement, proposedMinute: number) {
  return { ...placement, startMinute: clampPocMinute(proposedMinute + POC_SLOT_MINUTES, placement.durationMinutes), state: "confirmed" as const };
}
