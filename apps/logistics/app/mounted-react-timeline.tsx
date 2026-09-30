"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PlannerDay, PlannerMovementView, PlannerWorkGroup } from "../lib/planner-read-model";
import { directResizeEnabled, effectivePlacement, type ConfirmedPlacement, type PendingScheduleOperation, type SchedulePosition } from "../lib/scheduling";
import { formatTimelineMinute, schedulableTimelineRuns, snapTimelineEndMinute, snapTimelineMinute, timelineQueueDuplicatesCanonical, timelineVisualSubrows } from "../lib/react-timeline-model";
import styles from "./mounted-react-timeline.module.css";

type Lane = "delivery" | "collection";
export type QueueCard = { id: string; kind: "group" | "movement"; destination: string; lane: Lane; loadCount: number; workIds: string[]; collectionRequired?: boolean; draggable: boolean };
type Card = { id: string; destination: string; runId: string; lane: Lane; start: string; end?: string; loadCount: number; duration: number; attention: boolean; pending: boolean; queue: boolean; sourceRunId?: string };
type DragOrigin = { card: Card; queueItem?: QueueCard; element: HTMLElement; pointerId: number; startX: number; startY: number; grabOffset: number; mode: "move" | "resize"; endGrabOffset?: number; started: boolean; x: number; y: number; target?: DragTarget };
type DragTarget = { kind: "lane"; runId: string; lane: Lane; minute: number; end?: string } | { kind: "resize"; runId: string; lane: Lane; start: string; endMinute: number } | { kind: "queue" };

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
    const eligibleRefs = group.requirementRefs.filter((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")));
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
    if (!eligibleRefs.length && !collectionPending && !placementPending) continue;
    const workIds = collectionPending
      ? groupCollectionWorkIds(group, runs)
      : eligibleRefs.flatMap((ref) => [ref.requirementId, ...(ref.stopId ? [ref.stopId] : [])]);
    result.push({ id: group.groupKey, kind: "group", destination: group.destinationLabel, lane: collectionPending ? "collection" : "delivery", loadCount: Math.max(1, collectionPending ? group.requirementCount : eligibleRefs.length), workIds, collectionRequired: group.collectionRequired, draggable: !placementPending });
  }
  for (const movement of movements) {
    const placementPending = pendingSchedules[movement.movementId]?.intent === "scheduled" && Boolean(pendingSchedules[movement.movementId]?.proposed);
    if (movement.assignedStops.length && movement.planningState === "planned" && !placementPending) continue;
    result.push({ id: movement.movementId, kind: "movement", destination: movement.to?.label || movement.from?.label || "Movement", lane: movement.type === "collection" ? "collection" : "delivery", loadCount: Math.max(1, movement.items.length), workIds: [movement.movementId, ...movement.assignedStops.map((item) => item.stopId)], draggable: movement.planningState !== "planned" && !placementPending });
  }
  return result;
}

function groupCollectionWorkIds(group: PlannerWorkGroup, runs: PlannerDay["runs"]): string[] {
  const ids = new Set<string>();
  if (group.groupKey.startsWith("projection-collection:")) {
    const referencedIds = group.requirementRefs.flatMap((ref) => ref.stopId ? [ref.stopId] : []);
    for (const stopId of referencedIds) {
      const stop = runs.flatMap((run) => run.stops).find((candidate) => candidate.stopId === stopId);
      if (stop) for (const id of canonicalWorkIds(stop)) ids.add(id);
      else ids.add(stopId);
    }
    if (!ids.size) ids.add(group.groupKey.slice("projection-collection:".length));
    return [...ids];
  }
  for (const ref of group.requirementRefs) {
    if (!ref.runId || !ref.stopId) continue;
    const source = runs.find((run) => run.runId === ref.runId)?.stops.find((stop) => stop.stopId === ref.stopId);
    const linked = source?.linkedStopId ? runs.flatMap((run) => run.stops).find((stop) => stop.stopId === source.linkedStopId) : undefined;
    if (linked) for (const id of canonicalWorkIds(linked)) ids.add(id);
  }
  return [...ids];
}

export function MountedReactTimeline({ planner, queueItems, pendingSchedules, confirmedSchedules, onStop, onSchedule, onQueueDrop, onReturnToQueue, onRun }: {
  planner: PlannerDay;
  queueItems: QueueCard[];
  pendingSchedules: Record<string, PendingScheduleOperation>;
  confirmedSchedules: Record<string, ConfirmedPlacement>;
  onStop: (runId: string, stopId: string) => void;
  onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: Lane, preserveStart?: boolean) => void;
  onQueueDrop: (kind: "group" | "movement", id: string, runId: string, time: string, lane: Lane, collectionRequired?: boolean) => void;
  onReturnToQueue: (sourceRunId: string, stopId: string) => void;
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
  const schedulableRuns = useMemo(() => schedulableTimelineRuns(planner.runs), [planner.runs]);
  const runById = useMemo(() => new Map(schedulableRuns.map((run) => [run.runId, run])), [schedulableRuns]);

  const cards = useMemo(() => {
    const stops: Card[] = [];
    for (const sourceRun of schedulableRuns) for (const stop of sourceRun.stops) {
      const canonicalStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime;
      const canonical: SchedulePosition | undefined = canonicalStart ? { runId: sourceRun.runId, lane: stop.lane, start: canonicalStart, ...(stop.plannedWindow?.endTime ? { end: stop.plannedWindow.endTime } : {}) } : undefined;
      const placement = effectivePlacement(pendingSchedules[stop.stopId], confirmedSchedules[stop.stopId], canonical);
      if (!placement || placement.kind === "unscheduled") continue;
      const position = placement.position;
      const loadCount = Math.max(1, stop.requirementCount || stop.movementCount);
      stops.push({ id: stop.stopId, destination: stop.destination.label, runId: position.runId, lane: stop.lane, start: position.start, ...(position.end ? { end: position.end } : {}), loadCount, duration: position.end ? Math.max(15, minutes(position.end) - minutes(position.start)) : 15, attention: stop.attention.length > 0, pending: Boolean(pendingSchedules[stop.stopId]), queue: false, sourceRunId: sourceRun.runId });
    }
    const canonical = schedulableRuns.flatMap((run) => run.stops.flatMap((stop) => {
      const start = stop.plannedWindow?.startTime || stop.plannedArrivalTime;
      return start ? [{ workIds: canonicalWorkIds(stop), runId: run.runId, lane: stop.lane, start }] : [];
    }));
    const queueCards: Card[] = queueItems.flatMap((item) => {
      const operation = pendingSchedules[item.id];
      if (!operation?.proposed || operation.intent !== "scheduled" || timelineQueueDuplicatesCanonical(item.workIds, canonical, operation.proposed)) return [];
      const position = operation.proposed;
      return [{ id: `queue:${item.id}`, destination: item.destination, runId: position.runId, lane: position.lane, start: position.start, ...(position.end ? { end: position.end } : {}), loadCount: item.loadCount, duration: position.end ? Math.max(15, minutes(position.end) - minutes(position.start)) : 15, attention: false, pending: true, queue: true }];
    });
    return [...stops, ...queueCards].filter((card) => runById.has(card.runId));
  }, [schedulableRuns, queueItems, pendingSchedules, confirmedSchedules, runById]);

  const rows = useMemo(() => schedulableRuns.flatMap((run) => (["delivery", "collection"] as Lane[]).map((lane) => {
    const items = cards.filter((card) => card.runId === run.runId && card.lane === lane);
    const subrows = timelineVisualSubrows(items.map((item) => ({ id: item.id, startMinute: minutes(item.start), durationMinutes: Math.max(item.duration, CARD_MIN_WIDTH / pxPerMinute) })));
    const count = subrows.size ? Math.max(...subrows.values()) + 1 : 1;
    return { run, lane, items, subrows, height: Math.max(ROW_BASE_HEIGHT, 18 + count * 62) };
  })), [schedulableRuns, cards, pxPerMinute]);

  useEffect(() => {
    const first = cards.map((card) => minutes(card.start)).sort((a, b) => a - b)[0] ?? 7 * 60;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = Math.max(0, first * pxPerMinute - viewport.clientWidth * 0.18);
  }, [planner.serviceDate]);

  const resolveTarget = useCallback((x: number, y: number, drag: DragOrigin): DragTarget | undefined => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    if (drag.mode === "resize") {
      const trackBounds = rowRefs.current.get(`${drag.card.runId}:${drag.card.lane}`)?.getBoundingClientRect();
      if (!trackBounds || !drag.card.end) return;
      const endMinute = snapTimelineEndMinute(x, trackBounds.left, pxPerMinute, minutes(drag.card.start), drag.endGrabOffset || 0);
      return { kind: "resize", runId: drag.card.runId, lane: drag.card.lane, start: drag.card.start, endMinute };
    }
    const queue = drag.card.sourceRunId ? document.querySelector<HTMLElement>("[data-logistics-planning-queue]") : null;
    const queueBounds = queue?.getBoundingClientRect();
    if (queueBounds && x >= queueBounds.left && x <= queueBounds.right && y >= queueBounds.top && y <= queueBounds.bottom) return { kind: "queue" };
    const row = rows.find(({ run, lane }) => { const rect = rowRefs.current.get(`${run.runId}:${lane}`)?.getBoundingClientRect(); return Boolean(rect && y >= rect.top && y <= rect.bottom); });
    if (!row) return;
    if (row.lane !== drag.card.lane) return;
    const trackBounds = rowRefs.current.get(`${row.run.runId}:${row.lane}`)?.getBoundingClientRect();
    if (!trackBounds) return;
    if (x < Math.max(bounds.left, trackBounds.left) || x > Math.min(trackBounds.right, bounds.right + CARD_MIN_WIDTH)) return;
    const minute = snapTimelineMinute(x, trackBounds.left, 0, drag.grabOffset, pxPerMinute, drag.card.end ? drag.card.duration : undefined);
    const start = formatTimelineMinute(minute);
    const end = drag.card.end ? addMinutes(start, drag.card.duration) : undefined;
    return { kind: "lane", runId: row.run.runId, lane: row.lane, minute, ...(end ? { end } : {}) };
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
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      const target = resolveTarget(event.clientX, event.clientY, latest);
      if (!target) return;
      if (target.kind === "queue" && latest.card.sourceRunId) onReturnToQueue(latest.card.sourceRunId, latest.card.id);
      else if (target.kind === "lane" && latest.queueItem) onQueueDrop(latest.queueItem.kind, latest.queueItem.id, target.runId, formatTimelineMinute(target.minute), target.lane, latest.queueItem.collectionRequired);
      else if (target.kind === "lane" && latest.card.sourceRunId) onSchedule(latest.card.sourceRunId, latest.card.id, target.runId, formatTimelineMinute(target.minute), target.end, target.lane);
      else if (target.kind === "resize" && latest.card.sourceRunId) onSchedule(latest.card.sourceRunId, latest.card.id, target.runId, target.start, formatTimelineMinute(target.endMinute), target.lane, true);
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
      const drag: DragOrigin = { card, queueItem: item, element: source, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, grabOffset: 0, mode: "move", started: false, x: event.clientX, y: event.clientY };
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
  }, [queueItems, pendingSchedules, onQueueDrop, onReturnToQueue, onSchedule, resolveTarget, updatePreview]);

  useEffect(() => {
    const queue = document.querySelector<HTMLElement>("[data-logistics-planning-queue]");
    if (!queue) return;
    if (preview?.target?.kind === "queue") queue.dataset.returnTarget = "active";
    else delete queue.dataset.returnTarget;
    return () => { delete queue.dataset.returnTarget; };
  }, [preview?.target]);

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
    activeRef.current = { card, element: event.currentTarget, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, grabOffset: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), mode: "move", started: false, x: event.clientX, y: event.clientY };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* window pointer handlers are fallback */ }
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, card: Card, endMinute: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (card.pending || !card.end || event.button !== 0) return;
    const track = rowRefs.current.get(`${card.runId}:${card.lane}`);
    const trackBounds = track?.getBoundingClientRect();
    if (!trackBounds) return;
    const actualEndX = trackBounds.left + endMinute * pxPerMinute;
    activeRef.current = { card, element: event.currentTarget, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, grabOffset: 0, endGrabOffset: event.clientX - actualEndX, mode: "resize", started: false, x: event.clientX, y: event.clientY };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* window pointer handlers are fallback */ }
  };

  const activeOrigin = preview?.origin;
  const laneTarget = preview?.target?.kind === "lane" ? preview.target : undefined;
  const resizeTarget = preview?.target?.kind === "resize" ? preview.target : undefined;
  const previewCard: Card | undefined = activeOrigin && laneTarget ? { ...activeOrigin.card, runId: laneTarget.runId, lane: laneTarget.lane, start: formatTimelineMinute(laneTarget.minute), ...(laneTarget.end ? { end: laneTarget.end } : {}) } : activeOrigin && resizeTarget ? { ...activeOrigin.card, end: formatTimelineMinute(resizeTarget.endMinute), duration: resizeTarget.endMinute - minutes(resizeTarget.start) } : undefined;
  const previewLeft = laneTarget ? laneTarget.minute * pxPerMinute : resizeTarget ? minutes(resizeTarget.start) * pxPerMinute : 0;
  const fitTimeline = () => {
    const viewport = viewportRef.current;
    const labelWidth = viewport?.querySelector<HTMLElement>(`.${styles.rowLabel}`)?.getBoundingClientRect().width;
    if (!viewport || !labelWidth) return;
    setZoom(Math.max(0.05, Math.min(2, (viewport.clientWidth - labelWidth - 16) / (24 * 60 * MINUTE_PX))));
    setFit(true);
  };

  return <div className={styles.timeline} data-testid="mounted-react-timeline" style={{ "--timeline-content-width": `${contentWidth}px`, "--timeline-quarter-hour": `${15 * pxPerMinute}px`, "--timeline-hour": `${60 * pxPerMinute}px` } as React.CSSProperties}>
    <div className={styles.tools} aria-label="Timeline controls"><span>Timeline</span><button type="button" aria-label="Zoom timeline out" onClick={() => { setFit(false); setZoom((value) => Math.max(0.05, value - 0.25)); }}>−</button><input aria-label="Timeline zoom" type="range" min="0.05" max="2" step="0.05" value={zoom} onChange={(event) => { setFit(false); setZoom(Number(event.target.value)); }} /><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom timeline in" onClick={() => { setFit(false); setZoom((value) => Math.min(2, value + 0.25)); }}>＋</button><button type="button" onClick={fitTimeline}>Fit day</button><span className={styles.srOnly}>{fit ? "Full day fitted" : "Scroll horizontally to view the full operational day"}</span></div>
    <div className={styles.board}>
      <div className={styles.axisViewport} ref={viewportRef} data-testid="mounted-timeline-viewport" aria-label="Full operational day timeline, midnight to midnight">
        <div className={styles.content}>
          <div className={styles.axis} aria-hidden="true">{hourTicks.map((minute) => <span key={minute} style={{ left: `${minute * pxPerMinute}px` }}>{minute === 1440 ? "24:00" : formatTimelineMinute(minute)}</span>)}</div>
          {rows.map(({ run, lane, items, subrows, height }) => {
            const key = `${run.runId}:${lane}`;
            const highlighted = (laneTarget?.runId === run.runId && laneTarget.lane === lane) || (resizeTarget?.runId === run.runId && resizeTarget.lane === lane);
            const name = run.vehicle || run.driver || "Unassigned vehicle";
            return <div className={styles.row} key={key}>
              <div className={styles.rowLabel}><strong>{name}</strong><span>{run.driver && run.vehicle ? run.driver : `Run ${schedulableRuns.indexOf(run) + 1}`} · {laneName(lane)}</span><button type="button" onClick={() => onRun(run.runId)}>Run details</button></div>
              <div className={`${styles.track} ${highlighted ? styles.activeTrack : ""}`} ref={(element) => { if (element) rowRefs.current.set(key, element); else rowRefs.current.delete(key); }} data-lane={key} aria-label={`${name} ${laneName(lane)} lane`} style={{ height: `${height}px`, "--timeline-content-width": `${contentWidth}px`, "--timeline-quarter-hour": `${15 * pxPerMinute}px`, "--timeline-hour": `${60 * pxPerMinute}px` } as React.CSSProperties}>
                {items.map((card) => {
                  const row = subrows.get(card.id) || 0;
                  const left = minutes(card.start) * pxPerMinute;
                  const width = Math.max(CARD_MIN_WIDTH, (card.end ? card.duration * pxPerMinute : CARD_MIN_WIDTH));
                  const isOrigin = activeOrigin?.card.id === card.id && activeOrigin.started && activeOrigin.mode === "move";
                  if (isOrigin) return <span key={card.id} aria-hidden="true" className={styles.origin} style={{ left, top: `${8 + row * 62}px`, width }} />;
                  const label = `Move ${card.destination}, ${name}, ${laneName(lane)}, ${card.start}${card.end ? ` to ${card.end} window end` : ""}, ${card.loadCount} loads`;
                  const startMinute = minutes(card.start);
                  const endMinute = card.end ? minutes(card.end) : undefined;
                  const resizable = Boolean(card.sourceRunId && card.end && endMinute !== undefined && endMinute - startMinute >= 15 && endMinute <= 1425 && startMinute < 1425 && directResizeEnabled(Boolean(card.end)));
                  return <div className={styles.cardSlot} key={card.id} style={{ left, top: `${8 + row * 62}px`, width }}>
                    <button type="button" className={`${styles.card} ${lane === "collection" ? styles.collection : ""} ${card.attention ? styles.attention : ""} ${card.pending ? styles.pending : ""}`} data-testid={card.queue ? `pending-queue-${card.id.slice("queue:".length)}` : `stop-${card.id}`} aria-label={label} aria-busy={card.pending} disabled={card.pending} onPointerDown={(event) => beginCard(event, card)} onClick={() => card.sourceRunId && onStop(card.sourceRunId, card.id)}>
                      <time>{card.start}{card.end ? `–${card.end}` : ""}</time><strong>{card.destination}</strong><small>{card.loadCount} {card.loadCount === 1 ? "load" : "loads"}{card.pending ? " · Saving…" : ""}</small>
                    </button>
                    {resizable && endMinute !== undefined && <button type="button" role="slider" className={styles.resizeHandle} data-testid={`resize-${card.id}`} aria-label={`Resize ${card.destination} window end`} aria-valuemin={startMinute + 15} aria-valuemax={1425} aria-valuenow={endMinute} aria-valuetext={`${card.start} start, ${card.end} end, ${endMinute - startMinute} minutes`} disabled={card.pending} style={{ left: `${(endMinute - startMinute) * pxPerMinute}px`, top: "50%" }} onPointerDown={(event) => beginResize(event, card, endMinute)} onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      const nextEnd = Math.max(startMinute + 15, Math.min(1425, endMinute + (event.key === "ArrowRight" ? 15 : -15)));
                      if (card.sourceRunId && nextEnd !== endMinute) onSchedule(card.sourceRunId, card.id, card.runId, card.start, formatTimelineMinute(nextEnd), card.lane, true);
                    }} />}
                  </div>;
                })}
                {previewCard?.runId === run.runId && previewCard.lane === lane && <div className={styles.ghost} data-testid="mounted-drag-ghost" aria-hidden="true" style={{ left: previewLeft, top: 8, width: Math.max(CARD_MIN_WIDTH, previewCard.duration * pxPerMinute) }}><time>{previewCard.start}{previewCard.end ? `–${previewCard.end}` : ""}</time><strong>{previewCard.destination}</strong><small>{previewCard.loadCount} {previewCard.loadCount === 1 ? "load" : "loads"}</small></div>}
                {highlighted && laneTarget && <><span className={styles.snapLine} style={{ left: previewLeft }} aria-hidden="true" /><span className={styles.timePill} style={{ left: previewLeft }} aria-hidden="true">{formatTimelineMinute(laneTarget.minute)}</span></>}
                {highlighted && resizeTarget && <><span className={styles.snapLine} data-testid="mounted-resize-marker" style={{ left: resizeTarget.endMinute * pxPerMinute }} aria-hidden="true" /><span className={styles.timePill} data-testid="mounted-resize-time" style={{ left: resizeTarget.endMinute * pxPerMinute }} aria-live="polite">{resizeTarget.start} → {formatTimelineMinute(resizeTarget.endMinute)} · {resizeTarget.endMinute - minutes(resizeTarget.start)} min</span></>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </div>
    {!schedulableRuns.length && <p className={styles.empty}>No dispatch runs. Create a run to begin planning.</p>}
  </div>;
}
