"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

type Option = { canonicalId: string; label: string };
type Area = Option & { oplocId: string };
type Arrangement = {
  canonicalId: string; serviceDefinitionId: string; serviceLabel: string;
  oplocId: string; oplocLabel: string; operationalAreaId?: string;
  operationalAreaLabel?: string; effectiveFrom: string; effectiveTo?: string;
  lifecycleState: "active" | "archived"; operationalNotes?: string; version: number;
};
type Data = { today: string; serviceDefinitions: Option[]; oplocs: Option[]; areas: Area[]; arrangements: Arrangement[] };
type Draft = Partial<Arrangement> & { oplocWide?: boolean };

export default function ServiceArrangementsPanel({ canManage, refreshSession, initialOplocId, initialAreaId }: {
  canManage: boolean; refreshSession: () => Promise<boolean>; initialOplocId?: string; initialAreaId?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [oplocFilter, setOplocFilter] = useState(initialOplocId || "");
  const [areaFilter, setAreaFilter] = useState(initialAreaId || "");
  const [typeFilter, setTypeFilter] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<"active" | "archived" | "all">("active");
  const [error, setError] = useState("");

  async function load() {
    try {
      const request = () => fetch("/api/service-arrangements", { cache: "no-store" });
      let response = await request();
      if (response.status === 401 && await refreshSession()) response = await request();
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message || "Service Arrangements could not be loaded.");
      setData(body); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  const selectedAreas = data?.areas.filter(area => area.oplocId === draft?.oplocId) || [];
  const filterAreas = data?.areas.filter(area => !oplocFilter || area.oplocId === oplocFilter) || [];
  const visible = useMemo(() => data?.arrangements.filter(item =>
    (lifecycleFilter === "all" || item.lifecycleState === lifecycleFilter) &&
    (!oplocFilter || item.oplocId === oplocFilter) &&
    (!areaFilter || item.operationalAreaId === areaFilter) &&
    (!typeFilter || item.serviceDefinitionId === typeFilter) &&
    `${item.serviceLabel} ${item.oplocLabel} ${item.operationalAreaLabel || ""}`.toLowerCase().includes(query.toLowerCase())
  ) || [], [data, query, oplocFilter, areaFilter, typeFilter, lifecycleFilter]);

  function startCreate() {
    const initialArea = initialAreaId || (initialOplocId ? data?.areas.find(area => area.oplocId === initialOplocId)?.canonicalId : undefined);
    setDraft({ serviceDefinitionId: data?.serviceDefinitions[0]?.canonicalId || "", oplocId: initialOplocId || "", operationalAreaId: initialArea, oplocWide: false, effectiveFrom: data?.today || "", lifecycleState: "active" });
  }
  async function save() {
    if (!draft || !data) return;
    try {
      const body = {
        action: "save-service-arrangement",
        ...(draft.canonicalId ? { canonicalId: draft.canonicalId, expectedVersion: draft.version } : {}),
        serviceDefinitionId: draft.serviceDefinitionId,
        oplocId: draft.oplocId,
        ...(!draft.oplocWide && draft.operationalAreaId ? { operationalAreaId: draft.operationalAreaId } : {}),
        effectiveFrom: draft.effectiveFrom,
        ...(draft.effectiveTo ? { effectiveTo: draft.effectiveTo } : {}),
        ...(draft.operationalNotes ? { operationalNotes: draft.operationalNotes } : {}),
        lifecycleState: draft.lifecycleState || "active"
      };
      const request = () => fetch("/api/operational-configuration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      let response = await request();
      if (response.status === 401 && await refreshSession()) response = await request();
      const result = await response.json();
      if (!response.ok) throw Error(result.error?.message || "Service Arrangement could not be saved.");
      setDraft(null); await load();
    } catch (cause) { setError((cause as Error).message); }
  }
  const canSave = Boolean(draft?.serviceDefinitionId && draft?.oplocId && draft?.effectiveFrom && (draft.oplocWide || draft.operationalAreaId));

  return <section className="connection-section">
    <header><div><h3>Service Arrangements</h3><p className="form-help">Location-specific delivery of a reusable service type.</p></div>
      {canManage && <button className="connection-action" onClick={startCreate}><Plus /> Add service arrangement</button>}
    </header>
    <div className="connection-filters">
      <label>Search<input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>OPLOC<select value={oplocFilter} onChange={event => { setOplocFilter(event.target.value); setAreaFilter(""); }}><option value="">All OPLOCs</option>{data?.oplocs.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.label}</option>)}</select></label>
      <label>Operational Area<select value={areaFilter} onChange={event => setAreaFilter(event.target.value)}><option value="">All areas</option>{filterAreas.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.label}</option>)}</select></label>
      <label>Service type<select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="">All service types</option>{data?.serviceDefinitions.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.label}</option>)}</select></label>
      <label>Lifecycle<select value={lifecycleFilter} onChange={event => setLifecycleFilter(event.target.value as "active" | "archived" | "all")}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All lifecycle states</option></select></label>
    </div>
    {error && <p className="error">{error}</p>}
    <div className="connection-list">{visible.map(item => <article className="connection-row" key={item.canonicalId}><div><b>{item.serviceLabel}</b><span>{item.oplocLabel} · {item.operationalAreaLabel || "OPLOC-wide"} · {item.lifecycleState}</span><small>{item.effectiveFrom}{item.effectiveTo ? ` to ${item.effectiveTo}` : " onwards"}</small><details><summary>Technical details</summary><p>{item.canonicalId}</p></details></div></article>)}</div>
    {!visible.length && <p className="empty">No Service Arrangements match these filters.</p>}
    {draft && <div className="detail-backdrop" role="dialog" aria-modal="true" aria-label="Add service arrangement"><section className="detail-modal connection-dialog"><header><div><small>Governed Service Arrangement</small><h2>{draft.canonicalId ? "Edit service arrangement" : "Add service arrangement"}</h2></div><button className="icon" onClick={() => setDraft(null)} aria-label="Close"><X /></button></header><div className="connection-dialog-body">
      <label>Service type<select value={draft.serviceDefinitionId || ""} onChange={event => setDraft({ ...draft, serviceDefinitionId: event.target.value })}><option value="">Choose service type</option>{data?.serviceDefinitions.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.label}</option>)}</select></label>
      <label>OPLOC<select value={draft.oplocId || ""} onChange={event => { const oplocId = event.target.value; const area = data?.areas.find(candidate => candidate.oplocId === oplocId); setDraft({ ...draft, oplocId, operationalAreaId: area?.canonicalId, oplocWide: false }); }}><option value="">Choose OPLOC</option>{data?.oplocs.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.label}</option>)}</select></label>
      <label className="checkbox-field"><input type="checkbox" checked={Boolean(draft.oplocWide)} onChange={event => setDraft({ ...draft, oplocWide: event.target.checked, operationalAreaId: event.target.checked ? undefined : selectedAreas[0]?.canonicalId })} /> This is OPLOC-wide</label>
      {draft.oplocId && !draft.oplocWide && <label>Operational Area<select value={draft.operationalAreaId || ""} onChange={event => setDraft({ ...draft, operationalAreaId: event.target.value })}><option value="">Choose Operational Area</option>{selectedAreas.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.label}</option>)}</select></label>}
      {draft.oplocId && !draft.oplocWide && !selectedAreas.length && <p className="form-help">No Operational Areas are available for this OPLOC. Select “This is OPLOC-wide” to continue.</p>}
      <label>Effective from<input type="date" value={draft.effectiveFrom || ""} onChange={event => setDraft({ ...draft, effectiveFrom: event.target.value })} /></label><label>Effective until (optional)<input type="date" value={draft.effectiveTo || ""} onChange={event => setDraft({ ...draft, effectiveTo: event.target.value })} /></label><label className="wide-field">Operational notes<textarea value={draft.operationalNotes || ""} onChange={event => setDraft({ ...draft, operationalNotes: event.target.value })} /></label>
    </div><footer className="modal-actions"><button onClick={() => setDraft(null)}>Cancel</button><button className="primary" disabled={!canSave} onClick={() => void save()}>Save service arrangement</button></footer></section></div>}
  </section>;
}
