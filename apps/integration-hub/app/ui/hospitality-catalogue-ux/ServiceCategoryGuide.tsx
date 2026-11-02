"use client";

import { useMemo, useRef, useState } from "react";
import { SERVICE_IDS, type ServiceId } from "@fika/server-shared/hospitality-service-layout";
import { SERVICE_LABELS, serviceRuleAt, setServiceCategoriesCommand, layoutVocabulary, type CataloguePayload } from "../../../lib/hospitality-catalogue-types";
import { oplocLabel, selectableSites } from "../../../lib/hospitality-catalogue-view";
import { categoryItems, guidedBlocker, guidedChange, guidedDraft, impactLines, impactSentence, otherServices, scopePhrase, type ServicesContext } from "./model";
import "./ServiceCategoryGuide.css";

type Command = Record<string, unknown> & { action: string };
type Send = (command: Command) => Promise<{ message: string }>;

/** Guided "pick a site, pick a service, tick categories" flow. Saves through the existing governed set-service-categories command only. */
export default function ServiceCategoryGuide({ payload, canManage, send, reload, context, onContext }: { payload: CataloguePayload; canManage: boolean; send: Send; reload: () => Promise<void>; context: ServicesContext; onContext: (next: ServicesContext) => void }) {
  const view = payload.serviceLayout;
  const sites = useMemo(() => selectableSites(payload.oplocs), [payload.oplocs]);
  if (!view) return <section className="scg" aria-labelledby="scg-title"><h2 id="scg-title">Change what a booking service offers</h2><p className="hc-note" role="status">The booking service settings were not included in this load. Reload the catalogue to edit them.</p></section>;
  const oplocId = sites.some(s => s.oplocId === context.oplocId) ? context.oplocId : undefined;
  const serviceId = context.serviceId && SERVICE_IDS.includes(context.serviceId) ? context.serviceId : undefined;
  return <section className="scg" aria-labelledby="scg-title">
    <header><h2 id="scg-title">Change what a booking service offers</h2>
      <p>Choose a site and a booking service, then tick the categories customers can order from. Only that one site and service changes. Prices, minimums, site permissions and existing bookings are not affected.</p>
      {!canManage && <p className="hc-viewonly" role="status">View only: you do not have permission to change booking services.</p>}</header>
    <ol className="scg-steps">
      <li><label className="hc-field"><span>1. Site</span>
        <select value={oplocId ?? ""} onChange={e => onContext({ oplocId: e.target.value || undefined, serviceId: undefined, category: undefined })}>
          <option value="">Choose a site…</option>{sites.map(s => <option key={s.oplocId} value={s.oplocId}>{s.label}</option>)}</select></label></li>
      <li><label className="hc-field"><span>2. Booking service</span>
        <select value={serviceId ?? ""} disabled={!oplocId} onChange={e => onContext({ oplocId, serviceId: (e.target.value || undefined) as ServiceId | undefined, category: context.category })}>
          <option value="">{oplocId ? "Choose a service…" : "Choose a site first"}</option>{SERVICE_IDS.map(id => <option key={id} value={id}>{SERVICE_LABELS[id]}</option>)}</select></label></li>
    </ol>
    {oplocId && serviceId ? <Editor key={`${oplocId}:${serviceId}:${view.sites[oplocId]?.version ?? 0}`} payload={payload} oplocId={oplocId} serviceId={serviceId} focus={context.category} canManage={canManage} send={send} reload={reload} />
      : <p className="hc-hint">Pick a site and a service to see its categories.</p>}
  </section>;
}

function Editor({ payload, oplocId, serviceId, focus, canManage, send, reload }: { payload: CataloguePayload; oplocId: string; serviceId: ServiceId; focus?: string; canManage: boolean; send: Send; reload: () => Promise<void> }) {
  const view = payload.serviceLayout!;
  const siteLabel = oplocLabel(payload.oplocs, oplocId), serviceLabel = SERVICE_LABELS[serviceId];
  const base = serviceRuleAt(view, oplocId, serviceId);
  const [draft, setDraft] = useState<string[]>(base.rule.categories);
  const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [status, setStatus] = useState("");
  const inFlight = useRef(false);
  const categories = useMemo(() => layoutVocabulary(view), [view]);
  const live = new Set(view.vocabulary.catalogueCategories);
  const change = guidedChange(view, oplocId, serviceId, draft);
  const impact = impactLines(payload.rows, change, oplocId, siteLabel, serviceLabel);
  const blocker = guidedBlocker(change, reason, confirmed);
  const disabled = !canManage || busy;
  const phrase = scopePhrase(siteLabel, serviceId);

  function toggle(category: string, included: boolean) { setStatus(""); setConfirmed(false); setDraft(current => guidedDraft(view, oplocId, serviceId, category, included, current).categories); }
  async function save() {
    if (blocker || inFlight.current) { if (blocker) setError(blocker); return; }
    inFlight.current = true; setBusy(true); setError(""); setStatus("");
    try {
      const result = await send(setServiceCategoriesCommand(view, oplocId, serviceId, { categories: draft, ...(base.rule.hidden ? { hidden: true } : {}) }, reason));
      setStatus(`${result.message || "Saved."} ${phrase} changed; nothing else was touched.`); setReason(""); setConfirmed(false);
    } catch (caught) {
      const message = (caught as Error).message;
      if (/changed elsewhere/i.test(message)) { setError(`${message} Someone else changed this just now. Your unsaved edits were discarded and the latest settings are loading.`); setDraft(base.rule.categories); try { await reload(); } catch { /* catalogue shows its own error */ } }
      else setError(message);
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="scg-editor">
    <p className="scg-source" role="note">{base.source === "site"
      ? <><span className="hc-tag hc-tag--overrides">Site override</span> {siteLabel} has its own {serviceLabel} list. Company default is unchanged.</>
      : <><span className="hc-tag hc-tag--inherits">Inherits company</span> {siteLabel} {serviceLabel} currently follows the company default. Saving creates a site-only override for {siteLabel}; other sites keep following the company default.</>}</p>
    {base.rule.hidden && <p className="hc-warning" role="note">{serviceLabel} is hidden at {siteLabel}, so customers see nothing from it whatever you tick here.</p>}
    <div className="scg-live" aria-live="polite">{status && <p className="hc-success" role="status">{status}</p>}{error && <p className="hc-error" role="alert">{error}</p>}</div>
    <fieldset className="scg-cats" disabled={disabled}>
      <legend>Categories customers can order from at {siteLabel} {serviceLabel}</legend>
      <ul>{categories.map(category => {
        const included = draft.includes(category), was = base.rule.categories.includes(category);
        const { orderable, notPermitted } = categoryItems(payload.rows, category, oplocId);
        return <li key={category} className={category === focus ? "is-focus" : ""}>
          <label><input type="checkbox" checked={included} onChange={e => toggle(category, e.target.checked)} />
            <span className="scg-cat"><strong>{category}</strong>
              <small>{included ? "Included" : "Not included"}{included !== was ? " · changed" : ""} · {orderable.length} item{orderable.length === 1 ? "" : "s"} available here{notPermitted.length ? `, ${notPermitted.length} not permitted here` : ""}{!live.has(category) ? " · no live items use this name" : ""}</small></span></label></li>;
      })}</ul>
    </fieldset>

    <section className="scg-preview" aria-labelledby="scg-prev-title" aria-live="polite">
      <h3 id="scg-prev-title">What customers will see</h3>
      {!change.changed ? <p className="hc-hint">No changes yet. Tick or untick a category above.</p> : <>
        <ul>{impact.lines.map(line => <li key={`${line.kind}:${line.category}`} className={`scg-line scg-line--${line.kind}`}><span className="hc-badge hc-badge--neutral">{line.kind === "added" ? "Added" : "Removed"}</span> {impactSentence(line, siteLabel, serviceLabel)}
          {line.names.length > 0 && line.names.length <= 15 && <small>{line.names.join(", ")}</small>}</li>)}</ul>
        <p className="scg-ba"><span><strong>Before:</strong> {change.before.join(", ") || "nothing"}</span><span><strong>After:</strong> {change.after.join(", ") || "nothing"}</span></p></>}
      <p className="hc-hint scg-unchanged"><strong>{phrase}</strong> will change. Not changing: {otherServices(serviceId).join(", ")}, every other site, the company default, prices, minimums, routing and past bookings.</p>
    </section>

    {canManage && <div className="scg-save">
      <label className="hc-check"><input type="checkbox" checked={confirmed} disabled={disabled || !change.changed} onChange={e => setConfirmed(e.target.checked)} /> <span><strong>{phrase}</strong>: I confirm this change applies to this site and service only.</span></label>
      <label className="hc-field"><span>Reason for the change (required, at least 8 characters)</span>
        <input value={reason} onChange={e => setReason(e.target.value)} disabled={disabled} maxLength={500} autoComplete="off" /></label>
      <div className="scg-actions">
        <button type="button" className="hc-btn hc-btn--primary" disabled={disabled || Boolean(blocker)} onClick={() => void save()}>{busy ? "Saving…" : `Save changes to ${siteLabel} ${serviceLabel}`}</button>
        <button type="button" className="hc-btn" disabled={disabled || !change.changed} onClick={() => { setDraft(base.rule.categories); setConfirmed(false); setError(""); }}>Discard changes</button></div>
      {change.changed && blocker && <p className="hc-hint" role="status">{blocker}</p>}
    </div>}
  </div>;
}
