"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AD_HOC_CATEGORIES, AD_HOC_UNITS, NOTES_LIMIT, STATUS_LABELS, blankDraft, contentKey, isArchived, isSent, newLineId, readiness, submitBlockers, type AdHocCategory, type AdHocDraft, type AdHocLine, type AdHocRequest } from "../lib/ad-hoc-domain";
import { Icon } from "./icons";

type OplocOption = { canonicalId: string; label: string; address?: string; lifecycleStatus?: string };
const toDraft = (request: AdHocRequest): AdHocDraft => ({ eventName: request.eventName, serviceDate: request.serviceDate, requiredReadyTime: request.requiredReadyTime, category: request.category, guestCount: request.guestCount, notes: request.notes, destination: structuredClone(request.destination), lines: structuredClone(request.lines) });
const longDate = (date: string) => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const categoryLabel = (value: string) => AD_HOC_CATEGORIES.find(item => item.value === value)?.label || "—";

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "That action could not be completed.");
  return body as { request: AdHocRequest; sent?: boolean };
}

export function OrderForm({ id }: { id: string }) {
  const isNew = id === "new";
  const [request, setRequest] = useState<AdHocRequest | null>(null);
  const [draft, setDraft] = useState<AdHocDraft>(() => blankDraft());
  const [loading, setLoading] = useState(!isNew);
  const [oplocs, setOplocs] = useState<OplocOption[]>([]);
  const [oplocError, setOplocError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "send">("");
  const [showErrors, setShowErrors] = useState(false);
  const [dragId, setDragId] = useState("");

  useEffect(() => {
    if (isNew) { setRequest(null); setDraft(blankDraft()); setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    void fetch(`/api/requests?id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message || "This order could not be loaded."); return body.request as AdHocRequest; })
      .then(loaded => { if (active) { setRequest(loaded); setDraft(toDraft(loaded)); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "This order could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, isNew]);
  useEffect(() => {
    void fetch("/api/oplocs", { cache: "no-store" }).then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message || "OPLOC destinations could not be loaded."); setOplocs((body.oplocs || []).filter((item: OplocOption) => !item.lifecycleStatus || item.lifecycleStatus.toLowerCase() === "active")); })
      .catch(cause => setOplocError(cause instanceof Error ? cause.message : "OPLOC destinations could not be loaded."));
  }, []);

  const dirty = request ? contentKey(draft) !== contentKey(toDraft(request)) : Boolean(draft.eventName.trim() || draft.destination.label || draft.lines.some(line => line.description.trim()));
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);

  const readOnly = Boolean(request && isArchived(request));
  const checklist = useMemo(() => readiness(draft), [draft]);
  const blockers = useMemo(() => submitBlockers(draft), [draft]);
  const set = <K extends keyof AdHocDraft>(key: K, value: AdHocDraft[K]) => { setDraft(current => ({ ...current, [key]: value })); setNotice(""); };
  const setDestination = (patch: Partial<AdHocDraft["destination"]>) => set("destination", { ...draft.destination, ...patch });
  const setLine = (lineId: string, patch: Partial<AdHocLine>) => set("lines", draft.lines.map(line => line.id === lineId ? { ...line, ...patch } : line));
  const move = (from: number, to: number) => { if (to < 0 || to >= draft.lines.length) return; const lines = [...draft.lines]; const [item] = lines.splice(from, 1); lines.splice(to, 0, item); set("lines", lines.map((line, index) => ({ ...line, sortOrder: index }))); };
  const addLine = () => set("lines", [...draft.lines, { id: newLineId(), description: "", quantity: 1, unit: "portions", sortOrder: draft.lines.length }]);
  const removeLine = (lineId: string) => set("lines", draft.lines.filter(line => line.id !== lineId).map((line, index) => ({ ...line, sortOrder: index })));
  const chooseOploc = (canonicalId: string) => { const option = oplocs.find(item => item.canonicalId === canonicalId); setDestination({ oplocId: option?.canonicalId, label: option?.label || "", address: option?.address || "", identity: option?.canonicalId || "" }); };

  const save = useCallback(async () => {
    const payload = { ...draft, lines: draft.lines.map((line, index) => ({ ...line, sortOrder: index })) };
    const result = request ? await post({ action: "update", id: request.id, expectedVersion: request.version, draft: payload }) : await post({ action: "create", draft: payload });
    setRequest(result.request); setDraft(toDraft(result.request));
    // Same page instance: update the address bar without remounting, so the confirmation below stays visible.
    if (!request) window.history.replaceState(null, "", `/orders/${encodeURIComponent(result.request.id)}`);
    return result.request;
  }, [draft, request]);

  const run = async (kind: "save" | "send") => {
    setBusy(kind); setError(""); setNotice("");
    try {
      if (kind === "send") { setShowErrors(true); if (blockers.length) { setError("Complete the highlighted details before sending to CPU."); return; } }
      const saved = dirty || !request ? await save() : request;
      if (kind === "send") {
        const result = await post({ action: "send", id: saved.id, expectedVersion: saved.version });
        setRequest(result.request); setDraft(toDraft(result.request)); setNotice(result.request.status === "SENT_TO_CPU" ? "Sent to CPU. Logistics will plan dispatch from your ready time." : "Sent, but the order changed while sending. Send the update to bring CPU up to date.");
      } else setNotice(request && isSent(request) ? "Changes saved. CPU and Logistics still hold the last version you sent." : "Draft saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That action could not be completed."); }
    finally { setBusy(""); }
  };

  if (loading) return <div className="page narrow"><p className="empty" role="status">Loading order…</p></div>;
  if (!isNew && !request) return <div className="page narrow"><Link href="/" className="back"><Icon name="arrowLeft" size={16} />Back to overview</Link><p className="banner error" role="alert">{error || "This order was not found."}</p></div>;

  const status = request?.status || "DRAFT";
  const invalid = (ok: boolean) => showErrors && !ok;
  const done = (key: string) => checklist.find(item => item.key === key)?.done ?? false;
  const destination = draft.destination;
  const sendLabel = status === "NEEDS_UPDATE" || (request && isSent(request) && dirty) ? "Send update to CPU" : "Send to CPU";
  const sendDisabled = Boolean(busy) || readOnly || (status === "SENT_TO_CPU" && !dirty);

  return <div className="page order">
    <div className="order-main">
      <Link href="/" className="back"><Icon name="arrowLeft" size={16} />Back to overview</Link>
      <div className="title-row"><h1>{isNew ? "New ad-hoc order" : draft.eventName || "Ad-hoc order"}</h1><span className={`chip ${status === "DRAFT" ? "draft" : status === "SENT_TO_CPU" ? "sent" : status === "NEEDS_UPDATE" ? "update" : "cancelled"}`}>{request && isArchived(request) && status === "DRAFT" ? "Archived draft" : STATUS_LABELS[status]}</span>{request && <span className="ref">{request.reference}</span>}</div>
      <p className="lede">Create a bespoke food order to send to CPU Hospitality and Logistics.</p>
      <div aria-live="polite">{notice && <p className="banner ok" role="status">{notice}</p>}{error && <p className="banner error" role="alert">{error}</p>}
        {status === "NEEDS_UPDATE" && <p className="banner warn" role="status">This order changed after it was sent. CPU and Logistics still hold the previous version until you send the update.</p>}
        {readOnly && <p className="banner warn" role="status">{status === "CANCELLED" ? "This order was cancelled and withdrawn from CPU and Logistics." : "This draft is archived."} It is read-only; duplicate it from the overview to start a new order.</p>}</div>

      <fieldset className="plain" disabled={readOnly || busy !== ""}>
        <section className="card" aria-labelledby="sec-details">
          <div className="card-head"><span className="step">1</span><div><h2 id="sec-details">Event details</h2><p>Basic information about the event and catering requirement.</p></div></div>
          <div className="grid">
            <label className="field"><span>Event name <b aria-hidden="true">*</b></span><input value={draft.eventName} maxLength={120} aria-invalid={invalid(Boolean(draft.eventName.trim()))} onChange={event => set("eventName", event.target.value)} />{invalid(Boolean(draft.eventName.trim())) && <em className="field-error">Enter an event name.</em>}</label>
            <label className="field"><span>Service date <b aria-hidden="true">*</b></span><input type="date" value={draft.serviceDate} aria-invalid={invalid(!submitBlockers(draft).includes("Service date is in the past") && Boolean(draft.serviceDate))} onChange={event => set("serviceDate", event.target.value)} />{showErrors && submitBlockers(draft).includes("Service date is in the past") && <em className="field-error">Service date is in the past.</em>}</label>
            <label className="field"><span>Required ready time <b aria-hidden="true">*</b></span><input type="time" value={draft.requiredReadyTime} aria-invalid={invalid(done("ready"))} onChange={event => set("requiredReadyTime", event.target.value)} /><small className="help">Ready by this time — Logistics sets the dispatch time.</small></label>
            <label className="field span2"><span>Request type / category <b aria-hidden="true">*</b></span><select value={draft.category} onChange={event => set("category", event.target.value as AdHocCategory)}>{AD_HOC_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="field"><span>Guest count <b aria-hidden="true">*</b></span><input type="number" inputMode="numeric" min={1} step={1} value={draft.guestCount ?? ""} aria-invalid={invalid(Boolean(draft.guestCount))} onChange={event => set("guestCount", event.target.value ? Math.trunc(Number(event.target.value)) : undefined)} />{invalid(Boolean(draft.guestCount)) && <em className="field-error">Enter the guest count.</em>}</label>
            <label className="field span3"><span>Internal notes <i>(optional)</i></span><textarea rows={3} value={draft.notes ?? ""} maxLength={NOTES_LIMIT} onChange={event => set("notes", event.target.value)} /><small className="count">{(draft.notes ?? "").length}/{NOTES_LIMIT}</small></label>
          </div>
        </section>

        <section className="card" aria-labelledby="sec-destination">
          <div className="card-head"><span className="step">2</span><div><h2 id="sec-destination">Destination</h2><p>Where does this order need to go? A delivery destination is required for Logistics.</p></div></div>
          <div className="segmented wide" role="group" aria-label="Destination type">
            <button type="button" aria-pressed={destination.mode === "oploc"} className={destination.mode === "oploc" ? "on" : ""} onClick={() => setDestination({ mode: "oploc", label: "", address: "", oplocId: undefined, identity: "" })}><Icon name="building" size={18} />Existing OPLOC</button>
            <button type="button" aria-pressed={destination.mode === "one_off"} className={destination.mode === "one_off" ? "on" : ""} onClick={() => setDestination({ mode: "one_off", label: "", address: "", oplocId: undefined, identity: "" })}><Icon name="pin" size={18} />One-off address</button>
          </div>
          {destination.mode === "oploc" ? <div className="grid">
            <label className="field"><span>Select OPLOC <b aria-hidden="true">*</b></span><select value={destination.oplocId || ""} aria-invalid={invalid(done("destination"))} onChange={event => chooseOploc(event.target.value)}><option value="">Select an OPLOC…</option>{destination.oplocId && !oplocs.some(item => item.canonicalId === destination.oplocId) && <option value={destination.oplocId}>{destination.label || destination.oplocId}</option>}{oplocs.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.label}{item.address ? ` — ${item.address}` : ""}</option>)}</select>{oplocError && <em className="field-error">{oplocError}</em>}{invalid(done("destination")) && !oplocError && <em className="field-error">Choose a destination.</em>}</label>
            <label className="field"><span>Contact name <i>(optional)</i></span><input value={destination.contactName ?? ""} maxLength={120} onChange={event => setDestination({ contactName: event.target.value })} /></label>
            <label className="field"><span>Contact phone <i>(optional)</i></span><input type="tel" value={destination.contactPhone ?? ""} maxLength={40} onChange={event => setDestination({ contactPhone: event.target.value })} /></label>
          </div> : <div className="grid">
            <label className="field span2"><span>Destination name <b aria-hidden="true">*</b></span><input value={destination.label} maxLength={160} aria-invalid={invalid(Boolean(destination.label.trim()))} onChange={event => setDestination({ label: event.target.value })} /></label>
            <label className="field span3"><span>Delivery address <b aria-hidden="true">*</b></span><textarea rows={2} value={destination.address} maxLength={400} aria-invalid={invalid(Boolean(destination.address.trim()))} onChange={event => setDestination({ address: event.target.value })} />{invalid(done("destination")) && <em className="field-error">Enter the destination name and full address.</em>}</label>
            <label className="field"><span>Contact name <i>(optional)</i></span><input value={destination.contactName ?? ""} maxLength={120} onChange={event => setDestination({ contactName: event.target.value })} /></label>
            <label className="field"><span>Contact phone <i>(optional)</i></span><input type="tel" value={destination.contactPhone ?? ""} maxLength={40} onChange={event => setDestination({ contactPhone: event.target.value })} /></label>
            <label className="field span3"><span>Delivery instructions <i>(optional)</i></span><input value={destination.deliveryInstructions ?? ""} maxLength={400} onChange={event => setDestination({ deliveryInstructions: event.target.value })} /></label>
          </div>}
          <p className="info-line"><Icon name="info" size={18} />{destination.mode === "oploc" ? `This order will be sent to CPU Hospitality${destination.label ? ` for ${destination.label}` : ""} and a delivery requirement will be created in Logistics.` : "A one-off address is stored with this order only. It is not added to the OPLOC list."}</p>
        </section>

        <section className="card" aria-labelledby="sec-lines">
          <div className="card-head"><span className="step">3</span><div><h2 id="sec-lines">Production lines</h2><p>Add the food and drink items for this order. Describe them freely; no Dish Library item is needed.</p></div></div>
          <div className="lines">
            <div className="line-head" aria-hidden="true"><span /><span>Item</span><span>Quantity</span><span>Unit</span><span>Preparation / service note <i>(optional)</i></span><span /></div>
            {draft.lines.map((line, index) => <div className={`line${dragId === line.id ? " dragging" : ""}`} key={line.id} draggable={!readOnly} onDragStart={() => setDragId(line.id)} onDragEnd={() => setDragId("")} onDragOver={event => event.preventDefault()} onDrop={() => { const from = draft.lines.findIndex(item => item.id === dragId); if (from >= 0) move(from, index); setDragId(""); }}>
              <span className="grip" title="Drag to reorder"><Icon name="grip" size={18} /></span>
              <label className="field"><span className="visually-hidden">Item {index + 1}</span><input value={line.description} maxLength={200} placeholder="e.g. Sandwich platters" aria-invalid={invalid(Boolean(line.description.trim()))} onChange={event => setLine(line.id, { description: event.target.value })} /></label>
              <label className="field"><span className="visually-hidden">Quantity for item {index + 1}</span><input type="number" min={0} step="any" value={line.quantity || ""} aria-invalid={invalid(line.quantity > 0)} onChange={event => setLine(line.id, { quantity: Number(event.target.value) })} /></label>
              <label className="field"><span className="visually-hidden">Unit for item {index + 1}</span><select value={line.unit} onChange={event => setLine(line.id, { unit: event.target.value })}>{AD_HOC_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>
              <label className="field"><span className="visually-hidden">Note for item {index + 1}</span><input value={line.note ?? ""} maxLength={300} onChange={event => setLine(line.id, { note: event.target.value })} /></label>
              <span className="line-actions">
                <button type="button" className="icon-btn" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, index - 1)}><Icon name="up" size={16} /></button>
                <button type="button" className="icon-btn" aria-label={`Move item ${index + 1} down`} disabled={index === draft.lines.length - 1} onClick={() => move(index, index + 1)}><Icon name="down" size={16} /></button>
                <button type="button" className="icon-btn danger" aria-label={`Remove item ${index + 1}`} onClick={() => removeLine(line.id)}><Icon name="trash" size={18} /></button>
              </span>
            </div>)}
            {invalid(done("lines")) && <em className="field-error">Add at least one item with a description, quantity and unit.</em>}
            <button type="button" className="btn" onClick={addLine}><Icon name="plus" size={18} />Add item</button>
          </div>
        </section>
      </fieldset>
    </div>

    <aside className="order-side" aria-label="Order summary">
      <section className="card flush">
        <div className="side-head"><span className="side-icon"><Icon name="truck" size={22} /></span><div><h2>Logistics &amp; routing preview</h2><p>This order will be sent to CPU Hospitality and a delivery requirement will be created in Logistics.</p></div></div>
        <div className="route">
          <div className="route-box"><span className="route-icon cpu"><Icon name="fork" size={20} /></span><small>CPU destination</small><strong>Hospitality view</strong><span>Order will appear in CPU for the selected destination.</span></div>
          <Icon name="arrowRight" size={20} className="route-arrow" />
          <div className="route-box"><span className="route-icon log"><Icon name="truck" size={20} /></span><small>Logistics</small><strong>Delivery requirement created</strong><span>A delivery stop will be created in Logistics.</span></div>
        </div>
        <dl className="summary"><h3><Icon name="doc" size={18} />Order summary</h3>
          <div><dt>Event name</dt><dd>{draft.eventName || "—"}</dd></div><div><dt>Service date</dt><dd>{longDate(draft.serviceDate)}</dd></div><div><dt>Ready time</dt><dd>{draft.requiredReadyTime || "—"}</dd></div><div><dt>Category</dt><dd>{categoryLabel(draft.category)}</dd></div><div><dt>Guest count</dt><dd>{draft.guestCount ?? "—"}</dd></div>
        </dl>
        <dl className="summary"><h3><Icon name="pin" size={18} />Destination</h3>
          <div><dt>Type</dt><dd>{destination.mode === "oploc" ? "Existing OPLOC" : "One-off address"}</dd></div><div><dt>{destination.mode === "oploc" ? "OPLOC" : "Name"}</dt><dd>{destination.label || "—"}</dd></div><div><dt>Address</dt><dd>{destination.address || "—"}</dd></div>{destination.contactName && <div><dt>Contact</dt><dd>{destination.contactName}</dd></div>}{destination.contactPhone && <div><dt>Phone</dt><dd>{destination.contactPhone}</dd></div>}
        </dl>
        <dl className="summary"><h3><Icon name="fork" size={18} />Menu items</h3>
          <div><dt>Production lines</dt><dd>{draft.lines.length}</dd></div>
        </dl>
        <section className="checklist" aria-labelledby="ready-title"><h3 id="ready-title"><Icon name="check" size={18} />Readiness checklist</h3>
          <ul>{checklist.map(item => <li key={item.key} className={item.done ? "ok" : ""}><span className="tick" aria-hidden="true">{item.done && <Icon name="check" size={14} />}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span><span className="visually-hidden">{item.done ? "Complete" : "Incomplete"}</span></li>)}</ul>
        </section>
        <p className="dispatch-note"><Icon name="clock" size={18} />Dispatch time will be assigned in Logistics based on the ready time and delivery location.</p>
        <div className="actions">
          <button type="button" className="btn large" disabled={Boolean(busy) || readOnly || (!dirty && Boolean(request))} onClick={() => void run("save")}><Icon name="doc" size={18} />{busy === "save" ? "Saving…" : request && isSent(request) ? "Save changes" : "Save draft"}</button>
          <button type="button" className="btn primary large" disabled={sendDisabled} onClick={() => void run("send")}><Icon name="send" size={18} />{busy === "send" ? "Sending…" : status === "SENT_TO_CPU" && !dirty ? "Sent to CPU" : sendLabel}</button>
        </div>
      </section>
    </aside>
  </div>;
}
