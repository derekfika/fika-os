"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, ChevronUpIcon, GripIcon, MoreIcon, TrashIcon, TruckIcon } from "./icons";
import { statusLabel, type RunRowView } from "./model";
import { RunStopSequence } from "./RunStopSequence";
import styles from "./timeline.module.css";

export type BarPreview = { start: number; end: number; valid: boolean };
export type BarMode = "move" | "resize" | "place";
const pad = (value: number) => String(value).padStart(2, "0");
export const formatMinute = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };

/** Planned CPU departure -> return as a bar. Width is proportional to the planned duration; nothing else is inferred from it. */
export function RunTimeBar({ run, pxPerHour, preview, onSelect, onPointerDown, onResizeKey, top, drop }: {
  run: RunRowView; pxPerHour: number; preview?: BarPreview; onSelect: () => void;
  onPointerDown?: (event: ReactPointerEvent, mode: BarMode) => void; onResizeKey?: (delta: number) => void;
  top?: number;
  drop?: "valid" | "invalid";
}) {
  const start = preview ? preview.start : run.departure ? minutesOf(run.departure) : undefined;
  const end = preview ? preview.end : run.return ? minutesOf(run.return) : undefined;
  if (start === undefined || end === undefined) return null;
  const left = (start / 60) * pxPerHour;
  const width = Math.max(44, ((end - start) / 60) * pxPerHour);
  const draggable = run.editable && !run.pending;
  const text = run.pending ? "Saving…" : `${formatMinute(start)} – ${formatMinute(end)}`;
  return <div
    className={styles.bar}
    role="button"
    tabIndex={0}
    data-run-bar={run.id}
    data-drop-run-id={run.id}
    data-drop={drop}
    data-status={run.status}
    data-pending={run.pending ? "true" : undefined}
    data-dragging={preview ? "true" : undefined}
    data-invalid={preview && !preview.valid ? "true" : undefined}
    data-overlap={run.overlapWarning ? "true" : undefined}
    data-editable={draggable ? "true" : "false"}
    style={{ left, width, top }}
    title={`${run.title} · ${run.vehicleLabel} · ${text}${run.overlapWarning ? " · Overlaps another run" : ""}${draggable ? " · drag to move, drag the right edge to resize" : ""}`}
    aria-label={`${run.title}, ${run.vehicleLabel}, ${statusLabel(run.status)}, planned CPU departure ${formatMinute(start)}, return ${formatMinute(end)}${run.pending ? ", saving" : ""}${run.overlapWarning ? ", overlaps another run on this vehicle" : ""}. Select run`}
    onClick={onSelect}
    onPointerDown={draggable ? (event) => onPointerDown?.(event, "move") : undefined}
    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(); } }}
  >
    {draggable && <span className={styles.barGripStart} aria-hidden="true"><GripIcon size={9} /></span>}
    <span className={styles.barText}>{run.title} · {text}{run.status !== "planned" ? ` · ${statusLabel(run.status)}` : ""}</span>
    {draggable && <span
      className={styles.barGripEnd}
      data-resize-handle
      role="slider"
      tabIndex={0}
      aria-label={`Resize ${run.title} return time`}
      aria-valuemin={start + 15}
      aria-valuemax={23 * 60 + 45}
      aria-valuenow={end}
      aria-valuetext={`Return ${formatMinute(end)}`}
      onPointerDown={(event) => { event.stopPropagation(); onPointerDown?.(event, "resize"); }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); onResizeKey?.(event.key === "ArrowRight" ? 15 : -15); } }}
    ><GripIcon size={9} /></span>}
  </div>;
}

export function RunTimelineRow({ run, pxPerHour, selected, collapsed, drop, dropReason, preview, overlapping, activeStopKey, onToggleCollapsed, onSelect, onSelectStop, onSetTimes, onRetire, onBarPointerDown, onResizeKey, detailsOnly = false }: {
  run: RunRowView;
  pxPerHour: number;
  selected: boolean;
  collapsed: boolean;
  /** Set by the queue drag controller while work is dragged over this row: the WHOLE row is the target. */
  drop?: "valid" | "invalid";
  dropReason?: string;
  preview?: BarPreview;
  overlapping?: boolean;
  activeStopKey?: string;
  onToggleCollapsed: () => void;
  onSelect: () => void;
  onSelectStop?: (stopKey: string) => void;
  onSetTimes?: () => void;
  onRetire?: () => void;
  onBarPointerDown?: (event: ReactPointerEvent, mode: BarMode) => void;
  onResizeKey?: (delta: number) => void;
  detailsOnly?: boolean;
}) {
  const [menu, setMenu] = useState<{ top: number; left: number } | undefined>();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) { setMenu(undefined); if (event instanceof KeyboardEvent) triggerRef.current?.focus(); } };
    const dismiss = () => setMenu(undefined);
    const dismissIfAnchorMoved = () => {
      const box = triggerRef.current?.getBoundingClientRect();
      if (!box || Math.abs(box.bottom + 6 - menu.top) > 1 || Math.abs(Math.max(8, box.right - 220) - menu.left) > 1) dismiss();
    };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    window.addEventListener("resize", dismiss); document.addEventListener("scroll", dismissIfAnchorMoved, true);
    // Focusing a fixed portal must not scroll the timeline and dismiss its own menu.
    popupRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); window.removeEventListener("resize", dismiss); document.removeEventListener("scroll", dismissIfAnchorMoved, true); };
  }, [menu]);
  const timed = Boolean(run.departure && run.return);
  const barStart = preview ? preview.start : timed ? minutesOf(run.departure!) : 0;
  const barLeft = (barStart / 60) * pxPerHour;
  const counts = `${run.stopCount} ${run.stopCount === 1 ? "stop" : "stops"} · ${run.loadCount} ${run.loadCount === 1 ? "load" : "loads"}`;
  const warn = run.overlapWarning || overlapping ? run.overlapWarning || "Overlaps another run on this vehicle. You can still save." : undefined;
  return <article
    className={styles.row}
    data-run-row={detailsOnly ? undefined : ""}
    data-run-id={run.id}
    data-drop-run-id={run.id}
    data-vehicle={run.vehicleId}
    data-status={run.status}
    data-selected={selected ? "true" : undefined}
    data-collapsed={collapsed ? "true" : undefined}
    data-drop={drop}
    data-pending={run.pending ? "true" : undefined}
    aria-label={`${run.title}, ${run.vehicleLabel}`}
  >
    <div className={styles.frame} aria-hidden="true" />
    <div className={styles.label}>
      <div className={styles.titleLine}>
        <h3 className={styles.title}>{run.title}{collapsed && <span className={styles.titleVehicle}> · {run.vehicleLabel}</span>}</h3>
        {run.pending ? <span className={styles.status} data-status="pending">Saving…</span> : run.status !== "planned" && <span className={styles.status} data-status={run.status}>{statusLabel(run.status)}</span>}
      </div>
      {!collapsed && <div className={styles.vehicle}><TruckIcon size={17} />{run.vehicleLabel}</div>}
      <div className={styles.times} data-missing={timed ? undefined : "true"}>{timed ? `${run.departure} – ${run.return}` : "Times to set"}</div>
      <div className={styles.counts}>{counts}</div>
      {warn && <div className={styles.warn} title={warn} data-overlap-warning>⚠ Overlaps another run</div>}
      {run.attention && <div className={styles.warn}>⚠ {run.attention}</div>}
    </div>
    <div className={detailsOnly ? `${styles.track} ${styles.detailsTrack}` : styles.track}>
      {!detailsOnly && (timed || preview)
        ? <RunTimeBar run={run} pxPerHour={pxPerHour} preview={preview} onSelect={onSelect} onPointerDown={onBarPointerDown} onResizeKey={onResizeKey} />
        : !timed && <div className={styles.draftSlot} data-draft-slot data-editable={run.editable && !run.pending ? "true" : "false"} onPointerDown={run.editable && !run.pending ? (event) => { if ((event.target as HTMLElement).closest("button")) return; onBarPointerDown?.(event, "place"); } : undefined} title={run.editable ? "Drag onto the timeline to place this run, or set exact times" : undefined}><span>Draft · set CPU departure and return</span><button type="button" onClick={onSetTimes ?? onSelect} disabled={!run.editable || run.pending}>Set times</button></div>}
      {drop && <div className={styles.dropLabel} role="status" data-drop-label>{drop === "valid" ? `Drop to add to ${run.title}` : dropReason || "Can’t add work to this run"}</div>}
      <div className={styles.actionsWrap}>
        <div className={styles.actions}>
          <button type="button" className={styles.actionButton} onClick={onToggleCollapsed} aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${run.title} stop sequence`}>{collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}</button>
          <div ref={menuRef} className={styles.menuAnchor}>
            <button ref={triggerRef} type="button" className={styles.actionButton} onClick={(event) => { if (menu) { setMenu(undefined); return; } const box = event.currentTarget.getBoundingClientRect(); setMenu({ top: box.bottom + 6, left: Math.max(8, box.right - 220) }); }} aria-haspopup="menu" aria-expanded={Boolean(menu)} aria-label={`${run.title} actions`}><MoreIcon /></button>
            {menu && triggerRef.current?.closest("[data-journey-planner]") && createPortal(<div ref={popupRef} className={styles.menu} role="menu" aria-label={`${run.title} actions`} style={{ top: menu.top, left: menu.left }}>
              <button type="button" role="menuitem" onClick={() => { setMenu(undefined); onSelect(); }}>Open run</button>
              <button type="button" role="menuitem" disabled={!run.editable} onClick={() => { setMenu(undefined); (onSetTimes ?? onSelect)(); }}>Set planned times</button>
              <button type="button" role="menuitem" disabled={!run.canRetire} title={run.canRetire ? undefined : run.retireBlocker} onClick={() => { setMenu(undefined); onRetire?.(); }}><TrashIcon size={17} />Delete empty run</button>
            </div>, triggerRef.current.closest("[data-journey-planner]")!)}
          </div>
        </div>
      </div>
      {!collapsed && !detailsOnly && <RunStopSequence runTitle={run.title} chips={run.chips} onSelectStop={onSelectStop} activeKey={activeStopKey} offset={!detailsOnly && (timed || preview) ? barLeft : 0} />}
    </div>
  </article>;
}
