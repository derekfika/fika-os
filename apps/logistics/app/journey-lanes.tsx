"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { PlannerDay } from "../lib/planner-read-model";
import { formatTimelineMinute, timelineVisualSubrows } from "../lib/react-timeline-model";
import { overlappingRunIds } from "../lib/run-journey";
import styles from "./mounted-react-timeline.module.css";

type Run = PlannerDay["runs"][number];
export type PendingRunTiming = { start: string; end: string };
export type CreatingRun = { id: string; vehicleId: string; start?: string; end?: string };
export type RunDropHint = { runId: string; valid: boolean; reason?: string };

const VEHICLES = [{ id: "van1", label: "Van 1" }, { id: "van2", label: "Van 2" }] as const;
const SLOT = 15;
const DEFAULT_RUN_MINUTES = 180;
/** Latest minute a Run may start/return: the canonical journey-time validator allows 15-minute marks up to 23:45. */
const LAST_MINUTE = 23 * 60 + 45;
const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
const snap = (value: number) => Math.round(value / SLOT) * SLOT;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const planningOpen = (run: Run) => run.status === "draft" || run.status === "planned";

const runLabel = (run: Run, vehicleRuns: Run[]) => {
  const ordered = [...vehicleRuns].sort((left, right) => (left.plannedCpuDepartureTime || "99:99").localeCompare(right.plannedCpuDepartureTime || "99:99"));
  return `Run ${ordered.findIndex((item) => item.runId === run.runId) + 1}`;
};
const runStatusText = (run: Run) => run.operationalStatus === "attention" ? "Attention" : run.operationalStatus === "complete" || run.operationalStatus === "returned" ? "Completed" : run.operationalStatus === "dispatched" || run.operationalStatus === "in_progress" ? "Dispatched" : run.status === "ready" ? "Ready" : run.status === "planned" ? "Planned" : "Draft";

type Drag = { runId: string; vehicleId: string; mode: "move" | "resize" | "place"; pointerId: number; startX: number; startY: number; start: number; end: number; started: boolean };
type Preview = { runId: string; start: number; end: number; valid: boolean; invalidReason?: string };

export function JourneyLanes({ runs, pxPerMinute, contentWidth, selectedRunId, pendingRuns, creatingRuns, dropHint, onRun, onRunTiming, onCreateRun }: {
  runs: Run[];
  pxPerMinute: number;
  contentWidth: number;
  selectedRunId?: string;
  pendingRuns: Record<string, PendingRunTiming>;
  creatingRuns: CreatingRun[];
  dropHint?: RunDropHint;
  onRun: (runId: string) => void;
  /** Proposes new planned CPU times. The caller must only treat them as saved once the server confirms. */
  onRunTiming: (runId: string, departure: string, returnTime: string) => void;
  onCreateRun: (vehicleId: string, departure?: string, returnTime?: string) => void;
}) {
  const dragRef = useRef<Drag | null>(null);
  const previewRef = useRef<Preview | undefined>(undefined);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<Preview>();
  const [hover, setHover] = useState<{ vehicleId: string; minute: number }>();
  const pxRef = useRef(pxPerMinute);
  pxRef.current = pxPerMinute;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const timingRef = useRef(onRunTiming);
  timingRef.current = onRunTiming;

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      drag.started = true;
      suppressClick.current = true;
      const px = pxRef.current;
      let next: Preview;
      if (drag.mode === "place") {
        const track = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-vehicle-track]");
        const valid = Boolean(track) && track!.dataset.vehicleTrack === drag.vehicleId;
        const start = track ? clamp(snap((event.clientX - track.getBoundingClientRect().left) / px), 0, LAST_MINUTE - SLOT) : drag.start;
        next = { runId: drag.runId, start, end: Math.min(LAST_MINUTE, start + DEFAULT_RUN_MINUTES), valid, ...(track && !valid ? { invalidReason: "A run stays on its own vehicle" } : {}) };
      } else {
        const delta = snap((event.clientX - drag.startX) / px);
        if (drag.mode === "move") {
          const duration = drag.end - drag.start;
          const start = clamp(drag.start + delta, 0, LAST_MINUTE - duration);
          next = { runId: drag.runId, start, end: start + duration, valid: true };
        } else {
          next = { runId: drag.runId, start: drag.start, end: clamp(drag.end + delta, drag.start + SLOT, LAST_MINUTE), valid: true };
        }
      }
      previewRef.current = next;
      setPreview(next);
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
      timingRef.current(drag.runId, formatTimelineMinute(latest.start), formatTimelineMinute(latest.end));
    };
    const onUp = (event: PointerEvent) => finish(event, false);
    const onCancel = (event: PointerEvent) => finish(event, true);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && dragRef.current) { dragRef.current = null; previewRef.current = undefined; suppressClick.current = false; setPreview(undefined); } };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); window.removeEventListener("keydown", onKey); };
  }, []);

  const begin = (event: ReactPointerEvent, run: Run, mode: Drag["mode"]) => {
    if (mode === "resize") event.stopPropagation();
    if (event.button !== 0 || !planningOpen(run) || pendingRuns[run.runId]) return;
    const start = run.plannedCpuDepartureTime ? minutes(run.plannedCpuDepartureTime) : 0;
    const end = run.plannedCpuReturnTime ? minutes(run.plannedCpuReturnTime) : start + DEFAULT_RUN_MINUTES;
    if (mode !== "place" && !run.plannedCpuDepartureTime) return;
    dragRef.current = { runId: run.runId, vehicleId: run.vehicleId || "", mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start, end, started: false };
  };

  const overlapping = useMemo(() => {
    const view = runs.map((run) => {
      const pending = pendingRuns[run.runId];
      const live = preview?.runId === run.runId ? { start: formatTimelineMinute(preview.start), end: formatTimelineMinute(preview.end) } : pending;
      return { canonicalId: run.runId, vehicleId: run.vehicleId, plannedCpuDepartureTime: live?.start ?? run.plannedCpuDepartureTime, plannedCpuReturnTime: live?.end ?? run.plannedCpuReturnTime };
    });
    return overlappingRunIds(view);
  }, [runs, pendingRuns, preview]);

  const keyboardResize = (event: ReactKeyboardEvent, run: Run) => {
    if (!planningOpen(run) || pendingRuns[run.runId] || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    event.stopPropagation();
    const start = minutes(run.plannedCpuDepartureTime!);
    const end = clamp(minutes(run.plannedCpuReturnTime!) + (event.key === "ArrowRight" ? SLOT : -SLOT), start + SLOT, LAST_MINUTE);
    if (end !== minutes(run.plannedCpuReturnTime!)) onRunTiming(run.runId, run.plannedCpuDepartureTime!, formatTimelineMinute(end));
  };

  return <>{VEHICLES.map(({ id: vehicleId, label: vehicleLabel }) => {
    const vehicleRuns = runs.filter((run) => run.vehicleId === vehicleId);
    const timed = vehicleRuns.filter((run) => run.plannedCpuDepartureTime && run.plannedCpuReturnTime);
    const untimed = vehicleRuns.filter((run) => !run.plannedCpuDepartureTime || !run.plannedCpuReturnTime);
    const placing = preview && untimed.some((run) => run.runId === preview.runId) ? preview : undefined;
    const creating = creatingRuns.filter((item) => item.vehicleId === vehicleId);
    const visual = (run: Run) => {
      const pending = pendingRuns[run.runId];
      if (preview?.runId === run.runId && preview.valid) return { start: preview.start, end: preview.end, state: "dragging" as const };
      if (pending) return { start: minutes(pending.start), end: minutes(pending.end), state: "pending" as const };
      return { start: minutes(run.plannedCpuDepartureTime!), end: minutes(run.plannedCpuReturnTime!), state: "idle" as const };
    };
    const intervals = timed.map((run) => { const view = visual(run); return { id: run.runId, startMinute: view.start, durationMinutes: view.end - view.start }; });
    const packed = timelineVisualSubrows(intervals);
    const packedRows = Math.max(0, ...packed.values()) + 1;
    const timedArea = timed.length || creating.length ? 16 + packedRows * 52 : 0;
    const trackHeight = Math.max(untimed.length ? 84 : 72, timedArea + (untimed.length && (timed.length || creating.length) ? 52 : 0));
    const hintFor = (run: Run) => dropHint?.runId === run.runId ? dropHint : undefined;
    return <div className={styles.journeyRow} key={vehicleId}>
      <div className={styles.journeyLabel}>
        <strong>{vehicleLabel}</strong>
        <span>{vehicleRuns.length} {vehicleRuns.length === 1 ? "run" : "runs"}</span>
        <button type="button" className={styles.newRunButton} onClick={() => onCreateRun(vehicleId)} aria-label={`Add run to ${vehicleLabel}`}>+ Add run</button>
      </div>
      <div
        className={styles.journeyTrack}
        data-vehicle-track={vehicleId}
        title="Click an empty space to create a run at that time"
        style={{ width: `${contentWidth}px`, minHeight: `${trackHeight}px`, paddingTop: untimed.length ? `${timedArea}px` : undefined, "--timeline-quarter-hour": `${15 * pxPerMinute}px`, "--timeline-hour": `${60 * pxPerMinute}px` } as CSSProperties}
        onPointerMove={(event) => { if (dragRef.current || event.target !== event.currentTarget) { if (hover) setHover(undefined); return; } setHover({ vehicleId, minute: clamp(snap((event.clientX - event.currentTarget.getBoundingClientRect().left) / pxPerMinute), 0, LAST_MINUTE - SLOT) }); }}
        onPointerLeave={() => setHover(undefined)}
        onClick={(event) => {
          if (event.target !== event.currentTarget || suppressClick.current) return;
          const start = clamp(snap((event.clientX - event.currentTarget.getBoundingClientRect().left) / pxPerMinute), 0, LAST_MINUTE - SLOT);
          onCreateRun(vehicleId, formatTimelineMinute(start), formatTimelineMinute(Math.min(LAST_MINUTE, start + DEFAULT_RUN_MINUTES)));
        }}
      >
        {hover?.vehicleId === vehicleId && !preview && <span className={styles.createGhost} aria-hidden="true" style={{ left: `${hover.minute * pxPerMinute}px` }}>+ New run {formatTimelineMinute(hover.minute)}</span>}
        {timed.map((run) => {
          const view = visual(run);
          const label = runLabel(run, vehicleRuns);
          const overlaps = overlapping.has(run.runId);
          const top = (untimed.length ? 8 : Math.max(8, (trackHeight - packedRows * 52) / 2)) + (packed.get(run.runId) || 0) * 52;
          const loads = run.stops.reduce((total, stop) => total + (stop.loadCount ?? stop.requirementCount), 0);
          const hint = hintFor(run);
          const editable = planningOpen(run) && !pendingRuns[run.runId];
          const depart = formatTimelineMinute(view.start), ret = formatTimelineMinute(view.end);
          const statusClass = run.operationalStatus === "attention" ? styles.journeyAttention : run.operationalStatus === "complete" || run.operationalStatus === "returned" ? styles.journeyComplete : run.status === "dispatched" ? styles.journeyDispatched : run.status === "ready" ? styles.journeyReady : run.status === "draft" ? styles.journeyDraft : "";
          return <div
            key={run.runId}
            className={`${styles.journeyBlock} ${statusClass} ${overlaps ? styles.journeyConflict : ""} ${selectedRunId === run.runId ? styles.journeySelected : ""} ${view.state === "dragging" ? styles.journeyDragging : ""} ${view.state === "pending" ? styles.journeyPending : ""} ${hint ? hint.valid ? styles.dropValid : styles.dropInvalid : ""} ${editable ? styles.journeyMovable : ""}`}
            data-journey-run-id={run.runId}
            data-run-status={run.status}
            style={{ left: `${view.start * pxPerMinute}px`, top: `${top}px`, width: `${Math.max(40, (view.end - view.start) * pxPerMinute)}px` }}
          >
            <button
              type="button"
              className={styles.journeyBlockButton}
              aria-current={selectedRunId === run.runId ? "true" : undefined}
              title={`${vehicleLabel} · ${label} · ${depart}–${ret}${overlaps ? " · Overlaps another run" : ""}${editable ? " · Drag to move, drag the right edge to resize" : ""}`}
              aria-label={`${vehicleLabel} ${label}, ${runStatusText(run)}, ${depart} to ${ret}, ${run.stopCount} stops, ${loads} loads${overlaps ? ", overlaps another run" : ""}${view.state === "pending" ? ", saving" : ""}`}
              onPointerDown={(event) => begin(event, run, "move")}
              onClick={() => { if (suppressClick.current) return; onRun(run.runId); }}
            >
              <span><strong>{vehicleLabel} · {label}</strong><b>{view.state === "pending" ? "Saving…" : runStatusText(run)}</b></span>
              <span>{depart}–{ret} · {run.stopCount} stops · {loads} loads</span>
              {overlaps && <small>Schedule overlap</small>}
              {hint && <em className={styles.dropLabel} role="status">{hint.valid ? "Drop to assign" : hint.reason || "Can't assign here"}</em>}
            </button>
            {editable && <span
              className={styles.resizeEdge}
              role="slider"
              tabIndex={0}
              data-testid={`run-resize-${run.runId}`}
              aria-label={`Resize ${vehicleLabel} ${label} return time`}
              aria-valuemin={view.start + SLOT}
              aria-valuemax={LAST_MINUTE}
              aria-valuenow={view.end}
              aria-valuetext={`Return ${ret}`}
              onPointerDown={(event) => begin(event, run, "resize")}
              onKeyDown={(event) => keyboardResize(event, run)}
            />}
          </div>;
        })}
        {creating.map((item) => item.start && item.end ? <div key={item.id} className={`${styles.journeyBlock} ${styles.journeyPending} ${styles.journeyDraft}`} data-testid="creating-run" role="status" style={{ left: `${minutes(item.start) * pxPerMinute}px`, top: "8px", width: `${Math.max(40, (minutes(item.end) - minutes(item.start)) * pxPerMinute)}px` }}><span><strong>{vehicleLabel} · New run</strong><b>Saving…</b></span><span>{item.start}–{item.end}</span></div> : null)}
        {placing?.valid && <div className={`${styles.journeyBlock} ${styles.journeyDragging}`} aria-hidden="true" style={{ left: `${placing.start * pxPerMinute}px`, top: "8px", width: `${(placing.end - placing.start) * pxPerMinute}px` }}><span><strong>{vehicleLabel}</strong><b>Place here</b></span><span>{formatTimelineMinute(placing.start)}–{formatTimelineMinute(placing.end)}</span></div>}
        {untimed.length > 0 || creating.some((item) => !item.start) ? <div className={styles.untimedRuns} data-testid="untimed-runs">
          <span className={styles.untimedNote}>{timed.length ? "Not yet on the timeline:" : "No journey times yet. Drag a run onto the timeline, or open it to set its times."}</span>
          {untimed.map((run) => {
            const hint = hintFor(run);
            const open = planningOpen(run);
            return <button
              type="button"
              key={run.runId}
              data-untimed-run-id={run.runId}
              className={`${styles.untimedJourney} ${selectedRunId === run.runId ? styles.journeySelected : ""} ${hint ? hint.valid ? styles.dropValid : styles.dropInvalid : ""}`}
              title={open ? "Drag onto the timeline to position this run" : undefined}
              onPointerDown={(event) => begin(event, run, "place")}
              onClick={() => { if (suppressClick.current) return; onRun(run.runId); }}
              aria-label={`${vehicleLabel} run needs CPU journey times · ${runLabel(run, vehicleRuns)} · ${run.stopCount} ${run.stopCount === 1 ? "stop" : "stops"}`}
            ><strong>{runLabel(run, vehicleRuns)}</strong> · {runStatusText(run)} · needs journey times · {run.stopCount} {run.stopCount === 1 ? "stop" : "stops"}{hint && <em className={styles.dropLabel} role="status"> {hint.valid ? "Drop to assign" : hint.reason || "Can't assign here"}</em>}</button>;
          })}
          {creating.filter((item) => !item.start).map((item) => <span key={item.id} className={styles.untimedJourney} role="status" data-testid="creating-run">New run · Saving…</span>)}
        </div> : null}
        {!vehicleRuns.length && !creating.length && <span className={styles.noVehicleRuns}>No runs planned · click here to create one</span>}
      </div>
    </div>;
  })}</>;
}
