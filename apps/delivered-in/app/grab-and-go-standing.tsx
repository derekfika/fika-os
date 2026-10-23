"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DELIVERY_WEEKDAYS, productsForDeliveryDate, representativeDeliveryDate, type GrabAndGoProduct } from "../lib/grab-and-go";
import { STANDING_MAX_QUANTITY, STANDING_WEEKS, configuredSlotCount, slotKey, type OccurrenceState, type StandingLine, type StandingOperation, type StandingSlots, type StandingStatus, type StandingVersion } from "../lib/grab-and-go-standing";
import { mapStandingSlotProducts, type StandingSlotProductMapping } from "../lib/grab-and-go-standing-copy";
import type { StandingMutationResult, StandingOverview, UpcomingDelivery } from "../lib/grab-and-go-standing-service";

type Props = { oplocId: string; catalogue: GrabAndGoProduct[]; cutoffHour: number; onChanged: () => void; refreshToken: number };
type Quantities = Record<string, Record<string, number>>;
type Confirm = { kind: "activate" | "pause" | "terminate" | "resume" | "cancel-upcoming" | "generate"; invoker: HTMLElement | null; deliveryDate?: string };
type SlotCopyPair = { sourceKey: string; targetKey: string };
type SlotCopyPreview = { sourceKey: string; targetKey: string; mappings: StandingSlotProductMapping[] };
type CopyPlan = { title: string; copies: SlotCopyPreview[]; overwriteKeys: string[] };
type Clipboard = { sourceKey: string; quantities: Record<string, number> };

const API = "/api/delivered-in/grab-and-go/standing-orders";
const STATUS_LABEL: Record<StandingStatus | "none", string> = { none: "Not set up", draft: "Draft", active: "Active", paused: "Paused", terminated: "Terminated" };
const STATUS_HELP: Record<StandingStatus | "none", string> = {
  none: "Set quantities for any Monday or Wednesday in the four-week rotation, save a draft, then activate it. Nothing is ordered until you activate.",
  draft: "This draft is not ordering anything yet. Activate it when the quantities are right.",
  active: "Orders are generated automatically: Monday 12:01 for Wednesday, Thursday 12:01 for the following Monday (London time). Each order stays editable until its cut-off.",
  paused: "Pausing stops future automatic generation only. Orders already created stay in place; cancel them separately if you do not want them.",
  terminated: "This standing order has ended. Start a new draft to set one up again; the history is kept.",
};
const OCCURRENCE_LABEL: Record<OccurrenceState, string> = {
  generate: "Due · not created yet", scheduled: "Scheduled", "in-sync": "Automatic order · up to date", sync: "Will update to the standing order", "manual-order": "Manual order · standing order not applied",
  cancelled: "Cancelled · not recreated", "unavailable-lines": "Needs attention", "slot-removed": "Will be withdrawn", "no-slot": "No standing quantity set", "not-active": "Standing order not active", missed: "Not generated · cut-off passed", "cutoff-passed": "Cut-off has passed",
};
const HANDOFF_LABEL: Record<string, string> = { delivered: "Sent to CPU", pending: "Pending · not yet in CPU", "intervention-required": "Needs administrator review", "not-staged": "Not yet sent", "not-tracked": "Not tracked in this environment" };
const displayDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const displayTime = (value: string) => new Date(value).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const total = (lines: Array<{ quantity: number }>) => lines.reduce((sum, line) => sum + line.quantity, 0);
const toQuantities = (slots: StandingSlots): Quantities => Object.fromEntries(Object.entries(slots).map(([key, lines]) => [key, Object.fromEntries(lines.map(line => [line.productId, line.quantity]))]));
const toSlots = (quantities: Quantities): StandingSlots => Object.fromEntries(Object.entries(quantities).map(([key, byProduct]) => [key, Object.entries(byProduct).filter(([, quantity]) => quantity > 0).map(([productId, quantity]): StandingLine => ({ productId, quantity }))]).filter(([, lines]) => (lines as StandingLine[]).length));
const sameQuantities = (a: Quantities, b: Quantities) => JSON.stringify(Object.entries(toSlots(a)).sort()) === JSON.stringify(Object.entries(toSlots(b)).sort());

async function request(method: "GET" | "POST", body?: unknown, oplocId?: string, url?: string) {
  const response = await fetch(url || (method === "GET" ? `${API}?oplocId=${encodeURIComponent(oplocId || "")}` : API), { method, cache: "no-store", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || "The standing order could not be loaded."), { status: response.status });
  return payload;
}

/** Plain-language outcome of a mutation. Success is only claimed when every change reached CPU. */
function describe(result: StandingMutationResult, success: string) {
  const items = result.reconcile?.items || []; const count = (...outcomes: string[]) => items.filter(item => outcomes.includes(item.outcome)).length;
  const sent = items.filter(item => ["created", "amended", "cancelled"].includes(item.outcome) && item.handoff === "delivered").length;
  const pending = items.filter(item => ["created", "amended", "cancelled"].includes(item.outcome) && item.handoff !== "delivered").length;
  const failed = items.filter(item => ["error", "template-changed", "unavailable-lines"].includes(item.outcome));
  const parts = [count("created") ? `${count("created")} created` : "", count("amended") ? `${count("amended")} updated` : "", count("cancelled") ? `${count("cancelled")} cancelled` : ""].filter(Boolean).join(", ");
  const problems = [pending ? `${pending} order change${pending === 1 ? " is" : "s are"} recorded but not yet in CPU. Use “Retry production update” on the delivery below.` : "", ...failed.map(item => `${displayDate(item.deliveryDate)}: ${item.message || item.outcome}`), result.reconcileError ? `Synchronising orders failed: ${result.reconcileError}` : "", result.auditError ? "The action succeeded but its audit note could not be saved." : ""].filter(Boolean);
  const ok = problems.length === 0;
  return { ok, notice: ok ? [success, parts ? `${parts}${sent ? ` (${sent} confirmed in CPU)` : ""}.` : ""].filter(Boolean).join(" ") : `Recorded, but not complete${parts ? ` (${parts})` : ""}. See what needs attention.`, problems };
}

export default function GrabAndGoStandingOrders({ oplocId, catalogue, cutoffHour, onChanged, refreshToken }: Props) {
  const [overview, setOverview] = useState<StandingOverview>(); const [quantities, setQuantities] = useState<Quantities>({}); const [saved, setSaved] = useState<Quantities>({});
  const [selected, setSelected] = useState<string>(slotKey(1, "Monday")); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [problems, setProblems] = useState<string[]>([]); const [confirm, setConfirm] = useState<Confirm>();
  const [clipboard, setClipboard] = useState<Clipboard>(); const [copyPlan, setCopyPlan] = useState<CopyPlan>(); const [copyMessage, setCopyMessage] = useState("");
  const [copyWeek, setCopyWeek] = useState("2"); const [referenceWeek, setReferenceWeek] = useState("1");
  const head = overview?.standingOrder || undefined; const status: StandingStatus | "none" = head?.status || "none"; const dirty = !sameQuantities(quantities, saved);

  const load = useCallback(async (keepEdits = false) => {
    try {
      const next = await request("GET", undefined, oplocId) as StandingOverview; setOverview(next); setError("");
      if (!keepEdits) { const loaded = toQuantities(next.standingOrder?.slots || {}); setQuantities(loaded); setSaved(loaded); }
    } catch (cause) { setError((cause as Error).message); }
  }, [oplocId]);
  useEffect(() => { void load(); }, [load, refreshToken]);

  const act = async (action: string, extra: Record<string, unknown> = {}, success = "") => {
    setBusy(true); setError(""); setNotice(""); setProblems([]);
    try {
      let version = head?.version;
      if (dirty && ["activate", "resume"].includes(action)) { // save the edits first so the activated version is exactly what is on screen
        const savedResult = await request("POST", { oplocId, action: "save", expectedVersion: version, slots: toSlots(quantities) }) as StandingMutationResult; version = savedResult.standingOrder.version;
      }
      const result = await request("POST", { oplocId, action, expectedVersion: version, ...extra, ...(action === "save" ? { slots: toSlots(quantities) } : {}) }) as StandingMutationResult;
      const outcome = describe(result, success || "Saved."); setNotice(outcome.notice); setProblems(outcome.problems);
      await load(); onChanged();
    } catch (cause) { setError((cause as Error).message); if ((cause as { status?: number }).status === 409) await load(); } finally { setBusy(false); setConfirm(undefined); }
  };
  const retryHandoff = async (item: UpcomingDelivery) => {
    if (!item.order) return; setBusy(true); setError(""); setNotice(""); setProblems([]);
    try { const result = await request("POST", { oplocId, deliveryDate: item.deliveryDate, action: "retry-handoff", expectedVersion: item.order.version }, undefined, "/api/delivered-in/grab-and-go"); if (result.handoff === "delivered") setNotice(`${displayDate(item.deliveryDate)}: CPU has been updated.`); else setProblems([`${displayDate(item.deliveryDate)}: CPU has not been updated yet (${result.handoff}). It keeps retrying automatically; check again shortly.`]); await load(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };

  const productsForSlot = useCallback((key: string) => {
    const [week, weekday] = key.split(":");
    return productsForDeliveryDate(catalogue, representativeDeliveryDate(Number(week), weekday as typeof DELIVERY_WEEKDAYS[number]));
  }, [catalogue]);
  const slotProducts = useMemo(() => selected ? productsForSlot(selected) : [], [productsForSlot, selected]);
  if (!overview) return <div className="empty-state" role={error ? "alert" : "status"}><p>{error || "Loading standing orders…"}</p></div>;
  const editable = status !== "terminated"; const configured = configuredSlotCount(toSlots(quantities));
  const setQuantity = (productId: string, quantity: number) => { if (!selected) return; setCopyPlan(undefined); setQuantities(current => ({ ...current, [selected]: { ...current[selected], [productId]: quantity } })); };
  const prepareCopy = (pairs: SlotCopyPair[], title: string, sourceOverrides: Record<string, Record<string, number>> = {}) => {
    if (!pairs.length) { setCopyMessage("There are no eligible empty rotation slots to fill."); setCopyPlan(undefined); return; }
    const copies: SlotCopyPreview[] = [];
    for (const pair of pairs) {
      if (pair.sourceKey === pair.targetKey) { setCopyMessage("Choose a different rotation slot for the copy."); setCopyPlan(undefined); return; }
      const source = sourceOverrides[pair.sourceKey] || quantities[pair.sourceKey] || {};
      const mapping = mapStandingSlotProducts(productsForSlot(pair.sourceKey), productsForSlot(pair.targetKey), source);
      if (!mapping.ok) { setCopyMessage(`${pair.targetKey.replace(":", " · ")}: ${mapping.reason}`); setCopyPlan(undefined); return; }
      copies.push({ ...pair, mappings: mapping.mappings });
    }
    const overwriteKeys = copies.filter(copy => Object.values(quantities[copy.targetKey] || {}).some(quantity => quantity > 0)).map(copy => copy.targetKey);
    setCopyMessage(""); setCopyPlan({ title, copies, overwriteKeys });
  };
  const copySelectedDay = () => {
    if (!selected) return;
    setClipboard({ sourceKey: selected, quantities: { ...(quantities[selected] || {}) } }); setCopyPlan(undefined);
    setCopyMessage(`Copied Week ${selected.replace(":", " · ")} quantities locally. Select another slot, then preview the mapping.`);
  };
  const applyCopy = () => {
    if (!copyPlan) return;
    setQuantities(current => {
      const next = { ...current };
      for (const copy of copyPlan.copies) next[copy.targetKey] = Object.fromEntries(copy.mappings.map(mapping => [mapping.targetProductId, mapping.quantity]));
      return next;
    });
    setCopyMessage(`Copied quantities into ${copyPlan.copies.length} rotation slot${copyPlan.copies.length === 1 ? "" : "s"}. Changes are unsaved.`); setCopyPlan(undefined);
  };
  const open = (kind: Confirm["kind"], deliveryDate?: string) => (event: React.MouseEvent<HTMLButtonElement>) => setConfirm({ kind, invoker: event.currentTarget, deliveryDate });
  const outstandingAutomatic = overview.upcoming.filter(item => item.order?.control === "automatic" && item.order.editable);
  const next = overview.schedule.nextGenerations[0];
  const selectedParts = selected?.split(":") || [];
  const selectedWeek = Number(selectedParts[0] || 1);
  const selectedDay = selectedParts[1] as typeof DELIVERY_WEEKDAYS[number] | undefined;

  return <div className="standing-panel">
    <section className="standing-status" aria-labelledby="standing-heading">
      <div><h2 id="standing-heading">Standing order</h2><p>{STATUS_HELP[status]}</p>
        {status === "active" && next && <p className="standing-meta">Next generation: {displayTime(next.generationAt)} (London) for {displayDate(next.deliveryDate)}.</p>}
        {head && <p className="standing-meta">Version {head.version} · updated {displayTime(head.updatedAt)} by {head.updatedBy}</p>}</div>
      <span className={`standing-chip standing-chip-${status}`}><span aria-hidden="true">{status === "active" ? "●" : status === "paused" ? "Ⅱ" : status === "terminated" ? "■" : "○"}</span> {STATUS_LABEL[status]}</span>
    </section>
    {error && <p className="grab-error" role="alert">{error}</p>}
    {problems.length > 0 && <div className="grab-error" role="alert"><strong>Needs attention</strong><ul>{problems.map(problem => <li key={problem}>{problem}</li>)}</ul></div>}
    {notice && <p className={problems.length ? "grab-handoff-notice" : "standing-success"} role="status">{notice}</p>}
    <section className="standing-section" aria-labelledby="rotation-heading">
      <header><h3 id="rotation-heading">Four-week quantities</h3><p>Select a day to edit. Monday and Wednesday remain independent; empty slots never generate orders.</p></header>
      <div className="standing-workspace">
        <div className="standing-overview">
          <div className="standing-table-wrap" role="region" aria-label="Rotation quantities" tabIndex={0}>
            <table className="standing-table"><caption className="visually-hidden">Standing quantities for each Monday and Wednesday of the four-week rotation</caption>
              <thead><tr><th scope="col">Week</th>{DELIVERY_WEEKDAYS.map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
              <tbody>{STANDING_WEEKS.map(week => <tr key={week}><th scope="row">{week}</th>{DELIVERY_WEEKDAYS.map(day => { const key = slotKey(week, day); const count = total(Object.entries(quantities[key] || {}).map(([, quantity]) => ({ quantity }))); return <td key={day}>
                <button type="button" className={`standing-slot${selected === key ? " selected" : ""}`} aria-pressed={selected === key} disabled={!editable || busy} onClick={() => setSelected(key)} aria-label={`Edit Week ${week} ${day} standing quantities, ${count ? `${count} items` : "not set"}`}>
                  <strong>{count ? `${count} items` : "Not set"}</strong><small>{count ? `${Object.values(quantities[key] || {}).filter(quantity => quantity > 0).length} products` : "No order"}</small></button></td>; })}</tr>)}</tbody></table>
          </div>
          <p className="standing-overview-note">Copy quantities once, review the product mapping, then save all slot changes together.</p>
        </div>
        {selected && <div className="standing-edit-column">
          <div className="standing-editor" role="group" aria-labelledby="editor-heading">
            <header><h4 id="editor-heading">Week {selectedWeek} · {selectedDay}</h4><button type="button" className="secondary-button" disabled={busy || !editable} onClick={() => { setQuantities(current => ({ ...current, [selected]: {} })); setCopyPlan(undefined); }}>Clear day</button></header>
            {slotProducts.length === 0 ? <p className="grab-copy-note">The catalogue offers no products for this rotation day.</p> : <div className="grab-product-list">{slotProducts.map(product => { const quantity = quantities[selected]?.[product.productId] || 0; return <div className="grab-product-row" key={product.productId}><span className="product-mark" aria-hidden="true">✦</span><strong>{product.name}<small>{product.category === "grab_250ml" ? "250ml pot" : "750ml pot"}</small></strong><div className="grab-quantity"><input aria-label={`Quantity of ${product.name}`} type="number" min={0} max={STANDING_MAX_QUANTITY} step={1} inputMode="numeric" value={quantity} disabled={busy || !editable} onChange={event => { const value = event.currentTarget.value === "" ? 0 : Number(event.currentTarget.value); if (Number.isInteger(value) && value >= 0 && value <= STANDING_MAX_QUANTITY) setQuantity(product.productId, value); }} /></div></div>; })}</div>}
            {editable && <div className="standing-copy-tools" aria-label="Copy quantities">
              <div className="standing-copy-row"><button type="button" className="secondary-button" disabled={busy || !total(Object.entries(quantities[selected] || {}).map(([, quantity]) => ({ quantity })))} onClick={copySelectedDay}>Copy this day</button>
                {clipboard && clipboard.sourceKey !== selected && <button type="button" className="secondary-button" disabled={busy} onClick={() => prepareCopy([{ sourceKey: clipboard.sourceKey, targetKey: selected }], `Paste Week ${clipboard.sourceKey.replace(":", " · ")} into Week ${selected.replace(":", " · ")}`, { [clipboard.sourceKey]: clipboard.quantities })}>Preview paste</button>}
              </div>
              {selectedDay && <div className="standing-copy-row"><button type="button" className="secondary-button" disabled={busy || !total(Object.entries(quantities[selected] || {}).map(([, quantity]) => ({ quantity })))} onClick={() => prepareCopy(STANDING_WEEKS.filter(week => week !== selectedWeek).map(week => ({ sourceKey: selected, targetKey: slotKey(week, selectedDay) })), `Copy Week ${selectedWeek} ${selectedDay} to the other ${selectedDay}s`)}>Copy to other {selectedDay}s</button>
                <label>Copy week to <select aria-label="Target rotation week" value={copyWeek} onChange={event => setCopyWeek(event.target.value)}>{STANDING_WEEKS.filter(week => week !== selectedWeek).map(week => <option key={week} value={week}>Week {week}</option>)}</select></label>
                <button type="button" className="secondary-button" disabled={busy || !DELIVERY_WEEKDAYS.some(day => total(Object.entries(quantities[slotKey(selectedWeek, day)] || {}).map(([, quantity]) => ({ quantity }))) > 0)} onClick={() => prepareCopy(DELIVERY_WEEKDAYS.map(day => ({ sourceKey: slotKey(selectedWeek, day), targetKey: slotKey(Number(copyWeek), day) })), `Copy Week ${selectedWeek} into Week ${copyWeek}`)}>Preview week copy</button></div>}
              <div className="standing-copy-row"><label>Reference week <select aria-label="Reference rotation week" value={referenceWeek} onChange={event => setReferenceWeek(event.target.value)}>{STANDING_WEEKS.map(week => <option key={week} value={week}>Week {week}</option>)}</select></label>
                <button type="button" className="secondary-button" disabled={busy || !DELIVERY_WEEKDAYS.some(day => total(Object.entries(quantities[slotKey(Number(referenceWeek), day)] || {}).map(([, quantity]) => ({ quantity }))) > 0)} onClick={() => { const sourceWeek = Number(referenceWeek); const pairs = DELIVERY_WEEKDAYS.flatMap(day => { const sourceKey = slotKey(sourceWeek, day); const targets = STANDING_WEEKS.filter(week => week !== sourceWeek).map(week => slotKey(week, day)).filter(key => !Object.values(quantities[key] || {}).some(quantity => quantity > 0)); return total(Object.entries(quantities[sourceKey] || {}).map(([, quantity]) => ({ quantity }))) ? targets.map(targetKey => ({ sourceKey, targetKey })) : []; }); prepareCopy(pairs, `Fill empty slots from Week ${sourceWeek}`); }}>Fill empty weeks</button></div>
              {copyMessage && <p className="standing-copy-message" role="status">{copyMessage}</p>}
              {copyPlan && <section className="standing-copy-preview" aria-labelledby="copy-preview-heading">
                <h5 id="copy-preview-heading">Review product mapping</h5><p>{copyPlan.title}. Product identities use each target week’s catalogue.</p>
                {copyPlan.overwriteKeys.length > 0 && <p className="standing-copy-warning">This replaces existing quantities in {copyPlan.overwriteKeys.map(key => `Week ${key.replace(":", " · ")}`).join(", ")}.</p>}
                <div className="standing-copy-mappings">{copyPlan.copies.map(copy => <div key={`${copy.sourceKey}-${copy.targetKey}`}><strong>Week {copy.sourceKey.replace(":", " · ")} → Week {copy.targetKey.replace(":", " · ")}</strong><ul>{copy.mappings.map(mapping => <li key={mapping.targetProductId}>{mapping.sourceName} → {mapping.targetName}: {mapping.quantity}</li>)}</ul></div>)}</div>
                <div className="standing-copy-actions"><button type="button" className="secondary-button" onClick={() => setCopyPlan(undefined)}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={applyCopy}>{copyPlan.overwriteKeys.length ? "Overwrite quantities" : "Apply copy"}</button></div>
              </section>}
            </div>}
          </div>
          <footer className="standing-actions">
            {dirty && <span className="standing-unsaved" role="status">Unsaved changes</span>}
            {dirty && status === "active" && outstandingAutomatic.length > 0 && <p className="standing-amendment-impact">Saving can also update {outstandingAutomatic.length} editable automatic order{outstandingAutomatic.length === 1 ? "" : "s"} already generated{outstandingAutomatic.length <= 3 ? ` (${outstandingAutomatic.map(item => displayDate(item.deliveryDate)).join(", ")})` : ""}.</p>}
            {(status === "none" || status === "draft") && <><button type="button" className="secondary-button" disabled={busy || !dirty} onClick={() => void act("save", {}, "Draft saved.")}>Save draft</button><button type="button" className="primary-button" disabled={busy || configured === 0} onClick={open("activate")}>Activate…</button></>}
            {(status === "active" || status === "paused") && <button type="button" className="primary-button" disabled={busy || !dirty || configured === 0} onClick={() => void act("save", {}, "Amendment saved. Existing automatic orders that are still open were updated.")}>Save changes</button>}
            {status === "active" && <button type="button" className="secondary-button" disabled={busy} onClick={open("pause")}>Pause generation…</button>}
            {status === "paused" && <button type="button" className="secondary-button" disabled={busy} onClick={open("resume")}>Resume…</button>}
            {(status === "paused" || status === "terminated") && outstandingAutomatic.length > 0 && <button type="button" className="secondary-button" disabled={busy} onClick={open("cancel-upcoming")}>Cancel {outstandingAutomatic.length} automatic order{outstandingAutomatic.length === 1 ? "" : "s"}…</button>}
            {(status === "draft" || status === "active" || status === "paused") && <button type="button" className="danger-button" disabled={busy} onClick={open("terminate")}>Terminate…</button>}
            {status === "terminated" && <button type="button" className="primary-button" disabled={busy || configured === 0} onClick={() => void act("save", {}, "A new draft was started from the previous quantities.")}>Start a new draft</button>}
          </footer>
        </div>}
      </div>
    </section>
    <details className="standing-section standing-collapsible"><summary>Upcoming deliveries ({overview.upcoming.length})</summary><UpcomingTable upcoming={overview.upcoming} cutoffHour={cutoffHour} busy={busy} onGenerate={(item, event) => open("generate", item.deliveryDate)(event)} onRetry={item => void retryHandoff(item)} /></details>
    {!overview.historyAvailable && <p className="grab-copy-note" role="note">Version history is temporarily unavailable. Your standing order and upcoming deliveries are unaffected.</p>}
    <details className="standing-section standing-collapsible"><summary>Audit history ({overview.versions.length + overview.operations.length})</summary><History versions={overview.versions} operations={overview.operations} /></details>
    {confirm && <ConfirmDialog {...dialogFor(confirm.kind, { upcoming: overview.upcoming, deliveryDate: confirm.deliveryDate, outstanding: outstandingAutomatic })} busy={busy} invoker={confirm.invoker} onCancel={() => setConfirm(undefined)}
      onConfirm={() => void (confirm.kind === "activate" ? act("activate", {}, "Standing order activated. No orders were created yet.") : confirm.kind === "resume" ? act("resume", {}, "Standing order resumed. No orders were created yet.") : confirm.kind === "pause" ? act("pause", {}, "Automatic generation paused. Existing orders were left in place.") : confirm.kind === "terminate" ? act("terminate", {}, "Standing order terminated. Existing orders were left in place.") : confirm.kind === "generate" ? act("generate", { deliveryDate: confirm.deliveryDate }, `Order for ${displayDate(confirm.deliveryDate || "")} generated.`) : act("cancel-upcoming", {}, "Outstanding automatic orders cancelled."))} />}
  </div>;
}

function dialogFor(kind: Confirm["kind"], context: { upcoming: UpcomingDelivery[]; deliveryDate?: string; outstanding: UpcomingDelivery[] }) {
  const dates = context.outstanding.map(item => displayDate(item.deliveryDate)).join(", ");
  if (kind === "activate") return { title: "Activate this standing order?", confirmLabel: "Activate standing order", body: <><p>No order is created when you activate. Orders are generated on the schedule: Monday 12:01 for Wednesday and Thursday 12:01 for the following Monday (London time), each passed to CPU like any other order.</p><p>Existing manual orders and cancellations always take precedence. You can generate a due order yourself from the Upcoming deliveries list.</p></> };
  if (kind === "resume") return { title: "Resume this standing order?", confirmLabel: "Resume", body: <p>Scheduled generation restarts. No order is created now, and cancelled orders are never recreated.</p> };
  if (kind === "pause") return { title: "Pause automatic generation?", confirmLabel: "Pause generation", body: <><p>No new automatic orders are generated while paused. You can resume later.</p><p>Orders that already exist are not cancelled. {context.outstanding.length ? `${context.outstanding.length} automatic order${context.outstanding.length === 1 ? " remains" : "s remain"} active (${dates}); you can cancel ${context.outstanding.length === 1 ? "it" : "them"} separately afterwards.` : ""}</p></> };
  if (kind === "cancel-upcoming") return { title: "Cancel outstanding automatic orders?", confirmLabel: "Cancel automatic orders", destructive: true, body: <><p>{context.outstanding.length ? `${context.outstanding.length} automatic order${context.outstanding.length === 1 ? "" : "s"} before cut-off will be cancelled and CPU will be told: ${dates}.` : "There are no editable automatic orders to cancel."} Manual orders are not affected. If CPU cannot be reached, the cancellation is shown as pending and is not reported as complete.</p></> };
  if (kind === "generate") { const item = context.upcoming.find(candidate => candidate.deliveryDate === context.deliveryDate); return { title: `Create the order for ${displayDate(context.deliveryDate || "")}?`, confirmLabel: "Create order now", body: <><p>This creates the real Grab & Go order for {displayDate(context.deliveryDate || "")}{item ? ` (${total(item.templateLines)} items from Week ${item.rotationWeek} ${item.weekday})` : ""} immediately and sends it to CPU. It follows the same cut-off and catalogue rules as any order and never replaces a manual order.</p></> }; }
  return { title: "Terminate this standing order?", confirmLabel: "Terminate standing order", destructive: true, body: <><p>Termination ends automatic generation. Version history is kept and you can start a new draft later.</p><p>Existing orders are not cancelled by terminating.{context.outstanding.length ? ` ${context.outstanding.length} automatic order${context.outstanding.length === 1 ? " remains" : "s remain"} active (${dates}); cancel ${context.outstanding.length === 1 ? "it" : "them"} separately if required.` : ""}</p></> };
}

function ConfirmDialog({ title, body, confirmLabel, destructive, busy, invoker, onConfirm, onCancel }: { title: string; body: ReactNode; confirmLabel: string; destructive?: boolean; busy: boolean; invoker: HTMLElement | null; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); invoker?.focus(); }; }, [invoker]);
  return <dialog ref={ref} className="standing-dialog" aria-labelledby="standing-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id="standing-dialog-title">{title}</h3>{body}
    <div className="standing-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel} autoFocus>Go back</button><button type="button" className={destructive ? "danger-button" : "primary-button"} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button></div>
  </dialog>;
}

function sourceLabel(item: UpcomingDelivery) {
  const order = item.order; if (!order) return "—";
  if (order.control === "automatic" && order.source) return `Standing order v${order.source.templateVersion}`;
  if (order.source) return `Manual (changed from standing order v${order.source.templateVersion})`;
  return "Manual order";
}
function UpcomingTable({ upcoming, cutoffHour, busy, onGenerate, onRetry }: { upcoming: UpcomingDelivery[]; cutoffHour: number; busy: boolean; onGenerate: (item: UpcomingDelivery, event: React.MouseEvent<HTMLButtonElement>) => void; onRetry: (item: UpcomingDelivery) => void }) {
  return <section className="standing-section" aria-labelledby="upcoming-heading">
    <header><h3 id="upcoming-heading">Upcoming deliveries</h3><p>The next 14 days. Orders close at {cutoffHour}:00 the day before delivery.</p></header>
    {upcoming.length === 0 ? <div className="empty-state"><p>No Monday or Wednesday deliveries in the next 14 days.</p></div> :
      <div className="standing-table-wrap" role="region" aria-label="Upcoming deliveries" tabIndex={0}><table className="standing-table standing-upcoming"><caption className="visually-hidden">Upcoming Grab and Go deliveries and their standing-order status</caption>
        <thead><tr><th scope="col">Delivery</th><th scope="col">Source</th><th scope="col">Order</th><th scope="col">Items</th><th scope="col">CPU update</th><th scope="col">Standing order</th></tr></thead>
        <tbody>{upcoming.map(item => <tr key={item.deliveryDate} className={item.exception ? "has-exception" : undefined}>
          <th scope="row">{displayDate(item.deliveryDate)}<small>Week {item.rotationWeek} · cut-off {displayTime(item.cutoff)}</small></th>
          <td>{sourceLabel(item)}</td>
          <td>{item.order ? <>{item.order.status === "cancelled" ? "Cancelled" : item.cutoffPassed ? "Submitted · locked" : "Submitted"} <small>v{item.order.version}</small></> : "No order"}</td>
          <td>{item.order && item.order.status === "submitted" ? total(item.order.lines) : item.templateLines.length && !item.order ? `${total(item.templateLines)} planned` : "—"}</td>
          <td>{item.order ? <>{HANDOFF_LABEL[item.order.handoff]}{["pending", "not-staged", "intervention-required"].includes(item.order.handoff) && <button type="button" className="secondary-button standing-inline" disabled={busy} onClick={() => onRetry(item)} aria-label={`Retry production update for ${displayDate(item.deliveryDate)}`}>Retry</button>}</> : "—"}</td>
          <td><span className={`standing-state standing-state-${item.state}`}>{OCCURRENCE_LABEL[item.state]}</span>{item.state === "scheduled" && <small>Generates {displayTime(item.generationAt)}</small>}
            {item.canGenerateNow && <button type="button" className="secondary-button standing-inline" disabled={busy} onClick={event => onGenerate(item, event)} aria-label={`Create the order for ${displayDate(item.deliveryDate)} now`}>Create now…</button>}
            {item.exception && <small className="standing-exception" role="note">⚠ {item.exception}</small>}</td></tr>)}</tbody></table></div>}
  </section>;
}
function History({ versions, operations }: { versions: StandingVersion[]; operations: StandingOperation[] }) {
  if (!versions.length && !operations.length) return null;
  return <details className="standing-section standing-history"><summary>History ({versions.length} versions{operations.length ? `, ${operations.length} actions` : ""})</summary>
    {operations.length > 0 && <><h4>Actions</h4><ol>{operations.map(operation => <li key={operation.operationId}><strong>{operation.operation === "manual-generate" ? "Order created manually" : "Automatic orders cancelled"} · {operation.complete ? "complete" : "INCOMPLETE — needs attention"}</strong> <span>{displayTime(operation.at)} · {operation.actor} · template v{operation.templateVersion}</span>{operation.items.map(item => <small key={item.deliveryDate}>{displayDate(item.deliveryDate)}: {item.outcome}{item.orderVersion ? ` (order v${item.orderVersion})` : ""}{item.handoff ? ` · CPU ${item.handoff}` : ""}{item.message ? ` · ${item.message}` : ""}</small>)}</li>)}</ol></>}
    {versions.length > 0 && <><h4>Template versions</h4><ol>{versions.map(version => <li key={version.version}><strong>v{version.version} · {version.action.replace("-", " ")}</strong> <span>{displayTime(version.at)} · {version.actor}</span>{version.changedSlots.length > 0 && <small>Changed: {version.changedSlots.map(key => `Week ${key.replace(":", " ")}`).join(", ")}</small>}{version.note && <small>Note: {version.note}</small>}</li>)}</ol></>}
  </details>;
}
