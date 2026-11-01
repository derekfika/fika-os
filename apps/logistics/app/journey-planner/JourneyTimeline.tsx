"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlusIcon } from "./icons";
import type { PlannerStatus, RunRowView, VehicleId } from "./model";
import { formatMinute, RunTimelineRow, RunTimeBar, type BarMode, type BarPreview } from "./RunTimelineRow";
import { RunStopSequence } from "./RunStopSequence";
import { vehicleTimelineRows } from "./vehicle-timeline";
import styles from "./timeline.module.css";

export const LABEL_WIDTH = 140;
/** Right gutter reserved for the row action buttons so bars never sit underneath them at the default zoom. */
export const ACTIONS_GUTTER = 100;
/** At zoom 1 the visible window is 05:30–18:00 (06:00–18:00 fully shown); other zooms scale around that. */
const WINDOW_START_HOUR = 5.5;
const WINDOW_HOURS = 12.5;
const MIN_PX_PER_HOUR = 30;
const SLOT = 15;
/** The canonical journey-time validator allows 15-minute marks up to 23:45. */
const LAST_MINUTE = 23 * 60 + 45;
/** Placing an untimed run by drag shows (and, on release, proposes) a window of this length; nothing is saved until the server confirms. */
const PLACE_MINUTES = 180;
const pad = (value: number) => String(value).padStart(2, "0");
const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };
const snap = (value: number) => Math.round(value / SLOT) * SLOT;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

type Drag = { runId: string; vehicleId: VehicleId; mode: BarMode; pointerId: number; startX: number; startScroll: number; start: number; end: number; started: boolean; x: number; y: number; startY: number };
type Preview = BarPreview & { runId: string };

/** Same-vehicle windows that overlap. A warning only; never blocks a save. */
function overlapSet(runs: RunRowView[], preview?: Preview) {
  const items = runs.flatMap((run) => {
    const live = preview?.runId === run.id ? { start: preview.start, end: preview.end } : run.departure && run.return ? { start: minutesOf(run.departure), end: minutesOf(run.return) } : undefined;
    return live ? [{ id: run.id, vehicleId: run.vehicleId, ...live }] : [];
  });
  const result = new Set<string>();
  for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
    if (items[i].vehicleId === items[j].vehicleId && items[i].start < items[j].end && items[j].start < items[i].end) { result.add(items[i].id); result.add(items[j].id); }
  }
  return result;
}

/**
 * Shared time ruler + one lane per van, with independent run bars. The label column is sticky; the ruler, bars and
 * "now" marker scroll together in a single horizontal scroll owner so they can never drift apart.
 * Run bars move/resize with the pointer (15-minute snap, edge auto-scroll); the caller receives only the
 * proposed times and decides when a change is saved.
 */
export function JourneyTimeline({ runs, vehicleIds, status = "ready", zoom = 1, selectedRunId, activeStopKey, collapsedRunIds, nowMinute, dropTargets, dropReasons, onToggleCollapsed, onSelectRun, onSelectStop, onNewRun, onSetTimes, onRetire, onRunTiming, onRetryLoad }: {
  runs: RunRowView[];
  vehicleIds?: readonly VehicleId[];
  status?: PlannerStatus;
  /** Multiplier on the fit-to-window scale (1 = 06:00–18:00 fills the viewport). */
  zoom?: number;
  selectedRunId?: string;
  activeStopKey?: string;
  collapsedRunIds: ReadonlySet<string>;
  nowMinute?: number;
  dropTargets?: Record<string, "valid" | "invalid">;
  dropReasons?: Record<string, string>;
  onToggleCollapsed: (runId: string) => void;
  onSelectRun: (runId: string) => void;
  onSelectStop?: (runId: string, stopKey: string) => void;
  onNewRun?: () => void;
  onSetTimes?: (runId: string) => void;
  onRetire?: (runId: string) => void;
  /** Proposed new planned CPU times. Never treated as saved by this component. */
  onRunTiming?: (runId: string, departure: string, returnTime: string) => void;
  onRetryLoad?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  /** The clock hour at the left edge of the visible window. Kept across resize/zoom so the view never jumps to another time of day. */
  const anchorHour = useRef(WINDOW_START_HOUR);
  const [scrollX, setScrollX] = useState(0);
  const [viewport, setViewport] = useState(0);
  useLayoutEffect(() => {
    const node = scroller.current; if (!node) return;
    const measure = () => setViewport(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const fit = viewport > 0 ? (viewport - LABEL_WIDTH - ACTIONS_GUTTER) / WINDOW_HOURS : 56;
  const pxPerHour = Math.max(MIN_PX_PER_HOUR, fit * zoom);
  const pxRef = useRef(pxPerHour); pxRef.current = pxPerHour;
  // Open on the working window; when the scale changes (inspector opens, zoom, resize) keep the same time at the left edge.
  useEffect(() => { if (viewport > 0 && scroller.current) { scroller.current.scrollLeft = anchorHour.current * pxPerHour; setScrollX(scroller.current.scrollLeft); } }, [viewport, pxPerHour]);

  // ----- run bar drag (move / resize / place) -----
  const dragRef = useRef<Drag | null>(null);
  const previewRef = useRef<Preview | undefined>(undefined);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<Preview>();
  const ppmRef = useRef(pxPerHour / 60); ppmRef.current = pxPerHour / 60;
  const timingRef = useRef(onRunTiming); timingRef.current = onRunTiming;

  const compute = (drag: Drag, clientX: number, clientY: number): Preview => {
    const node = scroller.current!;
    const ppm = ppmRef.current;
    if (drag.mode === "place") {
      const rect = node.getBoundingClientRect();
      const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-vehicle-row]");
      const start = clamp(snap((clientX - (rect.left + LABEL_WIDTH - node.scrollLeft)) / ppm), 0, LAST_MINUTE - SLOT);
      return { runId: drag.runId, start, end: Math.min(LAST_MINUTE, start + PLACE_MINUTES), valid: row?.dataset.vehicleRow === drag.vehicleId && clientX > rect.left + LABEL_WIDTH };
    }
    const delta = snap((clientX - drag.startX + (node.scrollLeft - drag.startScroll)) / ppm);
    if (drag.mode === "move") {
      const duration = drag.end - drag.start;
      const start = clamp(drag.start + delta, 0, LAST_MINUTE - duration);
      return { runId: drag.runId, start, end: start + duration, valid: true };
    }
    return { runId: drag.runId, start: drag.start, end: clamp(drag.end + delta, drag.start + SLOT, LAST_MINUTE), valid: true };
  };

  useEffect(() => {
    const update = (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.x = clientX; drag.y = clientY;
      const next = compute(drag, clientX, clientY);
      previewRef.current = next;
      setPreview(next);
    };
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started) { if (Math.abs(event.clientX - drag.startX) < 4 && Math.abs(event.clientY - drag.startY) < 4) return; drag.started = true; suppressClick.current = true; }
      update(event.clientX, event.clientY);
    };
    const finish = (event: PointerEvent, cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      const latest = previewRef.current;
      previewRef.current = undefined;
      setPreview(undefined);
      if (!drag.started) return;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (cancelled || !latest || !latest.valid) return;
      if (drag.mode !== "place" && latest.start === drag.start && latest.end === drag.end) return;
      timingRef.current?.(drag.runId, formatMinute(latest.start), formatMinute(latest.end));
    };
    const onUp = (event: PointerEvent) => finish(event, false);
    const onCancel = (event: PointerEvent) => finish(event, true);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && dragRef.current) { dragRef.current = null; previewRef.current = undefined; suppressClick.current = false; setPreview(undefined); } };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edge auto-scroll while a bar is being dragged, so a run can be carried beyond the visible window.
  const dragging = Boolean(preview);
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const drag = dragRef.current; const node = scroller.current;
      if (drag?.started && node) {
        const rect = node.getBoundingClientRect();
        const delta = drag.x < rect.left + LABEL_WIDTH + 36 ? -12 : drag.x > rect.right - ACTIONS_GUTTER + 24 ? 12 : 0;
        if (delta) {
          const before = node.scrollLeft; node.scrollLeft += delta;
          if (before !== node.scrollLeft) { const next = compute(drag, drag.x, drag.y); previewRef.current = next; setPreview(next); }
        }
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const beginDrag = (event: ReactPointerEvent, run: RunRowView, mode: BarMode) => {
    if (event.button !== 0 || !run.editable || run.pending) return;
    if (mode !== "place" && !(run.departure && run.return)) return;
    const start = run.departure ? minutesOf(run.departure) : 0;
    const end = run.return ? minutesOf(run.return) : start + PLACE_MINUTES;
    dragRef.current = { runId: run.id, vehicleId: run.vehicleId, mode, pointerId: event.pointerId, startX: event.clientX, startScroll: scroller.current?.scrollLeft ?? 0, start, end, started: false, x: event.clientX, y: event.clientY, startY: event.clientY };
  };
  const nudgeReturn = (run: RunRowView, delta: number) => {
    if (!run.departure || !run.return || !run.editable || run.pending) return;
    const end = clamp(minutesOf(run.return) + delta, minutesOf(run.departure) + SLOT, LAST_MINUTE);
    if (end !== minutesOf(run.return)) onRunTiming?.(run.id, run.departure, formatMinute(end));
  };
  const overlaps = useMemo(() => overlapSet(runs, preview), [runs, preview]);
  const vehicleRows = vehicleTimelineRows(runs.map(run => preview?.runId === run.id ? { ...run, departure: formatMinute(preview.start), return: formatMinute(preview.end) } : run), vehicleIds);
  const selectedRun = runs.find(run => run.id === selectedRunId);

  const labelEvery = pxPerHour >= 90 ? 1 : 2;
  const hours = Array.from({ length: 25 }, (_, hour) => hour);
  const cssVars = { "--ph": `${pxPerHour}px`, "--label-w": `${LABEL_WIDTH}px`, "--gutter-w": `${ACTIONS_GUTTER}px` } as React.CSSProperties;
  const showNow = nowMinute !== undefined;
  return <section className={styles.timeline} aria-label="Vehicle journey timeline" style={cssVars}>
    <div className={styles.scroller} ref={scroller} data-testid="journey-timeline-scroller" onScroll={(event) => { const left = event.currentTarget.scrollLeft; setScrollX(left); anchorHour.current = left / pxRef.current; }}>
      <div className={styles.canvas}>
        <div className={styles.rulerRow}>
          <div className={styles.rulerCorner} />
          <div className={styles.ruler} aria-hidden="true">
            {hours.map((hour) => <div key={hour}><span className={styles.tick} style={{ left: hour * pxPerHour }} />{hour % labelEvery === 0 && hour < 24 && hour * pxPerHour - scrollX > 22 && !(showNow && Math.abs(hour * 60 - nowMinute!) < 36 * 60 / pxPerHour) && <span className={styles.tickLabel} style={{ left: hour * pxPerHour }}>{pad(hour)}:00</span>}</div>)}
            {showNow && <span className={styles.nowPill} style={{ left: (nowMinute! / 60) * pxPerHour }}>{pad(Math.floor(nowMinute! / 60))}:{pad(nowMinute! % 60)}</span>}
          </div>
        </div>
        {status === "loading" && <div aria-busy="true" aria-label="Loading runs">{[0, 1, 2].map((index) => <div key={index} className={styles.skeletonRow} />)}</div>}
        {status === "error" && <div className={styles.empty} role="alert" style={{ position: "sticky", left: 0, width: "calc(100cqw - 2px)" }}><strong>Runs could not be loaded</strong><span>Your planning is safe. Nothing was changed.</span>{onRetryLoad && <button type="button" className={styles.draftSlot} style={{ position: "static", margin: 0 }} onClick={onRetryLoad}>Try again</button>}</div>}
        {status === "ready" && runs.length === 0 && <div className={styles.empty} style={{ position: "sticky", left: 0, width: "calc(100cqw - 2px)" }}><strong>No runs for this day yet</strong><span>Create a run, then drag work onto it from the queue.</span></div>}
        {status === "ready" && <div className={styles.rows}>
          {showNow && <span className={styles.nowLine} style={{ left: LABEL_WIDTH + (nowMinute! / 60) * pxPerHour }} aria-hidden="true" />}
          {vehicleRows.map(vehicle => <article key={vehicle.vehicleId} className={styles.row} data-run-row data-vehicle-row={vehicle.vehicleId} data-vehicle={vehicle.vehicleId} data-drop-run-id={selectedRun?.vehicleId === vehicle.vehicleId ? selectedRun.id : undefined} aria-label={`${vehicle.vehicleLabel} timeline`}>
            <div className={styles.frame} aria-hidden="true" />
            <div className={styles.label}>
              <h3 className={styles.title}>{vehicle.vehicleLabel}</h3>
              <span className={styles.counts}>{vehicle.runs.length} {vehicle.runs.length === 1 ? "run" : "runs"}</span>
              {vehicle.runs.some(run => overlaps.has(run.id)) && <span className={styles.warn}>Overlapping runs</span>}
              <label className={styles.runSelector}>Run on {vehicle.vehicleLabel}
                <select aria-label={`Run on ${vehicle.vehicleLabel}`} value={selectedRun?.vehicleId === vehicle.vehicleId ? selectedRun.id : ""} onChange={event => { if (event.target.value) onSelectRun(event.target.value); }}>
                  <option value="">Select a run</option>
                  {vehicle.runs.map(run => <option key={run.id} value={run.id}>{run.title} · {run.departure && run.return ? `${run.departure}–${run.return}` : "Times to set"}</option>)}
                </select>
              </label>
            </div>
            <div className={`${styles.track} ${styles.laneTrack}`} data-vehicle-track={vehicle.vehicleId}>
              {Array.from({ length: vehicle.runs.some(run => run.departure && run.return) ? vehicle.trackCount : 0 }, (_, track) => {
                const members = vehicle.runs.filter(run => run.departure && run.return && (vehicle.tracks.get(run.id) || 0) === track);
                return <div key={track} className={styles.trackBand} data-track-band={track}>
                  <div className={styles.barLane}>
                    {members.map(run => <RunTimeBar key={run.id} run={overlaps.has(run.id) ? { ...run, overlapWarning: "Overlaps another run on this vehicle" } : run} pxPerHour={pxPerHour} preview={preview?.runId === run.id ? preview : undefined} top={4} drop={dropTargets?.[run.id]} onSelect={() => { if (!suppressClick.current) onSelectRun(run.id); }} onPointerDown={(event, mode) => beginDrag(event, run, mode)} onResizeKey={delta => nudgeReturn(run, delta)} />)}
                  </div>
                  {/* Each run's visiting sequence sits directly beneath its own bar, in the same van row. */}
                  {[...members].sort((a, b) => minutesOf(a.departure!) - minutesOf(b.departure!)).filter(run => !collapsedRunIds.has(run.id)).map(run => <RunStopSequence key={run.id} runId={run.id} runTitle={run.title} chips={run.chips} selected={run.id === selectedRunId} onSelectStop={onSelectStop ? stopKey => onSelectStop(run.id, stopKey) : undefined} activeKey={activeStopKey} offset={(preview?.runId === run.id ? preview.start : minutesOf(run.departure!)) / 60 * pxPerHour} />)}
                </div>;
              })}
              {vehicle.runs.some(run => !run.departure || !run.return) && <div className={styles.unscheduledRuns}>
                {vehicle.runs.filter(run => !run.departure || !run.return).map(run => <div key={run.id} className={styles.unscheduledRun}>
                  <button type="button" data-drop-run-id={run.id} onClick={() => onSelectRun(run.id)}>{run.title} · Times to set</button>
                  {!collapsedRunIds.has(run.id) && <RunStopSequence runId={run.id} runTitle={run.title} chips={run.chips} selected={run.id === selectedRunId} onSelectStop={onSelectStop ? stopKey => onSelectStop(run.id, stopKey) : undefined} activeKey={activeStopKey} />}
                </div>)}
              </div>}
              {vehicle.runs.length === 0 && <p className={styles.laneEmpty}>No runs assigned</p>}
            </div>
          </article>)}
          {selectedRun && <div className={styles.selectedDetails} aria-label="Selected run details"><h2 className={styles.selectedDetailsTitle}>Selected run</h2><RunTimelineRow
            key={selectedRun.id}
            detailsOnly
            run={selectedRun}
            pxPerHour={pxPerHour}
            selected
            collapsed={collapsedRunIds.has(selectedRun.id)}
            drop={dropTargets?.[selectedRun.id]}
            dropReason={dropReasons?.[selectedRun.id]}
            preview={preview?.runId === selectedRun.id ? preview : undefined}
            overlapping={overlaps.has(selectedRun.id)}
            activeStopKey={activeStopKey}
            onToggleCollapsed={() => onToggleCollapsed(selectedRun.id)}
            onSelect={() => { if (!suppressClick.current) onSelectRun(selectedRun.id); }}
            onSelectStop={onSelectStop ? stopKey => onSelectStop(selectedRun.id, stopKey) : undefined}
            onSetTimes={onSetTimes ? () => onSetTimes(selectedRun.id) : undefined}
            onRetire={onRetire ? () => onRetire(selectedRun.id) : undefined}
            onBarPointerDown={(event, mode) => beginDrag(event, selectedRun, mode)}
            onResizeKey={delta => nudgeReturn(selectedRun, delta)}
          /></div>}
        </div>}
        {status === "ready" && <button type="button" className={styles.create} onClick={onNewRun}><strong><span className={styles.createCircle}><PlusIcon size={16} /></span>Create another Run</strong><span>Click to add a new run or use the button above</span></button>}
      </div>
    </div>
  </section>;
}
