"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { sameServiceRule, type ServiceId, type ServiceRule, type ServiceRules } from "@fika/server-shared/hospitality-service-layout";
import "./HospitalityServiceLayout.css";
import {
  clearServiceOverrideCommand, effectivePreview, layoutVocabulary, moveCategory, orphanCategories, saveBlocker,
  serviceRuleAt, setCategoryIncluded, setServiceCategoriesCommand, unmappedCategories,
  type CataloguePayload, type ServiceLayoutView,
} from "../../lib/hospitality-catalogue-types";
import { oplocLabel, selectableSites } from "../../lib/hospitality-catalogue-view";

type Command = Record<string, unknown> & { action: string };
type Send = (command: Command) => Promise<{ message: string }>;
type Drafts = Partial<Record<ServiceId, ServiceRule>>;

/**
 * Booking-service category layout editor (issue #175, slice 2a). It edits ONLY which Item categories each booking service offers,
 * for the company default or for one site's override, through the existing governed `set-service-categories` /
 * `clear-service-override` commands. It never creates, renames or deletes categories and never touches Items, prices, minimums,
 * site permissions or amendments. Category names are matched exactly; nothing is added, removed or mapped automatically.
 */
export default function HospitalityServiceLayout({ payload, canManage, send, reload }: { payload: CataloguePayload; canManage: boolean; send: Send; reload: () => Promise<void> }) {
  const view = payload.serviceLayout;
  const sites = useMemo(() => selectableSites(payload.oplocs), [payload.oplocs]);
  const [chosenSite, setChosenSite] = useState("");
  const oplocId = sites.some(site => site.oplocId === chosenSite) ? chosenSite : "";
  if (!view) return <section className="hsl" aria-labelledby="hsl-title"><h2 id="hsl-title">Booking service categories</h2><p className="hc-note" role="status">The service layout was not included in this catalogue load. Reload the catalogue to edit it.</p></section>;
  return <section className="hsl" aria-labelledby="hsl-title">
    <header className="hsl-head">
      <h2 id="hsl-title">Booking service categories</h2>
      <p>Choose which Item categories each booking service offers. The company default applies everywhere; a site can override a single service. This changes what the booking portals list, not prices, minimums, site permissions or existing bookings.</p>
      {!canManage && <p className="hc-viewonly" role="status">View only: you do not have permission to change the layout.</p>}
    </header>
    <div className="hsl-scope">
      <label className="hc-field"><span>Edit layout for</span>
        <select value={oplocId} onChange={event => setChosenSite(event.target.value)}>
          <option value="">Company default (all sites)</option>
          {sites.map(site => <option key={site.oplocId} value={site.oplocId}>{site.label}{view.sites[site.oplocId] && Object.keys(view.sites[site.oplocId].services).length ? " (has overrides)" : ""}</option>)}
        </select>
      </label>
      <p className="hc-hint">{oplocId ? `Showing ${oplocLabel(payload.oplocs, oplocId)}. A service marked Inherits company follows the company default; ticking a box on it creates an override for this site only.` : "Showing the company default. Sites without an override follow it."}</p>
    </div>
    <ScopeEditor key={oplocId || "company"} view={view} oplocId={oplocId || undefined} canManage={canManage} send={send} reload={reload} />
  </section>;
}

function ScopeEditor({ view, oplocId, canManage, send, reload }: { view: ServiceLayoutView; oplocId?: string; canManage: boolean; send: Send; reload: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const inFlight = useRef(false);

  const catalogue = view.vocabulary.catalogueCategories;
  const liveCategories = useMemo(() => new Set(catalogue), [catalogue]);
  const vocabulary = useMemo(() => layoutVocabulary(view), [view]);
  const preview = effectivePreview(view, oplocId, drafts);
  const shownRules: ServiceRules = Object.fromEntries(preview.map(entry => [entry.serviceId, { categories: entry.categories, ...(entry.hidden ? { hidden: true } : {}) }]));
  // Company-level mapping: the company draft is included only while editing the company default.
  const companyShown = oplocId ? view.company.services : shownRules;
  const orphans = orphanCategories(shownRules, catalogue);
  const unmapped = unmappedCategories(companyShown, catalogue);
  const disabled = !canManage || busy;
  const reasonOk = reason.trim().length >= 8;

  const baseRule = (id: ServiceId) => serviceRuleAt(view, oplocId, id).rule;
  const draftOf = (id: ServiceId): ServiceRule => drafts[id] ?? baseRule(id);
  function edit(id: ServiceId, next: ServiceRule) {
    setStatus("");
    setDrafts(current => {
      const { [id]: removed, ...rest } = current; void removed;
      return sameServiceRule(baseRule(id), next) ? rest : { ...rest, [id]: next };
    });
  }
  const withHidden = (rule: ServiceRule, categories: string[]): ServiceRule => ({ categories, ...(rule.hidden ? { hidden: true } : {}) });
  const toggle = (id: ServiceId, category: string, included: boolean) => { const rule = draftOf(id); edit(id, withHidden(rule, setCategoryIncluded(rule.categories, category, included))); };
  const move = (id: ServiceId, category: string, delta: -1 | 1) => { const rule = draftOf(id); edit(id, withHidden(rule, moveCategory(rule.categories, category, delta))); };
  const setHidden = (id: ServiceId, hidden: boolean) => { const rule = draftOf(id); edit(id, { categories: [...rule.categories], ...(hidden ? { hidden: true } : {}) }); };

  async function run(command: Command, done: (message: string) => void) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setStatus("");
    try {
      const result = await send(command);
      done(result.message);
    } catch (caught) {
      const message = (caught as Error).message;
      if (/changed elsewhere/i.test(message)) {
        // Stale version: show the server's message, discard drafts built on the old version and load the latest layout.
        setDrafts({});
        setError(`${message} Your unsaved edits were discarded and the latest layout is being loaded.`);
        try { await reload(); } catch { /* the catalogue screen shows its own load error */ }
      } else setError(message);
    } finally { inFlight.current = false; setBusy(false); }
  }
  const save = (id: ServiceId) => {
    const draft = drafts[id]; if (!draft) return;
    const blocker = saveBlocker(view, oplocId, id, draft, reason);
    if (blocker) { setError(blocker); return; }
    void run(setServiceCategoriesCommand(view, oplocId, id, draft, reason), message => {
      setDrafts(current => { const { [id]: removed, ...rest } = current; void removed; return rest; });
      setReason(""); setStatus(message);
    });
  };
  const clearOverride = (id: ServiceId) => {
    if (!oplocId) return;
    if (!reasonOk) { setError("Record a reason of at least eight characters."); return; }
    void run(clearServiceOverrideCommand(view, oplocId, id, reason), message => {
      setDrafts(current => { const { [id]: removed, ...rest } = current; void removed; return rest; });
      setReason(""); setStatus(message);
    });
  };

  return <div className="hsl-body">
    {(orphans.length > 0 || unmapped.length > 0) && <div className="hsl-flags">
      {orphans.length > 0 && <div className="hc-warning" role="note"><AlertTriangle size={18} aria-hidden="true" />
        <div><strong>Not in any item</strong>
          <p>These categories are in {oplocId ? "this site's effective layout" : "the company layout"} but no live catalogue item has exactly that category name, so nothing can be listed from them. They have not been removed.</p>
          <ul className="hsl-names">{orphans.map(name => <li key={name}><code>{name}</code></li>)}</ul></div></div>}
      {unmapped.length > 0 && <div className="hc-warning" role="note"><AlertTriangle size={18} aria-hidden="true" />
        <div><strong>Not offered by any service</strong>
          <p>These catalogue categories are in no service at company level, so items in them cannot be booked from a portal. Nothing is added automatically; tick a box in the company default if a service should offer one.</p>
          <ul className="hsl-names">{unmapped.map(name => <li key={name}><code>{name}</code></li>)}</ul></div></div>}
    </div>}

    <div className="hsl-live" aria-live="polite">
      {status && <p className="hc-success" role="status">{status}</p>}
      {error && <p className="hc-error" role="alert">{error}</p>}
    </div>

    <div className="hsl-matrix-wrap" role="region" aria-label="Categories by service. Scroll sideways on a small screen." tabIndex={0}>
      <table className="hsl-matrix">
        <caption className="hc-sr">Tick the categories each service offers{oplocId ? " at this site" : " by default"}.</caption>
        <thead><tr>
          <th scope="col" className="hsl-sticky">Category</th>
          {preview.map(entry => <th scope="col" key={entry.serviceId}>{entry.label}
            <small>{entry.hidden ? "Hidden" : oplocId ? (entry.source === "site" ? "Overrides" : "Inherits company") : "Offered"}{entry.edited ? " · edited" : ""}</small></th>)}
        </tr></thead>
        <tbody>{vocabulary.map(category => <tr key={category}>
          <th scope="row" className="hsl-sticky"><span className="hsl-cat">{category}</span>{!liveCategories.has(category) && <span className="hc-badge hc-badge--warning">Not in any item</span>}</th>
          {preview.map(entry => <td key={entry.serviceId}><input type="checkbox" checked={entry.categories.includes(category)} disabled={disabled}
            aria-label={`${category} in ${entry.label}`} onChange={event => toggle(entry.serviceId, category, event.target.checked)} /></td>)}
        </tr>)}</tbody>
      </table>
    </div>

    <div className="hsl-reason">
      <label className="hc-field"><span>Reason for the change (required, at least 8 characters)</span>
        <input value={reason} onChange={event => setReason(event.target.value)} disabled={disabled} maxLength={500} autoComplete="off" aria-describedby="hsl-reason-hint" />
        <small id="hsl-reason-hint">Recorded with who changed what in the audit log. It is needed to save a service or clear an override.</small></label>
    </div>

    <ul className="hsl-cards" aria-label="Effective order for each service">{preview.map(entry => {
      const id = entry.serviceId, draft = drafts[id], blocker = draft ? saveBlocker(view, oplocId, id, draft, reason) : "";
      const overrides = oplocId ? view.sites[oplocId]?.services[id] !== undefined : false;
      return <li key={id} className={`hsl-card ${entry.hidden ? "is-hidden" : ""}`}>
        <div className="hsl-card__head">
          <h3>{entry.label}</h3>
          <span className="hsl-tags">
            {oplocId && <span className={`hc-tag ${overrides ? "hc-tag--overrides" : "hc-tag--inherits"}`}>{overrides ? "Overrides" : "Inherits company"}</span>}
            {entry.hidden && <span className="hc-tag hc-tag--none">Hidden from booking</span>}
            {entry.edited && <span className="hc-tag hc-tag--overrides">Unsaved edit</span>}
          </span>
        </div>
        <label className="hc-check"><input type="checkbox" checked={entry.hidden} disabled={disabled} onChange={event => setHidden(id, event.target.checked)} /> Hide {entry.label} from booking{oplocId ? " at this site" : ""}</label>
        {entry.hidden && <p className="hc-hint">Hidden: this service offers nothing. The list below is kept for when it is shown again.</p>}
        {entry.categories.length === 0 ? <p className="hc-hint">No categories{entry.hidden ? "" : ". Tick some in the matrix, or hide the service"}.</p>
          : <ol className="hsl-order" aria-label={`${entry.label} category order`}>{entry.categories.map((category, index) => <li key={category}>
            <span className="hsl-cat">{category}{!liveCategories.has(category) && <span className="hc-badge hc-badge--warning">Not in any item</span>}</span>
            <span className="hsl-move">
              <button type="button" className="hc-btn hc-btn--text hsl-iconbtn" disabled={disabled || index === 0} aria-label={`Move ${category} up in ${entry.label}`} onClick={() => move(id, category, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
              <button type="button" className="hc-btn hc-btn--text hsl-iconbtn" disabled={disabled || index === entry.categories.length - 1} aria-label={`Move ${category} down in ${entry.label}`} onClick={() => move(id, category, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
            </span></li>)}</ol>}
        {canManage && <div className="hsl-actions">
          {draft && <button type="button" className="hc-btn hc-btn--primary" disabled={disabled || Boolean(blocker)} onClick={() => save(id)}>{busy ? "Saving…" : `Save ${entry.label}`}</button>}
          {draft && <button type="button" className="hc-btn" disabled={disabled} onClick={() => edit(id, baseRule(id))}>Discard edits</button>}
          {overrides && <button type="button" className="hc-btn hc-btn--danger" disabled={disabled || !reasonOk} onClick={() => clearOverride(id)}>Clear override</button>}
        </div>}
        {canManage && draft && blocker && <p className="hc-hint" role="status">{blocker}</p>}
        {canManage && overrides && !reasonOk && <p className="hc-hint">Add a reason above to clear this override.</p>}
      </li>;
    })}</ul>
  </div>;
}
