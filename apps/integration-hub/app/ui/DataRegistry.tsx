"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { CanonicalRecord } from "@/lib/types";
import type { EditableEntityType } from "@/lib/canonical-editor";
import { formatAddress } from "@/lib/address";
import { schemaDefinition } from "@/lib/schema-catalogue";
import {
  availableLifecycleActions,
  canonicalDisplayStatus,
  canonicalRecordFromMutationResponse,
  replaceCanonicalRecord,
} from "@/lib/canonical-mutation-state";
import CanonicalEditorModal from "./CanonicalEditorModal";
import GovernedDecisionModal from "./GovernedDecisionModal";
import OperationalAreasPanel from "./OperationalAreasPanel";

type RegistryResponse = {
  records: CanonicalRecord[];
  total: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
  filters: {
    entityTypes: string[];
    providers: string[];
    statuses: string[];
    sites: string[];
  };
  storage: {
    embeddedRecords: number;
    collectionRecords: number;
    migrationRequired: boolean;
  };
};
type Filters = {
  search: string;
  entityType: string;
  provider: string;
  status: string;
  site: string;
  sort: string;
  direction: string;
  page: number;
  pageSize: number;
};
type AddressPublicationAssessment = {
  publishable: { canonicalId: string; label: string }[];
  incomplete: { canonicalId: string; label: string; reason: string }[];
  duplicates: {
    canonicalId: string;
    label: string;
    candidates: { canonicalId: string; label: string; reason: string }[];
  }[];
};
type EditorRequest = {
  record?: CanonicalRecord;
  initialEntityType?: EditableEntityType;
  prefillValues?: Record<string, unknown>;
};

export default function DataRegistry({
  role,
  refreshSession,
}: {
  role: string;
  refreshSession: () => Promise<boolean>;
}) {
  const [filters, setFilters] = useState<Filters>(() => initialFilters());
  const [data, setData] = useState<RegistryResponse | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [detail, setDetail] = useState<CanonicalRecord | null>(null);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [addressAssessment, setAddressAssessment] =
      useState<AddressPublicationAssessment | null>(null),
    [bulkPublishOpen, setBulkPublishOpen] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = registryParams(filters);
        const request = () =>
          fetch(`/api/registry?${params}`, { cache: "no-store", signal });
        let response = await request();
        if (response.status === 401 && (await refreshSession()))
          response = await request();
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message || "Data Registry could not be loaded.",
          );
        setData(body);
        setError("");
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}?${params}`,
        );
      } catch (cause) {
        if ((cause as Error).name !== "AbortError")
          setError((cause as Error).message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filters, refreshSession],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [load]);
  const update = (patch: Partial<Filters>) =>
    setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const acceptAuthoritativeRecord = useCallback(
    async (record: CanonicalRecord) => {
      setDetail(record);
      setData((current) =>
        current
          ? {
              ...current,
              records: replaceCanonicalRecord(current.records, record),
            }
          : current,
      );
      window.dispatchEvent(
        new CustomEvent("fika:canonical-record-mutated", {
          detail: { canonicalId: record.canonicalId },
        }),
      );
      await load();
    },
    [load],
  );
  const fetchAuthoritativeRecord = useCallback(
    async (canonicalId: string) => {
      const request = () =>
        fetch(
          `/api/registry?search=${encodeURIComponent(canonicalId)}&page=1&pageSize=25`,
          { cache: "no-store" },
        );
      let response = await request();
      if (response.status === 401 && (await refreshSession()))
        response = await request();
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message || "The updated record could not be refreshed.",
        );
      const record = (body.records as CanonicalRecord[] | undefined)?.find(
        (candidate) => candidate.canonicalId === canonicalId,
      );
      if (!record)
        throw new Error(
          "The updated record could not be found. Retry the status refresh.",
        );
      return record;
    },
    [refreshSession],
  );
  async function migrate() {
    setLoading(true);
    try {
      let response = await fetch("/api/registry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "migrate-canonical-storage",
          confirmation: "MIGRATE CANONICAL STORAGE",
        }),
      });
      if (response.status === 401 && (await refreshSession()))
        response = await fetch("/api/registry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "migrate-canonical-storage",
            confirmation: "MIGRATE CANONICAL STORAGE",
          }),
        });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "Migration failed safely.");
      setMigrationOpen(false);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
      setLoading(false);
    }
  }
  async function addressCommand(
    action: "assess-address-publication" | "publish-valid-addresses",
  ) {
    setLoading(true);
    setError("");
    try {
      const request = () =>
        fetch("/api/canonical-records", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
      let response = await request();
      if (response.status === 401 && (await refreshSession()))
        response = await request();
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message || "Address publication review failed.",
        );
      if (action === "assess-address-publication") {
        setAddressAssessment(body);
        setBulkPublishOpen(true);
      } else {
        setBulkPublishOpen(false);
        setAddressAssessment(null);
        await load();
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <section className="heading">
        <small>Canonical data management</small>
        <h2>Data Registry</h2>
        <p>
          Search, inspect and govern durable record candidates. Only records
          explicitly marked published are available to operational consumers.
        </p>
        {role === "integration-admin" && (
          <div className="actions">
            <button className="primary" onClick={() => setEditor({})}>
              <Plus /> Create canonical candidate
            </button>
            <button
              onClick={() => void addressCommand("assess-address-publication")}
            >
              Review existing Addresses
            </button>
          </div>
        )}
      </section>
      {error && (
        <div className="error">
          <AlertTriangle />
          {error}
        </div>
      )}
      {data?.storage.migrationRequired && (
        <section className="registry-migration">
          <AlertTriangle />
          <div>
            <b>Canonical storage migration required</b>
            <span>
              {data.storage.embeddedRecords} existing record(s) are still held
              in the legacy state document. A verified local snapshot is created
              before migration.
            </span>
          </div>
          {role === "integration-admin" && (
            <button onClick={() => setMigrationOpen(true)}>
              Review migration
            </button>
          )}
        </section>
      )}
      <section
        className="panel registry-filters"
        aria-label="Data Registry filters"
      >
        <label className="registry-search">
          Search
          <input
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
            placeholder="Name, email, canonical or provider ID"
          />
          <Search />
        </label>
        <Filter
          label="Schema type"
          value={filters.entityType}
          options={data?.filters.entityTypes || []}
          onChange={(entityType) => update({ entityType })}
        />
        <Filter
          label="Source provider"
          value={filters.provider}
          options={data?.filters.providers || []}
          onChange={(provider) => update({ provider })}
        />
        <Filter
          label="Lifecycle/status"
          value={filters.status}
          options={data?.filters.statuses || []}
          onChange={(status) => update({ status })}
        />
        <Filter
          label="OPLOC or source location evidence"
          value={filters.site}
          options={data?.filters.sites || []}
          onChange={(site) => update({ site })}
        />
        <Filter
          label="Sort"
          value={filters.sort}
          options={["name", "entityType", "updatedAt", "createdAt", "status"]}
          onChange={(sort) => update({ sort })}
          allLabel="Name"
          hideAll
        />
        <Filter
          label="Direction"
          value={filters.direction}
          options={["asc", "desc"]}
          onChange={(direction) => update({ direction })}
          allLabel="Ascending"
          hideAll
        />
      </section>
      <section className="registry-summary" aria-live="polite">
        <b>{data?.filteredTotal ?? 0} matching</b>
        <span>of {data?.total ?? 0} canonical records</span>
        {loading && <span>Loading…</span>}
      </section>
      <section className="panel registry-results">
        {data?.records.length ? (
          <RegistryTable
            records={data.records}
            selectedType={filters.entityType}
            open={setDetail}
          />
        ) : (
          !loading && (
            <div className="empty">
              <Database />
              <b>No canonical records match these filters.</b>
            </div>
          )
        )}
        <footer className="registry-pagination">
          <label>
            Rows per page
            <select
              value={filters.pageSize}
              onChange={(event) =>
                update({ pageSize: Number(event.target.value) })
              }
            >
              {[25, 50, 100].map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </label>
          <button
            aria-label="Previous registry page"
            disabled={!data || data.page <= 1 || loading}
            onClick={() => update({ page: filters.page - 1 })}
          >
            <ChevronLeft />
          </button>
          <span>
            Page {data?.page || 1} of {data?.pageCount || 1}
          </span>
          <button
            aria-label="Next registry page"
            disabled={!data || data.page >= data.pageCount || loading}
            onClick={() => update({ page: filters.page + 1 })}
          >
            <ChevronRight />
          </button>
        </footer>
      </section>
      {detail && (
        <RegistryDetail
          record={detail}
          role={role}
          managed={!data?.storage.migrationRequired}
          refreshSession={refreshSession}
          close={() => setDetail(null)}
          openEditor={(request) => {
            setEditor(request);
            setDetail(null);
          }}
          saved={acceptAuthoritativeRecord}
          fetchAuthoritativeRecord={fetchAuthoritativeRecord}
        />
      )}
      {editor && (
        <CanonicalEditorModal
          record={editor.record}
          initialEntityType={editor.initialEntityType}
          prefillValues={editor.prefillValues}
          refreshSession={refreshSession}
          close={() => setEditor(null)}
          saved={async (record) => {
            setEditor(null);
            await acceptAuthoritativeRecord(record);
          }}
        />
      )}
      {addressAssessment && (
        <section className="panel">
          <h3>Existing Address publication review</h3>
          <p>
            {addressAssessment.publishable.length} valid, complete and
            non-duplicate Address record(s) can be published.
          </p>
          {addressAssessment.incomplete.length > 0 && (
            <details>
              <summary>
                {addressAssessment.incomplete.length} incomplete Address
                record(s)
              </summary>
              <ul>
                {addressAssessment.incomplete.map((item) => (
                  <li key={item.canonicalId}>
                    <b>{item.label}</b> — {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {addressAssessment.duplicates.length > 0 && (
            <details>
              <summary>
                {addressAssessment.duplicates.length} possible duplicate Address
                record(s)
              </summary>
              <ul>
                {addressAssessment.duplicates.map((item) => (
                  <li key={item.canonicalId}>
                    <b>{item.label}</b> — review against{" "}
                    {item.candidates
                      .map((candidate) => candidate.label)
                      .join(", ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {migrationOpen && (
        <GovernedDecisionModal
          title="Migrate canonical storage"
          eyebrow="Local storage maintenance"
          introduction="Copy every embedded canonical record into the managed per-record collection, verify IDs and hashes, then remove only the verified embedded copies."
          confirmLabel="Migrate safely"
          destructive
          busy={loading}
          close={() => setMigrationOpen(false)}
          submit={async () => migrate()}
          summary={[
            {
              label: "Records to migrate",
              value: String(data?.storage.embeddedRecords || 0),
            },
            {
              label: "Safety",
              value: "A verified local snapshot is created first",
            },
          ]}
        />
      )}
      {bulkPublishOpen && addressAssessment && (
        <GovernedDecisionModal
          title="Publish valid existing Addresses"
          introduction="Only schema-valid, complete and non-duplicate Addresses will be approved and published. Incomplete and possible duplicate records remain unchanged for review."
          confirmLabel={`Publish ${addressAssessment.publishable.length} valid Address${addressAssessment.publishable.length === 1 ? "" : "es"}`}
          confirmDisabled={!addressAssessment.publishable.length}
          busy={loading}
          close={() => setBulkPublishOpen(false)}
          submit={async () => addressCommand("publish-valid-addresses")}
          summary={[
            {
              label: "Ready",
              value: String(addressAssessment.publishable.length),
            },
            {
              label: "Incomplete",
              value: String(addressAssessment.incomplete.length),
            },
            {
              label: "Possible duplicates",
              value: String(addressAssessment.duplicates.length),
            },
          ]}
        />
      )}
    </>
  );
}

function RegistryTable({
  records,
  selectedType,
  open,
}: {
  records: CanonicalRecord[];
  selectedType: string;
  open: (record: CanonicalRecord) => void;
}) {
  const columns = useMemo(() => registryColumns(selectedType), [selectedType]);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.canonicalId}>
              {columns.map((column) => (
                <td key={column.key}>{column.value(record)}</td>
              ))}
              <td>
                <button
                  className="inline-action"
                  onClick={() => open(record)}
                  aria-label={`View ${record.entityType} ${recordName(record)}`}
                >
                  View record
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegistryDetail({
  record,
  role,
  managed,
  refreshSession,
  close,
  openEditor,
  saved,
  fetchAuthoritativeRecord,
}: {
  record: CanonicalRecord;
  role: string;
  managed: boolean;
  refreshSession: () => Promise<boolean>;
  close: () => void;
  openEditor: (request: EditorRequest) => void;
  saved: (record: CanonicalRecord) => Promise<void>;
  fetchAuthoritativeRecord: (canonicalId: string) => Promise<CanonicalRecord>;
}) {
  const definition = schemaDefinition(record.entityType),
    editable = definition?.fields.filter((field) => field.editable) || [];
  const [editing, setEditing] = useState(false),
    [values, setValues] = useState<Record<string, string | boolean>>(() =>
      Object.fromEntries(
        editable.map((field) => [
          field.name,
          field.valueType === "boolean"
            ? record.record[field.name] !== false
            : String(record.record[field.name] ?? ""),
        ]),
      ),
    ),
    [reason, setReason] = useState(""),
    [lockChanges, setLockChanges] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [decision, setDecision] = useState<
      | {
          kind: "lifecycle";
          target: "draft" | "needs-review" | "published" | "archived";
        }
      | { kind: "approve-address" }
      | null
    >(null),
    [refreshRequired, setRefreshRequired] = useState(false);
  const [legendRelations, setLegendRelations] = useState<{
    employment: CanonicalRecord[];
    assignments: CanonicalRecord[];
    labels: Record<string, string>;
  }>({ employment: [], assignments: [], labels: {} });
  const [legendRelationsError, setLegendRelationsError] = useState("");
  useEffect(() => {
    if (record.entityType !== "Legend") return;
    let active = true;
    void (async () => {
      try {
        const request = () =>
          Promise.all([
            fetch(
              `/api/registry?search=${encodeURIComponent(record.canonicalId)}&page=1&pageSize=100`,
              { cache: "no-store" },
            ),
            fetch("/api/canonical-records", { cache: "no-store" }),
          ]);
        let [recordsResponse, contextResponse] = await request();
        if (
          (recordsResponse.status === 401 || contextResponse.status === 401) &&
          (await refreshSession())
        )
          [recordsResponse, contextResponse] = await request();
        const [recordsBody, contextBody] = await Promise.all([
          recordsResponse.json(),
          contextResponse.json(),
        ]);
        if (!recordsResponse.ok || !contextResponse.ok)
          throw new Error(
            recordsBody.error?.message ||
              contextBody.error?.message ||
              "Related Legend information could not be loaded.",
          );
        if (!active) return;
        const related = (recordsBody.records as CanonicalRecord[]).filter(
          (candidate) =>
            candidate.canonicalId !== record.canonicalId &&
            candidate.record.legendId === record.canonicalId,
        );
        setLegendRelations({
          employment: related.filter(
            (candidate) => candidate.entityType === "Employment",
          ),
          assignments: related.filter(
            (candidate) => candidate.entityType === "Operational Assignment",
          ),
          labels: Object.fromEntries(
            (contextBody.relationships as { canonicalId: string; label: string }[]).map(
              (item) => [item.canonicalId, item.label],
            ),
          ),
        });
        setLegendRelationsError("");
      } catch (cause) {
        if (active) setLegendRelationsError((cause as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [record, refreshSession]);
  const ownership =
    record.record.ownership && typeof record.record.ownership === "object"
      ? (record.record.ownership as Record<string, unknown>)
      : {};
  async function save() {
    setSaving(true);
    setError("");
    try {
      const patch: Record<string, string | boolean | null> = {};
      for (const field of editable) {
        const value =
          field.valueType === "boolean"
            ? Boolean(values[field.name])
            : String(values[field.name] || "").trim() || null;
        if (value !== record.record[field.name]) patch[field.name] = value;
      }
      const request = () =>
        fetch("/api/registry", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            canonicalId: record.canonicalId,
            expectedVersion: Number(record.record.version),
            patch,
            reason,
            lockFields: lockChanges ? Object.keys(patch) : [],
          }),
        });
      let response = await request();
      if (response.status === 401 && (await refreshSession()))
        response = await request();
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "Canonical correction failed.");
      setEditing(false);
      setReason("");
      setLockChanges(false);
      await saved(body.record);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function changeLifecycle(
    target: "draft" | "needs-review" | "published" | "archived",
    note: string,
  ) {
    setSaving(true);
    setError("");
    try {
      const request = () =>
        fetch("/api/governance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "lifecycle",
            canonicalId: record.canonicalId,
            expectedVersion: Number(record.record.version),
            target,
            reason: note,
          }),
        });
      let response = await request();
      if (response.status === 401 && (await refreshSession()))
        response = await request();
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "Lifecycle change failed.");
      await acceptMutation(body);
      setDecision(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function publishAddress(note: string) {
    setSaving(true);
    setError("");
    try {
      const request = () =>
        fetch("/api/canonical-records", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "approve-address",
            canonicalId: record.canonicalId,
            expectedVersion: Number(record.record.version),
            note,
          }),
        });
      let response = await request();
      if (response.status === 401 && (await refreshSession()))
        response = await request();
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "Address publication failed.");
      await acceptMutation(body);
      setDecision(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function acceptMutation(body: unknown) {
    let authoritative = canonicalRecordFromMutationResponse(body);
    if (!authoritative) {
      try {
        authoritative = await fetchAuthoritativeRecord(record.canonicalId);
      } catch (cause) {
        setRefreshRequired(true);
        throw new Error(
          `The change was saved, but its current status could not be refreshed. ${(cause as Error).message}`,
        );
      }
    }
    await saved(authoritative);
    setRefreshRequired(false);
    setError("");
  }
  async function retryRefresh() {
    setSaving(true);
    try {
      const latest = await fetchAuthoritativeRecord(record.canonicalId);
      await saved(latest);
      setRefreshRequired(false);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const structured = [
    "OPLOC",
    "Address",
    "Legend",
    "Employment",
    "Operational Assignment",
    "Operational Capability",
    "Capability Enablement",
  ].includes(record.entityType);
  const status = canonicalDisplayStatus(record),
    lifecycle = status.lifecycle,
    actions = availableLifecycleActions(record);
  return (
    <div
      className="detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registry-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="detail-modal registry-detail">
        <header>
          <div>
            <small>
              {record.entityType} · {lifecycle}
            </small>
            <h2 id="registry-detail-title">{recordName(record)}</h2>
            {record.entityType === "OPLOC" && (
              <div className="oploc-identity">
                <span>OPLOC ID • <code>{record.canonicalId}</code></span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(record.canonicalId)}
                  aria-label={`Copy OPLOC ID ${record.canonicalId}`}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
          <button
            className="icon"
            aria-label="Close registry record"
            onClick={close}
          >
            <X />
          </button>
        </header>
        <div className="detail-summary">
          <span className={`status status--${lifecycle}`}>
            Publication: {labelValue(status.publication)}
          </span>
          {record.entityType === "Address" && (
            <span>Review: {labelValue(status.approval || "pending")}</span>
          )}
          <span>Last updated {formatDate(record.record.updatedAt)}</span>
        </div>
        {error && (
          <div className="error">
            <AlertTriangle />
            {error}
            {refreshRequired && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void retryRefresh()}
              >
                Retry status refresh
              </button>
            )}
          </div>
        )}
        {editing ? (
          <section className="canonical-editor">
            <h3>Governed correction</h3>
            <p>Identity, lifecycle and source history remain protected.</p>
            <div className="editor-grid">
              {editable.map((field) =>
                field.valueType === "boolean" ? (
                  <label key={field.name}>
                    <span>{field.label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(values[field.name])}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.name]: event.target.checked,
                        }))
                      }
                    />
                  </label>
                ) : field.values ? (
                  <label key={field.name}>
                    {field.label}
                    <select
                      value={String(values[field.name] || "")}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.name]: event.target.value,
                        }))
                      }
                    >
                      {field.values.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label key={field.name}>
                    {field.label}
                    <input
                      type={
                        field.valueType === "email"
                          ? "email"
                          : field.valueType === "date"
                            ? "date"
                            : "text"
                      }
                      value={String(values[field.name] || "")}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.name]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ),
              )}
            </div>
            <label>
              Why is this correction needed?
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={10}
                maxLength={1000}
                placeholder="Explain the exceptional correction."
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={lockChanges}
                onChange={(event) => setLockChanges(event.target.checked)}
              />{" "}
              Protect corrected fields from later provider overwrite
            </label>
            <div className="actions">
              <button onClick={() => setEditing(false)}>Cancel</button>
              <button
                className="primary"
                disabled={saving || reason.trim().length < 10}
                onClick={save}
              >
                {saving ? "Saving…" : "Validate and save correction"}
              </button>
            </div>
          </section>
        ) : (
          <>
            <ReadableRecordDetails record={record} lifecycle={lifecycle} />
            {record.entityType === "OPLOC" && (
              <OperationalAreasPanel
                oplocId={record.canonicalId}
                canManage={role === "integration-admin" && managed}
                refreshSession={refreshSession}
              />
            )}
            {record.entityType === "Legend" && (
              <LegendProfileData
                record={record}
                related={legendRelations}
                error={legendRelationsError}
                canManage={role === "integration-admin" && managed}
                openEditor={openEditor}
              />
            )}
            <details className="technical-details">
              <summary>Technical details and raw record</summary>
              <dl className="readable-summary">
                <div>
                  <dt>Canonical ID</dt>
                  <dd>{record.canonicalId}</dd>
                </div>
                <div>
                  <dt>Schema</dt>
                  <dd>{String(record.record.schemaVersion)}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{String(record.record.version)}</dd>
                </div>
              </dl>
              <pre>
                {JSON.stringify(
                  {
                    record: record.record,
                    fieldProvenance: record.fieldProvenance,
                    ownership,
                    provenanceIds: record.record.provenanceIds,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            {role === "integration-admin" && managed && (
              <div className="actions">
                {structured ? (
                  <button
                    className="primary"
                    onClick={() => openEditor({ record })}
                  >
                    Edit structured record
                  </button>
                ) : (
                  <button className="primary" onClick={() => setEditing(true)}>
                    Correct canonical record
                  </button>
                )}
                {actions.includes("publish-valid-address") && (
                  <button
                    onClick={() => setDecision({ kind: "approve-address" })}
                  >
                    Publish valid Address
                  </button>
                )}
                {actions.includes("send-to-review") && (
                  <button
                    onClick={() =>
                      setDecision({ kind: "lifecycle", target: "needs-review" })
                    }
                  >
                    Send to review
                  </button>
                )}
                {(actions.includes("return-to-draft") ||
                  actions.includes("publish")) && (
                  <>
                    {actions.includes("return-to-draft") && (
                      <button
                        onClick={() =>
                          setDecision({ kind: "lifecycle", target: "draft" })
                        }
                      >
                        Return to draft
                      </button>
                    )}
                    {actions.includes("publish") && (
                      <button
                        onClick={() =>
                          setDecision({
                            kind: "lifecycle",
                            target: "published",
                          })
                        }
                      >
                        Publish
                      </button>
                    )}
                  </>
                )}
                {actions.includes("archive") && (
                  <button
                    onClick={() =>
                      setDecision({ kind: "lifecycle", target: "archived" })
                    }
                  >
                    Archive
                  </button>
                )}
                {actions.includes("restore") && (
                  <button
                    onClick={() =>
                      setDecision({ kind: "lifecycle", target: "needs-review" })
                    }
                  >
                    Restore to review
                  </button>
                )}
              </div>
            )}
            {role === "integration-admin" && !managed && (
              <div className="warning">
                <AlertTriangle />
                Complete the verified canonical storage migration before
                recording changes.
              </div>
            )}
          </>
        )}
        {decision?.kind === "approve-address" && (
          <GovernedDecisionModal
            title={`Publish ${recordName(record)}`}
            introduction="A schema-valid, complete Address is approved and published together. Incomplete records remain unchanged."
            confirmLabel="Publish valid Address"
            busy={saving}
            close={() => setDecision(null)}
            submit={publishAddress}
          />
        )}
        {decision?.kind === "lifecycle" && (
          <GovernedDecisionModal
            title={`${lifecycleActionLabel(decision.target)} ${recordName(record)}`}
            introduction={`Move this record from ${labelValue(lifecycle)} to ${labelValue(decision.target)}. Publication and archive actions remain separately authorised.`}
            confirmLabel={lifecycleActionLabel(decision.target)}
            destructive={
              decision.target === "archived" || decision.target === "published"
            }
            busy={saving}
            close={() => setDecision(null)}
            submit={(note) => changeLifecycle(decision.target, note)}
          />
        )}
      </section>
    </div>
  );
}

function Filter({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
  hideAll = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  allLabel?: string;
  hideAll?: boolean;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {!hideAll && <option value="">{allLabel}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {labelValue(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
function ReadableRecordDetails({
  record,
  lifecycle,
}: {
  record: CanonicalRecord;
  lifecycle: string;
}) {
  const hidden = new Set([
    "canonicalId",
    "entityType",
    "schemaVersion",
    "version",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "ownership",
    "provenanceIds",
    "externalIdentities",
  ]);
  const fields = Object.entries(record.record).filter(
    ([key]) => !hidden.has(key),
  );
  const isOploc = record.entityType === "OPLOC";
  const locationTypeHistory = isOploc ? record.record.locationTypeHistory : undefined;
  const currentFields = isOploc
    ? ["primaryLocationType", "lifecycleState", "aliases", "active", "approvedName"].flatMap((key) => fields.filter(([field]) => field === key))
    : fields;
  return (
    <section className="detail-block">
      <h3>{isOploc ? "Current OPLOC information" : "Current information"}</h3>
      <dl className="readable-summary">
        <div>
          <dt>Status</dt>
          <dd>{labelValue(lifecycle)}</dd>
        </div>
        {currentFields.map(([key, value]) => (
          <div key={key}>
            <dt>{labelValue(key)}</dt>
            <dd>{readableValue(value)}</dd>
          </div>
        ))}
      </dl>
      {isOploc && Array.isArray(locationTypeHistory) && (
        <details className="audit-history">
          <summary>Audit/history</summary>
          <dl className="readable-summary">
            <div>
              <dt>Location Type History</dt>
              <dd>{readableValue(locationTypeHistory)}</dd>
            </div>
          </dl>
        </details>
      )}
      {Array.isArray(record.record.externalIdentities) &&
        record.record.externalIdentities.length > 0 && (
          <>
            <h3>Source identities</h3>
            <ul>
              {record.record.externalIdentities.map((identity) => (
                <li key={externalIdentityKey(identity)}>
                  {readableValue(identity)}
                </li>
              ))}
            </ul>
          </>
        )}
    </section>
  );
}

function LegendProfileData({
  record,
  related,
  error,
  canManage,
  openEditor,
}: {
  record: CanonicalRecord;
  related: {
    employment: CanonicalRecord[];
    assignments: CanonicalRecord[];
    labels: Record<string, string>;
  };
  error: string;
  canManage: boolean;
  openEditor: (request: EditorRequest) => void;
}) {
  const suggestions = legendRotaSuggestions(record);
  return (
    <section className="detail-block legend-profile-data">
      <h3>Employment and working locations</h3>
      <p>
        Name and contact details belong to the Legend. Employment dates and
        working locations remain linked records so history is not overwritten.
      </p>
      {error && <div className="warning">{error}</div>}
      <h4>Employment history</h4>
      {related.employment.length ? (
        <div className="list">
          {related.employment.map((employment) => (
            <article key={employment.canonicalId}>
              <b>{String(employment.record.employmentState || "Employment")}</b>
              <span>
                {String(employment.record.startDate || "Start date not supplied")}
                {employment.record.terminationDate
                  ? ` to ${String(employment.record.terminationDate)}`
                  : ""}
              </span>
              {Boolean(employment.record.contractualJobTitle) && (
                <small>{String(employment.record.contractualJobTitle)}</small>
              )}
              {canManage && employment.lifecycleStatus !== "published" && (
                <button
                  className="inline-action"
                  onClick={() => openEditor({ record: employment })}
                >
                  Edit employment
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p>No separate Employment record has been added yet.</p>
      )}
      {canManage && (
        <button
          className="inline-action"
          onClick={() =>
            openEditor({
              initialEntityType: "Employment",
              prefillValues: {
                legendId: record.canonicalId,
                employmentState: String(record.record.employmentState || ""),
                terminationDate: String(record.record.terminationDate || ""),
                contractualJobTitle: String(record.record.jobTitle || ""),
              },
            })
          }
        >
          Add employment details
        </button>
      )}
      <h4>Working locations</h4>
      {related.assignments.length ? (
        <div className="list">
          {related.assignments.map((assignment) => (
            <article key={assignment.canonicalId}>
              <b>
                {related.labels[String(assignment.record.oplocId)] ||
                  String(assignment.record.oplocId)}
              </b>
              <span>
                {String(assignment.record.designation || "Assignment")} ·{" "}
                {String(assignment.record.assignmentRole || "Role not supplied")}
              </span>
              <small>
                Effective {String(assignment.record.effectiveFrom || "date not supplied")}
                {assignment.record.effectiveTo
                  ? ` to ${String(assignment.record.effectiveTo)}`
                  : ""}
              </small>
              {canManage && assignment.lifecycleStatus !== "published" && (
                <button
                  className="inline-action"
                  onClick={() => openEditor({ record: assignment })}
                >
                  Edit working location
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p>No governed working location has been assigned yet.</p>
      )}
      {suggestions.length > 0 && (
        <p>
          <b>Rota suggestions:</b> {suggestions.join(", ")}. These are hints
          only and do not create an assignment.
        </p>
      )}
      {canManage && (
        <button
          className="inline-action"
          onClick={() =>
            openEditor({
              initialEntityType: "Operational Assignment",
              prefillValues: { legendId: record.canonicalId },
            })
          }
        >
          Assign working location
        </button>
      )}
    </section>
  );
}

function legendRotaSuggestions(record: CanonicalRecord) {
  const ownership = record.record.ownership as
    | {
        fikaOwned?: {
          workLocationEvidence?: {
            siteReferences?: { name?: unknown }[];
            primarySiteSuggestion?: unknown;
          };
        };
      }
    | undefined;
  const evidence = ownership?.fikaOwned?.workLocationEvidence;
  const names = Array.isArray(evidence?.siteReferences)
    ? evidence!.siteReferences!.map((item) => String(item.name || "")).filter(Boolean)
    : [];
  const primary = String(evidence?.primarySiteSuggestion || "");
  return [...new Set([primary, ...names].filter(Boolean))];
}
function registryColumns(type: string) {
  const base = [
    { key: "name", label: "Name", value: recordName },
    {
      key: "type",
      label: "Schema",
      value: (record: CanonicalRecord) => record.entityType,
    },
  ];
  if (type === "Legend")
    return [
      ...base,
      {
        key: "email",
        label: "Work email",
        value: (record: CanonicalRecord) =>
          String(record.record.workEmail || "—"),
      },
      {
        key: "job",
        label: "Job title",
        value: (record: CanonicalRecord) =>
          String(record.record.jobTitle || "—"),
      },
      {
        key: "state",
        label: "Employment",
        value: (record: CanonicalRecord) =>
          String(record.record.employmentState || "—"),
      },
    ];
  if (type === "Address")
    return [
      ...base,
      {
        key: "locality",
        label: "Town or city",
        value: (record: CanonicalRecord) =>
          String(record.record.locality || "—"),
      },
      {
        key: "postal",
        label: "Postal code",
        value: (record: CanonicalRecord) =>
          String(record.record.postalCode || "—"),
      },
      {
        key: "country",
        label: "Country",
        value: (record: CanonicalRecord) =>
          String(record.record.countryCode || "—"),
      },
    ];
  if (type === "Site")
    return [
      ...base,
      {
        key: "oploc",
        label: "OPLOC",
        value: (record: CanonicalRecord) =>
          String(record.record.operationalLocationId || "—"),
      },
      {
        key: "address",
        label: "Address",
        value: (record: CanonicalRecord) =>
          String(record.record.address || "—"),
      },
    ];
  if (type === "Till Item Variation")
    return [
      ...base,
      {
        key: "item",
        label: "Till Item",
        value: (record: CanonicalRecord) =>
          String(record.record.tillItemId || "—"),
      },
      {
        key: "sku",
        label: "SKU",
        value: (record: CanonicalRecord) => String(record.record.sku || "—"),
      },
    ];
  return [
    ...base,
    {
      key: "source",
      label: "Sources",
      value: (record: CanonicalRecord) =>
        externalProviders(record).join(", ") || "—",
    },
    {
      key: "status",
      label: "Status",
      value: (record: CanonicalRecord) =>
        record.lifecycleStatus ||
        (record.publicationStatus === "published"
          ? "published"
          : record.publicationStatus === "withdrawn"
            ? "archived"
            : "needs review"),
    },
    {
      key: "updated",
      label: "Updated",
      value: (record: CanonicalRecord) => formatDate(record.record.updatedAt),
    },
  ];
}
function recordName(record: CanonicalRecord) {
  return record.entityType === "Address"
    ? formatAddress(record.record) || record.canonicalId
    : String(
        record.record.displayName ||
          record.record.name ||
          record.record.approvedName ||
          record.canonicalId,
      );
}
function externalProviders(record: CanonicalRecord) {
  return [
    ...new Set(
      (Array.isArray(record.record.externalIdentities)
        ? record.record.externalIdentities
        : []
      )
        .map((identity) =>
          identity && typeof identity === "object"
            ? String((identity as Record<string, unknown>).provider || "")
            : "",
        )
        .filter(Boolean),
    ),
  ];
}
function formatDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}
function labelValue(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
function lifecycleActionLabel(target: string) {
  if (target === "needs-review") return "Send to review";
  if (target === "draft") return "Return to draft";
  if (target === "published") return "Publish";
  return "Archive";
}
function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "")
    return "Not supplied";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length ? value.map(readableValue).join(", ") : "None";
  if (typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${labelValue(key)}: ${readableValue(item)}`)
      .join(" · ");
  return String(value);
}
function externalIdentityKey(identity: unknown) {
  if (identity && typeof identity === "object") {
    const value = identity as Record<string, unknown>;
    return `${String(value.provider || "source")}:${String(value.externalId || JSON.stringify(value))}`;
  }
  return `identity:${String(identity)}`;
}
function initialFilters(): Filters {
  if (typeof window === "undefined")
    return {
      search: "",
      entityType: "",
      provider: "",
      status: "",
      site: "",
      sort: "name",
      direction: "asc",
      page: 1,
      pageSize: 25,
    };
  const params = new URLSearchParams(window.location.search);
  return {
    search: params.get("search") || "",
    entityType: params.get("entityType") || "",
    provider: params.get("provider") || "",
    status: params.get("status") || "",
    site: params.get("site") || "",
    sort: params.get("sort") || "name",
    direction: params.get("direction") || "asc",
    page: Number(params.get("page") || 1),
    pageSize: Number(params.get("pageSize") || 25),
  };
}
function registryParams(filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== "") params.set(key, String(value));
  return params.toString();
}
