"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./timeline-poc.module.css";
import {
  adjustedPocPlacement,
  clampPocMinute,
  formatPocTime,
  pocLeftPx,
  pocVisualSubrows,
  snapPocMinute,
  POC_CARD_WIDTH,
  POC_DAY_END,
  POC_DAY_START,
  POC_SLOT_MINUTES,
  POC_SLOT_WIDTH,
  type PocLane,
  type PocPlacement,
  type PocVehicle,
} from "../../../lib/timeline-poc";

type QueueItem = { id: string; destination: string; lane: PocLane; durationMinutes: number; loadCount: number; kind: "delivery" | "collection" };
type SimMode = "immediate" | "delayed" | "reject" | "adjust";
type LaneRow = { vehicle: PocVehicle; lane: PocLane; label: string };
type Origin = { type: "queue"; item: QueueItem } | { type: "scheduled"; item: PocPlacement };
type DragState = {
  pointerId: number;
  origin: Origin;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  grabOffsetPx: number;
  element: HTMLElement;
  started: boolean;
  target?: { vehicle: PocVehicle; lane: PocLane; minute: number };
};

const ROWS: LaneRow[] = [
  { vehicle: "van-1", lane: "delivery", label: "Van 1 · Delivery" },
  { vehicle: "van-1", lane: "collection", label: "Van 1 · Collection" },
  { vehicle: "van-2", lane: "delivery", label: "Van 2 · Delivery" },
  { vehicle: "van-2", lane: "collection", label: "Van 2 · Collection" },
];
const HOURS = Array.from({ length: (POC_DAY_END - POC_DAY_START) / 60 + 1 }, (_, index) => POC_DAY_START + index * 60);
const FIXTURE_QUEUE: QueueItem[] = [
  { id: "queue-bridgepoint", destination: "Bridgepoint", lane: "delivery", durationMinutes: 15, loadCount: 2, kind: "delivery" },
  { id: "queue-haleon", destination: "Haleon", lane: "delivery", durationMinutes: 15, loadCount: 1, kind: "delivery" },
  { id: "queue-angel-court", destination: "One Angel Court", lane: "delivery", durationMinutes: 15, loadCount: 1, kind: "delivery" },
  { id: "queue-mnk-collection", destination: "MNK returns", lane: "collection", durationMinutes: 15, loadCount: 1, kind: "collection" },
];
const FIXTURE_PLACEMENTS: PocPlacement[] = [
  { id: "stop-mnk", destination: "MNK", vehicle: "van-1", lane: "delivery", startMinute: 7 * 60 + 30, durationMinutes: 15, loadCount: 1, kind: "delivery", state: "confirmed" },
  { id: "stop-bridgepoint", destination: "Bridgepoint", vehicle: "van-1", lane: "delivery", startMinute: 8 * 60, durationMinutes: 15, loadCount: 2, kind: "delivery", state: "confirmed" },
  { id: "stop-haleon", destination: "Haleon", vehicle: "van-1", lane: "delivery", startMinute: 8 * 60 + 15, durationMinutes: 15, loadCount: 1, kind: "delivery", state: "confirmed" },
  { id: "stop-riverside", destination: "Riverside", vehicle: "van-1", lane: "collection", startMinute: 10 * 60, durationMinutes: 60, loadCount: 2, kind: "collection", explicitWindow: true, state: "confirmed" },
  { id: "stop-commerce", destination: "Commerzbank", vehicle: "van-2", lane: "delivery", startMinute: 7 * 60, durationMinutes: 15, loadCount: 1, kind: "delivery", state: "confirmed" },
  { id: "stop-exchange", destination: "FIKA Xchange", vehicle: "van-2", lane: "delivery", startMinute: 9 * 60, durationMinutes: 15, loadCount: 2, kind: "delivery", state: "confirmed" },
  { id: "stop-kitchen", destination: "Kitchen collection", vehicle: "van-2", lane: "collection", startMinute: 10 * 60 + 15, durationMinutes: 15, loadCount: 1, kind: "collection", state: "confirmed" },
];
const minuteChoices = Array.from({ length: (POC_DAY_END - POC_DAY_START) / POC_SLOT_MINUTES + 1 }, (_, index) => POC_DAY_START + index * POC_SLOT_MINUTES);
const laneKey = (vehicle: PocVehicle, lane: PocLane) => `${vehicle}:${lane}`;
const vehicleName = (vehicle: PocVehicle) => vehicle === "van-1" ? "Van 1" : "Van 2";
const laneName = (lane: PocLane) => lane === "delivery" ? "Delivery" : "Collection";
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function TimelineInteractionPoc() {
  const [queue, setQueue] = useState(FIXTURE_QUEUE);
  const [placements, setPlacements] = useState(FIXTURE_PLACEMENTS);
  const [simulation, setSimulation] = useState<SimMode>("delayed");
  const [dragPreview, setDragPreview] = useState<DragState | null>(null);
  const [notice, setNotice] = useState("Fixture loaded. Drag a full card, or use the keyboard placement form.");
  const [commandCount, setCommandCount] = useState(0);
  const [selectedId, setSelectedId] = useState(FIXTURE_QUEUE[0].id);
  const [formVehicle, setFormVehicle] = useState<PocVehicle>("van-1");
  const [formLane, setFormLane] = useState<PocLane>("delivery");
  const [formStart, setFormStart] = useState(8 * 60 + 15);
  const [formEnd, setFormEnd] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const activeRef = useRef<DragState | null>(null);
  const nextId = useRef(1);

  const allSources = useMemo<Origin[]>(() => [
    ...queue.map((item) => ({ type: "queue" as const, item })),
    ...placements.map((item) => ({ type: "scheduled" as const, item })),
  ], [queue, placements]);

  const resolveTarget = useCallback((clientX: number, clientY: number, drag: DragState) => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const rect = viewport.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) return undefined;
    const row = ROWS.find(({ vehicle, lane }) => {
      const rowRect = rowRefs.current.get(laneKey(vehicle, lane))?.getBoundingClientRect();
      return rowRect && clientY >= rowRect.top && clientY <= rowRect.bottom;
    });
    if (!row) return undefined;
    const minute = clampPocMinute(snapPocMinute(clientX, rect.left, viewport.scrollLeft, drag.grabOffsetPx), drag.origin.type === "queue" ? drag.origin.item.durationMinutes : drag.origin.item.durationMinutes);
    return { vehicle: row.vehicle, lane: row.lane, minute };
  }, []);

  const updateDragPreview = useCallback((clientX: number, clientY: number) => {
    const drag = activeRef.current;
    if (!drag) return;
    drag.clientX = clientX;
    drag.clientY = clientY;
    if (!drag.started && Math.hypot(clientX - drag.startX, clientY - drag.startY) < 6) return;
    drag.started = true;
    drag.target = resolveTarget(clientX, clientY, drag);
    setDragPreview((previous) => previous?.clientX === clientX && previous.clientY === clientY && previous.target?.minute === drag.target?.minute && previous.target?.lane === drag.target?.lane && previous.target?.vehicle === drag.target?.vehicle ? previous : { ...drag });
  }, [resolveTarget]);

  const requestPlacement = useCallback(async (origin: Origin, target: { vehicle: PocVehicle; lane: PocLane; minute: number; durationMinutes?: number }) => {
    if (origin.type === "scheduled" && origin.item.state === "pending") return;
    const duration = target.durationMinutes ?? origin.item.durationMinutes;
    const requestedMinute = clampPocMinute(target.minute, duration);
    const pending: PocPlacement = origin.type === "scheduled"
      ? { ...origin.item, vehicle: target.vehicle, lane: target.lane, startMinute: requestedMinute, durationMinutes: duration, state: "pending" }
      : { id: `fixture-${nextId.current++}`, destination: origin.item.destination, vehicle: target.vehicle, lane: target.lane, startMinute: requestedMinute, durationMinutes: duration, loadCount: origin.item.loadCount, kind: origin.item.kind, explicitWindow: duration > POC_SLOT_MINUTES, state: "pending" };
    const original = origin.type === "scheduled" ? origin.item : undefined;
    if (origin.type === "queue") setQueue((items) => items.filter((item) => item.id !== origin.item.id));
    setPlacements((items) => origin.type === "scheduled" ? items.map((item) => item.id === pending.id ? pending : item) : [...items, pending]);
    setCommandCount((count) => count + 1);
    setNotice(`Saving fixture placement · ${vehicleName(pending.vehicle)} · ${laneName(pending.lane)} · ${formatPocTime(pending.startMinute)}. No live API is called.`);
    if (simulation === "delayed") await wait(2000);
    if (simulation === "reject") await wait(650);
    if (simulation === "reject") {
      if (original) setPlacements((items) => items.map((item) => item.id === pending.id ? original : item));
      else {
        setPlacements((items) => items.filter((item) => item.id !== pending.id));
        setQueue((items) => [...items, origin.item]);
        setSelectedId(origin.item.id);
      }
      setNotice(`Fixture rejected the move for ${pending.destination}; the confirmed card was restored. Retry from the card or form.`);
      return;
    }
    const confirmed = simulation === "adjust" ? adjustedPocPlacement(pending, requestedMinute) : { ...pending, state: "confirmed" as const };
    setPlacements((items) => items.map((item) => item.id === pending.id ? confirmed : item));
    setNotice(simulation === "adjust"
      ? `Fixture server adjusted ${pending.destination}: requested ${formatPocTime(requestedMinute)}, confirmed ${formatPocTime(confirmed.startMinute)}.`
      : `Fixture placement confirmed · ${vehicleName(confirmed.vehicle)} · ${laneName(confirmed.lane)} · ${formatPocTime(confirmed.startMinute)}.`);
  }, [simulation]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, origin: Origin) => {
    if (origin.type === "scheduled" && origin.item.state === "pending") return;
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const initial: DragState = {
      pointerId: event.pointerId,
      origin,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      grabOffsetPx: origin.type === "queue" ? 0 : Math.max(0, Math.min(POC_CARD_WIDTH, event.clientX - rect.left)),
      element: event.currentTarget,
      started: false,
    };
    activeRef.current = initial;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* window listeners remain the fallback */ }
    setSelectedId(origin.type === "queue" ? origin.item.id : origin.item.id);
  };

  const cancelDrag = useCallback((message: string) => {
    const active = activeRef.current;
    if (!active) return;
    try { if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId); } catch { /* pointer may already be cancelled */ }
    activeRef.current = null;
    setDragPreview(null);
    setNotice(message);
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (activeRef.current?.pointerId !== event.pointerId) return;
      if (activeRef.current.started) event.preventDefault();
      updateDragPreview(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      updateDragPreview(event.clientX, event.clientY);
      const latest = activeRef.current;
      if (!latest?.started) { activeRef.current = null; setDragPreview(null); return; }
      const target = resolveTarget(event.clientX, event.clientY, latest);
      activeRef.current = null;
      setDragPreview(null);
      if (!target) { setNotice("No timeline lane selected; drag cancelled with no fixture command."); return; }
      void requestPlacement(latest.origin, target);
    };
    const onCancel = (event: PointerEvent) => {
      if (activeRef.current?.pointerId === event.pointerId) cancelDrag("Pointer cancelled · original fixture state kept; no command sent.");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeRef.current) { event.preventDefault(); cancelDrag("Escape cancelled the drag · original fixture state kept; no command sent."); }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [cancelDrag, requestPlacement, resolveTarget, updateDragPreview]);

  useEffect(() => {
    if (!dragPreview?.started) return;
    let frame = 0;
    const tick = () => {
      const drag = activeRef.current;
      const viewport = viewportRef.current;
      if (drag?.started && viewport) {
        const rect = viewport.getBoundingClientRect();
        const edge = 52;
        const direction = drag.clientX < rect.left + edge ? -1 : drag.clientX > rect.right - edge ? 1 : 0;
        if (direction) {
          const previous = viewport.scrollLeft;
          viewport.scrollLeft += direction * 11;
          if (viewport.scrollLeft !== previous) updateDragPreview(drag.clientX, drag.clientY);
        }
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [Boolean(dragPreview?.started), updateDragPreview]);

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const origin = allSources.find((candidate) => candidate.item.id === selectedId);
    if (!origin) { setNotice("Choose a fixture work item before placing it."); return; }
    const chosenDuration = formEnd ? Math.max(POC_SLOT_MINUTES, Number(formEnd) - formStart) : origin.item.durationMinutes;
    void requestPlacement(origin, { vehicle: formVehicle, lane: formLane, minute: formStart, durationMinutes: chosenDuration });
  };

  const rowsWithPlacements = useMemo(() => ROWS.map((row) => {
    const items = placements.filter((item) => item.vehicle === row.vehicle && item.lane === row.lane);
    return { ...row, items, subrows: pocVisualSubrows(items) };
  }), [placements]);
  const previewSource = dragPreview?.started ? dragPreview.origin : undefined;
  const previewItem: PocPlacement | undefined = previewSource
    ? previewSource.type === "scheduled"
      ? previewSource.item
      : { id: previewSource.item.id, destination: previewSource.item.destination, vehicle: dragPreview?.target?.vehicle || "van-1", lane: dragPreview?.target?.lane || previewSource.item.lane, startMinute: dragPreview?.target?.minute || POC_DAY_START, durationMinutes: previewSource.item.durationMinutes, loadCount: previewSource.item.loadCount, kind: previewSource.item.kind, state: "pending" }
    : undefined;
  const target = dragPreview?.target;
  const previewLeft = target ? pocLeftPx(target.minute) : 0;
  const previewTime = target?.minute ?? POC_DAY_START;
  const sourceId = previewSource?.item.id;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>LOGISTICS · PHASE 2 INTERACTION LAB</p><h1>Timeline interaction proof</h1><p className={styles.subtitle}>Fixture-only scheduler · no Logistics API or staging data</p></div>
        <div className={styles.fixtureBadge} role="status"><span aria-hidden="true" />No live mutations</div>
      </header>

      <section className={styles.safetyNote} aria-label="Fixture safety notice"><strong>Isolated fixture</strong><span>Every placement is simulated in this page’s local state. Reload to reset the sample day.</span><span className={styles.commandCount}>Fixture commands: {commandCount}</span></section>

      <div className={styles.controlsRow}>
        <label className={styles.simControl}>Command simulator
          <select value={simulation} onChange={(event) => setSimulation(event.target.value as SimMode)}>
            <option value="immediate">Immediate success</option><option value="delayed">2-second success</option><option value="reject">Reject and rollback</option><option value="adjust">Adjust by 15 minutes</option>
          </select>
        </label>
        <p className={styles.simHint}>Selected mode applies to the next placement command.</p>
      </div>

      <section className={styles.workspace} aria-label="Logistics fixture planner">
        <aside className={styles.queuePanel} aria-labelledby="queue-heading">
          <div className={styles.panelHeading}><div><p className={styles.kicker}>UNASSIGNED</p><h2 id="queue-heading">Planning queue <span>({queue.length})</span></h2></div></div>
          <p className={styles.panelHelp}>Drag any part of a card onto a vehicle lane and quarter-hour.</p>
          <div className={styles.queueList}>
            {queue.length ? queue.map((item) => <button
              key={item.id} type="button" className={styles.queueCard} data-testid={`queue-${item.id}`} draggable={false}
              aria-label={`Drag ${item.destination}, ${item.loadCount} loads, into the timeline`}
              onPointerDown={(event) => beginDrag(event, { type: "queue", item })}
              onClick={() => setSelectedId(item.id)}
            ><span className={styles.cardKind}>{laneName(item.lane)} · unassigned</span><strong>{item.destination}</strong><span>{item.loadCount} {item.loadCount === 1 ? "load" : "loads"} · {item.durationMinutes} min</span></button>)
              : <p className={styles.emptyQueue}>All fixture queue cards have a placement.</p>}
          </div>
        </aside>

        <section className={styles.timelinePanel} aria-labelledby="timeline-heading">
          <div className={styles.timelineHeading}><div><p className={styles.kicker}>WEDNESDAY · FIXTURE DAY</p><h2 id="timeline-heading">Dispatch timeline</h2></div><p>2 vehicles · 2 lanes each · 15-minute anchors</p></div>
          <div className={styles.timelineBoard}>
            <div className={styles.rowLabelSpacer} aria-hidden="true" />
            <div className={styles.rowLabels}>
              {rowsWithPlacements.map((row) => {
                const activeTarget = target?.vehicle === row.vehicle && target.lane === row.lane;
                return <div className={`${styles.rowLabel} ${activeTarget ? styles.rowLabelActive : ""}`} key={laneKey(row.vehicle, row.lane)}><strong>{vehicleName(row.vehicle)}</strong><span>{laneName(row.lane)} lane</span></div>;
              })}
            </div>
            <div className={styles.axisViewport} ref={viewportRef} data-testid="timeline-viewport" aria-label="Scrollable timeline from 06:00 to 14:00">
              <div className={styles.timelineContent} style={{ width: `${((POC_DAY_END - POC_DAY_START) / POC_SLOT_MINUTES) * POC_SLOT_WIDTH}px` }}>
                <div className={styles.axis}>
                  {HOURS.map((hour, index) => <span key={hour} style={{ left: `${((hour - POC_DAY_START) / POC_SLOT_MINUTES) * POC_SLOT_WIDTH}px`, transform: index === 0 ? "none" : index === HOURS.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{formatPocTime(hour)}</span>)}
                </div>
                <div className={styles.gridLines} aria-hidden="true" />
                {rowsWithPlacements.map((row) => {
                  const rowActive = target?.vehicle === row.vehicle && target.lane === row.lane;
                  return <div
                    key={laneKey(row.vehicle, row.lane)}
                    className={`${styles.laneTrack} ${rowActive ? styles.laneActive : ""}`}
                    ref={(element) => { if (element) rowRefs.current.set(laneKey(row.vehicle, row.lane), element); else rowRefs.current.delete(laneKey(row.vehicle, row.lane)); }}
                    data-lane={laneKey(row.vehicle, row.lane)}
                    aria-label={`${vehicleName(row.vehicle)} ${laneName(row.lane)} lane`}
                  >
                    {row.items.map((item) => {
                      const top = 14 + (row.subrows.get(item.id) || 0) * 38;
                      const isOrigin = dragPreview?.started && previewSource?.type === "scheduled" && sourceId === item.id;
                      if (isOrigin) return <span key={item.id} aria-hidden="true" className={styles.originMarker} style={{ left: pocLeftPx(item.startMinute), top, width: POC_CARD_WIDTH }} />;
                      return <button key={item.id} type="button" className={`${styles.stopCard} ${item.state === "pending" ? styles.pendingCard : ""} ${item.explicitWindow ? styles.windowCard : ""}`} data-testid={`stop-${item.id}`} style={{ left: pocLeftPx(item.startMinute), top, width: POC_CARD_WIDTH }} disabled={item.state === "pending"} draggable={false} aria-label={`Move ${item.destination}, ${vehicleName(item.vehicle)}, ${laneName(item.lane)}, ${formatPocTime(item.startMinute)}${item.explicitWindow ? ` to ${formatPocTime(item.startMinute + item.durationMinutes)} window end` : ""}, ${item.loadCount} loads`} onPointerDown={(event) => beginDrag(event, { type: "scheduled", item })} onClick={() => setSelectedId(item.id)}>
                        <span className={styles.cardTime}>{formatPocTime(item.startMinute)}{item.explicitWindow ? `–${formatPocTime(item.startMinute + item.durationMinutes)}` : ""}</span><strong>{item.destination}</strong><span className={styles.cardMeta}>{item.loadCount} {item.loadCount === 1 ? "load" : "loads"}{item.state === "pending" ? " · Saving fixture" : ""}</span>
                      </button>;
                    })}
                    {previewItem && target?.vehicle === row.vehicle && target.lane === row.lane && <div className={styles.ghostCard} data-testid="drag-ghost" style={{ left: previewLeft, top: 14, width: POC_CARD_WIDTH }} aria-hidden="true"><span className={styles.cardTime}>{formatPocTime(previewTime)}</span><strong>{previewItem.destination}</strong><span className={styles.cardMeta}>{previewItem.loadCount} {previewItem.loadCount === 1 ? "load" : "loads"}</span></div>}
                  </div>;
                })}
                {dragPreview?.started && target && <><div className={styles.snapLine} style={{ left: previewLeft }} aria-hidden="true" /><div className={styles.timePill} style={{ left: previewLeft }} aria-hidden="true">{formatPocTime(previewTime)}</div></>}
              </div>
            </div>
          </div>
          <div className={styles.timelineFootnote}><span>Cards stay anchored to exact quarter-hour time; colliding display cards stack into visual subrows.</span><span>Horizontal edge drag scrolls the timeline.</span></div>
        </section>
      </section>

      <section className={styles.accessPanel} aria-labelledby="keyboard-heading">
        <div className={styles.accessHeading}><div><p className={styles.kicker}>ACCESSIBLE PLACEMENT</p><h2 id="keyboard-heading">Place without dragging</h2></div><p>Keyboard users can select the work item and target, then submit the same fixture command.</p></div>
        <form className={styles.placementForm} onSubmit={submitForm}>
          <label>Work item<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} required>{allSources.map((source) => <option key={source.item.id} value={source.item.id}>{source.type === "queue" ? "Queue · " : "Scheduled · "}{source.item.destination}</option>)}</select></label>
          <label>Vehicle<select value={formVehicle} onChange={(event) => setFormVehicle(event.target.value as PocVehicle)}><option value="van-1">Van 1</option><option value="van-2">Van 2</option></select></label>
          <label>Lane<select value={formLane} onChange={(event) => setFormLane(event.target.value as PocLane)}><option value="delivery">Delivery</option><option value="collection">Collection</option></select></label>
          <label>Time<select value={formStart} onChange={(event) => setFormStart(Number(event.target.value))}>{minuteChoices.map((minute) => <option key={minute} value={minute}>{formatPocTime(minute)}</option>)}</select></label>
          <label>Window end <span className={styles.optional}>(optional)</span><select value={formEnd} onChange={(event) => setFormEnd(event.target.value)}><option value="">Keep item duration</option>{minuteChoices.filter((minute) => minute > formStart).map((minute) => <option key={minute} value={minute}>{formatPocTime(minute)}</option>)}</select></label>
          <button className={styles.primaryButton} type="submit" disabled={!allSources.length || Boolean(allSources.find((source) => source.item.id === selectedId && source.type === "scheduled" && source.item.state === "pending"))}>Place fixture item</button>
        </form>
      </section>

      <p className={styles.liveStatus} data-testid="fixture-notice" role="status" aria-live="polite">{notice}</p>
      {dragPreview?.started && !target && previewItem && <div className={styles.pointerGhost} style={{ left: dragPreview.clientX + 16, top: dragPreview.clientY + 16 }} aria-hidden="true"><span className={styles.cardTime}>Choose a timeline row</span><strong>{previewItem.destination}</strong><span className={styles.cardMeta}>{previewItem.loadCount} {previewItem.loadCount === 1 ? "load" : "loads"}</span></div>}
      <p className={styles.keyboardHint}>Drag interaction: press Escape to cancel. Pointer cancellation also leaves the fixture unchanged. No DayPilot internals, HTML5 DataTransfer, or network commands are used here.</p>
    </main>
  );
}
