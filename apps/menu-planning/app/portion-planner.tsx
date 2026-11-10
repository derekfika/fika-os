"use client";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useSearchParams } from "next/navigation";
import MenuPlanningShell from "./menu-planning-shell"
import HotForkBuffetDemand from "./hot-fork-buffet-demand";
import { revealPortionInput } from "./portion-scroll";
import PublicationHandoffStatus from "./publication-handoff-status";
import PlanningContextNav from "./planning-context-nav";
import DuplicatePlanningModal from "./duplicate-planning-modal";
import { useRollingData } from "./planner-data";
import { loadPublicationReadiness } from "@/lib/publication-readiness-cache";
import type { RollingAllocation } from "@/lib/rolling-menu-types";
import { allocationMatchesPortionDestination, draftValueMatchesPersisted, persistedPortionValue, reconcilePortionDraft } from "@/lib/portion-draft";
import { orderPortionPlannerEntries } from "../lib/portion-menu-order";

type Oploc = { canonicalId: string; label: string; address?: string };
type Destination = { id: string; label: string; address?: string; oneOff?: boolean };

const PORTION_DISH_WIDTH_KEY = "fika-menu-portion-dish-width:v1";
const MIN_PORTION_DISH_WIDTH = 180;
const DEFAULT_PORTION_DISH_WIDTH = 280;
const MAX_PORTION_DISH_WIDTH = 520;
const PORTION_DESTINATION_WIDTH = 96;
const PORTION_TOTAL_WIDTH = 92;

export function portionDishWidthLimit(viewportWidth: number) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return MAX_PORTION_DISH_WIDTH;
  return Math.max(MIN_PORTION_DISH_WIDTH, Math.min(MAX_PORTION_DISH_WIDTH, Math.floor(viewportWidth * 0.45)));
}

export function clampPortionDishWidth(value: number, maximum = MAX_PORTION_DISH_WIDTH) {
  const safeMaximum = Math.max(MIN_PORTION_DISH_WIDTH, Math.min(MAX_PORTION_DISH_WIDTH, Math.floor(maximum)));
  const safeValue = Number.isFinite(value) ? Math.round(value) : DEFAULT_PORTION_DISH_WIDTH;
  return Math.max(MIN_PORTION_DISH_WIDTH, Math.min(safeMaximum, safeValue));
}

export default function PortionPlanner() {
  const { snapshot, weeks, publicationState, handoff, message, error, setError, command, refreshWeek } = useRollingData({ loadCatalogue: false }); const params = useSearchParams();
  const [oplocs, setOplocs] = useState<Oploc[]>([]); const [oneOffOpen, setOneOffOpen] = useState(false); const [oneOffName, setOneOffName] = useState(""); const [oneOffAddress, setOneOffAddress] = useState(""); const [showAll, setShowAll] = useState(false); const [draftValues, setDraftValues] = useState<Record<string, string>>({}); const [blockers, setBlockers] = useState<string[]>([]); const [readinessRefresh, setReadinessRefresh] = useState(0); const [withdrawOpen, setWithdrawOpen] = useState(false); const [withdrawReason, setWithdrawReason] = useState(""); const [withdrawError, setWithdrawError] = useState(""); const [publishing, setPublishing] = useState(false); const [saving, setSaving] = useState(false); const hydratedDraftKey = useRef(""); const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [dishColumnWidth, setDishColumnWidth] = useState(DEFAULT_PORTION_DISH_WIDTH); const [dishColumnMax, setDishColumnMax] = useState(MAX_PORTION_DISH_WIDTH); const [dishWidthPreferenceReady, setDishWidthPreferenceReady] = useState(false); const portionTableWrap = useRef<HTMLDivElement>(null); const resizeStart = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null); const dishWidthRef = useRef(DEFAULT_PORTION_DISH_WIDTH);
  const updateDishColumnWidth = (value: number) => { const next = clampPortionDishWidth(value, dishColumnMax); dishWidthRef.current = next; setDishColumnWidth(next); return next; };
  const saveDishColumnWidth = (value = dishWidthRef.current) => { try { window.localStorage.setItem(PORTION_DISH_WIDTH_KEY, String(value)); } catch { /* Keep resizing available when storage is blocked. */ } };
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(PORTION_DISH_WIDTH_KEY));
      if (Number.isFinite(saved) && saved > 0) { const next = clampPortionDishWidth(saved); dishWidthRef.current = next; setDishColumnWidth(next); }
    } catch { /* The default width is enough when local storage is unavailable. */ }
    setDishWidthPreferenceReady(true);
  }, []);
  useEffect(() => {
    const wrapper = portionTableWrap.current;
    if (!wrapper) return;
    const measure = () => setDishColumnMax(portionDishWidthLimit(wrapper.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure); observer.observe(wrapper); return () => observer.disconnect();
  }, [snapshot?.entries.length]);
  useEffect(() => {
    const next = clampPortionDishWidth(dishColumnWidth, dishColumnMax);
    if (next !== dishColumnWidth) { dishWidthRef.current = next; setDishColumnWidth(next); if (dishWidthPreferenceReady) saveDishColumnWidth(next); }
  }, [dishColumnMax]);
  useEffect(() => { void fetch("/api/oplocs", { cache: "no-store" }).then(response => response.json()).then(body => setOplocs(body.oplocs || [])).catch(() => setOplocs([])); }, []);
  const selectedDayId = snapshot?.days.find(item => item.date === params.get("day") || item.id === params.get("day"))?.id || snapshot?.days[0]?.id;
  const draftStorageKey = snapshot && selectedDayId ? `fika-menu-portion-draft:${snapshot.week.id}:${selectedDayId}` : "";
  useEffect(() => {
    if (!draftStorageKey || !snapshot || !selectedDayId) return;
    try {
      const stored = window.localStorage.getItem(draftStorageKey);
      const day = snapshot.days.find(item => item.id === selectedDayId);
      const entries = snapshot.entries.filter(entry => entry.dayId === selectedDayId && entry.itemLabel.trim());
      const destinations = [...oplocs.map(item => ({ id: item.canonicalId, label: item.label, address: item.address })), ...(day?.oneOffDestinations || []).map(item => ({ id: `oneoff:${item.id}`, label: item.label, address: item.address, oneOff: true })), ...entries.flatMap(entry => entry.allocations.filter(allocation => allocation.destinationId).map(allocation => ({ id: allocation.destinationId as string, label: allocation.destinationLabel })))].filter((item, index, values) => values.findIndex(candidate => candidate.id === item.id) === index);
      const storedDraft = stored ? JSON.parse(stored) as Record<string, string> : {};
      const reconciled = reconcilePortionDraft(storedDraft, entries, destinations);
      hydratedDraftKey.current = draftStorageKey;
      setDraftValues(reconciled);
      if (Object.keys(reconciled).length) window.localStorage.setItem(draftStorageKey, JSON.stringify(reconciled));
      else window.localStorage.removeItem(draftStorageKey);
    } catch { hydratedDraftKey.current = draftStorageKey; setDraftValues({}); window.localStorage.removeItem(draftStorageKey); }
  }, [draftStorageKey, snapshot, selectedDayId, oplocs]);
  useEffect(() => {
    if (!draftStorageKey || hydratedDraftKey.current !== draftStorageKey) return;
    if (Object.keys(draftValues).length) window.localStorage.setItem(draftStorageKey, JSON.stringify(draftValues));
    else window.localStorage.removeItem(draftStorageKey);
  }, [draftStorageKey, draftValues]);
  useEffect(() => {
    if (!snapshot || !selectedDayId) return;
    let active = true;
    setBlockers([]);
    const key = `${snapshot.week.id}:${snapshot.week.version}:${selectedDayId}`;
    void loadPublicationReadiness(key, async () => {
      const response = await fetch(`/api/rolling-menu?weekId=${encodeURIComponent(snapshot.week.id)}&dayId=${encodeURIComponent(selectedDayId)}&publicationPreview=true`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || "Publication readiness is unavailable.");
      // This screen is scoped to the selected day. Week-level blockers can
      // describe another service day and falsely block an otherwise valid
      // day preview (for example an intentionally blank bank holiday).
      return Array.isArray(body.dayBlockers) ? body.dayBlockers : [];
    }).then(nextBlockers => {
      if (!active) return;
      setBlockers(nextBlockers);
      setError("");
    }).catch(cause => {
      if (active) setBlockers([cause instanceof Error ? cause.message : "Readiness could not be checked."]);
    });
    return () => { active = false; };
  }, [snapshot?.week.id, selectedDayId, snapshot?.week.version, readinessRefresh, setError]);
  if (!snapshot) return <MenuPlanningShell section="Portion Planner"><div className="menu-loading">Loading Portion Planner…</div></MenuPlanningShell>;
  const day = snapshot.days.find(item => item.id === selectedDayId) || snapshot.days[0]; const entries = orderPortionPlannerEntries(snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim()));
  const allDestinations: Destination[] = [...oplocs.map(item => ({ id: item.canonicalId, label: item.label, address: item.address })), ...(day.oneOffDestinations || []).map(item => ({ id: `oneoff:${item.id}`, label: item.label, address: item.address, oneOff: true })), ...entries.flatMap(entry => entry.allocations.filter(allocation => allocation.destinationId && !oplocs.some(item => item.canonicalId === allocation.destinationId)).map(allocation => ({ id: allocation.destinationId as string, label: allocation.destinationLabel, address: allocation.destinationAddress })))].filter((item, index, values) => values.findIndex(candidate => candidate.id === item.id) === index).sort((a, b) => a.label.localeCompare(b.label));
  const explicitlyAdded = new Set((params.get("dest") || "").split(",").filter(Boolean)); const activeIds = new Set([...explicitlyAdded, ...allDestinations.filter(destination => entries.some(entry => entry.allocations.some(allocation => allocationMatchesPortionDestination(allocation, destination)))).map(destination => destination.id), ...allDestinations.filter(destination => destination.oneOff).map(destination => destination.id)]); const destinations = showAll ? allDestinations : allDestinations.filter(destination => activeIds.has(destination.id)); const state = publicationState[day.id];
  const valueFor = (entry: typeof entries[number], destination: Destination) => draftValues[`${entry.id}|${destination.id}`] ?? String(persistedPortionValue(entry, destination) || "");
  const editDraftValue = (entry: typeof entries[number], destination: Destination, raw: string) => setDraftValues(current => { const key = `${entry.id}|${destination.id}`; const next = { ...current }; if (draftValueMatchesPersisted(raw, entry, destination)) delete next[key]; else next[key] = raw; return next; });
  const addDestination = (id: string) => { const next = new URLSearchParams(params.toString()); next.set("dest", [...explicitlyAdded, id].filter((value, index, values) => values.indexOf(value) === index).join(",")); window.history.replaceState(null, "", `?${next}`); };
  const saveChanges = async () => {
    if (saving || !Object.keys(draftValues).length) return;
    if (Object.values(draftValues).some(raw => raw.trim() !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0))) {
      setError("Portion values must be zero or a positive finite number.");
      return;
    }
    setSaving(true);
    try {
      const touched = new Set(Object.keys(draftValues).map(key => key.split("|")[0]));
      const updates = entries.filter(item => touched.has(item.id)).map(entry => {
        let allocations = entry.allocations.slice();
        for (const destination of allDestinations.filter(item => Object.prototype.hasOwnProperty.call(draftValues, `${entry.id}|${item.id}`))) {
          const raw = draftValues[`${entry.id}|${destination.id}`].trim();
          const value = raw === "" ? 0 : Number(raw);
          if (!Number.isFinite(value) || value < 0) continue;
          allocations = allocations.filter(allocation => !allocationMatchesPortionDestination(allocation, destination));
          if (value > 0 && Number.isFinite(value)) allocations.push({ ...(destination.oneOff ? { oneOffDestinationId: destination.id.replace(/^oneoff:/, "") } : { destinationId: destination.id }), destinationLabel: destination.label, ...(destination.address ? { destinationAddress: destination.address } : {}), quantity: value, sourceLabel: destination.label });
        }
        return { entryId: entry.id, dayId: entry.dayId, allocations };
      });
      const saved = await command("batch-update-entries", { weekId: snapshot.week.id, expectedWeekVersion: snapshot.week.version, updates });
      if (saved) { setDraftValues({}); setReadinessRefresh(value => value + 1); }
    } finally { setSaving(false); }
  };
  const addOneOff = async () => { const saved = await command("add-one-off-destination", { weekId: snapshot.week.id, dayId: day.id, label: oneOffName, address: oneOffAddress }); if (saved) { setOneOffName(""); setOneOffAddress(""); setOneOffOpen(false); } };
  const publish = async () => { setPublishing(true); try { await command("publish", { weekId: snapshot.week.id }); } finally { setPublishing(false); } };
  const withdraw = async () => { setWithdrawError(""); const publicationId = state?.currentPublicationId || state?.currentPublicationDayId?.split(":v")[0] || state?.currentPublicationDayId?.split(":day:")[0]; if (!publicationId) { setWithdrawError("The current publication could not be identified. Refresh and try again."); return; } const response = await fetch("/api/rolling-menu/publications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "withdraw-week", publicationId, reason: withdrawReason }) }); const body = await response.json(); if (!response.ok) { setWithdrawError(body.error?.message || "Could not withdraw publication."); return; } const refreshed = await refreshWeek(snapshot.week.id); if (!refreshed) { setWithdrawError("The week was withdrawn, but its current state could not be refreshed. Reload to verify the withdrawal."); return; } setWithdrawOpen(false); setWithdrawReason(""); };
  const resizeDishPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeStart.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: dishWidthRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeDishPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateDishColumnWidth(start.startWidth + event.clientX - start.startX);
  };
  const finishDishResize = (pointerId: number) => {
    if (resizeStart.current?.pointerId !== pointerId) return;
    resizeStart.current = null;
    saveDishColumnWidth();
  };
  const resizeDishKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 40 : 16;
    let next: number | undefined;
    if (event.key === "ArrowLeft") next = dishColumnWidth - step;
    else if (event.key === "ArrowRight") next = dishColumnWidth + step;
    else if (event.key === "Home") next = MIN_PORTION_DISH_WIDTH;
    else if (event.key === "End") next = dishColumnMax;
    if (next === undefined) return;
    event.preventDefault();
    saveDishColumnWidth(updateDishColumnWidth(next));
  };
  const portionTableMinimum = dishColumnWidth + destinations.length * PORTION_DESTINATION_WIDTH + PORTION_TOTAL_WIDTH;
  const portionTableStyle = { "--portion-dish-column-width": `${dishColumnWidth}px`, minWidth: `${portionTableMinimum}px` } as CSSProperties;
  return <MenuPlanningShell section="Portion Planner"><section className="workspace-intro planner-intro"><small>Delivered-In · {day.dayName}</small><h2>Portion Planner</h2><p>Active destinations are shown by default. Add another governed Delivered-In OPLOC when required.</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} days={snapshot.days} showDay /><HotForkBuffetDemand weekId={snapshot.week.id} weekVersion={snapshot.week.version} weekCommencing={snapshot.week.weekCommencing} weekEnding={snapshot.week.weekEnding} demandSnapshots={snapshot.week.hospitalityDemandAllocations} portionQuantities={snapshot.entries.flatMap(entry => entry.allocations.map(allocation => ({ serviceDate: entry.date, entryId: entry.id, oplocId: allocation.destinationId || "", quantity: allocation.quantity })))} allowAllocationConfirm hasUnsavedPortions={Object.keys(draftValues).length > 0 || saving} onConfirmed={() => void refreshWeek(snapshot.week.id)} /><div className="planner-toolbar"><span>{destinations.length} active destination{destinations.length === 1 ? "" : "s"}</span>{message && <span role="status">{message}</span>}<button className="button button-soft" type="button" onClick={() => setShowAll(value => !value)}>{showAll ? "Show active only" : "Show all destinations"}</button><button className="button button-soft" type="button" onClick={() => setOneOffOpen(true)}>+ Add one-off location</button><button className="button button-soft" type="button" onClick={() => setDuplicateOpen(true)}>Duplicate planning</button><label className="destination-add">Add destination<select value="" onChange={event => event.target.value && addDestination(event.target.value)}><option value="">Choose OPLOC…</option>{allDestinations.filter(item => !activeIds.has(item.id)).map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label></div>{error && <div className="menu-error" role="alert">{error}</div>}<PublicationHandoffStatus key={snapshot.week.id} weekId={snapshot.week.id} version={snapshot.week.version} initial={handoff?.weekId === snapshot.week.id ? handoff.value : undefined} /><PublicationReadiness state={state} blockers={blockers} dayName={day.dayName} onPublish={publish} publishing={publishing} hasUnsavedChanges={Object.keys(draftValues).length > 0} onWithdraw={() => setWithdrawOpen(true)} />{!entries.length ? <section className="workspace-panel"><div className="empty-state"><h3>No menu planned for {day.dayName}.</h3><p>Choose {day.dayName}'s dishes in Week Planner before entering portions.</p><a className="button button-purple" href="/">Open Week Planner</a></div></section> : <section className="workspace-panel portion-panel"><div className="portion-actions"><span>{Object.keys(draftValues).length ? "Unsaved changes" : "All changes saved"}</span><div><button type="button" className="button button-soft" disabled={!Object.keys(draftValues).length || saving} onClick={() => setDraftValues({})}>Discard</button><button type="button" className="button button-purple" disabled={!Object.keys(draftValues).length || saving} onClick={() => void saveChanges()}>{saving ? "Saving…" : "Save changes"}</button></div></div><div className="table-wrap" ref={portionTableWrap}><table className="portion-matrix" style={portionTableStyle} data-dish-column-width={dishColumnWidth}><colgroup><col className="portion-dish-column" />{destinations.map(destination => <col className="portion-destination-column" key={destination.id} />)}<col className="portion-total-column" /></colgroup><thead><tr><th scope="col" className="portion-dish-heading"><span>Dish</span><button type="button" className="portion-column-resize" role="separator" aria-orientation="vertical" aria-label="Resize Dish column" aria-valuemin={MIN_PORTION_DISH_WIDTH} aria-valuemax={dishColumnMax} aria-valuenow={dishColumnWidth} aria-valuetext={`${dishColumnWidth} pixels`} title="Drag to resize or use Left and Right Arrow keys" onPointerDown={resizeDishPointerDown} onPointerMove={resizeDishPointerMove} onPointerUp={event => finishDishResize(event.pointerId)} onPointerCancel={event => finishDishResize(event.pointerId)} onLostPointerCapture={event => finishDishResize(event.pointerId)} onKeyDown={resizeDishKeyDown}><span className="portion-column-resize-grip" aria-hidden="true" /></button></th>{destinations.map(destination => <th scope="col" key={destination.id} title={destination.address}>{destination.label}{destination.oneOff && <small>{destination.address ? "One-off" : "Address pending"}</small>}</th>)}<th scope="col">Total</th></tr></thead><tbody>{entries.map((entry, rowIndex) => <tr key={entry.id} className={entry.isCoreSalad ? "core-salad-row" : undefined} style={entry.isCoreSalad ? { background: "var(--fika-status-success-surface)" } : undefined}><th scope="row" className="portion-dish-cell"><span className="portion-dish-name" title={entry.itemLabel}>{entry.itemLabel}</span>{entry.isCoreSalad && <span className="core-salad-label">CORE SALAD</span>}<small>{entry.slot}</small></th>{destinations.map((destination, columnIndex) => <td key={destination.id}><input data-portion-row={rowIndex} data-portion-column={columnIndex} aria-label={`${entry.itemLabel} portions for ${destination.label}${destination.oneOff ? " (one-off)" : ""}`} type="number" min="0" value={valueFor(entry, destination)} onChange={event => editDraftValue(entry, destination, event.target.value)} onKeyDown={event => handlePortionKeyDown(event, rowIndex, columnIndex)} /></td>)}<td><strong>{destinations.reduce((sum, destination) => sum + (Number(valueFor(entry, destination)) || 0), 0)}</strong></td></tr>)}<tr className="portion-total-row"><th scope="row" className="portion-dish-cell"><span className="portion-dish-name">Destination total</span></th>{destinations.map(destination => <td key={destination.id}><strong>{entries.reduce((sum, entry) => sum + (Number(valueFor(entry, destination)) || 0), 0)}</strong></td>)}<td><strong>{entries.reduce((sum, entry) => sum + destinations.reduce((total, destination) => total + (Number(valueFor(entry, destination)) || 0), 0), 0)}</strong></td></tr></tbody></table></div></section>}{oneOffOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOneOffOpen(false); }}><aside className="item-detail" role="dialog" aria-modal="true" aria-label="Add one-off location"><header><div><small>Day-specific logistics destination</small><h3>Add one-off location</h3></div><button type="button" className="modal-close" onClick={() => setOneOffOpen(false)} aria-label="Close">Close</button></header><label>Location name<input autoFocus value={oneOffName} onChange={event => setOneOffName(event.target.value)} placeholder="e.g. Client event venue" /></label><label>Delivery address (optional)<textarea value={oneOffAddress} onChange={event => setOneOffAddress(event.target.value)} placeholder="Enter the address if known" rows={4} /></label><p className="form-help">Logistics can confirm a missing address before assignment. To update this one-off in Menu Planning, enter its recorded name and address. Saved portions stay attached.</p><footer className="form-actions"><button type="button" className="button button-soft" onClick={() => setOneOffOpen(false)}>Cancel</button><button type="button" className="button button-mint" disabled={!oneOffName.trim()} onClick={() => void addOneOff()}>Save one-off location</button></footer></aside></div>}{duplicateOpen && <DuplicatePlanningModal origin="portion" weeks={weeks} currentWeek={{ id: snapshot.week.id, weekCommencing: snapshot.week.weekCommencing, version: snapshot.week.version }} dayNames={snapshot.days.slice(0, 5).map(item => item.dayName)} selectedDayIndex={Math.max(0, snapshot.days.slice(0, 5).findIndex(item => item.id === day.id))} onApplied={() => refreshWeek(snapshot.week.id)} onClose={() => setDuplicateOpen(false)} />}{withdrawOpen && <div className="modal-backdrop" role="presentation"><aside className="item-detail" role="dialog" aria-modal="true" aria-label="Withdraw publication"><header><div><small>Published menu</small><h3>Withdraw week</h3></div><button type="button" className="modal-close" onClick={() => setWithdrawOpen(false)}>Close</button></header><label>Reason required<textarea autoFocus value={withdrawReason} onChange={event => setWithdrawReason(event.target.value)} rows={4} placeholder="Explain why this publication is being withdrawn" /></label>{withdrawError && <p className="menu-error" role="alert">{withdrawError}</p>}<footer className="form-actions"><button type="button" className="button button-soft" onClick={() => setWithdrawOpen(false)}>Cancel</button><button type="button" className="button button-purple" disabled={!withdrawReason.trim()} onClick={() => void withdraw()}>Withdraw publication</button></footer></aside></div>}</MenuPlanningShell>;
}

function handlePortionKeyDown(event: KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
  if (event.key === "Enter") { event.currentTarget.blur(); return; }
  const deltas: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const delta = deltas[event.key];
  if (!delta) return;
  const target = event.currentTarget.closest("table")?.querySelector<HTMLInputElement>(`input[data-portion-row="${rowIndex + delta[0]}"][data-portion-column="${columnIndex + delta[1]}"]`);
  if (!target) return;
  event.preventDefault();
  target.focus();
  revealPortionInput(target);
  target.select();
}

function readableBlockers(blockers: string[]) {
  const sentences = blockers.flatMap(item => item.split(/(?<=\.)\s+/).map(sentence => sentence.trim()).filter(Boolean));
  const destinationDishes = sentences.filter(item => item.includes("has an unresolved destination")).map(item => item.replace(/ has an unresolved destination.*$/, ""));
  const portionDishes = sentences.filter(item => item.includes("needs a positive finite portion total")).map(item => item.replace(/ needs a positive finite portion total\.$/, ""));
  const allocationDishes = sentences.filter(item => item.includes("needs at least one destination allocation")).map(item => item.replace(/ needs at least one destination allocation\.$/, ""));
  const messages: string[] = [];
  if (destinationDishes.length) messages.push(`Choose a named destination for: ${destinationDishes.join(", ")}.`);
  const missingPortionsAndDestinations = portionDishes.filter(item => allocationDishes.includes(item));
  if (missingPortionsAndDestinations.length) messages.push(`Enter portions and choose a destination for: ${missingPortionsAndDestinations.join(", ")}.`);
  const onlyPortions = portionDishes.filter(item => !missingPortionsAndDestinations.includes(item));
  if (onlyPortions.length) messages.push(`Enter a positive portion total for: ${onlyPortions.join(", ")}.`);
  const onlyAllocations = allocationDishes.filter(item => !missingPortionsAndDestinations.includes(item));
  if (onlyAllocations.length) messages.push(`Choose at least one destination for: ${onlyAllocations.join(", ")}.`);
  sentences.filter(item => !item.includes("unresolved destination") && !item.includes("positive finite portion total") && !item.includes("at least one destination allocation")).forEach(item => {
    const allergen = item.match(/^(\d+) menu entries? need an explicit allergen review\.$/);
    if (allergen) messages.push(`Review allergens for ${allergen[1]} menu ${Number(allergen[1]) === 1 ? "entry" : "entries"}.`);
    else if (item.includes("allocation total")) messages.push("Destination quantities must add up to each dish total; blank OPLOC cells are allowed.");
    else if (item.includes("canonical dish identity")) messages.push("Select a saved dish for every populated menu row.");
    else messages.push(item);
  });
  return [...new Set(messages)];
}

function PublicationReadiness({ state, blockers, dayName, onPublish, publishing, hasUnsavedChanges, onWithdraw }: { state?: { currentPublicationId?: string; currentVersion?: number; hasCurrentPublication: boolean; hasUnpublishedChanges: boolean; status: string; currentPublicationDayId?: string }; blockers: string[]; dayName: string; onPublish: () => void; publishing: boolean; hasUnsavedChanges: boolean; onWithdraw: () => void }) { const published = Boolean(state?.hasCurrentPublication); const changed = Boolean(state?.hasUnpublishedChanges); const readable = readableBlockers(blockers); return <section className={`publication-readiness publication-readiness--${published ? changed ? "changed" : "published" : blockers.length ? "blocked" : "ready"}`}><div><small>Weekly publication · {dayName} view</small><strong>{published ? `Published v${state?.currentVersion || 1}${changed ? " · Unpublished changes" : " ✓"}` : blockers.length ? "Week not ready to publish" : "Week ready to publish"}</strong>{hasUnsavedChanges && <p>Unsaved changes — save before publishing.</p>}{readable.length > 0 && (!published || changed) && <ul>{readable.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}</div><div className="publication-actions">{published && changed && <button type="button" className="button button-purple" disabled={Boolean(blockers.length) || publishing || hasUnsavedChanges} onClick={onPublish}>{publishing && <span className="action-spinner" aria-hidden="true" />}{publishing ? "Publishing week…" : "Publish week amendment"}</button>}{!published && <button type="button" className="button button-purple" disabled={Boolean(blockers.length) || publishing || hasUnsavedChanges} onClick={onPublish}>{publishing && <span className="action-spinner" aria-hidden="true" />}{publishing ? "Publishing week…" : "Publish whole week"}</button>}{published && <button type="button" className="button button-soft" onClick={onWithdraw}>Withdraw week</button>}</div></section>; }
