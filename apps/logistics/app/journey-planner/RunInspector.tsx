"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, BoxIcon, BuildingIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, CloseIcon, CpuIcon, GripIcon, InfoIcon, LockIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";
import { statusLabel, type InspectorStopView, type RunInspectorView } from "./model";
import { journeyTimeProblem } from "./NewRunDialog";
import styles from "./inspector.module.css";

export type InspectorTab = "overview" | "stops" | "loads" | "driver";
export type NewCollection = { stopKey: string; movementId: string; description: string; quantity: number; unit: string; notes?: string };
const TABS: Array<{ id: InspectorTab; label: string }> = [{ id: "overview", label: "Overview" }, { id: "stops", label: "Stops" }, { id: "loads", label: "Loads" }, { id: "driver", label: "Driver view" }];
const summary = (stop: Extract<InspectorStopView, { kind: "visit" }>) => [stop.deliveries ? `${stop.deliveries} deliver${stop.deliveries === 1 ? "y" : "ies"}` : "", stop.collections ? `${stop.collections} collection${stop.collections === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");

/**
 * Docked Run inspector. Presentation only: ordering edits are local until "Save order", which raises an
 * event; the container maps it to the authoritative `set-run-stop-order` command and re-seeds from the result.
 */
export function RunInspector({ view, tab, onTab, expandedKey, onExpand, saving = false, timesOpen = false, onTimesOpen, retireConfirmOpen, onRetireConfirmOpen, onClose, onSaveOrder, onAddCollection, onViewLoads, onSaveTimes, onReturnStop, onRetire }: {
  view: RunInspectorView;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  expandedKey?: string;
  onExpand: (key: string | undefined) => void;
  saving?: boolean;
  onClose: () => void;
  onSaveOrder?: (visitKeys: string[]) => void;
  onAddCollection?: (collection: NewCollection) => Promise<boolean | void>;
  onViewLoads?: (stopKey: string) => void;
  /** Proposes exact planned CPU times. Saved only when the host confirms. */
  onSaveTimes?: (departure: string, returnTime: string) => void;
  onReturnStop?: (stopKey: string) => void;
  /** The host may open the exact-times editor (e.g. from the row menu or the draft slot). */
  timesOpen?: boolean;
  onTimesOpen?: (open: boolean) => void;
  /** The host may open the delete confirmation (e.g. from the row menu). */
  retireConfirmOpen?: boolean;
  onRetireConfirmOpen?: (open: boolean) => void;
  onRetire?: () => void;
}) {
  const { run } = view;
  const visits = view.stops.filter((stop): stop is Extract<InspectorStopView, { kind: "visit" }> => stop.kind === "visit");
  const original = visits.map((stop) => stop.key);
  const [order, setOrder] = useState(original);
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const [localConfirm, setLocalConfirm] = useState(false);
  const confirm = retireConfirmOpen ?? localConfirm;
  const setConfirm = (open: boolean) => { setLocalConfirm(open); onRetireConfirmOpen?.(open); };
  const [collectionFor, setCollectionFor] = useState<string>();
  const [collectionRequestId, setCollectionRequestId] = useState<string>();
  const [collectionSaving, setCollectionSaving] = useState(false);
  const collectionSavingRef = useRef(false);
  const [dep, setDep] = useState(run.departure ?? "");
  const [ret, setRet] = useState(run.return ?? "");
  const [timesTouched, setTimesTouched] = useState(false);
  useEffect(() => { setDep(run.departure ?? ""); setRet(run.return ?? ""); setTimesTouched(false); }, [run.id, run.departure, run.return]);
  const timesProblem = journeyTimeProblem(dep, ret) ?? (!dep && !ret ? "Enter a departure and a return time." : undefined);
  const signature = `${run.id}:${original.join("|")}`;
  useEffect(() => { setOrder(original); setLocalConfirm(false); setCollectionFor(undefined); setCollectionRequestId(undefined); }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = order.join("|") !== original.join("|");
  const byKey = new Map(visits.map((stop) => [stop.key, stop]));
  const ordered = order.map((key) => byKey.get(key)).filter((stop): stop is Extract<InspectorStopView, { kind: "visit" }> => Boolean(stop));
  const departure = view.stops.find((stop) => stop.kind === "cpu-departure");
  const arrival = view.stops.find((stop) => stop.kind === "cpu-return");
  const move = (from: number, to: number) => { if (to < 0 || to >= order.length || from === to) return; const next = [...order]; const [item] = next.splice(from, 1); next.splice(to, 0, item); setOrder(next); };
  const confirmCancel = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastStopIndex = useRef(-1);
  // When the stop that had keyboard focus disappears (e.g. returned to the queue) keep focus inside the inspector, on the neighbouring stop.
  useEffect(() => {
    const index = lastStopIndex.current;
    if (index < 0) return;
    const frame = window.requestAnimationFrame(() => {
      const root = scrollRef.current; if (!root) return;
      if (root.contains(document.activeElement) && document.activeElement !== root) return;
      const toggles = root.querySelectorAll<HTMLElement>("[data-stop-key] button[aria-expanded]");
      (toggles[Math.min(index, toggles.length - 1)] ?? root).focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (confirm) confirmCancel.current?.focus(); }, [confirm]);

  const summaryInner = <>
    <div className={styles.plannedRow}>
      <div>
        <div className={styles.plannedLabel}>Planned times{tab === "stops" && <> · {run.stopCount} {run.stopCount === 1 ? "stop" : "stops"} · {run.loadCount} {run.loadCount === 1 ? "load" : "loads"}</>}</div>
        <div className={styles.plannedTimes} data-missing={run.departure ? undefined : "true"}>{run.departure && run.return ? <>{run.departure}<span className={styles.arrowGlyph}>→</span>{run.return}</> : "Set departure and return"}</div>
      </div>
      <button type="button" className={styles.outline} disabled={!run.editable || run.pending} aria-expanded={timesOpen} onClick={() => onTimesOpen?.(!timesOpen)} title={run.editable ? undefined : "Times can’t change once a run is ready or dispatched."}><PencilIcon size={17} />Edit times</button>
    </div>
    {timesOpen && run.editable && <form className={styles.timesForm} aria-label="Edit planned CPU times" onSubmit={(event) => { event.preventDefault(); setTimesTouched(true); if (timesProblem) return; onSaveTimes?.(dep, ret); onTimesOpen?.(false); }}>
      <label>CPU departure<input name="departure" type="time" step={900} value={dep} onChange={(event) => setDep(event.target.value)} aria-invalid={timesTouched && Boolean(timesProblem)} /></label>
      <label>CPU return<input name="return" type="time" step={900} value={ret} onChange={(event) => setRet(event.target.value)} aria-invalid={timesTouched && Boolean(timesProblem)} /></label>
      {timesTouched && timesProblem && <p className={styles.formProblem} role="alert">{timesProblem}</p>}
      <div className={styles.formActions}><button type="button" className={styles.outline} style={{ height: 38 }} onClick={() => { onTimesOpen?.(false); setDep(run.departure ?? ""); setRet(run.return ?? ""); }}>Cancel</button><button type="submit" className={styles.primary} style={{ height: 38, flex: "0 0 auto" }}>Save times</button></div>
    </form>}
    {tab !== "stops" && <><div className={styles.facts}>
      <div className={styles.fact}><span>Vehicle</span><strong>{run.vehicleLabel}</strong></div>
      <div className={styles.fact}><span>Status</span><strong><i className={styles.dot} data-status={run.status} />{statusLabel(run.status)}{run.pending ? " · saving" : ""}</strong></div>
    </div>
    <div className={styles.counts}>{run.stopCount} {run.stopCount === 1 ? "stop" : "stops"} · {run.loadCount} {run.loadCount === 1 ? "load" : "loads"}</div></>}
    {run.overlapWarning && <div className={styles.warning} role="status">⚠ {run.overlapWarning}</div>}
  </>;

  return <aside className={styles.inspector} aria-label="Run inspector" data-run-inspector={run.id}>
    <div className={styles.top}>
      <h2>{run.title} <span>· {run.vehicleLabel}</span></h2>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close inspector"><CloseIcon size={22} /></button>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Run inspector sections">
      {TABS.map((item) => <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} className={styles.tab} aria-selected={tab === item.id} aria-controls="inspector-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => onTab(item.id)}
        onKeyDown={(event) => { const index = TABS.findIndex((candidate) => candidate.id === tab); if (event.key === "ArrowRight") onTab(TABS[(index + 1) % TABS.length].id); if (event.key === "ArrowLeft") onTab(TABS[(index + TABS.length - 1) % TABS.length].id); }}>{item.label}</button>)}
    </div>
    <div className={styles.scroll} ref={scrollRef} tabIndex={-1} role="tabpanel" id="inspector-panel" aria-labelledby={`tab-${tab}`}>
      {tab !== "stops" && <div className={styles.summary}>{summaryInner}</div>}
      {tab === "overview" && <>
        {run.attention && <div className={styles.warning} role="status" style={{ margin: "0 0 14px" }}>⚠ {run.attention}</div>}
        <p className={styles.plannedLabel} style={{ margin: "0 0 8px" }}>{run.canRetire ? "This run has no work and can be deleted." : run.retireBlocker}</p>
        <div className={styles.note}><InfoIcon size={20} /><span>The bar on the timeline shows planned CPU departure and return. The stop sequence shows where the vehicle goes, not when it arrives.</span></div>
      </>}
      {tab === "stops" && <>
        <div className={styles.summary}>
          {summaryInner}
        <ol className={styles.stops} aria-label="Stops in visiting order" onFocusCapture={(event) => { const li = (event.target as HTMLElement).closest<HTMLElement>("[data-stop-key]"); if (li) lastStopIndex.current = Math.max(0, order.indexOf(li.dataset.stopKey || "")); }}>
          <li className={styles.stop}><div className={styles.stopHead}>
            <span /><span className={styles.number}>1</span><span className={styles.glyph}><CpuIcon size={22} /></span>
            <span><span className={styles.stopName}>CPU</span><span className={styles.stopSub}>Departure{departure && "time" in departure && departure.time ? ` · ${departure.time}` : ""}</span></span>
            <span className={styles.stopEnd} title="Fixed endpoint" aria-label="Fixed endpoint, can’t be reordered"><LockIcon size={20} /></span>
          </div></li>
          {ordered.map((stop, index) => {
            const open = expandedKey === stop.key;
            return <li key={stop.key} className={styles.stop} data-stop-key={stop.key} data-dragging={dragging === stop.key ? "true" : undefined} data-drag-over={over === stop.key && dragging !== stop.key ? "true" : undefined}
              draggable={run.editable && !saving}
              onDragStart={(event) => { setDragging(stop.key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", stop.key); }}
              onDragOver={(event) => { if (!dragging) return; event.preventDefault(); setOver(stop.key); }}
              onDrop={(event) => { event.preventDefault(); if (dragging) move(order.indexOf(dragging), index); setDragging(undefined); setOver(undefined); }}
              onDragEnd={() => { setDragging(undefined); setOver(undefined); }}>
              <div className={styles.stopHead}>
                <button type="button" className={styles.handle} disabled={!run.editable} aria-label={`Reorder ${stop.name}. Use arrow up or down`} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); move(index, index - 1); } if (event.key === "ArrowDown") { event.preventDefault(); move(index, index + 1); } }}><GripIcon size={11} /></button>
                <span className={styles.number}>{index + 2}</span>
                <span className={styles.glyph}><BuildingIcon size={22} /></span>
                <button type="button" className={styles.stopText} onClick={() => onExpand(open ? undefined : stop.key)} aria-expanded={open}>
                  <span className={styles.stopName} title={stop.name}>{stop.name}</span>
                  <span className={styles.stopSub}>{stop.collections > 0 && stop.deliveries === 0 ? <b>{summary(stop)}</b> : summary(stop)}</span>
                </button>
                <span className={styles.stopEnd}>
                  {run.editable && <span className={styles.reorder}>
                    <button type="button" aria-label={`Move ${stop.name} up`} disabled={saving || index === 0} onClick={() => move(index, index - 1)}><ArrowUpIcon size={17} /></button>
                    <button type="button" aria-label={`Move ${stop.name} down`} disabled={saving || index === ordered.length - 1} onClick={() => move(index, index + 1)}><ArrowDownIcon size={17} /></button>
                  </span>}
                  <button type="button" className={styles.toggle} onClick={() => onExpand(open ? undefined : stop.key)} aria-label={`${open ? "Collapse" : "Expand"} ${stop.name}`}>{open ? <ChevronUpIcon size={20} /> : <ChevronRightIcon size={20} />}</button>
                </span>
              </div>
              {open && <div className={styles.pieces}>
                {stop.pieces.length === 0 && <p className={styles.stopSub} style={{ padding: "10px 0" }}>No work detail available for this stop.</p>}
                {stop.pieces.map((piece) => <div key={piece.key} className={styles.piece} data-kind={piece.kind}>
                  <span className={styles.pieceIcon}><BoxIcon size={20} /></span>
                  <span><span className={styles.pieceTitle}>{piece.title}</span><span className={styles.pieceDetail}>{piece.detail}</span></span>
                  <span className={styles.badge} data-kind={piece.kind}>{piece.kind === "delivery" ? "Delivery" : "Collection"}</span>
                </div>)}
                <div className={styles.pieceActions}>
                  {stop.canAddCollection && <button type="button" className={`${styles.outline} ${styles.primaryOutline}`} onClick={() => { if (collectionFor === stop.key) { setCollectionFor(undefined); setCollectionRequestId(undefined); } else { setCollectionRequestId(`movement:${crypto.randomUUID()}`); setCollectionFor(stop.key); } }} aria-expanded={collectionFor === stop.key}><PlusIcon size={17} />Add collection</button>}
                  <button type="button" className={styles.outline} onClick={() => onViewLoads?.(stop.key)}>View loads</button>
                  {run.editable && <button type="button" className={styles.outline} disabled={saving} onClick={() => onReturnStop?.(stop.key)} aria-label={`Return ${stop.name} to the queue`}>Return to queue</button>}
                </div>
                {collectionFor === stop.key && <form className={styles.collectionForm} aria-label={`Add a collection at ${stop.name}`} onSubmit={(event) => {
                  event.preventDefault();
                  if (collectionSavingRef.current || !collectionRequestId) return;
                  const data = new FormData(event.currentTarget);
                  collectionSavingRef.current = true;
                  setCollectionSaving(true);
                  void Promise.resolve(onAddCollection?.({ stopKey: stop.key, movementId: collectionRequestId, description: String(data.get("description") || "").trim(), quantity: Number(data.get("quantity")), unit: String(data.get("unit") || "").trim(), notes: String(data.get("notes") || "").trim() || undefined })).then((handled) => {
                    if (handled === false) return;
                    setCollectionFor(undefined);
                    setCollectionRequestId(undefined);
                  }).catch(() => undefined).finally(() => { collectionSavingRef.current = false; setCollectionSaving(false); });
                }}>
                  <label>What is being collected<input name="description" required placeholder="Empty catering crates" /></label>
                  <div className={styles.row2}><label>Quantity<input name="quantity" type="number" min={1} required defaultValue={1} /></label><label>Unit<input name="unit" required defaultValue="crates" /></label></div>
                  <label>Notes (optional)<input name="notes" /></label>
                  <div className={styles.formActions}><button type="button" className={styles.outline} style={{ height: 38 }} disabled={collectionSaving} onClick={() => { setCollectionFor(undefined); setCollectionRequestId(undefined); }}>Cancel</button><button type="submit" className={styles.primary} style={{ height: 38, flex: "0 0 auto" }} disabled={collectionSaving} aria-busy={collectionSaving}>{collectionSaving ? "Saving collection…" : "Add collection"}</button></div>
                </form>}
              </div>}
            </li>;
          })}
          <li className={styles.stop}><div className={styles.stopHead}>
            <span /><span className={styles.number}>{ordered.length + 2}</span><span className={styles.glyph}><CpuIcon size={22} /></span>
            <span><span className={styles.stopName}>CPU</span><span className={styles.stopSub}>Return{arrival && "time" in arrival && arrival.time ? ` · ${arrival.time}` : ""}</span></span>
            <span className={styles.stopEnd} title="Fixed endpoint" aria-label="Fixed endpoint, can’t be reordered"><LockIcon size={20} /></span>
          </div></li>
        </ol>
        </div>
        {changed && !saving && <p className={styles.unsaved} role="status" data-testid="order-unsaved">Order changed — not saved yet.</p>}
        {view.orderWarnings.length > 0 && <div className={styles.warning} role="status" style={{ margin: "14px 0 0" }}><strong>Order conflicts with planned times</strong><br />{view.orderWarnings.join(" ")} Times were not changed.</div>}
        <div className={styles.note}><InfoIcon size={20} /><span>Reordering stops changes the visiting order. Planned times are not automatically adjusted.</span></div>
      </>}
      {tab === "loads" && <div>{visits.length === 0 && <p className={styles.plannedLabel}>No work on this run yet.</p>}{visits.map((stop) => <div key={stop.key} className={styles.loadsGroup}><h3 className={styles.sectionTitle}>{stop.name}</h3>{stop.pieces.map((piece) => <div key={piece.key} className={styles.piece} data-kind={piece.kind} style={{ gridTemplateColumns: "40px minmax(0,1fr) auto" }}><span className={styles.pieceIcon}><BoxIcon size={20} /></span><span><span className={styles.pieceTitle}>{piece.title}</span><span className={styles.pieceDetail}>{piece.detail}</span></span><span className={styles.badge} data-kind={piece.kind}>{piece.kind === "delivery" ? "Delivery" : "Collection"}</span></div>)}</div>)}</div>}
      {tab === "driver" && <div><p className={styles.plannedLabel} style={{ margin: "0 0 10px" }}>Preview of the driver’s route in saved visiting order. Execution happens in the driver app.{run.driverHref && <> <a href={run.driverHref}>Open driver workflow →</a></>}</p><ol className={styles.driverList}><li><span className={styles.number}>1</span><div><strong>CPU</strong><span>Depart{departure && "time" in departure && departure.time ? ` ${departure.time}` : ""}</span></div></li>{ordered.map((stop, index) => <li key={stop.key}><span className={styles.number}>{index + 2}</span><div><strong>{stop.name}</strong><span>{summary(stop)}</span></div></li>)}<li><span className={styles.number}>{ordered.length + 2}</span><div><strong>CPU</strong><span>Return{arrival && "time" in arrival && arrival.time ? ` ${arrival.time}` : ""}</span></div></li></ol></div>}
    </div>
    <div className={styles.footer}>
      {confirm
        ? <div className={styles.confirm} role="alertdialog" aria-label="Delete empty run" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setConfirm(false); } }}><strong>Delete this empty run?</strong><span>It will be removed from the timeline. Its history is kept for audit.</span><div><button type="button" ref={confirmCancel} onClick={() => setConfirm(false)}>Cancel</button><button type="button" data-danger onClick={() => { setConfirm(false); onRetire?.(); }}>Delete empty run</button></div></div>
        : <>
          {run.canRetire && <button type="button" className={styles.danger} onClick={() => setConfirm(true)}><TrashIcon size={18} />Delete empty run</button>}
          {tab === "stops" && changed && !saving && <button type="button" className={styles.outline} style={{ height: 46 }} onClick={() => setOrder(original)}>Reset</button>}
          {tab === "stops" && <button type="button" className={styles.primary} data-order-state={saving ? "saving" : changed ? "unsaved" : "saved"} disabled={!changed || saving || !run.editable} onClick={() => onSaveOrder?.(order)}>{saving ? "Saving…" : "Save order"}</button>}
        </>}
    </div>
  </aside>;
}
