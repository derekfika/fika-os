"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, PackagePlus, RotateCcw, Trash2, X } from "lucide-react";
import ConfirmationModal from "./ConfirmationModal";

type EquipmentType = { canonicalId: string; name: string; description?: string; category?: string; lifecycleState: "active" | "retired"; version: number; assetUsageCount: number; historicUsage: boolean; canDelete: boolean };
type Draft = { canonicalId?: string; expectedVersion?: number; name: string; description: string; category: string };

export default function EquipmentTypesPanel({ canManage, refreshSession }: { canManage: boolean; refreshSession: () => Promise<boolean> }) {
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "archived">("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<EquipmentType | null>(null);
  async function load() {
    try {
      const request = () => fetch("/api/equipment-types", { cache: "no-store" });
      let response = await request();
      if (response.status === 401 && await refreshSession()) response = await request();
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Equipment Types could not be loaded.");
      setTypes(body.equipmentTypes || []); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => types.filter(type => (filter === "all" || (filter === "active" ? type.lifecycleState === "active" : type.lifecycleState === "retired")) && `${type.name} ${type.description || ""} ${type.category || ""}`.toLowerCase().includes(query.trim().toLowerCase())), [types, filter, query]);
  async function mutate(command: Record<string, unknown>) {
    setSaving(true); setError("");
    try {
      const request = () => fetch("/api/equipment-types", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
      let response = await request();
      if (response.status === 401 && await refreshSession()) response = await request();
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Equipment Type could not be updated.");
      setDraft(null); setConfirmation(null); await load();
    } catch (cause) { setError((cause as Error).message); } finally { setSaving(false); }
  }
  return <section className="connection-workspace equipment-types-workspace">
    <section className="connection-section"><header><div><h3>Equipment Types</h3><p className="form-help">Controlled reusable catalogue for durable assets. Archived types remain on existing assets and historical records, but are unavailable for new assets.</p></div>{canManage && <button className="connection-action" onClick={() => setDraft({ name: "", description: "", category: "" })}><PackagePlus /> Add equipment type</button>}</header>
      <div className="connection-filters"><label>Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search names and descriptions" /></label><label>Status<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All statuses</option><option value="active">Active</option><option value="archived">Archived</option></select></label><span>{visible.length} of {types.length} type{types.length === 1 ? "" : "s"}</span></div>
      {error && <p className="error">{error}</p>}
      {!types.length && !error ? <p className="empty">No governed Equipment Types yet. Add a type before registering an Equipment Asset.</p> : <div className="connection-list">{visible.map(type => <article className="connection-row" key={type.canonicalId}><Archive aria-hidden="true" /><div><b>{type.name}</b><span><span className={`status ${type.lifecycleState === "active" ? "status--approved" : "status--partial"}`}>{type.lifecycleState === "active" ? "Active" : "Archived"}</span> · {type.assetUsageCount} asset record{type.assetUsageCount === 1 ? "" : "s"}{type.historicUsage ? " · historical usage retained" : ""}</span>{type.category && <small>{type.category}</small>}{type.description && <small>{type.description}</small>}<details><summary>Technical details</summary><p>{type.canonicalId}</p><p>Version {type.version}</p></details></div>{canManage && <div className="actions"><button onClick={() => setDraft({ canonicalId: type.canonicalId, expectedVersion: type.version, name: type.name, description: type.description || "", category: type.category || "" })}>Edit</button>{type.lifecycleState === "active" ? <button onClick={() => void mutate({ action: "archive", canonicalId: type.canonicalId, expectedVersion: type.version, name: type.name, ...(type.description ? { description: type.description } : {}), ...(type.category ? { category: type.category } : {}) })}>Archive</button> : <button onClick={() => void mutate({ action: "restore", canonicalId: type.canonicalId, expectedVersion: type.version, name: type.name, ...(type.description ? { description: type.description } : {}), ...(type.category ? { category: type.category } : {}) })}><RotateCcw /> Restore</button>}{type.canDelete && <button className="danger" onClick={() => setConfirmation(type)}><Trash2 /> Delete</button>}</div>}</article>)}</div>}
    </section>
    {draft && <EquipmentTypeDialog draft={draft} close={() => setDraft(null)} saving={saving} save={(next) => mutate({ action: "save", ...(next.canonicalId ? { canonicalId: next.canonicalId, expectedVersion: next.expectedVersion } : {}), name: next.name, ...(next.description.trim() ? { description: next.description.trim() } : {}), ...(next.category.trim() ? { category: next.category.trim() } : {}) })} />}
    {confirmation && <ConfirmationModal title={`Delete Equipment Type “${confirmation.name}”?`} description="This permanently deletes an unused Equipment Type and cannot be undone." confirmLabel="Delete Equipment Type" destructive busy={saving} onCancel={() => setConfirmation(null)} onConfirm={() => mutate({ action: "delete", canonicalId: confirmation.canonicalId, expectedVersion: confirmation.version })} />}
  </section>;
}

function EquipmentTypeDialog({ draft, close, saving, save }: { draft: Draft; close: () => void; saving: boolean; save: (draft: Draft) => void }) {
  const [value, setValue] = useState(draft);
  return <div className="detail-backdrop" role="dialog" aria-modal="true" aria-label={draft.canonicalId ? "Edit Equipment Type" : "Add Equipment Type"}><section className="detail-modal connection-dialog"><header><div><small>Governed controlled catalogue</small><h2>{draft.canonicalId ? "Edit Equipment Type" : "Add Equipment Type"}</h2></div><button className="icon" aria-label="Close" onClick={close}><X /></button></header><div className="connection-dialog-body"><label>Name<input autoFocus required value={value.name} onChange={event => setValue({ ...value, name: event.target.value })} placeholder="e.g. Espresso machine" /></label><label>Category (optional)<input value={value.category} onChange={event => setValue({ ...value, category: event.target.value })} /></label><label>Description (optional)<textarea value={value.description} onChange={event => setValue({ ...value, description: event.target.value })} /></label>{draft.canonicalId && <details><summary>Technical details</summary><p>{draft.canonicalId}</p></details>}</div><footer className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" disabled={saving || !value.name.trim()} onClick={() => save(value)}>{saving ? "Saving…" : "Save Equipment Type"}</button></footer></section></div>;
}
