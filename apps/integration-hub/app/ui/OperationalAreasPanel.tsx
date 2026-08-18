"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import OperationalConfigurationPanel from "./OperationalConfigurationPanel";

type AreaType = { canonicalId: string; name: string; active: boolean };
type Area = {
  canonicalId: string;
  name: string;
  areaTypeId: string;
  areaTypeName: string;
  floorLevel: number;
  description?: string;
  lifecycleState: "active" | "archived";
  configuration: Record<string, unknown>;
  version: number;
  providerMappings: {
    mappingId: string;
    sourceProvider: string;
    sourceEntityType: string;
    sourceIdentifier: string;
    sourceLabel?: string;
    mappingStatus: string;
  }[];
};
type Data = { types: AreaType[]; areas: Area[] };
type Draft = {
  canonicalId?: string;
  expectedVersion?: number;
  name: string;
  areaTypeId: string;
  floorLevel: string;
  description: string;
  lifecycleState: "active" | "archived";
  localOperationalInstructions: string;
};

export default function OperationalAreasPanel({
  oplocId,
  canManage,
  refreshSession,
  openCreateSignal = 0,
  onCreateHandled,
}: {
  oplocId: string;
  canManage: boolean;
  refreshSession: () => Promise<boolean>;
  openCreateSignal?: number;
  onCreateHandled?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [addConnectionFor, setAddConnectionFor] = useState<string | null>(null);
  async function load() {
    try {
      const request = () =>
        fetch(`/api/operational-areas?oplocId=${encodeURIComponent(oplocId)}`, {
          cache: "no-store",
        });
      let response = await request();
      if (response.status === 401 && (await refreshSession())) response = await request();
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "Operational Areas could not be loaded.");
      setData(body);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [oplocId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (openCreateSignal) {
      create();
      onCreateHandled?.();
    }
  }, [openCreateSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  function create() {
    setDraft({
      name: "",
      areaTypeId: data?.types.find((type) => type.active)?.canonicalId || "",
      floorLevel: "",
      description: "",
      lifecycleState: "active",
      localOperationalInstructions: "",
    });
  }
  function edit(area: Area) {
    setDraft({
      canonicalId: area.canonicalId,
      expectedVersion: area.version,
      name: area.name,
      areaTypeId: area.areaTypeId,
      floorLevel: String(area.floorLevel),
      description: area.description || "",
      lifecycleState: area.lifecycleState,
      localOperationalInstructions: String(
        area.configuration.localOperationalInstructions || "",
      ),
    });
  }
  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const request = () =>
        fetch("/api/operational-areas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...draft,
            oplocId,
            floorLevel: Number(draft.floorLevel),
          }),
        });
      let response = await request();
      if (response.status === 401 && (await refreshSession())) response = await request();
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "Operational Area could not be saved.");
      setDraft(null);
      await load();
      setSuccess(draft.lifecycleState === "archived" ? "Operational Area archived. Its ID and mapping history remain available." : "Operational Area saved.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function transition(area: Area, lifecycleState: "active" | "archived") {
    const verb = lifecycleState === "archived" ? "Archive" : "Restore";
    const outcome = lifecycleState === "archived" ? "It will no longer appear in active local configuration, while its immutable ID and mapping history remain available." : "It will return to active local configuration.";
    if (!window.confirm(`${verb} Operational Area “${area.name}”? ${outcome}`)) return;
    setDraft({ canonicalId: area.canonicalId, expectedVersion: area.version, name: area.name, areaTypeId: area.areaTypeId, floorLevel: String(area.floorLevel), description: area.description || "", lifecycleState, localOperationalInstructions: String(area.configuration.localOperationalInstructions || "") });
  }
  return (
    <section className="connection-panel operational-areas-panel">
      <div className="panel-heading">
        <div>
          <small>Subordinate operating contexts</small>
          <h3>Operational Areas</h3>
          <p>
            Areas belong to this OPLOC. They do not create separate Sites,
            OPLOCs or staffing structures.
          </p>
        </div>
        {canManage && (
          <button className="primary" type="button" onClick={create}>
            <Plus /> Add area
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
      <label className="checkbox-field area-archive-filter"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Include archived areas</label>
      {!data ? (
        <p>Loading Operational Areas…</p>
      ) : (
        <div className="connection-list">
          {data.areas.length ? (
            data.areas.filter((area) => includeArchived || area.lifecycleState === "active").map((area) => (
              <article className="connection-row operational-area-row" key={area.canonicalId}>
                <div>
                  <b>{area.name}</b>
                  <span>
                    {area.areaTypeName} · Floor {area.floorLevel} · {area.lifecycleState}
                  </span>
                  {area.description && <span>{area.description}</span>}
                  <span>
                    {area.providerMappings.length
                      ? area.providerMappings.map((mapping) => `${mapping.sourceProvider}: ${mapping.sourceLabel || mapping.sourceIdentifier}`).join(" · ")
                      : "No mapped provider/service context"}
                  </span>
                  <details>
                    <summary>Technical details</summary>
                    <p>{area.canonicalId}</p>
                    {area.providerMappings.map((mapping) => (
                      <p key={mapping.mappingId}>
                        {mapping.mappingStatus}: {mapping.sourceEntityType} / {mapping.sourceIdentifier}
                      </p>
                    ))}
                  </details>
                </div>
                {canManage && <div className="area-row-actions"><button className="connection-action" type="button" onClick={() => edit(area)}>Edit area</button>{area.lifecycleState === "active" ? <button className="danger" type="button" onClick={() => transition(area, "archived")}>Archive area</button> : <button className="connection-action" type="button" onClick={() => transition(area, "active")}>Restore area</button>}<button className="connection-action" type="button" onClick={() => setAddConnectionFor(addConnectionFor === area.canonicalId ? null : area.canonicalId)}>Add connection</button></div>}
                <div className="operational-area-connections">
                  {addConnectionFor === area.canonicalId && <div className="area-connection-chooser"><b>Add a governed connection</b><button className="connection-action" onClick={() => setAddConnectionFor(`${area.canonicalId}:service`)}>Service arrangement</button><button className="connection-action" onClick={() => setAddConnectionFor(`${area.canonicalId}:equipment`)}>Equipment allocation</button></div>}
                  <OperationalConfigurationPanel oplocId={oplocId} operationalAreaId={area.canonicalId} section="services" canManage={canManage} refreshSession={refreshSession} openCreateSignal={addConnectionFor === `${area.canonicalId}:service` ? 1 : 0} onCreateHandled={() => setAddConnectionFor(null)} />
                  <OperationalConfigurationPanel oplocId={oplocId} operationalAreaId={area.canonicalId} section="equipment" canManage={canManage} refreshSession={refreshSession} openCreateSignal={addConnectionFor === `${area.canonicalId}:equipment` ? 1 : 0} onCreateHandled={() => setAddConnectionFor(null)} />
                </div>
              </article>
            ))
          ) : (
            <p>No Operational Areas have been configured for this OPLOC.</p>
          )}
        </div>
      )}
      {draft && (
        <section className="canonical-editor">
          <h4>{draft.canonicalId ? "Edit Operational Area" : "Add Operational Area"}</h4>
          <div className="editor-grid">
            <label>Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>Area type<select value={draft.areaTypeId} onChange={(event) => setDraft({ ...draft, areaTypeId: event.target.value })}>{data?.types.filter((type) => type.active || type.canonicalId === draft.areaTypeId).map((type) => <option value={type.canonicalId} key={type.canonicalId}>{type.name}</option>)}</select></label>
            <label>Floor or level<input type="number" step="1" value={draft.floorLevel} onChange={(event) => setDraft({ ...draft, floorLevel: event.target.value })} /></label>
            <label>Lifecycle<select value={draft.lifecycleState} onChange={(event) => setDraft({ ...draft, lifecycleState: event.target.value as Draft["lifecycleState"] })}><option value="active">Active</option><option value="archived">Archived</option></select></label>
          </div>
          <label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>Local operational instructions (optional)<textarea value={draft.localOperationalInstructions} onChange={(event) => setDraft({ ...draft, localOperationalInstructions: event.target.value })} /></label>
          <div className="actions"><button type="button" onClick={() => setDraft(null)}>Cancel</button><button className="primary" type="button" disabled={saving || !draft.name.trim() || !draft.areaTypeId || !Number.isInteger(Number(draft.floorLevel))} onClick={() => void save()}>{saving ? "Saving…" : "Save Operational Area"}</button></div>
        </section>
      )}
    </section>
  );
}
