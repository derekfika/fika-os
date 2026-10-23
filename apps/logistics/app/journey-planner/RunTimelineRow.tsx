"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, GripIcon, MoreIcon, TrashIcon, TruckIcon } from "./icons";
import { durationOf, minutesOf, statusLabel, type RunRowView } from "./model";
import { RunStopSequence } from "./RunStopSequence";
import styles from "./timeline.module.css";

/** Planned CPU departure -> return as a bar. Width is proportional to the planned duration; nothing else is inferred from it. */
export function RunTimeBar({ run, pxPerHour, onSelect }: { run: RunRowView; pxPerHour: number; onSelect: () => void }) {
  if (!run.departure || !run.return) return null;
  const left = (minutesOf(run.departure) / 60) * pxPerHour;
  const width = Math.max(44, ((durationOf(run) ?? 0) / 60) * pxPerHour);
  return <div
    className={styles.bar}
    role="button"
    tabIndex={0}
    data-run-bar={run.id}
    data-status={run.status}
    data-pending={run.pending ? "true" : undefined}
    data-overlap={run.overlapWarning ? "true" : undefined}
    data-editable={run.editable ? "true" : "false"}
    style={{ left, width }}
    title={`${run.title} · ${run.vehicleLabel} · ${run.departure}–${run.return}${run.editable ? " · drag to move, drag the right edge to resize" : ""}`}
    aria-label={`${run.title}, ${run.vehicleLabel}, planned CPU departure ${run.departure}, return ${run.return}${run.pending ? ", saving" : ""}. Select run`}
    onClick={onSelect}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}
  >
    {run.editable && <span className={styles.barGripStart} aria-hidden="true"><GripIcon size={9} /></span>}
    <span className={styles.barText}>{run.pending ? "Saving…" : `${run.departure} – ${run.return}`}</span>
    {run.editable && <span className={styles.barGripEnd} aria-hidden="true" data-resize-handle><GripIcon size={9} /></span>}
  </div>;
}

export function RunTimelineRow({ run, pxPerHour, selected, collapsed, drop, onToggleCollapsed, onSelect, onSelectStop, onSetTimes, onRetire }: {
  run: RunRowView;
  pxPerHour: number;
  selected: boolean;
  collapsed: boolean;
  /** Set by the (Phase B) drag controller while work is dragged over this row. */
  drop?: "valid" | "invalid";
  onToggleCollapsed: () => void;
  onSelect: () => void;
  onSelectStop?: (stopKey: string) => void;
  onSetTimes?: () => void;
  onRetire?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [menu]);
  const timed = Boolean(run.departure && run.return);
  const barLeft = timed ? (minutesOf(run.departure!) / 60) * pxPerHour : 0;
  const counts = `${run.stopCount} ${run.stopCount === 1 ? "stop" : "stops"} · ${run.loadCount} ${run.loadCount === 1 ? "load" : "loads"}`;
  return <article
    className={styles.row}
    data-run-row
    data-run-id={run.id}
    data-drop-run-id={run.id}
    data-vehicle={run.vehicleId}
    data-status={run.status}
    data-selected={selected ? "true" : undefined}
    data-collapsed={collapsed ? "true" : undefined}
    data-drop={drop}
    aria-label={`${run.title}, ${run.vehicleLabel}`}
  >
    <div className={styles.frame} aria-hidden="true" />
    <div className={styles.label}>
      <div className={styles.titleLine}>
        <h3 className={styles.title}>{run.title}{collapsed && <span style={{ fontWeight: 400, color: "var(--jp-ink-2)" }}> · {run.vehicleLabel}</span>}</h3>
        {run.status !== "planned" && <span className={styles.status} data-status={run.status}>{statusLabel(run.status)}</span>}
      </div>
      {!collapsed && <div className={styles.vehicle}><TruckIcon size={17} />{run.vehicleLabel}</div>}
      <div className={styles.times} data-missing={timed ? undefined : "true"}>{timed ? `${run.departure} – ${run.return}` : "Times to set"}</div>
      <div className={styles.counts}>{counts}</div>
      {run.overlapWarning && <div className={styles.warn} title={run.overlapWarning}>⚠ Overlaps another run</div>}
      {run.attention && <div className={styles.warn}>⚠ {run.attention}</div>}
    </div>
    <div className={styles.track}>
      {timed
        ? <RunTimeBar run={run} pxPerHour={pxPerHour} onSelect={onSelect} />
        : <div className={styles.draftSlot} data-draft-slot><span>Draft · set CPU departure and return</span><button type="button" onClick={onSetTimes ?? onSelect}>Set times</button></div>}
      <div className={styles.actionsWrap}>
        <div className={styles.actions}>
          <button type="button" className={styles.actionButton} onClick={onToggleCollapsed} aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${run.title} stop sequence`}>{collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}</button>
          <div ref={menuRef} style={{ position: "relative" }}>
            <button type="button" className={styles.actionButton} onClick={() => setMenu((open) => !open)} aria-haspopup="menu" aria-expanded={menu} aria-label={`${run.title} actions`}><MoreIcon /></button>
            {menu && <div className={styles.menu} role="menu" style={{ top: 46, right: 0 }}>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); onSelect(); }}>Open run</button>
              <button type="button" role="menuitem" disabled={!run.editable} onClick={() => { setMenu(false); (onSetTimes ?? onSelect)(); }}>Set planned times</button>
              <button type="button" role="menuitem" disabled={!run.canRetire} title={run.canRetire ? undefined : run.retireBlocker} onClick={() => { setMenu(false); onRetire?.(); }}><TrashIcon size={17} />Delete empty run</button>
            </div>}
          </div>
        </div>
      </div>
      {!collapsed && <RunStopSequence runTitle={run.title} chips={run.chips} onSelectStop={onSelectStop} offset={timed ? barLeft : 0} />}
    </div>
  </article>;
}
