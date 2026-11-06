"use client";

import { useMemo, useState } from "react";
import { SERVICE_IDS, type ServiceId } from "@fika/server-shared/hospitality-service-layout";
import { layoutVocabulary, SERVICE_LABELS, serviceRuleAt, type CataloguePayload } from "../../lib/hospitality-catalogue-types";
import { selectableSites } from "../../lib/hospitality-catalogue-view";
import { managerItemCounts, type ServicesContext } from "./hospitality-catalogue-ux/model";
import "./HospitalityCatalogueManager.css";

type Props = {
  payload: CataloguePayload;
  context: ServicesContext;
  onContextChange: (context: ServicesContext) => void;
  onOpenItem: (itemId: string) => void;
};

export default function HospitalityCatalogueManager({ payload, context, onContextChange, onOpenItem }: Props) {
  const [query, setQuery] = useState("");
  const sites = useMemo(() => selectableSites(payload.oplocs), [payload.oplocs]);
  const oplocId = sites.some(site => site.oplocId === context.oplocId) ? context.oplocId : undefined;
  const serviceId: ServiceId = SERVICE_IDS.find(id => id === context.serviceId) ?? SERVICE_IDS[0];
  const layout = payload.serviceLayout;
  const effective = layout ? serviceRuleAt(layout, oplocId, serviceId) : undefined;
  const vocabulary = layout ? [...new Set([...layoutVocabulary(layout), ...payload.rows.map(row => row.category).filter(Boolean)])] : [];
  const categories = effective ? [
    ...effective.rule.categories.map(name => ({ name, included: !effective.rule.hidden })),
    ...vocabulary.filter(name => !effective.rule.categories.includes(name)).map(name => ({ name, included: false })),
  ] : [];
  const category = categories.find(entry => entry.name === context.category)?.name ?? categories.find(entry => entry.included)?.name ?? categories[0]?.name;
  const categoryRows = payload.rows.filter(row => row.category === category);
  const filteredRows = categoryRows.filter(row => row.name.toLocaleLowerCase("en-GB").includes(query.trim().toLocaleLowerCase("en-GB")));
  const selected = categoryRows.find(row => row.itemId === context.itemId);
  const scopeName = oplocId ? sites.find(site => site.oplocId === oplocId)?.label : "Company default";
  const update = (patch: ServicesContext) => onContextChange(patch);

  return <section className="hcm" aria-labelledby="hcm-title">
    <header className="hcm-header">
      <div><h2 id="hcm-title">Catalogue Manager</h2><p>Browse the current service layout and catalogue items by company or site.</p></div>
      <label className="hcm-scope">Scope
        <select value={oplocId ?? ""} onChange={event => update({ oplocId: event.target.value || undefined, serviceId })}>
          <option value="">Company default</option>
          {sites.map(site => <option key={site.oplocId} value={site.oplocId}>{site.label}</option>)}
        </select>
      </label>
    </header>
    {!layout ? <p role="status" className="hcm-note">Service layout is unavailable. The existing Items editor remains available.</p> : <>
      <p className="hcm-note">Showing {scopeName} · {effective?.source === "site" ? "site override" : oplocId ? "inherits company rule" : "company rule"}. Counts show catalogue records and site permission; they do not establish customer orderability.</p>
      <div className="hcm-grid">
        <section className="hcm-pane" aria-labelledby="hcm-services"><h3 id="hcm-services">Services</h3><div className="hcm-list">
          {SERVICE_IDS.map(id => {
            const service = serviceRuleAt(layout, oplocId, id);
            return <button className="hcm-choice" type="button" key={id} aria-current={id === serviceId ? "true" : undefined} onClick={() => update({ oplocId, serviceId: id })}>
              <span>{SERVICE_LABELS[id]}</span><small>{service.rule.hidden ? "Hidden" : `${service.rule.categories.length} categories`} · {service.source === "site" ? "Site override" : "Company rule"}</small>
            </button>;
          })}
        </div></section>
        <section className="hcm-pane" aria-labelledby="hcm-categories"><h3 id="hcm-categories">Categories <small>{categories.filter(entry => entry.included).length} included</small></h3>
          {effective?.rule.hidden && <p className="hcm-note">This service is hidden at this scope. Its stored category list is shown for reference.</p>}
          <div className="hcm-list">{categories.map(entry => {
            const counts = managerItemCounts(payload.rows, entry.name, oplocId);
            return <button className="hcm-choice" type="button" key={entry.name} aria-current={entry.name === category ? "true" : undefined} onClick={() => update({ oplocId, serviceId, category: entry.name })}>
              <span>{entry.name}</span><small>{entry.included ? "Included" : "Excluded"} · {oplocId ? `${counts.sitePermitted} site-permitted` : `${counts.active} active`} · {counts.archived} archived</small>
            </button>;
          })}</div>
          {categories.length === 0 && <p className="hcm-empty">No categories in the current layout.</p>}
        </section>
        <section className="hcm-pane" aria-labelledby="hcm-items"><h3 id="hcm-items">Items <small>{categoryRows.length} records</small></h3>
          {category && <label className="hcm-search">Search items in {category}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>}
          <div className="hcm-list">{filteredRows.map(row => <button className="hcm-choice" type="button" key={row.itemId} aria-current={row.itemId === selected?.itemId ? "true" : undefined} onClick={() => update({ oplocId, serviceId, category, itemId: row.itemId })}>
            <span>{row.name}</span><small>{row.status === "archived" ? "Archived" : oplocId ? row.availableAt.includes(oplocId) ? "Active · site-permitted" : "Active · not permitted at site" : "Active"}</small>
          </button>)}</div>
          {filteredRows.length === 0 && <p className="hcm-empty">{query ? "No items match this search." : "No items in this category."}</p>}
          {selected && <div className="hcm-detail"><h4>{selected.name}</h4><p>Category: {selected.category}</p><p>Status: {selected.status}</p><button type="button" className="hc-btn" onClick={() => onOpenItem(selected.itemId)}>Open in Items editor</button></div>}
        </section>
      </div>
    </>}
  </section>;
}
