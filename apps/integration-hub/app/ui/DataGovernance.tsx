"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import CanonicalEditorModal from "./CanonicalEditorModal";
import GovernedDecisionModal from "./GovernedDecisionModal";
import LegacySiteDecisionModal from "./LegacySiteDecisionModal";

type Field = {
  fieldId: string;
  provider: string;
  providerEntity: string;
  sourcePath: string;
  description: string;
  classification: string;
  canonicalTarget?: string;
  authorityRule: string;
  sensitivity: string;
  mapperVersion: string;
  decisionReason: string;
  observed: number;
};
type Mapping = {
  mappingId: string;
  sourceProvider: string;
  sourceEntityType: string;
  sourceIdentifier: string;
  sourceLabel?: string;
  oplocId?: string;
  targetCanonicalId?: string;
  mappingStatus: string;
  decisionReason: string;
};
type Evidence = {
  displayName?: unknown;
  workEmail?: unknown;
  jobTitle?: unknown;
  employmentState?: unknown;
  externalIdentities?: unknown[];
  rotaSiteReferences?: unknown[];
  workLocationReferences?: unknown[];
};
type LegendCandidate = Evidence & {
  canonicalId: string;
  lifecycleStatus: string;
  matchExplanation: string;
  confidence: number;
};
type LegendQueueItem = {
  stagingId: string;
  displayName: unknown;
  status: unknown;
  source: Evidence;
  candidates: LegendCandidate[];
};
type ReadinessRecord = {
  canonicalId: string;
  entityType: string;
  label: string;
  lifecycleState: string;
  publicationEligible: boolean;
  alreadyPublished: boolean;
  blockers: string[];
  addressReference?: unknown;
  addressLabel?: string;
  addressLifecycle?: string;
  aliases: unknown[];
  sourceMappings: {
    mappingId: string;
    sourceProvider: string;
    sourceLabel?: string;
    mappingStatus: string;
  }[];
};
type MissingRotaEvidence = {
  stagingId: string;
  displayName: unknown;
  status: unknown;
  source: Evidence;
};
type Payload = {
  fields: Field[];
  sourceMappings: Mapping[];
  issues: {
    issueId: string;
    code: string;
    severity: string;
    entityReference: string;
    message: string;
    entityLabel?: string;
    entityType?: string;
    canonicalId?: string;
  }[];
  queues: {
    legends: LegendQueueItem[];
    deferredLegends: LegendQueueItem[];
    missingRotaEvidence: MissingRotaEvidence[];
    siteLabels: { label: string; mapping: Mapping | null }[];
  };
  publicationReadiness: {
    explicitLifecycle: number;
    legacyWithoutLifecycle: number;
    published: number;
    records: ReadinessRecord[];
  };
  resolution?: {
    examined: number;
    published: number;
    retainedForReview: number;
  };
};
type Relationship = {
  canonicalId: string;
  entityType: string;
  label: string;
  lifecycleStatus: string;
  schemaValid: boolean;
};
type EditorContext = {
  relationships: Relationship[];
  legacySites: {
    canonicalId: string;
    label: string;
    address?: string;
    mappingStatus: string;
    mappedOplocId?: string;
    mappedOplocLabel?: string;
  }[];
  permissions: string[];
};
type Decision =
  | { kind: "completeness"; field: Field; classification: string }
  | {
      kind: "legend";
      item: LegendQueueItem;
      status: "confirmed" | "rejected" | "deferred";
      targetId?: string;
    }
  | { kind: "location"; label: string; targetId?: string };

export default function DataGovernance({
  role,
  refreshSession,
  openRegistry,
}: {
  role: string;
  refreshSession: () => Promise<boolean>;
  openRegistry: (canonicalId: string) => void;
}) {
  const [data, setData] = useState<Payload | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [editorContext, setEditorContext] = useState<EditorContext | null>(
      null,
    ),
    [createFromLegacy, setCreateFromLegacy] = useState<string | null>(null),
    [legacyDecision, setLegacyDecision] = useState<
      EditorContext["legacySites"][number] | null
    >(null),
    [pilot, setPilot] = useState<ReadinessRecord | null>(null),
    [decision, setDecision] = useState<Decision | null>(null);
  const [provider, setProvider] = useState(""),
    [classification, setClassification] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const request = () =>
        Promise.all([
          fetch("/api/governance", { cache: "no-store" }),
          fetch("/api/canonical-records", { cache: "no-store" }),
        ]);
      let [response, contextResponse] = await request();
      if (
        (response.status === 401 || contextResponse.status === 401) &&
        (await refreshSession())
      )
        [response, contextResponse] = await request();
      const [body, contextBody] = await Promise.all([
        response.json(),
        contextResponse.json(),
      ]);
      if (!response.ok)
        throw new Error(
          body.error?.message || "Data governance could not be loaded.",
        );
      if (!contextResponse.ok)
        throw new Error(
          contextBody.error?.message ||
            "Canonical decision options could not be loaded.",
        );
      setData(body);
      setEditorContext(contextBody);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [refreshSession]);
  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("fika:canonical-record-mutated", refresh);
    return () =>
      window.removeEventListener("fika:canonical-record-mutated", refresh);
  }, [load]);
  const fields = useMemo(
    () =>
      (data?.fields || []).filter(
        (field) =>
          (!provider || field.provider === provider) &&
          (!classification || field.classification === classification),
      ),
    [data, provider, classification],
  );
  const legends =
      editorContext?.relationships.filter(
        (option) => option.entityType === "Legend",
      ) || [],
    oplocs =
      editorContext?.relationships.filter(
        (option) => option.entityType === "OPLOC",
      ) || [];
  const unresolvedLegacySites =
    editorContext?.legacySites.filter(
      (site) => site.mappingStatus !== "confirmed" || !site.mappedOplocId,
    ) || [];
  const unresolvedSiteLabels =
    data?.queues.siteLabels.filter(
      (item) => !item.mapping || item.mapping.mappingStatus !== "confirmed",
    ) || [];
  const unpublishedOplocs =
    data?.publicationReadiness.records.filter(
      (record) => record.entityType === "OPLOC" && !record.alreadyPublished,
    ) || [];
  async function command(body: Record<string, unknown>) {
    setLoading(true);
    try {
      const request = () =>
        fetch("/api/governance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      let response = await request();
      if (response.status === 401 && (await refreshSession()))
        response = await request();
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "Governance decision failed.");
      setData(result);
      setDecision(null);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function submitDecision(note: string) {
    if (!decision) return;
    if (decision.kind === "completeness")
      return command({
        action: "completeness-decision",
        fieldId: decision.field.fieldId,
        classification: decision.classification,
        decisionReason: note,
      });
    if (decision.kind === "location")
      return command({
        action: "source-mapping",
        sourceProvider: "rota",
        sourceEntityType: "site-label",
        sourceIdentifier: decision.label.toLowerCase(),
        sourceLabel: decision.label,
        oplocId: decision.targetId,
        mappingStatus: "confirmed",
        decisionReason: note,
      });
    return command({
      action: "source-mapping",
      sourceProvider: "rota",
      sourceEntityType: "person-identity",
      sourceIdentifier: decision.item.stagingId,
      sourceLabel: String(
        decision.item.displayName || "Unnamed person candidate",
      ),
      ...(decision.status === "confirmed"
        ? { targetCanonicalId: decision.targetId }
        : {}),
      mappingStatus: decision.status,
      decisionReason: note,
    });
  }
  return (
    <>
      <section className="heading">
        <small>Canonical data governance</small>
        <h2>Quality &amp; Reconciliation</h2>
        <p>
          Review people and locations using operational evidence. The
          Integration Hub manages identifiers and audit wording in the
          background.{loading ? " Loading current evidence…" : ""}
        </p>
      </section>
      {error && (
        <div className="error">
          <AlertTriangle />
          {error}
        </div>
      )}
      <div className="metrics">
        <article className="metric">
          <strong>{data?.publicationReadiness.published || 0}</strong>
          <span>Published</span>
        </article>
        <article className="metric warn">
          <strong>
            {data?.publicationReadiness.legacyWithoutLifecycle || 0}
          </strong>
          <span>Need lifecycle review</span>
        </article>
        <article className="metric warn">
          <strong>{data?.issues.length || 0}</strong>
          <span>Open issues</span>
        </article>
        <article className="metric warn">
          <strong>{data?.queues.legends.length || 0}</strong>
          <span>Legend identity reviews</span>
        </article>
      </div>
      <section className="panel">
        <h3>Source completeness</h3>
        <p className="panel-copy">
          Review how provider information is treated without changing its source
          evidence.
        </p>
        <div className="controls">
          <label>
            Provider
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="">All providers</option>
              {[
                ...new Set((data?.fields || []).map((field) => field.provider)),
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Classification
            <select
              value={classification}
              onChange={(event) => setClassification(event.target.value)}
            >
              <option value="">All classifications</option>
              {[
                ...new Set(
                  (data?.fields || []).map((field) => field.classification),
                ),
              ].map((value) => (
                <option key={value}>{friendly(value)}</option>
              ))}
            </select>
          </label>
          <button onClick={() => void load()} disabled={loading} aria-busy={loading}>
            <RefreshCw /> {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source information</th>
                <th>Observed</th>
                <th>Current treatment</th>
                <th>Used by FIKA OS as</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.fieldId}>
                  <td>
                    <b>{field.description}</b>
                    <small>
                      {field.provider} · {field.providerEntity}
                    </small>
                  </td>
                  <td>{field.observed}</td>
                  <td>{friendly(field.classification)}</td>
                  <td>{field.canonicalTarget || "Not currently used"}</td>
                  <td>
                    {role === "integration-admin" ? (
                      <button
                        className="inline-action"
                        onClick={() =>
                          setDecision({
                            kind: "completeness",
                            field,
                            classification: field.classification,
                          })
                        }
                      >
                        Review treatment
                      </button>
                    ) : (
                      field.decisionReason
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>Are these the same Legend?</h3>
        <p className="panel-copy">
          Compare the source person with real canonical candidates. Similar
          evidence never makes the decision automatically.
        </p>
        {data?.queues.legends.length ? (
          <div className="identity-queue">
            {data.queues.legends.slice(0, 100).map((item) => (
              <article className="identity-review" key={item.stagingId}>
                <div>
                  <h4>Source person</h4>
                  <EvidenceCard evidence={item.source} />
                </div>
                <div>
                  <h4>Possible existing Legends</h4>
                  {item.candidates.length ? (
                    item.candidates.map((candidate) => (
                      <div
                        className="candidate-card"
                        key={candidate.canonicalId}
                      >
                        <EvidenceCard evidence={candidate} />
                        <p>
                          <b>Why shown:</b> {candidate.matchExplanation} (
                          {Math.round(candidate.confidence * 100)}%)
                        </p>
                        {role === "integration-admin" && (
                          <button
                            className="primary"
                            onClick={() =>
                              setDecision({
                                kind: "legend",
                                item,
                                status: "confirmed",
                                targetId: candidate.canonicalId,
                              })
                            }
                          >
                            Yes, same person
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p>
                      No direct candidate was found. Search existing Legends if
                      you recognise this person.
                    </p>
                  )}
                  {role === "integration-admin" && (
                    <div className="actions">
                      <button
                        onClick={() =>
                          setDecision({
                            kind: "legend",
                            item,
                            status: "confirmed",
                          })
                        }
                      >
                        Choose another Legend
                      </button>
                      <button
                        onClick={() =>
                          setDecision({
                            kind: "legend",
                            item,
                            status: "rejected",
                          })
                        }
                      >
                        No, different people
                      </button>
                      <button
                        onClick={() =>
                          setDecision({
                            kind: "legend",
                            item,
                            status: "deferred",
                          })
                        }
                      >
                        Not sure yet
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">
            <CheckCircle2 />
            <b>No unresolved candidate-person matches.</b>
          </div>
        )}
      </section>
      {!!data?.queues.deferredLegends.length && (
        <section className="panel">
          <h3>Deferred identity reviews</h3>
          <p className="panel-copy">
            These comparisons were deliberately left for later and are not
            active unresolved decisions.
          </p>
          <div className="list">
            {data.queues.deferredLegends.map((item) => (
              <article key={item.stagingId}>
                <b>{String(item.displayName || "Unnamed person")}</b>
                <span>Deferred</span>
                <small>
                  {item.candidates.length} possible existing Legend
                  {item.candidates.length === 1 ? "" : "s"}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}
      {!!data?.queues.missingRotaEvidence.length && (
        <section className="panel">
          <h3>Missing rota evidence</h3>
          <p className="panel-copy">
            These Legends have no exact rota evidence. This is a
            source-completeness gap, not an identity conflict.
          </p>
          <div className="list">
            {data.queues.missingRotaEvidence.map((item) => (
              <article key={item.stagingId}>
                <b>{String(item.displayName || "Unnamed person")}</b>
                <span>No exact rota match</span>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <h3>Legacy Site candidates</h3>
        <p className="panel-copy">
          Only unresolved provider-derived Site evidence appears here.
          Confirmed mappings leave the active queue automatically.
        </p>
        {unresolvedLegacySites.length ? (
          <div className="list">
          {unresolvedLegacySites.map((site) => (
            <article key={site.canonicalId}>
              <b>{site.label}</b>
              <span>
                {site.mappingStatus}
                {site.mappedOplocId ? " · mapped" : ""}
              </span>
              {site.mappedOplocId && (
                <small>
                  Mapped OPLOC: {site.mappedOplocLabel || "Confirmed location"}
                </small>
              )}
              <small>{site.address || "No source address"}</small>
              {role === "integration-admin" && (
                <div className="actions">
                  {!site.mappedOplocId && (
                    <button
                      className="inline-action"
                      onClick={() => setCreateFromLegacy(site.canonicalId)}
                    >
                      Create location candidate
                    </button>
                  )}
                  <button
                    className="inline-action"
                    onClick={() => setLegacyDecision(site)}
                  >
                    {site.mappedOplocId ? "Change mapping" : "Review mapping"}
                  </button>
                </div>
              )}
            </article>
          ))}
          </div>
        ) : (
          <div className="empty">
            <CheckCircle2 />
            <b>All legacy Site candidates are mapped.</b>
          </div>
        )}
      </section>
      <section className="panel">
        <h3>Rota location labels</h3>
        <p className="panel-copy">
          Choose the existing FIKA location represented by each unresolved rota
          label.
        </p>
        {unresolvedSiteLabels.length ? (
          <div className="list">
          {unresolvedSiteLabels.map((item) => (
            <article key={item.label}>
              <b>{item.label}</b>
              <span>
                {item.mapping
                  ? friendly(item.mapping.mappingStatus)
                  : "Unresolved"}
              </span>
              {role === "integration-admin" && !item.mapping && (
                <button
                  className="inline-action"
                  onClick={() =>
                    setDecision({ kind: "location", label: item.label })
                  }
                >
                  Choose location
                </button>
              )}
            </article>
          ))}
          </div>
        ) : (
          <div className="empty">
            <CheckCircle2 />
            <b>All rota location labels are resolved.</b>
          </div>
        )}
      </section>
      <section className="panel">
        <h3>OPLOC publication readiness</h3>
        <p className="panel-copy">
          Only unpublished OPLOCs appear here. Published OPLOCs leave the active
          queue automatically.
        </p>
        <div className="checks">
          <div>
            <ShieldCheck /> Explicit lifecycle:{" "}
            {data?.publicationReadiness.explicitLifecycle || 0}
          </div>
          <div>
            <ShieldCheck /> Published:{" "}
            {data?.publicationReadiness.published || 0}
          </div>
          <div>
            <CheckCircle2 /> Eligible candidates:{" "}
            {data?.publicationReadiness.records.filter(
              (record) =>
                record.entityType === "OPLOC" && record.publicationEligible,
            ).length || 0}
          </div>
        </div>
        {unpublishedOplocs.length ? (
          <div className="list">
          {unpublishedOplocs.map((record) => (
              <article key={record.canonicalId}>
                <b>{record.label}</b>
                <span>
                  {record.alreadyPublished
                    ? record.blockers.length
                      ? `Published · ${record.blockers.length} integrity issue(s)`
                      : "Published"
                    : record.publicationEligible
                      ? "Ready for automatic publication"
                      : `${record.blockers.length} blocker(s)`}
                </span>
                <button
                  className="inline-action"
                  onClick={() => setPilot(record)}
                >
                  Preview readiness
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">
            <CheckCircle2 />
            <b>No unpublished OPLOCs require attention.</b>
          </div>
        )}
        {pilot && (
          <div className="canonical-preview">
            <h3>{pilot.label}</h3>
            <p>Lifecycle: {friendly(pilot.lifecycleState)}</p>
            <p>Address: {pilot.addressLabel || "Not supplied"}</p>
            <p>
              Other known names:{" "}
              {pilot.aliases.length
                ? pilot.aliases
                    .map((alias) =>
                      typeof alias === "object" && alias
                        ? String((alias as Record<string, unknown>).alias || "")
                        : String(alias),
                    )
                    .filter(Boolean)
                    .join(", ")
                : "None"}
            </p>
            <p>
              Source mappings:{" "}
              {pilot.sourceMappings.length
                ? pilot.sourceMappings
                    .map(
                      (mapping) =>
                        mapping.sourceLabel || mapping.sourceProvider,
                    )
                    .join(", ")
                : "None"}
            </p>
            {pilot.blockers.length ? (
              <ul>
                {pilot.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : pilot.alreadyPublished ? (
              <p>
                <CheckCircle2 /> This OPLOC is already published and has no
                current integrity issues.
              </p>
            ) : (
              <p>
                <CheckCircle2 /> Readiness checks pass. Publication remains
                separate.
              </p>
            )}
            <details className="technical-details">
              <summary>Technical details</summary>
              <p>
                {pilot.canonicalId}
                {pilot.addressReference
                  ? ` · ${String(pilot.addressReference)}`
                  : ""}
              </p>
            </details>
            <button onClick={() => setPilot(null)}>Close preview</button>
          </div>
        )}
      </section>
      <section className="panel">
        <h3>Open canonical issues</h3>
        <p className="panel-copy">
          Missing lifecycle on previously approved records is technical debt,
          not a new business decision. The resolver publishes only accepted,
          schema-valid records whose dependencies are ready. Everything else is
          assigned an explicit review state with its real blocker preserved.
        </p>
        {role === "integration-admin" &&
          (Boolean(data?.publicationReadiness.legacyWithoutLifecycle) ||
            Boolean(
              data?.publicationReadiness.records.some(
                (record) => record.publicationEligible,
              ),
            )) && (
            <div className="actions">
              <button
                className="primary"
                disabled={loading}
                onClick={() => void command({ action: "resolve-legacy-lifecycle" })}
              >
                Publish ready records and resolve lifecycle issues
              </button>
            </div>
          )}
        {data?.resolution && (
          <p className="success">
            Reviewed {data.resolution.examined} legacy records: published {data.resolution.published}; retained for a specific review {data.resolution.retainedForReview}.
          </p>
        )}
        {data?.issues.length ? (
          <div className="list">
          {data?.issues.slice(0, 200).map((issue) => (
            <article key={issue.issueId}>
              <b>{issue.entityLabel || issue.entityReference}</b>
              <span>
                {issue.entityType ? `${issue.entityType} · ` : ""}
                {friendly(issue.code)}
              </span>
              <span>{issue.message}</span>
              <small>
                {issue.severity} · {issue.entityReference}
              </small>
              {issue.canonicalId && (
                <button
                  className="inline-action"
                  onClick={() => openRegistry(issue.canonicalId!)}
                >
                  Open record
                </button>
              )}
            </article>
          ))}
          </div>
        ) : (
          <div className="empty">
            <CheckCircle2 />
            <b>No open canonical issues.</b>
          </div>
        )}
      </section>
      {decision?.kind === "completeness" && (
        <GovernedDecisionModal
          title={`Review ${decision.field.description}`}
          introduction="Choose how FIKA OS should treat this source information."
          confirmLabel="Save treatment"
          busy={loading}
          close={() => setDecision(null)}
          submit={submitDecision}
        >
          <label>
            Treatment
            <select
              value={decision.classification}
              onChange={(event) =>
                setDecision({ ...decision, classification: event.target.value })
              }
            >
              {[
                "mapped-now",
                "retained-not-mapped",
                "deliberately-excluded",
                "restricted-sensitive",
                "unavailable-from-provider",
                "unknown-investigation",
              ].map((value) => (
                <option key={value} value={value}>
                  {friendly(value)}
                </option>
              ))}
            </select>
          </label>
        </GovernedDecisionModal>
      )}
      {decision?.kind === "legend" && (
        <GovernedDecisionModal
          title={
            decision.status === "confirmed"
              ? "Confirm the same Legend"
              : decision.status === "rejected"
                ? "Confirm different people"
                : "Leave this match for later"
          }
          introduction="The displayed evidence supports your review but does not make the identity decision."
          confirmLabel={
            decision.status === "confirmed"
              ? "Yes, same person"
              : decision.status === "rejected"
                ? "No, different people"
                : "Not sure yet"
          }
          confirmDisabled={
            decision.status === "confirmed" && !decision.targetId
          }
          busy={loading}
          close={() => setDecision(null)}
          submit={submitDecision}
          summary={[
            {
              label: "Source person",
              value: String(decision.item.displayName || "Unnamed person"),
            },
          ]}
        >
          {decision.status === "confirmed" && (
            <SearchSelector
              label="Existing Legend"
              value={decision.targetId || ""}
              options={legends}
              change={(targetId) => setDecision({ ...decision, targetId })}
            />
          )}
        </GovernedDecisionModal>
      )}
      {decision?.kind === "location" && (
        <GovernedDecisionModal
          title={`Map '${decision.label}'`}
          introduction="Choose the existing FIKA location represented by this rota label."
          confirmLabel="Save location mapping"
          confirmDisabled={!decision.targetId}
          busy={loading}
          close={() => setDecision(null)}
          submit={submitDecision}
          summary={[{ label: "Rota label", value: decision.label }]}
        >
          <SearchSelector
            label="Existing location"
            value={decision.targetId || ""}
            options={oplocs}
            change={(targetId) => setDecision({ ...decision, targetId })}
          />
        </GovernedDecisionModal>
      )}
      {createFromLegacy && (
        <CanonicalEditorModal
          legacySourceCanonicalId={createFromLegacy}
          refreshSession={refreshSession}
          close={() => setCreateFromLegacy(null)}
          saved={async () => {
            setCreateFromLegacy(null);
            await load();
          }}
        />
      )}
      {legacyDecision && editorContext && (
        <LegacySiteDecisionModal
          site={legacyDecision}
          oplocs={oplocs}
          refreshSession={refreshSession}
          close={() => setLegacyDecision(null)}
          saved={load}
        />
      )}
    </>
  );
}

function EvidenceCard({ evidence }: { evidence: Evidence }) {
  const sites = Array.isArray(evidence.rotaSiteReferences)
    ? evidence.rotaSiteReferences
        .map((item) =>
          typeof item === "object" && item
            ? String((item as Record<string, unknown>).name || "")
            : String(item),
        )
        .filter(Boolean)
    : [];
  const identities = Array.isArray(evidence.externalIdentities)
    ? evidence.externalIdentities
        .map((item) =>
          typeof item === "object" && item
            ? `${String((item as Record<string, unknown>).provider || "Source")}: ${String((item as Record<string, unknown>).externalId || "")}`
            : "",
        )
        .filter(Boolean)
    : [];
  return (
    <dl className="evidence-card">
      <div>
        <dt>Name</dt>
        <dd>{String(evidence.displayName || "Not supplied")}</dd>
      </div>
      <div>
        <dt>Work email</dt>
        <dd>{String(evidence.workEmail || "Not supplied")}</dd>
      </div>
      <div>
        <dt>Role</dt>
        <dd>{String(evidence.jobTitle || "Not supplied")}</dd>
      </div>
      <div>
        <dt>Employment</dt>
        <dd>{String(evidence.employmentState || "Not supplied")}</dd>
      </div>
      <div>
        <dt>Rota/site evidence</dt>
        <dd>{sites.join(", ") || "Not supplied"}</dd>
      </div>
      {identities.length > 0 && (
        <div>
          <dt>Source identity</dt>
          <dd>{identities.join(", ")}</dd>
        </div>
      )}
    </dl>
  );
}
function SearchSelector({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: string;
  options: Relationship[];
  change: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.canonicalId === value);
  const matches = options
    .filter((option) =>
      `${option.label} ${option.lifecycleStatus}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 12);
  return (
    <section className="relationship-selector">
      <label>
        {label}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()} by name…`}
        />
      </label>
      {selected ? (
        <div className="relationship-selection">
          <b>{selected.label}</b>
          <span>{friendly(selected.lifecycleStatus)}</span>
          <button
            type="button"
            onClick={() => {
              change("");
              setQuery("");
            }}
          >
            Change selection
          </button>
        </div>
      ) : query ? (
        <div
          className="relationship-results"
          role="listbox"
          aria-label={`${label} results`}
        >
          {matches.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={option.canonicalId}
              onClick={() => {
                change(option.canonicalId);
                setQuery("");
              }}
            >
              <b>{option.label}</b>
              <span>{friendly(option.lifecycleStatus)}</span>
            </button>
          ))}
          {!matches.length && <p>No accessible matching records.</p>}
        </div>
      ) : (
        <p>No selection yet.</p>
      )}
    </section>
  );
}
function friendly(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
