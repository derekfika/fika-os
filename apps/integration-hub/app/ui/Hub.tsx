"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Link2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Upload,
  Users,
  WalletCards,
  X,
  ScanSearch,
} from "lucide-react";
import type { HubState, WorkbookProfile } from "@/lib/types";
import type {
  CanonicalEntityType,
  MappingDefinition,
  StagingRecord,
  SyncProgress,
} from "@/lib/schemas";
import { CanonicalEntityNames } from "@/lib/schemas";
import { baselineCoverage } from "@/lib/baseline-readiness";
import { isImportDeferred } from "@/lib/import-policy";
import DataRegistry from "./DataRegistry";
import SchemaCatalogueView from "./SchemaCatalogueView";
import DataGovernance from "./DataGovernance";
import ActivityAudit from "./ActivityAudit";
import GovernedDecisionModal from "./GovernedDecisionModal";
import Connections from "./Connections";
import HospitalityBookings from "./HospitalityBookings";

type Payload = {
  actor: { name: string; role: string };
  safety: { localOnly: boolean; cloudWrites: boolean; projectId: string };
  state: HubState;
};
const empty: HubState = {
  imports: [],
  staging: [],
  canonical: [],
  mappings: [],
  syncRuns: [],
  activity: [],
  profiles: [],
  manifests: [],
};
async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(response.status === 404
      ? "The Integration Hub API route was not found. Restart the Integration Hub dev server on port 3200."
      : `The Integration Hub returned an HTML error page (${response.status}). Restart the dev server and try again.`);
  }
  try { return JSON.parse(text) as T; }
  catch { throw new Error("The Integration Hub returned invalid JSON. Restart the dev server and try again."); }
}
const views = [
  "Overview",
  "Sources",
  "Imports",
  "Staging & Review",
  "Data Registry",
  "Hospitality Bookings",
  "Connections",
  "Schema Catalogue",
  "Quality & Reconciliation",
  "Activity & Audit",
  "Promotion",
] as const;
type View = (typeof views)[number];

export default function Hub() {
  const PERSISTED_ADMIN_KEY = "fika_hub_persist_admin";
  const [payload, setPayload] = useState<Payload | null>(null),
    [view, setView] = useState<View>("Overview"),
    [loading, setLoading] = useState(true),
    [progress, setProgress] = useState<string | SyncProgress>(""),
    [error, setError] = useState("");
  async function load(): Promise<boolean> {
    setLoading(true);
    try {
      const r = await fetch("/api/hub", { cache: "no-store" });
      if (r.status === 401) {
        setPayload(null);
        setError("");
        return false;
      }
      const j = await readJson<Payload & { error?: { message?: string } }>(r);
      if (!r.ok) throw Error(j.error?.message || "Could not load the Integration Hub.");
      setPayload(j);
      if (j.actor.role === "integration-admin") window.localStorage.setItem(PERSISTED_ADMIN_KEY, "true");
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void (async () => {
      const loaded = await load();
      if (!loaded && window.localStorage.getItem(PERSISTED_ADMIN_KEY) === "true") {
        const response = await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "integration-admin" }) });
        if (response.ok) await load();
      }
    })();
  }, []);
  async function refreshLocalSession() {
    const role = payload?.actor.role;
    if (!role) return false;
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    return response.ok;
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (window.localStorage.getItem(PERSISTED_ADMIN_KEY) === "true") void fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "integration-admin" }) });
    }, 45 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  async function command(body: Record<string, unknown>) {
    setLoading(true);
    setProgress(operationLabel(body));
    let progressTimer: number | undefined,
      progressPollBusy = false;
    try {
      if (
        body.action === "sync" &&
        (body.provider === "brighthr" || body.provider === "square")
      ) {
        const provider = body.provider;
        setProgress({
          phase: "Starting",
          message: `Preparing the ${provider === "brighthr" ? "BrightHR" : "Square"} read-only connection.`,
          percent: 1,
          updatedAt: new Date().toISOString(),
        });
        progressTimer = window.setInterval(async () => {
          if (progressPollBusy) return;
          progressPollBusy = true;
          try {
            const requestProgress = () =>
              fetch(`/api/hub/progress?provider=${provider}`, {
                cache: "no-store",
              });
            let response = await requestProgress();
            if (response.status === 401 && (await refreshLocalSession()))
              response = await requestProgress();
            if (!response.ok) return;
            const current = await response.json();
            if (current.run?.progress) setProgress(current.run.progress);
          } catch {
            /* The primary request remains authoritative. */
          } finally {
            progressPollBusy = false;
          }
        }, 750);
      }
      const request = () =>
        fetch("/api/hub", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      let r = await request();
      if (r.status === 401 && (await refreshLocalSession()))
        r = await request();
      const j = await readJson<{ error?: { message?: string }; state: HubState }>(r);
      if (!r.ok) throw Error(j.error?.message || "The Integration Hub command failed.");
      setPayload((p) => (p ? { ...p, state: j.state } : p));
      const completedRun =
        body.action === "sync"
          ? [...j.state.syncRuns]
              .reverse()
              .find(
                (run: HubState["syncRuns"][number]) =>
                  run.provider === body.provider,
              )
          : undefined;
      if (completedRun?.progress) {
        setProgress(completedRun.progress);
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
      setError("");
      return j;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (progressTimer) window.clearInterval(progressTimer);
      setLoading(false);
      setProgress("");
    }
  }
  async function uploadRota(file: File) {
    setLoading(true);
    setProgress(
      "Cross-checking the All Sites Rota against BrightHR Legends without changing canonical site assignments…",
    );
    try {
      const request = () => {
        const form = new FormData();
        form.set("file", file);
        return fetch("/api/rota-enrichment", { method: "POST", body: form });
      };
      let r = await request();
      if (r.status === 401 && (await refreshLocalSession()))
        r = await request();
      const j = await r.json();
      if (!r.ok) throw Error(j.error.message);
      setPayload((p) => (p ? { ...p, state: j.state } : p));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }
  if (!payload) return <Login loading={loading} error={error} done={load} onError={setError} />;
  const state = payload.state || empty;
  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <Image
            src="/fika-logo-white.png"
            alt="FIKA"
            width={88}
            height={42}
            priority
          />
          <span>OS</span>
        </div>
        <div className="app-title">
          <small>Controlled data gateway</small>
          <h1>Integration Hub</h1>
        </div>
        <div className="local-banner">
          <ShieldCheck /> Local development <span>— no cloud data</span>
        </div>
        <div className="identity">
          <b>{payload.actor.role.replaceAll("-", " ")}</b>
          <span>{payload.actor.name}</span>
        </div>
        <button
          className="icon dark"
          aria-label="Sign out"
          onClick={async () => {
            await fetch("/api/auth/session", { method: "DELETE" });
            window.localStorage.removeItem(PERSISTED_ADMIN_KEY);
            setPayload(null);
          }}
        >
          <LogOut />
        </button>
      </header>
      <aside>
        <nav aria-label="Integration Hub sections">
          {views.map((item) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
            >
              {navIcon(item)}
              <span>{item}</span>
            </button>
          ))}
          {payload.actor.role === "integration-admin" && (
            <button onClick={() => { window.location.href = "/authmod"; }}>
              <ShieldCheck />
              <span>AUTHMOD</span>
            </button>
          )}
        </nav>
      </aside>
      <main>
        {error && (
          <div className="error">
            <AlertTriangle />
            {error}
          </div>
        )}
        {progress && <ProgressModal progress={progress} />}
        {view === "Overview" && (
          <Dashboard state={state} setView={setView} command={command} />
        )}
        {view === "Sources" && (
          <Sources
            state={state}
            role={payload.actor.role}
            command={command}
            uploadRota={uploadRota}
          />
        )}
        {view === "Imports" && (
          <Spreadsheet
            state={state}
            update={(s) => setPayload({ ...payload, state: s })}
            command={command}
            setProgress={setProgress}
            reportError={setError}
          />
        )}
        {view === "Staging & Review" && (
          <Review state={state} role={payload.actor.role} command={command} />
        )}
        {view === "Data Registry" && (
          <DataRegistry
            role={payload.actor.role}
            refreshSession={refreshLocalSession}
          />
        )}
        {view === "Hospitality Bookings" && <HospitalityBookings />}
        {view === "Connections" && (
          <Connections
            role={payload.actor.role}
            refreshSession={refreshLocalSession}
          />
        )}
        {view === "Schema Catalogue" && (
          <SchemaCatalogueView refreshSession={refreshLocalSession} />
        )}
        {view === "Quality & Reconciliation" && (
          <DataGovernance
            role={payload.actor.role}
            refreshSession={refreshLocalSession}
            openRegistry={(canonicalId) => {
              const params = new URLSearchParams({
                search: canonicalId,
                sort: "name",
                direction: "asc",
                page: "1",
                pageSize: "25",
              });
              window.history.replaceState(
                {},
                "",
                `${window.location.pathname}?${params}`,
              );
              setView("Data Registry");
            }}
          />
        )}
        {view === "Activity & Audit" && (
          <ActivityAudit
            activity={state.activity}
            refreshSession={refreshLocalSession}
          />
        )}
        {view === "Promotion" && (
          <Promotion
            state={state}
            role={payload.actor.role}
            command={command}
          />
        )}
      </main>
    </div>
  );
}

function Login({
  loading,
  error,
  done,
  onError,
}: {
  loading: boolean;
  error: string;
  done: () => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState("integration-admin");
  return (
    <main className="login">
      <section>
        <Image
          src="/fika-logo-white.png"
          alt="FIKA"
          width={130}
          height={56}
          priority
        />
        <small>FIKA OS</small>
        <h1>Integration Hub</h1>
        <p>
          Inspect, map and approve operational data without leaving your
          computer.
        </p>
        <div className="local-banner">
          <ShieldCheck /> Local development — no cloud data
        </div>
        {error && (
          <div className="error">
            <AlertTriangle />
            {error}
          </div>
        )}
        <label>
          Synthetic local identity
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="integration-admin">Integration Administrator</option>
            <option value="reviewer">Reviewer</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={loading}
          onClick={async () => {
            const r = await fetch("/api/auth/session", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ role }),
            });
            if (r.ok) {
              if (role === "integration-admin") window.localStorage.setItem("fika_hub_persist_admin", "true");
              else window.localStorage.removeItem("fika_hub_persist_admin");
              await done();
            }
            else {
              try {
                const body = await readJson<{ error?: { message?: string } }>(r);
                throw new Error(body.error?.message || "Local sign-in failed.");
              } catch (error) {
                // The parent load will clear this once the session is valid.
                onError((error as Error).message);
              }
            }
          }}
        >
          {loading ? "Connecting to local emulators…" : "Enter local workspace"}
        </button>
      </section>
    </main>
  );
}

function Dashboard({
  state,
  setView,
  command,
}: {
  state: HubState;
  setView: (v: View) => void;
  command: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const counts = queueCounts(state.staging);
  const last = (provider: string) =>
    state.syncRuns
      .filter(
        (r) =>
          r.provider === provider &&
          ["succeeded", "partial"].includes(r.status),
      )
      .at(-1);
  const coverage = baselineCoverage(state);
  return (
    <>
      <Heading
        eyebrow="Integration health"
        title="Know what entered FIKA OS."
        text="Source evidence stays separate from reviewed staging and approved canonical records."
      />
      <div className="metrics">
        <Metric n={state.imports.length} label="Source imports" />
        <Metric n={state.staging.length} label="Staged records" />
        <Metric
          n={
            counts.unresolved +
            counts.invalid +
            counts.conflict +
            counts["possible-duplicate"]
          }
          label="Need attention"
          warn
        />
        <Metric n={state.canonical.length} label="Canonical records" />
      </div>
      <div className="source-grid">
        <Source
          title="Spreadsheets"
          icon={<FileSpreadsheet />}
          mode="Local upload"
          last={
            state.imports.filter((i) => i.sourceKind === "spreadsheet").at(-1)
              ?.uploadedAt
          }
          action="Open imports"
          onClick={() => setView("Imports")}
        />
        <Source
          title="BrightHR"
          icon={<Users />}
          mode={processLabel("BrightHR", state)}
          last={last("brighthr")?.finishedAt}
          action="Sync fixtures"
          onClick={() => command({ action: "sync", provider: "brighthr" })}
        />
        <Source
          title="Square"
          icon={<WalletCards />}
          mode={processLabel("Square", state)}
          last={last("square")?.finishedAt}
          action="Sync fixtures"
          onClick={() => command({ action: "sync", provider: "square" })}
        />
      </div>
      <Panel title="Baseline data coverage">
        <p className="panel-copy">
          Coverage highlights missing evidence before data is treated as a clean
          FIKA OS baseline. It does not invent canonical relationships from
          provider names or IDs.
        </p>
        <BaselineCoverageTable rows={coverage} />
      </Panel>
      <Panel title="Recent activity">
        <ActivityRows rows={state.activity.slice(-6).reverse()} />
      </Panel>
    </>
  );
}

function Sources({
  state,
  role,
  command,
  uploadRota,
}: {
  state: HubState;
  role: string;
  command: (b: Record<string, unknown>) => Promise<unknown>;
  uploadRota: (file: File) => Promise<void>;
}) {
  const [provider, setProvider] = useState<"brighthr" | "square">("brighthr");
  return (
    <>
      <div className="queue-tabs source-tabs" aria-label="Provider sources">
        <button
          className={provider === "brighthr" ? "active" : ""}
          onClick={() => setProvider("brighthr")}
        >
          <Users /> BrightHR
        </button>
        <button
          className={provider === "square" ? "active" : ""}
          onClick={() => setProvider("square")}
        >
          <WalletCards /> Square
        </button>
      </div>
      <Connector
        provider={provider}
        state={state}
        role={role}
        command={command}
        uploadRota={provider === "brighthr" ? uploadRota : undefined}
      />
    </>
  );
}

function BaselineCoverageTable({
  rows,
}: {
  rows: ReturnType<typeof baselineCoverage>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Record type</th>
            <th>Staged</th>
            <th>Approved</th>
            <th>Awaiting review</th>
            <th>Blocked</th>
            <th>Evidence coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entityType}>
              <td>
                <b>
                  {row.entityType === "Site"
                    ? "Source Site candidate (legacy)"
                    : row.entityType}
                </b>
              </td>
              <td>{row.staged}</td>
              <td>{row.approved}</td>
              <td>{row.awaitingReview}</td>
              <td>{row.blocked}</td>
              <td>
                {row.checks.map((check) => (
                  <span
                    className={
                      check.met === check.total ? "coverage-ok" : "coverage-gap"
                    }
                    key={check.label}
                  >
                    {check.label}: {check.met}/{check.total}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spreadsheet({
  state,
  update,
  command,
  setProgress,
  reportError,
}: {
  state: HubState;
  update: (s: HubState) => void;
  command: (b: Record<string, unknown>) => Promise<unknown>;
  setProgress: (text: string) => void;
  reportError: (text: string) => void;
}) {
  const [profileId, setProfileId] = useState(
      state.profiles.at(-1)?.importId || "",
    ),
    [sheet, setSheet] = useState(""),
    [entity, setEntity] = useState<CanonicalEntityType>("Legend"),
    [mappingDraft, setMappingDraft] = useState<MappingDefinition | null>(null),
    [page, setPage] = useState(0);
  const profile = state.profiles.find((p) => p.importId === profileId);
  const worksheet = profile?.worksheets.find(
    (w) => w.name === (sheet || profile.worksheets[0]?.name),
  );
  const latest = state.mappings
    .filter(
      (m) =>
        m.targetEntity === entity && m.name.startsWith(`${worksheet?.name} `),
    )
    .at(-1);
  const mapping = mappingDraft || latest || null;
  async function upload(file: File) {
    setProgress(
      "Profiling the workbook and preserving its local source evidence…",
    );
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw Error(j.error.message);
      update(j.state);
      setProfileId(j.profile.importId);
      setSheet(j.profile.worksheets[0]?.name || "");
      setEntity(
        j.profile.proposedEntity === "Unknown Dataset" ||
          isImportDeferred(j.profile.proposedEntity)
          ? "Legend"
          : j.profile.proposedEntity,
      );
      reportError("");
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setProgress("");
    }
  }
  return (
    <>
      <Heading
        eyebrow="Spreadsheet source"
        title="Understand before importing."
        text="Profile workbook structure, review inferred meaning, then map deliberately into an approved registry contract."
      />
      <HospitalityBrochureImport update={update} setProgress={setProgress} reportError={reportError} />
      <Panel title="Upload source file">
        <label className="drop">
          <Upload />
          <b>Choose CSV, XLSX or data-only XLS</b>
          <span>Maximum 10 MB. Macros are never executed.</span>
          <input
            aria-label="Upload spreadsheet"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) =>
              e.target.files?.[0] &&
              upload(e.target.files[0]).catch(() => undefined)
            }
          />
        </label>
      </Panel>
      {state.profiles.length > 0 && (
        <Panel title="Workbook and worksheet">
          <div className="controls">
            <label>
              Workbook
              <select
                value={profileId}
                onChange={(e) => {
                  setProfileId(e.target.value);
                  setSheet("");
                  setMappingDraft(null);
                }}
              >
                {state.profiles.map((p) => (
                  <option key={p.importId} value={p.importId}>
                    {p.filename}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Worksheet
              <select
                value={worksheet?.name || ""}
                onChange={(e) => {
                  setSheet(e.target.value);
                  setMappingDraft(null);
                }}
              >
                {profile?.worksheets.map((w) => (
                  <option key={w.name}>{w.name}</option>
                ))}
              </select>
            </label>
            <label>
              Proposed record type
              <select
                value={entity}
                onChange={(e) => {
                  setEntity(e.target.value as CanonicalEntityType);
                  setMappingDraft(null);
                }}
              >
                {CanonicalEntityNames.filter((x) => !isImportDeferred(x)).map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>
            <button
              onClick={() => {
                setMappingDraft(null);
                return command({
                  action: "save-mapping",
                  importId: profileId,
                  worksheet: worksheet?.name,
                  targetEntity: entity,
                });
              }}
            >
              Create mapping proposal
            </button>
          </div>
          {worksheet && <Profile sheet={worksheet} />}
        </Panel>
      )}
      {mapping && worksheet && (
        <Panel title={`Mapping version ${mapping.version}`}>
          <div className="mapping-head">
            <span>Source column</span>
            <span>Detected</span>
            <span>Examples</span>
            <span>Canonical field</span>
            <span>Transform</span>
            <span>Confidence</span>
          </div>
          {mapping.fields.map((field, index) => {
            const column = worksheet.columns.find(
              (c) => c.name === field.source,
            )!;
            return (
              <div className="mapping-row" key={field.source}>
                <b>{field.source}</b>
                <span>{column.inferredType}</span>
                <span>{column.examples.join(", ") || "—"}</span>
                <select
                  aria-label={`${field.source} target`}
                  value={field.target || ""}
                  onChange={(e) =>
                    setMappingDraft({
                      ...mapping,
                      fields: mapping.fields.map((f, i) =>
                        i === index
                          ? { ...f, target: e.target.value || null }
                          : f,
                      ),
                    })
                  }
                >
                  <option value="">Leave unmapped</option>
                  {targetOptions(entity).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select
                  aria-label={`${field.source} transformation`}
                  value={field.transform}
                  onChange={(e) =>
                    setMappingDraft({
                      ...mapping,
                      fields: mapping.fields.map((f, i) =>
                        i === index
                          ? {
                              ...f,
                              transform: e.target
                                .value as MappingDefinition["fields"][number]["transform"],
                            }
                          : f,
                      ),
                    })
                  }
                >
                  {["none", "trim", "lowercase", "number", "date"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <span className="confidence">
                  {Math.round(field.confidence * 100)}%
                </span>
              </div>
            );
          })}
          <div className="actions">
            <button
              onClick={() => {
                const request = command({
                  action: "save-mapping",
                  importId: profileId,
                  worksheet: worksheet.name,
                  targetEntity: entity,
                  fields: mapping.fields,
                });
                setMappingDraft(null);
                return request;
              }}
            >
              Save changed mapping
            </button>
            <button
              className="primary"
              onClick={() =>
                command({
                  action: "stage",
                  importId: profileId,
                  worksheet: worksheet.name,
                  mappingId: mapping.mappingId,
                })
              }
            >
              Validate and stage
            </button>
          </div>
        </Panel>
      )}
      {worksheet && (
        <Panel title="Source preview">
          <PagedTable rows={worksheet.preview} page={page} setPage={setPage} />
        </Panel>
      )}
    </>
  );
}

function HospitalityBrochureImport({ update, setProgress, reportError }: { update: (state: HubState) => void; setProgress: (text: string) => void; reportError: (text: string) => void }) {
  const [slides, setSlides] = useState<Array<{ slideNumber: number; text: string }>>([]);
  const [review, setReview] = useState<{ imports: any[]; candidates: any[]; menuItems: any[]; oplocs: any[]; areas: any[] }>({ imports: [], candidates: [], menuItems: [], oplocs: [], areas: [] });
  const [filter, setFilter] = useState("needs-review"); const [selected, setSelected] = useState<any | null>(null); const [draft, setDraft] = useState<Record<string, string>>({ offeringMode: "standard", effectiveFrom: new Date().toISOString().slice(0, 10), vatRate: "0.2" });
  const refresh = () => fetch("/api/hospitality-brochures/review").then(response => response.json()).then(setReview).catch(() => undefined);
  useEffect(() => { void refresh(); }, []);
  async function upload(file: File) {
    setProgress("Reading the PowerPoint brochure locally and preserving source evidence…");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/hospitality-brochures", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message || "Brochure import failed.");
      update(body.state); setSlides(body.slides); refresh(); reportError("");
    } catch (error) { reportError((error as Error).message); } finally { setProgress(""); }
  }
  const filtered = review.candidates.filter(candidate => {
    const state = candidate.record.reviewState; if (filter === "needs-review") return state === "draft"; if (filter === "ignored") return state === "ignored"; if (filter === "published") return Array.isArray(candidate.record.publishedRecordIds) && candidate.record.publishedRecordIds.length; if (filter === "ready") return state === "reviewed" && !candidate.record.publishedRecordIds?.length; return true;
  });
  const selectedRecord: any = selected?.record;
  const submit = async (action: "save" | "ignore" | "publish") => { if (!selected) return; setProgress(action === "publish" ? "Checking and publishing reviewed canonical records…" : "Saving deliberate brochure review…"); try { const body: Record<string, unknown> = { action, candidateId: selected.canonicalId }; if (action === "ignore") body.ignoreReason = draft.ignoreReason || "Not a usable menu item."; else if (action === "save") Object.assign(body, { proposedName: draft.proposedName || undefined, proposedCategory: draft.proposedCategory || undefined, proposedItemId: draft.proposedItemId || undefined, oplocId: draft.oplocId || undefined, operationalAreaId: draft.operationalAreaId || undefined, offeringMode: draft.offeringMode, priceAmount: draft.offeringMode === "standard" && draft.priceAmount ? Number(draft.priceAmount) : undefined, vatRate: draft.vatRate ? Number(draft.vatRate) : undefined, effectiveFrom: draft.effectiveFrom || undefined }); const response = await fetch("/api/hospitality-brochures/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw Error(result.error?.message || "Review failed."); setSelected(null); refresh(); reportError(""); } catch (error) { reportError((error as Error).message); } finally { setProgress(""); } };
  const publishImport = async (brochureImportId: string) => { if (!window.confirm("Publish every reviewed MNK catalogue record in this import? Only the reviewed, schema-valid records will become available to the portal.")) return; setProgress("Publishing reviewed MNK catalogue records and checking their scope and price rules…"); try { const response = await fetch("/api/hospitality-brochures/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish-import", brochureImportId }) }); const result = await response.json(); if (!response.ok) throw Error(result.error?.message || "Import publication failed."); refresh(); reportError(""); } catch (error) { reportError((error as Error).message); } finally { setProgress(""); } };
  return <Panel title="Hospitality Brochure Review">
    <p>Imported brochures remain evidence. Review each extracted candidate, explicitly choose its governed records, then publish only those records that pass the scope and price checks.</p>
    <label className="drop"><Upload /><b>Choose a PowerPoint hospitality brochure</b><span>.pptx only, maximum 75 MB. Menu items, prices and OPLOC availability remain review decisions.</span><input aria-label="Upload hospitality brochure" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
    <div className="controls"><label>Review queue<select value={filter} onChange={event => setFilter(event.target.value)}><option value="needs-review">Needs review</option><option value="ready">Ready to publish</option><option value="published">Published</option><option value="ignored">Ignored</option><option value="all">Needs attention / all</option></select></label><span>{review.imports.length} import(s) · {review.candidates.filter(candidate => candidate.record.reviewState === "draft").length} awaiting review · {review.candidates.filter(candidate => candidate.record.reviewState === "reviewed" && !candidate.record.publishedRecordIds?.length).length} ready to publish</span>{review.imports.filter(item => String(item.canonicalId).startsWith("hospitality-brochure-import:mnk-legacy-") && review.candidates.some(candidate => candidate.record.brochureImportId === item.canonicalId && candidate.record.reviewState === "reviewed" && !candidate.record.publishedRecordIds?.length)).map(item => <button className="primary" key={item.canonicalId} onClick={() => void publishImport(item.canonicalId)}>Publish reviewed MNK menu</button>)}</div>
    {filtered.length ? <div className="table-wrap"><table><thead><tr><th>Source excerpt</th><th>Proposed governed record</th><th>Scope / mode</th><th>Price signal</th><th>State</th><th /></tr></thead><tbody>{filtered.map(candidate => <tr key={candidate.canonicalId}><td>Slide {candidate.record.slideNumber}: {String(candidate.record.sourceText).slice(0, 170)}…</td><td>{candidate.record.proposedName || candidate.record.proposedItemId || "Not decided"}</td><td>{candidate.record.oplocId || "No OPLOC"} · {candidate.record.offeringMode || "No mode"}</td><td>{candidate.record.priceSignal || (candidate.record.offeringMode === "quote_only" ? "Quote required" : "No price")}</td><td>{candidate.record.reviewState}{candidate.record.publishedRecordIds?.length ? " · published" : ""}</td><td><button onClick={() => { setSelected(candidate); setDraft({ proposedName: candidate.record.proposedName || "", proposedCategory: candidate.record.proposedCategory || "", proposedItemId: candidate.record.proposedItemId || "", oplocId: candidate.record.oplocId || "", operationalAreaId: candidate.record.operationalAreaId || "", offeringMode: candidate.record.offeringMode || "standard", effectiveFrom: new Date().toISOString().slice(0, 10), vatRate: "0.2" }); }}>Review</button></td></tr>)}</tbody></table></div> : <div className="empty">No candidates match this review state.</div>}
    {selected && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="Review hospitality brochure candidate"><header><div><small>Slide {selectedRecord?.slideNumber} evidence</small><h2>Review brochure candidate</h2></div><button aria-label="Close" onClick={() => setSelected(null)}><X /></button></header><div className="modal-body two-column"><article><h3>Source evidence</h3><p>{String(selectedRecord?.sourceText || "")}</p></article><article><h3>Governed decision</h3><label>Menu item<select value={draft.proposedItemId || ""} onChange={event => setDraft({ ...draft, proposedItemId: event.target.value })}><option value="">Create a new reusable Menu Item</option>{review.menuItems.map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.record.name} ({item.canonicalId})</option>)}</select></label>{!draft.proposedItemId && <><label>Name<input value={draft.proposedName || ""} onChange={event => setDraft({ ...draft, proposedName: event.target.value })} /></label><label>Category<input value={draft.proposedCategory || ""} onChange={event => setDraft({ ...draft, proposedCategory: event.target.value })} /></label></>}<label>OPLOC<select value={draft.oplocId || ""} onChange={event => setDraft({ ...draft, oplocId: event.target.value, operationalAreaId: "" })}><option value="">Select governed OPLOC</option>{review.oplocs.map(oploc => <option key={oploc.canonicalId} value={oploc.canonicalId}>{oploc.record.approvedName}</option>)}</select></label><label>Operational Area (optional)<select value={draft.operationalAreaId || ""} onChange={event => setDraft({ ...draft, operationalAreaId: event.target.value })}><option value="">OPLOC-wide offering</option>{review.areas.filter(area => !draft.oplocId || area.record.oplocId === draft.oplocId).map(area => <option key={area.canonicalId} value={area.canonicalId}>{area.record.name}</option>)}</select></label><label>Offering mode<select value={draft.offeringMode} onChange={event => setDraft({ ...draft, offeringMode: event.target.value })}><option value="standard">Standard — priced and self-service orderable</option><option value="quote_only">Quote only — enquiry required, no catalogue price</option></select></label>{draft.offeringMode === "standard" && <><label>Standard price (£)<input type="number" min="0" step="0.01" value={draft.priceAmount || ""} onChange={event => setDraft({ ...draft, priceAmount: event.target.value })} /></label><label>Effective from<input type="date" value={draft.effectiveFrom || ""} onChange={event => setDraft({ ...draft, effectiveFrom: event.target.value })} /></label></>}<label>Ignore reason<input value={draft.ignoreReason || ""} onChange={event => setDraft({ ...draft, ignoreReason: event.target.value })} /></label></article></div><footer><button onClick={() => void submit("ignore")}>Ignore</button><button onClick={() => void submit("save")}>Create / map item and offering</button><button className="primary" onClick={() => void submit("publish")}>Publish reviewed records</button></footer></section></div>}
    {slides.length > 0 && <p className="muted">Latest local extraction: {slides.filter(slide => slide.text).length} readable slides. They have been added to the review queue as source evidence.</p>}
  </Panel>;
}

function Review({
  state,
  role,
  command,
}: {
  state: HubState;
  role: string;
  command: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const [queue, setQueue] = useState("ready"),
    [entityFilter, setEntityFilter] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [decision, setDecision] = useState<"approve" | "resolve-update" | null>(
      null,
    );
  const queueRows = state.staging.filter((r) => r.state === queue);
  const entityOptions = [
    ...new Set(queueRows.map((record) => record.entityType)),
  ].sort();
  const rows = queueRows.filter(
    (record) => !entityFilter || record.entityType === entityFilter,
  );
  const visibleRows = rows.slice(0, 100);
  const counts = queueCounts(state.staging);
  const selectReady = visibleRows
    .filter((r) => !r.issues.some((i) => i.severity === "blocking"))
    .map((r) => r.stagingId);
  return (
    <>
      <Heading
        eyebrow="Human review"
        title="Nothing becomes canonical silently."
        text="Resolve validation, duplicate and ownership questions before approval."
      />
      <div className="queue-tabs">
        {Object.entries(counts).map(([key, count]) => (
          <button
            key={key}
            className={queue === key ? "active" : ""}
            onClick={() => {
              setQueue(key);
              setEntityFilter("");
              setSelected([]);
            }}
          >
            {label(key)} <b>{count}</b>
          </button>
        ))}
      </div>
      <Panel title={`${label(queue)} queue`}>
        <div className="review-filter">
          <label>
            Filter by record type
            <select
              value={entityFilter}
              onChange={(event) => {
                setEntityFilter(event.target.value);
                setSelected([]);
              }}
            >
              <option value="">All record types ({queueRows.length})</option>
              {entityOptions.map((entityType) => (
                <option key={entityType} value={entityType}>
                  {entityType} (
                  {
                    queueRows.filter(
                      (record) => record.entityType === entityType,
                    ).length
                  }
                  )
                </option>
              ))}
            </select>
          </label>
          <span>
            Showing {visibleRows.length} of {rows.length} filtered records
          </span>
        </div>
        <div className="actions">
          <button onClick={() => setSelected(selectReady)}>
            Select visible eligible ({selectReady.length})
          </button>
          {queue === "possible-duplicate" && (
            <>
              <button
                onClick={() =>
                  command({
                    action: "review",
                    stagingIds: selected,
                    decision: "resolve-new",
                  })
                }
              >
                Keep as new record
              </button>
              {role === "integration-admin" && (
                <button
                  disabled={!selected.length}
                  onClick={() => setDecision("resolve-update")}
                >
                  Update matched record
                </button>
              )}
            </>
          )}
          <button
            onClick={() =>
              command({
                action: "review",
                stagingIds: selected,
                decision: "exclude",
                reason: "Excluded by reviewer",
              })
            }
          >
            Exclude
          </button>
          <button
            onClick={() =>
              command({
                action: "review",
                stagingIds: selected,
                decision: "unresolved",
              })
            }
          >
            Leave unresolved
          </button>
          {role === "integration-admin" && (
            <button
              className="primary"
              disabled={!selected.length}
              onClick={() => setDecision("approve")}
            >
              Approve {selected.length || "selected"}
            </button>
          )}
        </div>
        <RecordRows
          rows={visibleRows}
          allRecords={state.staging}
          selected={selected}
          setSelected={setSelected}
          command={command}
        />
      </Panel>
      {decision && (
        <GovernedDecisionModal
          title={
            decision === "approve"
              ? `Approve ${selected.length} staged record(s)`
              : `Update ${selected.length} matched record(s)`
          }
          introduction={
            decision === "approve"
              ? "Only the selected eligible records will be approved. Publication remains separate."
              : "The first deterministic match for each selected record will be updated while FIKA-owned enrichment is preserved."
          }
          confirmLabel={
            decision === "approve"
              ? "Approve selected"
              : "Update matched records"
          }
          destructive={decision === "resolve-update"}
          close={() => setDecision(null)}
          submit={async () => {
            await command({ action: "review", stagingIds: selected, decision });
            setDecision(null);
          }}
        />
      )}
    </>
  );
}

function Connector({
  provider,
  state,
  role,
  command,
  uploadRota,
}: {
  provider: "brighthr" | "square";
  state: HubState;
  role: string;
  command: (b: Record<string, unknown>) => Promise<unknown>;
  uploadRota?: (file: File) => Promise<void>;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const title = provider === "brighthr" ? "BrightHR" : "Square";
  const runs = state.syncRuns
    .filter((r) => r.provider === provider)
    .slice()
    .reverse();
  return (
    <>
      <Heading
        eyebrow="Read-only connector"
        title={`${title} source sync.`}
        text={
          provider === "brighthr"
            ? "Employment and termination facts come from BrightHR; FIKA site assignments can be cross-checked separately against the All Sites Rota."
            : "Locations and catalog structures are staged without turning Square identities into FIKA OS identities."
        }
      />
      <div className="connector-callout">
        <ShieldCheck />
        <div>
          <b>Fixture mode is the safe default</b>
          <span>
            Live-local mode requires explicit server-only environment
            configuration. No write-back exists.
          </span>
        </div>
        <button
          className="primary"
          onClick={() =>
            command({
              action: "sync",
              provider,
              fullReconciliation: provider === "square",
            })
          }
        >
          <RefreshCw /> Sync now
        </button>
      </div>
      {role === "integration-admin" && (
        <Panel title={`Reset ${title} local data`}>
          <p className="panel-copy">
            Removes only {title} staging, locally approved {title}-derived
            records and {title} sync history. Other providers, spreadsheet work
            and credentials are preserved.
          </p>
          <button onClick={() => setResetOpen(true)}>Review reset</button>
        </Panel>
      )}
      {provider === "brighthr" && uploadRota && (
        <Panel title="All Sites Rota cross-check">
          <p className="panel-copy">
            Use the rota as FIKA-owned evidence of where Legends work. Exact
            names are matched locally; site names remain suggestions until
            reviewed against canonical Sites or OPLOCs.
          </p>
          <label className="rota-upload">
            <FileSpreadsheet />
            <span>
              <b>Choose All Sites Rota workbook</b>
              <small>
                The raw workbook is not copied into the Hub. Only a minimised
                local name-to-site summary and source hash are retained.
              </small>
            </span>
            <input
              aria-label="Upload All Sites Rota workbook"
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadRota(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </Panel>
      )}
      <Panel title="Sync history">
        <SyncRows rows={runs} />
      </Panel>
      {resetOpen && (
        <GovernedDecisionModal
          title={`Reset ${title} local data`}
          introduction={`Remove only ${title} staging, locally approved ${title}-derived records and ${title} sync history. Other provider data is preserved.`}
          confirmLabel={`Reset ${title}`}
          destructive
          close={() => setResetOpen(false)}
          submit={async () => {
            await command({
              action: "reset-provider",
              provider,
              confirmation: "RESET LOCAL PROVIDER DATA",
            });
            setResetOpen(false);
          }}
        />
      )}
    </>
  );
}

function Promotion({
  state,
  role,
  command,
}: {
  state: HubState;
  role: string;
  command: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const manifest = state.manifests.at(-1);
  return (
    <>
      <Heading
        eyebrow="Promotion preparation"
        title="Prove readiness. Upload nothing."
        text="The manifest is a local, machine-readable dry run for a later separately controlled promotion command."
      />
      <Panel title="Promotion gate">
        <ul className="checks">
          <li>
            <CheckCircle2 />
            Target allow-list: fika-os-dev
          </li>
          <li>
            <CheckCircle2 />
            Cloud upload disabled
          </li>
          <li>
            <CheckCircle2 />
            Raw credentials excluded
          </li>
        </ul>
        {role === "integration-admin" ? (
          <button
            className="primary"
            onClick={() =>
              command({ action: "manifest", target: "fika-os-dev" })
            }
          >
            Generate dry-run manifest
          </button>
        ) : (
          <p>
            Only an Integration Administrator may generate promotion evidence.
          </p>
        )}
      </Panel>
      {manifest && (
        <Panel title={`Manifest ${manifest.version}`}>
          <div
            className={`manifest-result ${manifest.valid ? "success" : "blocked"}`}
          >
            <b>{manifest.valid ? "Dry run passed" : "Promotion blocked"}</b>
            <span>No upload occurred.</span>
            {manifest.blockers.map((x) => (
              <small key={x}>{x}</small>
            ))}
          </div>
          <details className="technical-details">
            <summary>Technical manifest</summary>
            <pre>{JSON.stringify(manifest, null, 2)}</pre>
          </details>
        </Panel>
      )}
    </>
  );
}

function Profile({ sheet }: { sheet: WorkbookProfile["worksheets"][number] }) {
  return (
    <div className="profile">
      <Metric n={sheet.rowCount} label="Rows" />
      <Metric n={sheet.columnCount} label="Columns" />
      <Metric n={sheet.headerRow} label="Header row" />
      <Metric
        n={sheet.columns.filter((c) => c.sensitive).length}
        label="Sensitive fields"
        warn
      />
      {sheet.warnings.map((w) => (
        <div className="warning" key={w}>
          <AlertTriangle />
          {w}
        </div>
      ))}
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <section className="heading">
      <small>{eyebrow}</small>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}
function Metric({
  n,
  label,
  warn = false,
}: {
  n: number;
  label: string;
  warn?: boolean;
}) {
  return (
    <article className={`metric ${warn && n ? "warn" : ""}`}>
      <strong>{n}</strong>
      <span>{label}</span>
    </article>
  );
}
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function Source({
  title,
  icon,
  mode,
  last,
  action,
  onClick,
}: {
  title: string;
  icon: React.ReactNode;
  mode: string;
  last?: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <article className="source">
      <div className="source-icon">{icon}</div>
      <h3>{title}</h3>
      <b>{mode}</b>
      <span>
        {last
          ? `Last success ${new Date(last).toLocaleString()}`
          : "Not synchronised yet"}
      </span>
      <button onClick={onClick}>{action}</button>
    </article>
  );
}
function ActivityRows({ rows }: { rows: HubState["activity"] }) {
  return (
    <div className="list">
      {rows.length ? (
        rows.map((r) => (
          <article key={r.activityId}>
            <b>{r.action}</b>
            <span>{r.summary}</span>
            <small>
              {new Date(r.timestamp).toLocaleString()} · {r.actorName} ·{" "}
              {r.source}
            </small>
          </article>
        ))
      ) : (
        <Empty text="No activity yet." />
      )}
    </div>
  );
}
function SyncRows({ rows }: { rows: HubState["syncRuns"] }) {
  return (
    <div className="list">
      {rows.length ? (
        rows.map((r) => (
          <article key={r.syncRunId}>
            <b>
              <Status value={r.status} /> {r.provider}
            </b>
            <span>
              {Object.entries(r.counts)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </span>
            <small>
              {new Date(r.startedAt).toLocaleString()} · {r.mode}
            </small>
          </article>
        ))
      ) : (
        <Empty text="Run the synthetic fixture sync to begin." />
      )}
    </div>
  );
}
function RecordRows({
  rows,
  allRecords,
  selected,
  setSelected,
  command,
}: {
  rows: StagingRecord[];
  allRecords: StagingRecord[];
  selected: string[];
  setSelected: (x: string[]) => void;
  command: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  void command;
  const [detail, setDetail] = useState<StagingRecord | null>(null);
  return (
    <>
      <div className="record-list">
        {rows.map((r) => (
          <div
            className="record record--inspectable"
            key={r.stagingId}
            role="button"
            tabIndex={0}
            aria-label={`Inspect ${r.entityType} ${String(r.normalised.name || r.normalised.displayName || r.raw.externalId || "record")}`}
            onClick={(event) => {
              if (
                !(event.target as HTMLElement).closest("input,button,select,a")
              )
                setDetail(r);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setDetail(r);
              }
            }}
          >
            <input
              aria-label={`Select ${r.entityType} source row ${r.sourceRow}`}
              type="checkbox"
              checked={selected.includes(r.stagingId)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, r.stagingId]
                    : selected.filter((x) => x !== r.stagingId),
                )
              }
            />
            <div>
              <b>
                {r.entityType === "Site"
                  ? "Source Site candidate (legacy)"
                  : r.entityType}
              </b>
              <span>
                {Object.entries(r.normalised)
                  .filter(
                    ([key, value]) =>
                      typeof value !== "object" &&
                      !["terminated", "active"].includes(key),
                  )
                  .slice(0, 4)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(" · ")}
              </span>
              {r.entityType === "Legend" &&
                r.normalised.terminated === true && (
                  <small className="termination">
                    Terminated Legend — retained as inactive, never deleted
                    {r.normalised.terminationDate
                      ? ` · ${String(r.normalised.terminationDate)}`
                      : ""}
                  </small>
                )}
              {Array.isArray(r.normalised.workLocationReferences) && (
                <small className="work-location">
                  BrightHR workplace reference:{" "}
                  {r.normalised.workLocationReferences.length
                    ? r.normalised.workLocationReferences
                        .map((value) =>
                          typeof value === "object" && value
                            ? String(
                                (
                                  value as {
                                    name?: string;
                                    providerLocationId?: string;
                                  }
                                ).name ||
                                  (value as { providerLocationId?: string })
                                    .providerLocationId ||
                                  "",
                              )
                            : String(value),
                        )
                        .filter(Boolean)
                        .join(", ")
                    : "Not supplied by BrightHR"}
                </small>
              )}
              {Array.isArray(r.normalised.rotaSiteReferences) && (
                <small className="work-location">
                  All Sites Rota:{" "}
                  {r.normalised.rotaSiteReferences.length
                    ? r.normalised.rotaSiteReferences
                        .map((value) =>
                          typeof value === "object" && value
                            ? `${String((value as { name?: string }).name || "")}${(value as { name?: string }).name === r.normalised.primarySiteSuggestion ? " (suggested primary)" : ""}`
                            : String(value),
                        )
                        .filter(Boolean)
                        .join(", ")
                    : rotaStatusLabel(
                        String(r.normalised.rotaSiteMappingStatus || ""),
                      )}
                </small>
              )}
              <small>
                Source row {r.sourceRow} · mapping v{r.mappingVersion}
              </small>
              <button className="inline-action" onClick={() => setDetail(r)}>
                View metadata
              </button>
              {r.entityType === "Site" && (
                <small className="issue">
                  Legacy provider location evidence. Create or map an OPLOC only
                  through Quality &amp; Reconciliation.
                </small>
              )}
              {r.issues.map((i) => (
                <small className="issue" key={i.issueId}>
                  {i.message}
                </small>
              ))}
              {r.duplicateCandidates.map((d) => (
                <small className="duplicate" key={d.canonicalId}>
                  Possible match: {d.reason} ({Math.round(d.confidence * 100)}%)
                </small>
              ))}
            </div>
            <Status value={r.state} />
          </div>
        ))}
        {!rows.length && <Empty text="No records in this queue." />}
      </div>
      {detail && (
        <RecordDetailsModal
          record={detail}
          allRecords={allRecords}
          close={() => setDetail(null)}
        />
      )}
    </>
  );
}

function RecordDetailsModal({
  record,
  allRecords,
  close,
}: {
  record: StagingRecord;
  allRecords: StagingRecord[];
  close: () => void;
}) {
  const related = squareRelatedRecords(record, allRecords);
  const rotaEvidence = Array.isArray(record.normalised.rotaSiteReferences)
    ? {
        status: record.normalised.rotaSiteMappingStatus,
        primarySiteSuggestion: record.normalised.primarySiteSuggestion,
        latestWeek: record.normalised.rotaLatestWeek,
        siteReferences: record.normalised.rotaSiteReferences,
      }
    : null;
  const brightHrWorkplaceEvidence = Array.isArray(
    record.normalised.workLocationReferences,
  )
    ? record.normalised.workLocationReferences
    : null;
  return (
    <div
      className="detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="detail-modal">
        <header>
          <div>
            <small>
              {record.entityType} ·{" "}
              {String(record.raw.provider || "spreadsheet")}
            </small>
            <h2 id="record-detail-title">
              {String(
                record.normalised.name ||
                  record.normalised.displayName ||
                  record.raw.externalId ||
                  "Imported record",
              )}
            </h2>
          </div>
          <button
            className="icon"
            aria-label="Close record details"
            onClick={close}
          >
            <X />
          </button>
        </header>
        <div className="detail-summary">
          <Status value={record.state} />
          <span>
            Source reference:{" "}
            {String(record.raw.externalId || `row ${record.sourceRow}`)}
          </span>
          <span>Mapping v{record.mappingVersion}</span>
        </div>
        {rotaEvidence && (
          <DetailBlock
            title="All Sites Rota workplace evidence"
            value={rotaEvidence}
          />
        )}
        {brightHrWorkplaceEvidence && (
          <DetailBlock
            title="BrightHR workplace evidence"
            value={
              brightHrWorkplaceEvidence.length
                ? brightHrWorkplaceEvidence
                : "Not supplied by BrightHR"
            }
          />
        )}
        <DetailBlock title="Provider evidence retained" value={record.raw} />
        <DetailBlock
          title="Normalised staging record"
          value={record.normalised}
        />
        {related.length > 0 && (
          <DetailBlock
            title="Linked Square categories, variations, locations and prices"
            value={related}
          />
        )}
        <DetailBlock
          title="Validation issues"
          value={record.issues.length ? record.issues : "No validation issues"}
        />
        <DetailBlock
          title="Duplicate evidence"
          value={
            record.duplicateCandidates.length
              ? record.duplicateCandidates
              : "No duplicate candidates"
          }
        />
      </section>
    </div>
  );
}

function DetailBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="detail-block">
      <h3>{title}</h3>
      <ReadableValue value={value} />
      <details className="technical-details">
        <summary>Raw technical data</summary>
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </details>
    </section>
  );
}
function ReadableValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <p>Not supplied.</p>;
  if (Array.isArray(value))
    return value.length ? (
      <ul>
        {value.map((item) => (
          <li key={stableDisplayKey(item)}>
            <ReadableValue value={item} />
          </li>
        ))}
      </ul>
    ) : (
      <p>None.</p>
    );
  if (typeof value === "object")
    return (
      <dl className="readable-summary">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <div key={key}>
            <dt>{displayLabel(key)}</dt>
            <dd>
              <ReadableValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <span>
      {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
    </span>
  );
}
function stableDisplayKey(value: unknown) {
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return String(
      item.canonicalId ||
        item.externalId ||
        item.issueId ||
        item.stagingId ||
        JSON.stringify(item),
    );
  }
  return String(value);
}
function displayLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function squareRelatedRecords(
  record: StagingRecord,
  allRecords: StagingRecord[],
) {
  if (record.raw.provider !== "square") return [];
  const externalId = String(record.raw.externalId || "");
  const categoryIds = new Set(
    [
      record.normalised.categoryExternalId,
      ...(Array.isArray(record.normalised.categoryExternalIds)
        ? record.normalised.categoryExternalIds
        : []),
    ]
      .filter(Boolean)
      .map(String),
  );
  const locationIds = new Set(
    [
      ...(Array.isArray(record.normalised.locationIds)
        ? record.normalised.locationIds
        : []),
      ...(Array.isArray(record.normalised.absentAtLocationIds)
        ? record.normalised.absentAtLocationIds
        : []),
      ...(Array.isArray(record.normalised.locationPrices)
        ? record.normalised.locationPrices.map((value) =>
            typeof value === "object" && value
              ? (value as { locationExternalId?: unknown }).locationExternalId
              : undefined,
          )
        : []),
    ]
      .filter(Boolean)
      .map(String),
  );
  const matches = allRecords.filter(
    (candidate) =>
      candidate.raw.provider === "square" &&
      candidate.stagingId !== record.stagingId &&
      ((record.entityType === "Till Item" &&
        candidate.entityType === "Till Item Variation" &&
        candidate.normalised.tillItemExternalId === externalId) ||
        (candidate.entityType === "Product Category" &&
          categoryIds.has(String(candidate.raw.externalId || ""))) ||
        (candidate.entityType === "Site" &&
          locationIds.has(String(candidate.raw.externalId || "")))),
  );
  return matches.map((candidate) => ({
    entityType: candidate.entityType,
    sourceReference: candidate.raw.externalId,
    normalised: candidate.normalised,
  }));
}
function PagedTable({
  rows,
  page,
  setPage,
}: {
  rows: Record<string, unknown>[];
  page: number;
  setPage: (n: number) => void;
}) {
  const size = 20,
    slice = rows.slice(page * size, page * size + size),
    headers = Object.keys(rows[0] || {}).filter(
      (header) => header !== "__fikaSourceRow",
    );
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={String(r.__fikaSourceRow)}>
                {headers.map((h) => (
                  <td key={h}>{String(r[h] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button disabled={!page} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page + 1} of {Math.max(1, Math.ceil(rows.length / size))}
        </span>
        <button
          disabled={(page + 1) * size >= rows.length}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
function Status({ value }: { value: unknown }) {
  const text = String(value);
  return (
    <span
      className={`status status--${text.toLowerCase().replaceAll(" ", "-")}`}
    >
      {text}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Link2 />
      <b>{text}</b>
    </div>
  );
}
function ProgressModal({ progress }: { progress: string | SyncProgress }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const detailed = typeof progress !== "string" ? progress : null;
  const percent = detailed?.percent;
  const count =
    detailed?.completed !== undefined
      ? detailed.total
        ? `${detailed.completed} of ${detailed.total}`
        : `${detailed.completed} processed`
      : "";
  const message =
    detailed?.message ||
    (typeof progress === "string" ? progress : "Operation in progress.");
  return (
    <div
      className="progress-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-title"
      aria-describedby="progress-description"
    >
      <section className="progress-modal">
        <div className="progress-mark">
          <RefreshCw />
        </div>
        <small>Local operation in progress</small>
        <h2 id="progress-title">{detailed?.phase || "Please hold on."}</h2>
        <p id="progress-description">{message}</p>
        <div className="progress-facts">
          {percent !== undefined && <strong>{Math.round(percent)}%</strong>}
          {count && <span>{count}</span>}
          <span>{elapsed}s elapsed</span>
        </div>
        <div
          className={`progress-track ${percent === undefined ? "progress-track--indeterminate" : "progress-track--determinate"}`}
          role="progressbar"
          aria-label="Operation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            percent === undefined ? undefined : Math.round(percent)
          }
        >
          <span
            style={percent === undefined ? undefined : { width: `${percent}%` }}
          />
        </div>
        {percent === undefined && (
          <em>Total size is not available from this provider yet.</em>
        )}
        <b>No cloud write or deployment is occurring.</b>
      </section>
    </div>
  );
}
function queueCounts(rows: StagingRecord[]) {
  return Object.fromEntries(
    [
      "ready",
      "invalid",
      "possible-duplicate",
      "conflict",
      "excluded",
      "unresolved",
      "approved",
    ].map((k) => [k, rows.filter((r) => r.state === k).length]),
  ) as Record<string, number>;
}
function label(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (x) => x.toUpperCase());
}
function processLabel(provider: string, state: HubState) {
  const run = state.syncRuns
    .filter((r) => r.provider === provider.toLowerCase())
    .at(-1);
  return run?.mode === "live-local"
    ? "Live local · read only"
    : "Synthetic fixtures";
}
function targetOptions(type: CanonicalEntityType) {
  if (type === "Legend")
    return ["displayName", "workEmail", "jobTitle", "employmentState"];
  if (type === "Absence")
    return ["legendId", "startDate", "endDate", "absenceType", "approvalState"];
  if (type === "OPLOC") return ["approvedName", "lifecycleState"];
  if (type === "Production Unit") return ["name", "operationalLocationId"];
  if (type === "Till Item Variation") return ["tillItemId", "name", "sku"];
  return ["name"];
}
function navIcon(view: View) {
  const icons: Record<View, React.ReactNode> = {
    Overview: <LayoutDashboard />,
    Sources: <Link2 />,
    Imports: <FileSpreadsheet />,
    "Staging & Review": <ShieldCheck />,
    "Data Registry": <Database />,
    "Hospitality Bookings": <WalletCards />,
    Connections: <Link2 />,
    "Schema Catalogue": <BookOpen />,
    "Quality & Reconciliation": <ScanSearch />,
    "Activity & Audit": <History />,
    Promotion: <CheckCircle2 />,
  };
  return icons[view];
}
function operationLabel(body: Record<string, unknown>) {
  if (body.action === "sync")
    return `Retrieving ${body.provider === "brighthr" ? "BrightHR" : "Square"} data, transforming it and replacing its local staging records…`;
  if (body.action === "reset-provider")
    return `Removing old local ${body.provider === "brighthr" ? "BrightHR" : "Square"} staging and approved test records while preserving other sources…`;
  if (body.action === "stage")
    return "Validating mapped values and building the local review queues…";
  if (body.action === "save-mapping")
    return "Versioning the mapping definition locally…";
  if (body.action === "review")
    return body.decision === "approve"
      ? "Validating and writing the selected records to the local canonical registry…"
      : "Recording the review decision and audit history…";
  if (body.action === "manifest")
    return "Checking promotion gates and generating a local dry-run manifest…";
  return "Updating the local Integration Hub workspace…";
}
function rotaStatusLabel(value: string) {
  if (value === "ambiguous-legend-name")
    return "Ambiguous Legend name — manual review required";
  if (value === "no-exact-rota-match") return "No exact name match found";
  if (value === "rota-not-imported") return "Rota not imported";
  return "No reviewed rota reference";
}
