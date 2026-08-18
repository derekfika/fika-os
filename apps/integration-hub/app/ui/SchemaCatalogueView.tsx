"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Search, X } from "lucide-react";
import type { CatalogueSchema } from "@/lib/schema-catalogue";
import { isImportDeferred } from "@/lib/import-policy";

type CatalogueResponse = { schemas: CatalogueSchema[]; counts: Record<string, number> };

export default function SchemaCatalogueView({ refreshSession }: { refreshSession: () => Promise<boolean> }) {
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CatalogueSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const request = () => fetch("/api/schemas", { cache: "no-store", signal: controller.signal });
        let response = await request();
        if (response.status === 401 && await refreshSession()) response = await request();
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Schema Catalogue could not be loaded.");
        setData(body); setError("");
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError((cause as Error).message);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [refreshSession]);

  const schemas = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.schemas || []).filter(schema => !query || [schema.title, schema.entityType, schema.schemaId, schema.description].join(" ").toLowerCase().includes(query));
  }, [data, search]);

  return <>
    <section className="heading"><small>Deliberate canonical contracts</small><h2>Schema Catalogue</h2><p>Review the versioned definitions canonical records must satisfy. Imported record shapes never create or alter these definitions.</p></section>
    {error && <div className="error"><AlertTriangle />{error}</div>}
    <section className="schema-summary" aria-live="polite"><b>{data?.schemas.length || 0} definitions</b><span>{Object.values(data?.counts || {}).reduce((sum, count) => sum + count, 0)} conforming canonical records</span>{loading && <span>Loading…</span>}</section>
    <label className="catalogue-search">Search schema definitions<input value={search} onChange={event => setSearch(event.target.value)} placeholder="OPLOC, Legend, Source Mapping…"/><Search /></label>
    {!loading && !schemas.length ? <div className="empty"><BookOpen /><b>No schema definitions match this search.</b></div> : <section className="schema-grid" aria-label="Canonical schema definitions">{schemas.map(schema => <button className="schema-card" key={schema.schemaId} onClick={() => setSelected(schema)} aria-label={`Open ${schema.title} schema version ${schema.version}`}><header><span>{schema.definitionStatus.replaceAll("-", " ")}</span><b>v{schema.version}</b></header><h3>{schema.title}</h3><p>{schema.description}</p><footer><span>{schema.fields.length} fields</span><span>{data?.counts[schema.entityType] || 0} records</span></footer></button>)}</section>}
    {selected && <SchemaDetail schema={selected} recordCount={data?.counts[selected.entityType] || 0} close={() => setSelected(null)} />}
  </>;
}

function SchemaDetail({ schema, recordCount, close }: { schema: CatalogueSchema; recordCount: number; close: () => void }) {
  return <div className="detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="schema-detail-title" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="detail-modal schema-detail"><header><div><small>{schema.schemaId}</small><h2 id="schema-detail-title">{schema.title}</h2></div><button className="icon" aria-label="Close schema definition" onClick={close}><X /></button></header><div className="detail-summary"><span className="status status--active">{isImportDeferred(schema.entityType) ? "Import deferred" : schema.lifecycle}</span><span>Version {schema.version}</span><span>{recordCount} canonical record(s)</span></div><p>{schema.description}</p><dl className="schema-facts"><div><dt>Source of truth</dt><dd>{schema.sourceOfTruth}</dd></div><div><dt>Validator</dt><dd>{schema.validator}</dd></div><div><dt>Lifecycle</dt><dd>{schema.lifecycleSupport.join(" → ")}</dd></div><div><dt>Sensitive-field policy</dt><dd>{schema.sensitiveFieldPolicy}</dd></div><div><dt>Relationships</dt><dd>{schema.relationships.length ? schema.relationships.map(item => `${item.field} → ${item.target}`).join(", ") : "None"}</dd></div><div><dt>Authority</dt><dd>{schema.authorityRules.join(" ")}</dd></div><div><dt>Version history</dt><dd>{schema.versionHistory.map(item => `${item.version}: ${item.note}`).join(" ")}</dd></div></dl><div className="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Registry correction</th><th>Description</th></tr></thead><tbody>{schema.fields.map(field => <tr key={field.name}><td><b>{field.label}</b><small>{field.name}</small></td><td>{field.valueType}</td><td>{field.required ? "Yes" : "No"}</td><td>{field.editable ? "Governed" : "Protected"}</td><td className="schema-description">{field.description}{field.sensitive ? " Restricted display." : ""}</td></tr>)}</tbody></table></div></section></div>;
}
