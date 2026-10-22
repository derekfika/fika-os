"use client";

import { useEffect, useRef, useState } from "react";
import type { PlannerRunView, PlannerStopView } from "../lib/planner-read-model";
import { describePieces, type StopPiece } from "../lib/run-stop-order";
import { groupIntoVisitRows } from "../lib/stop-visits";
import styles from "./run-organiser.module.css";

type Props = {
  run: PlannerRunView;
  /** True while any command for this run is in flight; prevents duplicate submission. */
  pending: boolean;
  onSave: (stopIds: string[]) => void;
  onOpenStop: (stopId: string) => void;
  onReturnStop: (stopId: string) => void;
  onRetire: () => void;
  /** Individually tracked work inside each physical stop, keyed by stop id. */
  pieces?: Record<string, StopPiece[]>;
};

const startOf = (stop: PlannerStopView) => stop.plannedWindow?.startTime || stop.plannedArrivalTime;

type Row = { key: string; stops: PlannerStopView[] };
const rowStart = (row: Row) => row.stops.map(startOf).filter((value): value is string => Boolean(value)).sort()[0];

/** Pairs where an earlier visit has a later planned time than a visit that follows it. Surfaced, never auto-corrected. */
export function orderConflicts(rows: Row[]): Array<{ earlier: Row; later: Row }> {
  const timed = rows.filter((row) => rowStart(row));
  const conflicts: Array<{ earlier: Row; later: Row }> = [];
  for (let index = 0; index < timed.length; index += 1) {
    for (let next = index + 1; next < timed.length; next += 1) {
      if (rowStart(timed[index])! > rowStart(timed[next])!) { conflicts.push({ earlier: timed[index], later: timed[next] }); break; }
    }
  }
  return conflicts;
}

const stopHas = (stop: PlannerStopView, kind: "delivery" | "collection" | "transfer") => stop.movementTypes.includes(kind) || (kind !== "transfer" && stop.lane === kind && stop.movementTypes.length === 0);
/** A physical stop's label: lanes that share one visit read as one mixed stop. */
const rowLabel = (row: Row) => row.stops.length === 1 ? typeLabel(row.stops[0]) : row.stops.some((stop) => stopHas(stop, "transfer")) ? "Transfer" : row.stops.some((stop) => stopHas(stop, "delivery")) && row.stops.some((stop) => stopHas(stop, "collection")) ? "Delivery + Collection" : typeLabel(row.stops[0]);
const typeLabel = (stop: PlannerStopView) => stop.movementTypes.includes("transfer") ? "Transfer" : stop.movementTypes.includes("delivery") && stop.movementTypes.includes("collection") ? "Delivery + Collection" : stop.lane === "collection" ? "Collection" : "Delivery";
const loadText = (stop: PlannerStopView) => `${stop.loadCount ?? stop.requirementCount} ${(stop.loadCount ?? stop.requirementCount) === 1 ? "load" : "loads"}`;

export function RunOrganiser({ run, pending, onSave, onOpenStop, onReturnStop, onRetire, pieces = {} }: Props) {
  const planningOpen = run.status === "draft" || run.status === "planned";
  const rows = groupIntoVisitRows(run.stops);
  const original = rows.map((row) => row.key);
  const [order, setOrder] = useState(original);
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const [confirmRetire, setConfirmRetire] = useState(false);
  const retireTrigger = useRef<HTMLButtonElement>(null);
  const confirmCancel = useRef<HTMLButtonElement>(null);
  // Re-seed from the authoritative run whenever the saved order or version changes.
  const signature = `${run.version}:${original.join("|")}`;
  useEffect(() => { setOrder(original); setConfirmRetire(false); }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (confirmRetire) confirmCancel.current?.focus(); }, [confirmRetire]);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const ordered = order.map((key) => byKey.get(key)).filter((row): row is Row => Boolean(row));
  const piecesOf = (row: Row) => row.stops.flatMap((stop) => pieces[stop.stopId] ?? []);
  const changed = order.join("|") !== original.join("|");
  const conflicts = orderConflicts(ordered);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
  };
  const eligibleToRetire = planningOpen && run.stopCount === 0;
  return <section className={styles.organiser} aria-label="Organise run">
    <div className={styles.heading}>
      <h3>Stops · visiting order <span>({ordered.length})</span></h3>
      {planningOpen ? <p>Drag stops, or use the arrows, to set the order the driver visits them. Times are not changed.</p> : <p>Return this run to planning to change its stop order.</p>}
    </div>
    {ordered.length === 0 && <p className={styles.empty}>No stops yet. Drag work from the queue onto this run.</p>}
    <ol className={styles.list} aria-label="Stops in visiting order">
      {ordered.map((row, index) => { const stop = row.stops[0]; const rowPieces = piecesOf(row); const start = rowStart(row); return <li
        key={row.key}
        data-testid={`organise-stop-${row.key}`}
        data-stop-id={row.key}
        data-visit={row.stops.length > 1 || stop.visitId ? "true" : undefined}
        className={`${styles.item} ${dragging === row.key ? styles.dragging : ""} ${over === row.key && dragging && dragging !== row.key ? styles.over : ""}`}
        draggable={planningOpen && !pending}
        onDragStart={(event) => { setDragging(row.key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-logistics-organise-stop", row.key); }}
        onDragOver={(event) => { if (!dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(row.key); }}
        onDrop={(event) => { event.preventDefault(); if (dragging) move(order.indexOf(dragging), index); setDragging(undefined); setOver(undefined); }}
        onDragEnd={() => { setDragging(undefined); setOver(undefined); }}
      >
        <span className={styles.grip} aria-hidden="true">⠿</span>
        <span className={styles.number}>{index + 1}</span>
        <button type="button" className={styles.main} onClick={() => onOpenStop(stop.stopId)} aria-label={`Open ${rowLabel(row)} ${stop.destination.label}`}>
          <strong>{stop.destination.label}</strong>
          <span>{rowLabel(row)} · {rowPieces.length > 0 ? describePieces(rowPieces) : loadText(stop)}{start ? ` · ${row.stops.length === 1 && stop.plannedWindow?.endTime ? `${start}–${stop.plannedWindow.endTime}` : start}` : " · time to confirm"}</span>
        </button>
        {rowPieces.length > 1 && <details className={styles.pieces}>
          <summary>{rowPieces.length} pieces of work in this stop</summary>
          <ul>{rowPieces.map((piece) => <li key={piece.key + piece.kind}><b>{piece.kind === "delivery" ? "Delivery" : piece.kind === "collection" ? "Collection" : "Transfer"}</b> {piece.label}</li>)}</ul>
        </details>}
        {planningOpen && <span className={styles.controls}>
          <button type="button" aria-label={`Move ${stop.destination.label} up`} disabled={pending || index === 0} onClick={() => move(index, index - 1)}>↑</button>
          <button type="button" aria-label={`Move ${stop.destination.label} down`} disabled={pending || index === ordered.length - 1} onClick={() => move(index, index + 1)}>↓</button>
          <button type="button" className={styles.remove} aria-label={`Return ${stop.destination.label} to queue`} disabled={pending} onClick={() => row.stops.forEach((member) => onReturnStop(member.stopId))}>↩</button>
        </span>}
      </li>; })}
    </ol>
    {conflicts.length > 0 && <div className={styles.conflict} role="status">
      <strong>Order conflicts with planned times</strong>
      <ul>{conflicts.map(({ earlier, later }) => <li key={`${earlier.key}:${later.key}`}>{earlier.stops[0].destination.label} ({rowStart(earlier)}) is listed before {later.stops[0].destination.label} ({rowStart(later)}).</li>)}</ul>
      <p>Times were not changed. Adjust a time, or the order, before dispatch.</p>
    </div>}
    {planningOpen && ordered.length > 1 && <div className={styles.actions}>
      <button type="button" className={styles.secondary} disabled={!changed || pending} onClick={() => setOrder(original)}>Cancel</button>
      <button type="button" className={styles.primary} disabled={!changed || pending} onClick={() => onSave(order)}>{pending && changed ? "Saving…" : "Save order"}</button>
    </div>}
    {eligibleToRetire && !confirmRetire && <button ref={retireTrigger} type="button" className={styles.destructiveLink} disabled={pending} onClick={() => setConfirmRetire(true)}>Delete empty run</button>}
    {eligibleToRetire && confirmRetire && <div className={styles.confirm} role="alertdialog" aria-label="Delete empty run" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setConfirmRetire(false); retireTrigger.current?.focus(); } }}>
      <strong>Delete this empty run?</strong>
      <p>It will be removed from the timeline. The run has no work, and its history is kept for audit.</p>
      <div className={styles.actions}>
        <button ref={confirmCancel} type="button" className={styles.secondary} onClick={() => setConfirmRetire(false)}>Cancel</button>
        <button type="button" className={styles.danger} disabled={pending} onClick={onRetire}>Delete empty run</button>
      </div>
    </div>}
    {!eligibleToRetire && planningOpen && run.stopCount > 0 && <p className={styles.hint}>A run with work can’t be deleted. Return its work to the queue first.</p>}
  </section>;
}
