"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SERVICE_IDS, type ServiceId, type ServiceRule } from "@fika/server-shared/hospitality-service-layout";
import {
  SERVICE_LABELS, clearServiceOverrideCommand, layoutVocabulary, saveBlocker,
  moveCategory, serviceRuleAt, setCategoryIncluded, setServiceCategoriesCommand,
  type CataloguePayload, type ServiceLayoutView,
} from "../../lib/hospitality-catalogue-types";
import { oplocLabel, selectableSites } from "../../lib/hospitality-catalogue-view";
import "./HospitalityCatalogueServices.css";

type Command = Record<string, unknown> & { action: string };
export type CatalogueServicesSend = (command: Command) => Promise<{ message: string }>;
export type ServicesContext = { oplocId?: string; serviceId?: ServiceId; category?: string; itemId?: string };
export type CatalogueServicesView = "services" | "locations";

type Props = {
  payload: CataloguePayload;
  canManage: boolean;
  send: CatalogueServicesSend;
  reload: () => Promise<void>;
  view: CatalogueServicesView;
  initialContext?: ServicesContext;
  onContextChange?: (context: ServicesContext) => void;
};

export function siteServiceDraft(rule: ServiceRule, enabled: boolean): ServiceRule {
  return { categories: [...rule.categories], ...(!enabled ? { hidden: true } : {}) };
}

export function activeItemsInCategory(rows: CataloguePayload["rows"], category: string): number {
  return rows.filter(row => row.status === "active" && row.category === category).length;
}

export function inheritingLocationCount(view: ServiceLayoutView, activeOplocIds: readonly string[], serviceId: ServiceId): number {
  return activeOplocIds.filter(oplocId => view.sites[oplocId]?.services[serviceId] === undefined).length;
}

const sameRule = (a: ServiceRule, b: ServiceRule) => a.categories.length === b.categories.length
  && a.categories.every((category, index) => category === b.categories[index])
  && Boolean(a.hidden) === Boolean(b.hidden);

function ruleStatus(rule: ServiceRule) { return rule.hidden ? "Hidden" : "Visible"; }

/**
 * Company-first editor for the existing Hospitality booking services plus a location-scoped view.
 * Writes only the current versioned service-layout commands. Categories remain exact canonical strings.
 */
export default function HospitalityCatalogueServices({ payload, canManage, send, reload, view: pageView, initialContext, onContextChange }: Props) {
  const layout = payload.serviceLayout;
  const sites = useMemo(() => selectableSites(payload.oplocs), [payload.oplocs]);
  const [serviceId, setServiceId] = useState<ServiceId | "">(initialContext?.serviceId ?? (pageView === "services" ? "dining" : ""));
  const [oplocId, setOplocId] = useState(() => sites.some(site => site.oplocId === initialContext?.oplocId) ? initialContext?.oplocId ?? "" : "");
  const [contextCategory, setContextCategory] = useState(initialContext?.category);
  const [itemId, setItemId] = useState(initialContext?.itemId ?? "");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<ServiceRule | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const appliedContext = useRef({ view: pageView, oplocId, serviceId });

  useEffect(() => {
    const nextSite = sites.some(site => site.oplocId === initialContext?.oplocId) ? initialContext?.oplocId ?? "" : "";
    const nextService = initialContext?.serviceId ?? (pageView === "services" ? "dining" : "");
    const previous = appliedContext.current;
    const scopeChanged = previous.view !== pageView || previous.oplocId !== nextSite || previous.serviceId !== nextService;
    setOplocId(nextSite);
    setServiceId(nextService);
    setContextCategory(initialContext?.category);
    setItemId(initialContext?.itemId ?? "");
    if (scopeChanged) {
      setDraft(null); setReason(""); setConfirmed(false); setError(""); setStatus("");
    }
    appliedContext.current = { view: pageView, oplocId: nextSite, serviceId: nextService };
  }, [pageView, initialContext?.oplocId, initialContext?.serviceId, initialContext?.category, initialContext?.itemId, sites]);

  if (!layout) return <section className="hcs" aria-labelledby="hcs-title"><h2 id="hcs-title">{pageView === "services" ? "Services" : "Locations"}</h2><p className="hc-note" role="status">Booking service settings were not included in this load. Reload the catalogue before editing.</p></section>;
  const currentLayout = layout;

  const currentService = serviceId ? SERVICE_LABELS[serviceId] : "";
  const chosenSite = sites.find(site => site.oplocId === oplocId);
  const siteLabel = chosenSite?.label ?? "";
  const contextItem = itemId ? payload.rows.find(row => row.itemId === itemId) : undefined;
  const isLocations = pageView === "locations";
  const scopeId = isLocations ? (chosenSite ? oplocId : undefined) : undefined;
  const activeSiteIds = sites.map(site => site.oplocId);
  const vocabulary = layoutVocabulary(layout);
  const visibleServices = SERVICE_IDS.filter(id => SERVICE_LABELS[id].toLocaleLowerCase("en-GB").includes(query.trim().toLocaleLowerCase("en-GB")));
  const selectedRule = serviceId ? serviceRuleAt(layout, scopeId, serviceId).rule : undefined;
  const source = serviceId ? serviceRuleAt(layout, scopeId, serviceId).source : undefined;
  const siteOverride = isLocations && serviceId && oplocId ? layout.sites[oplocId]?.services[serviceId] !== undefined : false;
  const shownRule = draft ?? selectedRule;
  const baseRule: ServiceRule = selectedRule ?? { categories: [], hidden: true };
  const changed = Boolean(selectedRule && shownRule && !sameRule(selectedRule, shownRule));
  const blocker = serviceId && shownRule ? saveBlocker(layout, scopeId, serviceId, shownRule, reason) : "Choose a service to continue.";
  const scopeDescription = !isLocations
    ? `Company-wide ${currentService}`
    : chosenSite && currentService ? `Only ${siteLabel} ${currentService}` : "Choose one location and service";
  const expectedLocationCount = serviceId ? inheritingLocationCount(layout, activeSiteIds, serviceId) : 0;
  const customLocationCount = serviceId ? activeSiteIds.length - expectedLocationCount : 0;
  const categories = shownRule?.categories ?? [];
  const orderedVocabulary = [...categories, ...vocabulary.filter(category => !categories.includes(category))];

  function updateContext(next: ServicesContext) {
    onContextChange?.({ ...next, ...(contextCategory ? { category: contextCategory } : {}), ...(itemId ? { itemId } : {}) });
  }
  function chooseService(next: ServiceId | "") {
    setServiceId(next); setDraft(null); setReason(""); setConfirmed(false); setStatus(""); setError("");
    appliedContext.current = { view: pageView, oplocId: isLocations ? oplocId : "", serviceId: next };
    updateContext({ ...(isLocations && oplocId ? { oplocId } : {}), ...(next ? { serviceId: next } : {}) });
  }
  function chooseSite(next: string) {
    setOplocId(next); setServiceId(""); setDraft(null); setReason(""); setConfirmed(false); setStatus(""); setError("");
    appliedContext.current = { view: pageView, oplocId: next, serviceId: "" };
    updateContext(next ? { oplocId: next } : {});
  }
  function setCategory(category: string, included: boolean) {
    if (!selectedRule) return;
    setStatus(""); setError(""); setConfirmed(false);
    setDraft(current => {
      const base = current ?? baseRule;
      const categories = setCategoryIncluded(base.categories, category, included);
      return { categories, ...(base.hidden ? { hidden: true } : {}) };
    });
  }
  function setEnabled(enabled: boolean) {
    if (!selectedRule) return;
    setStatus(""); setError(""); setConfirmed(false);
    setDraft(current => siteServiceDraft(current ?? baseRule, enabled));
  }
  function reorderCategory(category: string, delta: -1 | 1) {
    if (!selectedRule) return;
    setStatus(""); setError(""); setConfirmed(false);
    setDraft(current => {
      const base = current ?? baseRule;
      const next = moveCategory(base.categories, category, delta);
      return { categories: next, ...(base.hidden ? { hidden: true } : {}) };
    });
  }
  async function commit(command: Command, successMessage: (message: string) => string) {
    if (inFlight.current || !canManage) return;
    inFlight.current = true; setBusy(true); setError(""); setStatus("");
    try {
      const result = await send(command);
      setDraft(null); setReason(""); setConfirmed(false); setStatus(successMessage(result.message));
    } catch (caught) {
      const message = (caught as Error).message;
      if (/changed elsewhere/i.test(message)) {
        setDraft(null); setReason(""); setConfirmed(false);
        setError(`${message} Your draft was discarded and the latest settings are loading.`);
        try { await reload(); } catch { /* The parent catalogue reports its own load failure. */ }
      } else setError(message);
    } finally { inFlight.current = false; setBusy(false); }
  }
  function save() {
    if (!serviceId || !shownRule) return;
    if (blocker) { setError(blocker); return; }
    if (!confirmed) { setError(`Confirm the scope: ${scopeDescription}.`); return; }
    const target = scopeId;
    void commit(setServiceCategoriesCommand(currentLayout, target, serviceId, shownRule, reason), message => {
      const state = isLocations ? ` Saved for ${siteLabel} only.` : ` Saved to the company ${currentService} template.`;
      return `${message}${state} Portal serving still depends on the site's connected booking consumer.`;
    });
  }
  function resetToCompany() {
    if (!serviceId || !oplocId) return;
    if (reason.trim().length < 8) { setError("Record a reason of at least eight characters."); return; }
    if (!confirmed) { setError(`Confirm the scope: ${scopeDescription}.`); return; }
    void commit(clearServiceOverrideCommand(currentLayout, oplocId, serviceId, reason), message => `${message} ${siteLabel} now follows the company ${currentService} settings. Portal serving still depends on the site's connected booking consumer.`);
  }
  const savingDisabled = !canManage || busy || !changed || Boolean(blocker) || !confirmed;
  const reasonOk = reason.trim().length >= 8;

  return <section className="hcs" aria-labelledby="hcs-title">
    <header className="hcs-head">
      <div><h2 id="hcs-title">{isLocations ? "Location availability" : "Company booking services"}</h2>
        <p>{isLocations
          ? "Choose one location to review its effective services. A service setting does not grant Item permission or a valid price."
          : "Edit the company template used by locations that inherit it. Site-specific layouts remain in place until reviewed separately."}</p>
      </div>
      {!canManage && <span className="hc-viewonly" role="status">View only: you do not have permission to change booking services.</span>}
    </header>

    <div className="hcs-live" aria-live="polite">{status && <p className="hc-success" role="status">{status}</p>}{error && <p className="hc-error" role="alert">{error}</p>}</div>

    {isLocations && <div className="hcs-site-picker">
      <label className="hc-field"><span>Location</span><select value={oplocId} onChange={event => chooseSite(event.target.value)}>
        <option value="">Choose a location…</option>{sites.map(site => <option key={site.oplocId} value={site.oplocId}>{site.label}</option>)}
      </select></label>
      {chosenSite && <p className="hc-hint">{siteLabel} follows company setup except where a service is marked <span className="hc-tag hc-tag--overrides">Custom for this location</span>. Configured Hub settings do not prove the public booking portal serves this location.</p>}
    </div>}

    {contextItem && <p className="hcs-origin-item"><strong>Opened from Item:</strong> {contextItem.name} · {contextItem.category}. Service categories apply to all eligible Items in that exact category; this screen does not save per-Item service membership.</p>}

    {(!isLocations || chosenSite) && <div className="hcs-layout">
      <aside className="hcs-list" aria-label={isLocations ? `${siteLabel} services` : "Company booking services"}>
        <label className="hc-field"><span>Find a booking service</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search services" /></label>
        <p className="hc-count">{visibleServices.length} of {SERVICE_IDS.length} existing services</p>
        <ul>{visibleServices.map(id => {
          const rule = serviceRuleAt(layout, scopeId, id).rule;
          const isSelected = id === serviceId;
          return <li key={id}><button type="button" className={`hcs-service-choice${isSelected ? " is-selected" : ""}`} aria-pressed={isSelected} onClick={() => chooseService(id)}>
            <span className="hcs-service-title">{SERVICE_LABELS[id]}<span className={`hc-tag ${rule.hidden ? "hc-tag--none" : "hc-tag--inherits"}`}>{ruleStatus(rule)}</span></span>
            <small>{rule.categories.length} categor{rule.categories.length === 1 ? "y" : "ies"} · {new Set(payload.rows.filter(row => row.status === "active" && rule.categories.includes(row.category)).map(row => row.itemId)).size} active category Items</small>
          </button></li>;
        })}</ul>
        {visibleServices.length === 0 && <p className="hc-empty">No existing services match that search.</p>}
      </aside>

      {serviceId && shownRule ? <main className="hcs-editor" aria-label={`${scopeDescription} editor`}>
        <header className="hcs-editor-head">
          <div><p className="hc-kicker">{isLocations ? siteLabel : "Company-wide definition"}</p><h3>{currentService}</h3>
            <p>{isLocations ? "This setting changes this location and service only." : `This template affects ${expectedLocationCount} inheriting active locations; ${customLocationCount} active locations have custom ${currentService} settings and will keep them.`}</p>
          </div>
          {isLocations && <span className={`hc-tag ${siteOverride ? "hc-tag--overrides" : "hc-tag--inherits"}`}>{siteOverride ? "Custom for this location" : "Inherits company"}</span>}
        </header>

        {isLocations ? <section className="hcs-section" aria-labelledby="hcs-availability-title">
          <h4 id="hcs-availability-title">Service availability at {siteLabel}</h4>
          <p>Turning a service off keeps its category list. Item site permission and effective price are managed separately.</p>
          <label className="hc-check hcs-toggle"><input type="checkbox" checked={!shownRule.hidden} disabled={!canManage || busy} onChange={event => setEnabled(event.target.checked)} /> <span><strong>{shownRule.hidden ? "Disabled" : "Enabled"} at {siteLabel}</strong> · {source === "company" && !draft ? "Inherits the company setting" : "Custom service setting"}</span></label>
          {baseRule.hidden !== shownRule.hidden && <div className="hcs-review"><strong>Review this location-only change</strong><p>Before: {baseRule.hidden ? "Disabled" : "Enabled"}. After: {shownRule.hidden ? "Disabled" : "Enabled"}. Only {siteLabel} {currentService} changes.</p><p>Categories stay as: {shownRule.categories.join(", ") || "none"}.</p></div>}
        </section> : <section className="hcs-section" aria-labelledby="hcs-status-title">
          <h4 id="hcs-status-title">Company setting</h4>
          <p>Hide/show is a company-level visibility setting, separate from archiving a service. Existing site overrides may continue to differ.</p>
          <label className="hc-check hcs-toggle"><input type="checkbox" checked={!shownRule.hidden} disabled={!canManage || busy} onChange={event => setDraft(current => { const base = current ?? baseRule; return { categories: [...base.categories], ...(event.target.checked ? {} : { hidden: true }) }; })} /> <span><strong>{shownRule.hidden ? "Hidden" : "Visible"} in the company template</strong></span></label>
          {baseRule.hidden !== shownRule.hidden && <div className="hcs-review"><strong>Review company visibility</strong><p>Before: {baseRule.hidden ? "Hidden" : "Visible"}. After: {shownRule.hidden ? "Hidden" : "Visible"}. Site overrides are not changed automatically.</p></div>}
        </section>}

        {!isLocations && <section className="hcs-section" aria-labelledby="hcs-categories-title">
          <div className="hcs-section-head"><div><h4 id="hcs-categories-title">Categories in {currentService}</h4><p>Categories match their exact names. Adding one makes active Items in that category eligible for this service, subject to each site's rules.</p></div>
            <span className="hc-tag hc-tag--inherits">{categories.length} included</span></div>
          {categories.length === 0 && shownRule.hidden && <p className="hc-hint">No categories are included. The hidden service can keep an empty list until it is shown again.</p>}
          <ul className="hcs-categories">{orderedVocabulary.map(category => {
            const included = categories.includes(category);
            const count = activeItemsInCategory(payload.rows, category);
            const hasOrphan = included && count === 0;
            const orderIndex = categories.indexOf(category);
            return <li key={category}>
              <label className="hc-check"><input type="checkbox" checked={included} disabled={!canManage || busy} onChange={event => setCategory(category, event.target.checked)} />
                <span><strong>{category}</strong><small>{count} active catalogue Item{count === 1 ? "" : "s"}{hasOrphan ? " · no active Items use this exact category name" : " · candidate count, not an orderability count"}</small></span></label>
              {contextItem?.category === category && <span className="hc-badge hc-badge--neutral">From selected Item</span>}
              {hasOrphan && <span className="hc-badge hc-badge--warning">No active Items</span>}
              {included && <span className="hcs-order-actions"><button type="button" className="hc-btn hc-btn--text" aria-label={`Move ${category} up in ${currentService}`} disabled={!canManage || busy || orderIndex === 0} onClick={() => reorderCategory(category, -1)}><span aria-hidden="true">↑</span></button><button type="button" className="hc-btn hc-btn--text" aria-label={`Move ${category} down in ${currentService}`} disabled={!canManage || busy || orderIndex === categories.length - 1} onClick={() => reorderCategory(category, 1)}><span aria-hidden="true">↓</span></button></span>}
            </li>;
          })}</ul>
          {categories.length > 0 && <div className="hcs-review"><strong>Before → after</strong><p>{baseRule.categories.join(", ") || "none"} → {categories.join(", ") || "none"}</p>
            <p>{expectedLocationCount} active locations inherit this company service. {customLocationCount} locations have custom settings and will not change.</p></div>}
        </section>}

        {isLocations && <section className="hcs-section" aria-labelledby="hcs-effective-categories-title">
          <div className="hcs-section-head"><div><h4 id="hcs-effective-categories-title">Effective categories at {siteLabel}</h4>
            <p>{siteOverride ? "This location's service rule replaces the company category list." : "This service follows the current company category list."} You can edit categories after selecting the service here; changes are limited to this site.</p></div>
          </div>
          <ul className="hcs-categories">{orderedVocabulary.map(category => {
            const included = categories.includes(category), count = activeItemsInCategory(payload.rows, category);
            const orderIndex = categories.indexOf(category);
            return <li key={category}><label className="hc-check"><input type="checkbox" checked={included} disabled={!canManage || busy} onChange={event => setCategory(category, event.target.checked)} />
              <span><strong>{category}</strong><small>{count} active catalogue Item{count === 1 ? "" : "s"}{count === 0 ? " · no active Items use this exact category name" : " · candidates across the catalogue, not an orderability count"}</small></span></label>
              {included && <span className="hcs-order-actions"><button type="button" className="hc-btn hc-btn--text" aria-label={`Move ${category} up in ${currentService}`} disabled={!canManage || busy || orderIndex === 0} onClick={() => reorderCategory(category, -1)}><span aria-hidden="true">↑</span></button><button type="button" className="hc-btn hc-btn--text" aria-label={`Move ${category} down in ${currentService}`} disabled={!canManage || busy || orderIndex === categories.length - 1} onClick={() => reorderCategory(category, 1)}><span aria-hidden="true">↓</span></button></span>}
            </li>;
          })}</ul>
          {changed && <div className="hcs-review"><strong>Before → after at {siteLabel}</strong><p>{baseRule.categories.join(", ") || "none"} → {categories.join(", ") || "none"}</p><p>Only {siteLabel} {currentService} changes; company settings and other locations are unchanged.</p></div>}
        </section>}

        {canManage && (changed || (isLocations && siteOverride)) && <section className="hcs-save" aria-labelledby="hcs-save-title">
          <h4 id="hcs-save-title">Review and save</h4>
          <p><strong>Scope:</strong> {scopeDescription}. {isLocations ? "Other locations and the company default remain unchanged." : `${customLocationCount} custom site layouts remain unchanged.`}</p>
          {blocker && <p className="hc-hint" role="status">{blocker}</p>}
          <label className="hc-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => { setConfirmed(event.target.checked); setError(""); }} /> <span>I confirm this change applies to {scopeDescription} only.</span></label>
          <label className="hc-field"><span>Reason for the change (required, at least 8 characters)</span><input value={reason} onChange={event => { setReason(event.target.value); setError(""); }} disabled={busy} maxLength={500} autoComplete="off" /></label>
          <div className="hcs-actions">{changed && <button type="button" className="hc-btn hc-btn--primary" disabled={savingDisabled} onClick={save}>{busy ? "Saving…" : `Save ${isLocations ? `${siteLabel} ` : "company "}${currentService}`}</button>}
            {changed && <button type="button" className="hc-btn" disabled={busy} onClick={() => { setDraft(null); setReason(""); setConfirmed(false); setError(""); setStatus(""); }}>Cancel edits</button>}
            {isLocations && siteOverride && <button type="button" className="hc-btn hc-btn--text" disabled={busy || !reasonOk || !confirmed} onClick={resetToCompany}>Reset this service to company setup</button>}
          </div>
          {blocker && <p className="hc-hint">{blocker}</p>}
        </section>}
        {!canManage && <p className="hc-hint">This view is read only. Service rules are managed through the existing authorised Hub workflow.</p>}
      </main> : <div className="hcs-empty"><h3>{isLocations ? "Choose a booking service" : "Choose a booking service"}</h3><p>Select one service to review its effective categories and settings. Opening this page does not change any data.</p></div>}
    </div>}
    {isLocations && !chosenSite && <p className="hcs-empty">Choose an active location to review its service settings.</p>}
    {isLocations && chosenSite && !serviceId && <p className="hcs-portal-note">Configured Hub service settings do not prove customer availability. Verify the location's published package and booking portal before describing a service as customer-orderable.</p>}
  </section>;
}
