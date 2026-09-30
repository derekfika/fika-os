"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PlannerDay, PlannerMovementView, PlannerWorkGroup } from "../lib/planner-read-model";
import { effectivePlacement, type ConfirmedPlacement, type PendingScheduleOperation, type SchedulePosition } from "../lib/scheduling";
import { formatTimelineMinute, snapTimelineMinute, timelineQueueDuplicatesCanonical, timelineVisualSubrows } from "../lib/react-timeline-model";
import styles from "./mounted-react-timeline.module.css";

type Lane = "delivery" | "collection";
export type QueueCard = { id: string; kind: "group" | "movement"; destination: string; lane: Lane; loadCount: number; workIds: string[]; collectionRequired?: boolean; draggable: boolean };
type Card = { id: string; destination: string; runId: string; lane: Lane; start: string; end?: string; loadCount: number; duration: number; attention: boolean; pending: boolean; queue: boolean; sourceRunId?: string };
type DragOrigin = { card: Card; queueItem?: QueueCard; element: HTMLElement; pointerId: number; startX: number; startY: number; grabOffset: number; started: boolean; x: number; y: number; target?: DragTarget };
type DragTarget = { runId: string; lane: Lane; minute: number; end?: string };

const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
const laneName = (lane: Lane) => lane === "delivery" ? "Delivery" : "Collection";
const addMinutes = (start: string, duration: number) => formatTimelineMinute(minutes(start) + duration);
const hourTicks = Array.from({ length: 25 }, (_, index) => index * 60);
const MINUTE_PX = 2;
const CARD_MIN_WIDTH = 136;
const ROW_BASE_HEIGHT = 78;

function canonicalWorkIds(stop: PlannerDay["runs"][number]["stops"][number]): Set<string> {
  return new Set([
    stop.stopId, stop.linkedStopId, stop.originatingLoadKey,
    ...stop.combinedLines.flatMap((line) => [line.lineKey, ...line.sourceLineRefs.map((ref) => ref.requirementId)]),
  ].filter((value): value is string => Boolean(value)));
}

export function deriveTimelineQueueCards(groups: PlannerWorkGroup[], movements: PlannerMovementView[], runs: PlannerDay["runs"], pendingSchedules: Record<string, PendingScheduleOperation> = {}): QueueCard[] {
  const result: QueueCard[] = [];
  for (const group of groups) {
    const eligible = group.requirementRefs.some((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")));
    let collectionPending = false;
    if (group.collectionRequired && group.groupKey.startsWith("projection-collection:")) {
      const id = group.requirementRefs.find((ref) => ref.stopId)?.stopId;
      const linked = id ? runs.flatMap((run) => run.stops).find((item) => item.stopId === id) : undefined;
      collectionPending = Boolean(linked && !linked.plannedArrivalTime && !linked.plannedWindow?.startTime);
    } else if (group.collectionRequired) {
      collectionPending = group.requirementRefs.some((ref) => {
        const delivery = ref.runId && ref.stopId ? runs.find((run) => run.runId === ref.runId)?.stops.find((stop) => stop.stopId === ref.stopId) : undefined;
        const linked = delivery?.linkedStopId ? runs.flatMap((run) => run.stops).find((stop) => stop.stopId === delivery.linkedStopId) : undefined;
        return Boolean(linked && !linked.plannedArrivalTime && !linked.plannedWindow?.startTime);
      });
    }
    const placementPending = pendingSchedules[group.groupKey]?.intent === "scheduled" && Boolean(pendingSchedules[group.groupKey]?.proposed);
    if (!eligible && !collectionPending && !placementPending) continue;
    result.push({ id: group.groupKey, kind: "group", destination: group.destinationLabel, lane: collectionPending ? "collection" : "delivery", loadCount: Math.max(1, group.requirementCount), workIds: group.requirementRefs.flatMap((ref) => [ref.requirementId, ...(ref.stopId ? [ref.stopId] : [])]), collectionRequired: group.collectionRequired, draggable: !placementPending });
  }
  for (const movement of movements) {
    const placementPending = pendingSchedules[movement.movementId]?.intent === "scheduled" && Boolean(pendingSchedules[movement.movementId]?.proposed);
    if (movement.assignedStops.length && movement.planningState === "planned" && !placementPending) continue;
    result.push({ id: movement.movementId, kind: "movement", destination: movement.to?.label || movement.from?.label || "Movement", lane: movement.type === "collection" ? "collection" : "delivery", loadCount: Math.max(1, movement.items.length), workIds: [movement.movementId, ...movement.assignedStops.flatMap((item) => [item.stopId, item.runId])], draggable: movement.planningState !== "planned" && !placementPending });
  }
  return result;
}

export function MountedReactTimeline({ planner, queueItems, pendingSchedules, confirmedSchedules, onStop, onSchedule, onQueueDrop, onRun }: {
  planner: PlannerDay;
  queueItems: QueueCard[];
  pendingSchedules: Record<string, PendingScheduleOperation>;
  confirmedSchedules: Record<string, ConfirmedPlacement>;
  onStop: (runId: string, stopId: string) => void;
  onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: Lane) => void;
  onQueueDrop: (kind: "group" | "movement", id: string, runId: string, time: string, lane: Lane, collectionRequired?: boolean) => void;
  onRun: (runId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const activeRef = useRef<DragOrigin | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ origin: DragOrigin; target?: DragTarget }>();
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(false);
  const pxPerMinute = MINUTE_PX * zoom;
  const contentWidth = 24 * 60 * pxPerMinute;
  const runById = useMemo(() => new Map(planner.runs.map((run) => [run.runId, run])), [planner.runs]);

  const cards = useMemo(() => {
    const stops: Card[] = [];
    for (const sourceRun of planner.runs) for (const stop of sourceRun.stops) {
      const canonicalStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime;
      const canonical: SchedulePosition | undefined = canonicalStart ? { runId: sourceRun.runId, lane: stop.lane, start: canonicalStart, ...(stop.plannedWindow?.endTime ? { end: stop.plannedWindow.endTime } : {}) } : undefined;
      const placement = effectivePlacement(pendingSchedules[stop.stopId], confirmedSchedules[stop.stopId], canonical);
      if (!placement || placement.kind === "unscheduled") continue;
      const position = placement.position;
      const loadCount = Math.max(1, stop.requirementCount || stop.movementCount);
      stops.push({ id: stop.stopId, destination: stop.destination.label, runId: position.runId, lane: position.lane, start: position.start, ...(position.end ? { end: position.end } : {}), loadCount, duration: position.end ? Math.max(15, minutes(position.end) - minutes(position.start)) : 15, attention: stop.attention.length > 0, pending: Boolean(pendingSchedules[stop.stopId]), queue: false, sourceRunId: sourceRun.runId });
    }
    const canonicalIds = new Set(planner.runs.flatMap((run) => run.stops.flatMap((stop) => [...canonicalWorkIds(stop)])));
    const queueCards: Card[] = queueItems.flatMap((item) => {
      const operation = pendingSchedules[item.id];
      if (!operation?.proposed || operation.intent !== "scheduled" || timelineQueueDuplicatesCanonical(item.workIds, canonicalIds)) return [];
      const position = operation.proposed;
      return [{ id: `queue:${item.id}`, destination: item.destination, runId: position.runId, lane: position.lane, start: position.start, ...(position.end ? { end: position.end } : {}), loadCount: item.loadCount, duration: position.end ? Math.max(15, minutes(position.end) - minutes(position.start)) : 15, attention: false, pending: true, queue: true }];
    });
    return [...stops, ...queueCards].filter((card) => runById.has(card.runId));
  }, [planner.runs, queueItems, pendingSchedules, confirmedSchedules, runById]);

  const rows = useMemo(() => planner.runs.flatMap((run) => (["delivery", "collection"] as Lane[]).map((lane) => {
    const items = cards.filter((card) => card.runId === run.runId && card.lane === lane);
    const subrows = timelineVisualSubrows(items.map((item) => ({ id: item.id, startMinute: minutes(item.start), durationMinutes: Math.max(item.duration, CARD_MIN_WIDTH / pxPerMinute) })));
    const count = subrows.size ? Math.max(...subrows.values()) + 1 : 1;
    return { run, lane, items, subrows, height: Math.min(ROW_BASE_HEIGHT * 4, Math.max(ROW_BASE_HEIGHT, 18 + count * 62)) };
  })), [planner.runs, cards, pxPerMinute]);

  useEffect(() => {
    const first = cards.map((card) => minutes(card.start)).sort((a, b) => a - b)[0] ?? 7 * 60;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = Math.max(0, first * pxPerMinute - viewport.clientWidth * 0.18);
  }, [planner.serviceDate]);

  const resolveTarget = useCallback((x: number, y: number, drag: DragOrigin): DragTarget | undefined => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right) return;
    const row = rows.find(({ run, lane }) => { const rect = rowRefs.current.get(`${run.runId}:${lane}`)?.getBoundingClientRect(); return Boolean(rect && y >= rect.top && y <= rect.bottom); });
    if (!row) return;
    const minute = snapTimelineMinute(x, bounds.left + 150, viewport.scrollLeft, drag.grabOffset, pxPerMinute);
    const end = drag.card.end ? addMinutes(formatTimelineMinute(minute), drag.card.duration) : undefined;
    return { runId: row.run.runId, lane: row.lane, minute, ...(end ? { end } : {}) };
  }, [rows, pxPerMinute]);

  const updatePreview = useCallback((x: number, y: number) => {
    const drag = activeRef.current;
    if (!drag) return;
    drag.x = x; drag.y = y;
    if (!drag.started && Math.hypot(x - drag.startX, y - drag.startY) < 6) return;
    drag.started = true;
    drag.target = resolveTarget(x, y, drag);
    suppressClick.current = true;
    setPreview({ origin: drag, target: drag.target });
  }, [resolveTarget]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => { if (activeRef.current?.pointerId !== event.pointerId) return; updatePreview(event.clientX, event.clientY); };
    const onUp = (event: PointerEvent) => {
      const drag = activeRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      updatePreview(event.clientX, event.clientY);
      const latest = activeRef.current;
      activeRef.current = null;
      setPreview(undefined);
      if (!latest?.started) return;
      const target = resolveTarget(event.clientX, event.clientY, latest);
      if (!target) return;
      if (latest.queueItem) onQueueDrop(latest.queueItem.kind, latest.queueItem.id, target.runId, formatTimelineMinute(target.minute), target.lane, latest.queueItem.collectionRequired);
      else if (latest.card.sourceRunId) onSchedule(latest.card.sourceRunId, latest.card.id, target.runId, formatTimelineMinute(target.minute), target.end, target.lane);
    };
    const onCancel = (event: PointerEvent) => { if (activeRef.current?.pointerId === event.pointerId) { activeRef.current = null; suppressClick.current = false; setPreview(undefined); } };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && activeRef.current) { event.preventDefault(); activeRef.current = null; suppressClick.current = false; setPreview(undefined); } };
    const onQueueDown = (event: PointerEvent) => {
      const source = event.target instanceof Element ? event.target.closest<HTMLElement>(".mock-queue-main") : null;
      const target = source?.closest<HTMLElement>("[data-timeline-queue-id]") || (source?.hasAttribute("data-timeline-queue-id") ? source : null);
      if (!source || !target || event.button !== 0) return;
      const id = target.dataset.timelineQueueId;
      const item = queueItems.find((candidate) => candidate.id === id);
      if (!item?.draggable || pendingSchedules[item.id]) return;
      const rect = target.getBoundingClientRect();
      const card: Card = { id: item.id, destination: item.destination, runId: "", lane: item.lane, start: "00:00", loadCount: item.loadCount, duration: 15, attention: false, pending: false, queue: true };
      const drag: DragOrigin = { card, queueItem: item, element: source, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, grabOffset: 0, started: false, x: event.clientX, y: event.clientY };
      activeRef.current = drag;
      try { source.setPointerCapture(event.pointerId); } catch { /* window pointer handlers are fallback */ }
      void rect;
    };
    const preventDraggedClick = (event: MouseEvent) => { if (!suppressClick.current) return; suppressClick.current = false; event.preventDefault(); event.stopPropagation(); };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onQueueDown, true);
    document.addEventListener("click", preventDraggedClick, true);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); window.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onQueueDown, true); document.removeEventListener("click", preventDraggedClick, true); };
  }, [queueItems, pendingSchedules, onQueueDrop, onSchedule, resolveTarget, updatePreview]);

  useEffect(() => {
    if (!preview?.origin.started) return;
    let frame = 0;
    const tick = () => { const drag = activeRef.current; const viewport = viewportRef.current; if (drag?.started && viewport) { const rect = viewport.getBoundingClientRect(); const edge = 48; const delta = drag.x < rect.left + edge ? -10 : drag.x > rect.right - edge ? 10 : 0; if (delta) { const before = viewport.scrollLeft; viewport.scrollLeft += delta; if (before !== viewport.scrollLeft) updatePreview(drag.x, drag.y); } frame = window.requestAnimationFrame(tick); } };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [Boolean(preview?.origin.started), updatePreview]);

  const beginCard = (event: ReactPointerEvent<HTMLButtonElement>, card: Card) => {
    if (card.pending || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    activeRef.current = { card, element: event.currentTarget, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, grabOffset: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), started: false, x: event.clientX, y: event.clientY };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* window pointer handlers are fallback */ }
  };

  const activeOrigin = preview?.origin;
  const previewCard: Card | undefined = activeOrigin && preview?.target ? { ...activeOrigin.card, runId: preview.target.runId, lane: preview.target.lane, start: formatTimelineMinute(preview.target.minute), ...(preview.target.end ? { end: preview.target.end } : {}) } : undefined;
  const previewLeft = preview?.target ? preview.target.minute * pxPerMinute : 0;
  const fitTimeline = () => { const viewport = viewportRef.current; if (!viewport) return; const next = Math.max(0.45, Math.min(2, viewport.clientWidth / (24 * 60 * MINUTE_PX))); setZoom(next); setFit(true); };

  return <div className={styles.timeline} data-testid="mounted-react-timeline" style={{ "--timeline-content-width": `${contentWidth}px` } as React.CSSProperties}>
    <div className={styles.tools} aria-label="Timeline controls"><span>Timeline</span><button type="button" aria-label="Zoom timeline out" onClick={() => { setFit(false); setZoom((value) => Math.max(0.5, value - 0.25)); }}>−</button><input aria-label="Timeline zoom" type="range" min="0.5" max="2" step="0.05" value={zoom} onChange={(event) => { setFit(false); setZoom(Number(event.target.value)); }} /><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom timeline in" onClick={() => { setFit(false); setZoom((value) => Math.min(2, value + 0.25)); }}>＋</button><button type="button" onClick={fitTimeline}>Fit day</button><span className={styles.srOnly}>{fit ? "Full day fitted" : "Scroll horizontally to view the full operational day"}</span></div>
    <div className={styles.board}>
      <div className={styles.axisViewport} ref={viewportRef} data-testid="mounted-timeline-viewport" aria-label="Full operational day timeline, midnight to midnight">
        <div className={styles.content}>
          <div className={styles.axis} aria-hidden="true">{hourTicks.map((minute) => <span key={minute} style={{ left: `${minute * pxPerMinute}px` }}>{minute === 1440 ? "24:00" : formatTimelineMinute(minute)}</span>)}</div>
          {rows.map(({ run, lane, items, subrows, height }) => {
            const key = `${run.runId}:${lane}`;
            const highlighted = preview?.target?.runId === run.runId && preview.target.lane === lane;
            const name = run.vehicle || run.driver || "Unassigned vehicle";
            return <div className={styles.row} key={key}>
              <div className={styles.rowLabel}><strong>{name}</strong><span>{run.driver && run.vehicle ? run.driver : `Run ${planner.runs.indexOf(run) + 1}`} · {laneName(lane)}</span><button type="button" onClick={() => onRun(run.runId)}>Run details</button></div>
              <div className={`${styles.track} ${highlighted ? styles.activeTrack : ""}`} ref={(element) => { if (element) rowRefs.current.set(key, element); else rowRefs.current.delete(key); }} data-lane={key} aria-label={`${name} ${laneName(lane)} lane`} style={{ height: `${height}px` }}>
                {items.map((card) => {
                  const row = subrows.get(card.id) || 0;
                  const left = minutes(card.start) * pxPerMinute;
                  const width = Math.max(CARD_MIN_WIDTH, (card.end ? card.duration * pxPerMinute : CARD_MIN_WIDTH));
                  const isOrigin = activeOrigin?.card.id === card.id && activeOrigin.started;
                  if (isOrigin) return <span key={card.id} aria-hidden="true" className={styles.origin} style={{ left, top: `${8 + row * 62}px`, width }} />;
                  const label = `Move ${card.destination}, ${name}, ${laneName(lane)}, ${card.start}${card.end ? ` to ${card.end} window end` : ""}, ${card.loadCount} loads`;
                  return <button type="button" key={card.id} className={`${styles.card} ${lane === "collection" ? styles.collection : ""} ${card.attention ? styles.attention : ""} ${card.pending ? styles.pending : ""}`} data-testid={card.queue ? `pending-queue-${card.id.slice("queue:".length)}` : `stop-${card.id}`} aria-label={label} aria-busy={card.pending} disabled={card.pending} style={{ left, top: `${8 + row * 62}px`, width }} onPointerDown={(event) => beginCard(event, card)} onClick={() => card.sourceRunId && onStop(card.runId, card.id)}>
                    <time>{card.start}{card.end ? `–${card.end}` : ""}</time><strong>{card.destination}</strong><small>{card.loadCount} {card.loadCount === 1 ? "load" : "loads"}{card.pending ? " · Saving" : ""}</small>
                  </button>;
                })}
                {previewCard?.runId === run.runId && previewCard.lane === lane && <div className={styles.ghost} data-testid="mounted-drag-ghost" aria-hidden="true" style={{ left: previewLeft, top: 8, width: Math.max(CARD_MIN_WIDTH, previewCard.duration * pxPerMinute) }}><time>{previewCard.start}{previewCard.end ? `–${previewCard.end}` : ""}</time><strong>{previewCard.destination}</strong><small>{previewCard.loadCount} {previewCard.loadCount === 1 ? "load" : "loads"}</small></div>}
                {highlighted && preview.target && <><span className={styles.snapLine} style={{ left: previewLeft }} aria-hidden="true" /><span className={styles.timePill} style={{ left: previewLeft }} aria-hidden="true">{formatTimelineMinute(preview.target.minute)}</span></>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </div>
    {!planner.runs.length && <p className={styles.empty}>No dispatch runs. Create a run to begin planning.</p>}
  </div>;
}
