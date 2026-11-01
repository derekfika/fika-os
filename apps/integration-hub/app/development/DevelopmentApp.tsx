"use client";

import { ArrowLeft, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./development.module.css";
import type { DevelopmentSnapshot, IssueView, LifecycleStep, PipelineStatus, SourceStatus, StepStatus } from "@/lib/development/types";

type View = "pipeline" | "actions" | "releases" | "uat" | "activity";
type Load = { kind: "loading" } | { kind: "denied"; status: number } | { kind: "error"; message: string } | { kind: "ready"; snapshot: DevelopmentSnapshot };
const VIEWS: [View, string][] = [["pipeline", "Pipeline"], ["actions", "My actions"], ["releases", "Releases"], ["uat", "UAT"], ["activity", "Activity"]];
const STATUS_LABEL: Record<PipelineStatus, string> = { not_started: "Not started", in_progress: "In progress", ci_failing: "CI failing", merged_awaiting_deploy: "Merged, not deployed", awaiting_uat: "On staging, awaiting UAT", uat_failed: "On staging, UAT failed", uat_accepted: "UAT accepted, not live", live: "Production live" };
const STEP_TEXT: Record<StepStatus, string> = { evidenced: "Evidenced", pending: "Pending", failed: "Failed", not_reached: "Not reached", not_connected: "Not connected" };
const TONE: Record<StepStatus, string> = { evidenced: "success", pending: "warning", failed: "danger", not_reached: "neutral", not_connected: "info" };
const STATUS_TONE: Record<PipelineStatus, string> = { not_started: "neutral", in_progress: "info", ci_failing: "danger", merged_awaiting_deploy: "warning", awaiting_uat: "warning", uat_failed: "danger", uat_accepted: "info", live: "success" };

const london = (iso?: string | null) => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "Never";
const safeUrl = (url?: string) => url && /^https:\/\//.test(url) ? url : undefined;

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) { return <span className={`${styles.chip} ${styles["tone_" + tone]}`}>{children}</span>; }
function Link({ href, children }: { href?: string; children: React.ReactNode }) { const safe = safeUrl(href); return safe ? <a className={styles.link} href={safe} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={13} aria-hidden="true" /></a> : <span>{children}</span>; }

async function requestSnapshot(refresh: boolean): Promise<Load> {
  try {
    const response = await fetch("/api/development" + (refresh ? "?refresh=1" : ""), { cache: "no-store" });
    if (response.status === 401 || response.status === 403) return { kind: "denied", status: response.status };
    if (!response.ok) return { kind: "error", message: "Development data could not be loaded." };
    return { kind: "ready", snapshot: await response.json() as DevelopmentSnapshot };
  } catch { return { kind: "error", message: "Development data could not be loaded." }; }
}

export default function DevelopmentApp() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("pipeline");
  const [selected, setSelected] = useState<number | null>(null);
  const refresh = useCallback(async () => { setBusy(true); setLoad(await requestSnapshot(true)); setBusy(false); }, []);
  useEffect(() => { let live = true; void requestSnapshot(false).then(result => { if (live) setLoad(result); }); return () => { live = false; }; }, []);

  const snapshot = load.kind === "ready" ? load.snapshot : undefined;
  const issue = snapshot?.issues.find(i => i.number === selected);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.back} href="/hub"><ArrowLeft size={16} aria-hidden="true" /> Integration Hub</a>
        <div className={styles.titleRow}>
          <div><p className={styles.eyebrow}>Read-only · owner view</p><h1>Development</h1></div>
          <button type="button" className={styles.primary} onClick={() => void refresh()} disabled={busy || load.kind === "loading"}><RefreshCw size={16} aria-hidden="true" className={busy ? styles.spin : ""} /> {busy ? "Refreshing…" : "Refresh"}</button>
        </div>
      </header>
      <main className={styles.main}>
        {load.kind === "loading" && <p role="status" className={styles.notice}>Loading development status…</p>}
        {load.kind === "denied" && <section className={styles.notice} role="alert"><h2>{load.status === 401 ? "Sign in required" : "Not available"}</h2><p>{load.status === 401 ? "Sign in to FIKA OS to continue." : "The Development dashboard is restricted to the FIKA OS owner."}</p></section>}
        {load.kind === "error" && <section className={styles.notice} role="alert"><h2>Unavailable</h2><p>{load.message}</p></section>}
        {snapshot && <>
          <Freshness snapshot={snapshot} />
          <Summary snapshot={snapshot} />
          <nav className={styles.tabs} aria-label="Development views">{VIEWS.map(([key, label]) => <button key={key} type="button" className={view === key ? styles.tabActive : styles.tab} aria-current={view === key ? "page" : undefined} onClick={() => { setView(key); setSelected(null); }}>{label}</button>)}</nav>
          {issue ? <Detail issue={issue} onClose={() => setSelected(null)} /> : <>
            {view === "pipeline" && <Pipeline issues={snapshot.issues} onSelect={setSelected} />}
            {view === "actions" && <IssueList title="Needs your decision" issues={snapshot.issues.filter(i => i.ownerAction)} empty="Nothing needs an owner decision right now." onSelect={setSelected} showAction />}
            {view === "releases" && <Releases snapshot={snapshot} />}
            {view === "uat" && <Uat snapshot={snapshot} onSelect={setSelected} />}
            {view === "activity" && <Activity snapshot={snapshot} />}
          </>}
        </>}
      </main>
    </div>
  );
}

function Freshness({ snapshot }: { snapshot: DevelopmentSnapshot }) {
  const flags = [snapshot.flags.unavailable && "Unavailable", snapshot.flags.error && "Error", snapshot.flags.stale && "Stale", snapshot.flags.partial && "Partial"].filter(Boolean) as string[];
  return (
    <section className={styles.freshness} aria-label="Data freshness">
      <div><b>Last verified:</b> {london(snapshot.lastVerified)} <small>(Europe/London)</small>{flags.map(f => <Chip key={f} tone={f === "Partial" || f === "Stale" ? "warning" : "danger"}>{f}</Chip>)}{!flags.length && <Chip tone="success">Current</Chip>}</div>
      {snapshot.reasons.length > 0 && <ul>{snapshot.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
      <ul className={styles.sources}>{snapshot.sources.map(s => <SourceRow key={s.id} source={s} />)}</ul>
      {snapshot.rateLimit && <small>GitHub rate limit: {snapshot.rateLimit.remaining} of {snapshot.rateLimit.limit} remaining; resets {london(snapshot.rateLimit.resetAt)}.</small>}
    </section>
  );
}
function SourceRow({ source }: { source: SourceStatus }) { const label = source.state.replace("_", " "); return <li><Chip tone={source.state === "connected" ? "success" : source.state === "partial" || source.state === "stale" ? "warning" : source.state === "not_connected" ? "info" : "danger"}>{label}</Chip> <b>{source.label}</b>: {source.detail}</li>; }

function Summary({ snapshot }: { snapshot: DevelopmentSnapshot }) {
  const s = snapshot.summary;
  const cards: [string, number][] = [["Open issues", s.openIssues], ["In progress", s.inProgress], ["Awaiting UAT", s.awaitingUat], ["Blocked", s.blocked], ["Genuinely closed", s.genuinelyClosed], ["Stale / unverified", s.staleOrUnverified]];
  return <section className={styles.cards} aria-label="Summary">{cards.map(([label, value]) => <div key={label} className={styles.card}><span>{label}</span><strong>{value}</strong></div>)}</section>;
}

function Pipeline({ issues, onSelect }: { issues: IssueView[]; onSelect: (n: number) => void }) {
  const [q, setQ] = useState(""); const [app, setApp] = useState(""); const [stage, setStage] = useState(""); const [assignee, setAssignee] = useState(""); const [severity, setSeverity] = useState(""); const [workstream, setWorkstream] = useState(""); const [blockedOnly, setBlockedOnly] = useState(false); const [openState, setOpenState] = useState("open");
  const uniq = (pick: (i: IssueView) => string[]) => [...new Set(issues.flatMap(pick))].filter(Boolean).sort();
  const shown = useMemo(() => issues.filter(i => (!q || (`#${i.number} ${i.title}`).toLowerCase().includes(q.toLowerCase())) && (!app || i.app === app) && (!stage || i.status === stage) && (!assignee || i.assignees.includes(assignee)) && (!severity || i.severity === severity) && (!workstream || i.workstream === workstream) && (!blockedOnly || Boolean(i.blocker) || i.status === "ci_failing" || i.status === "uat_failed") && (openState === "all" || i.closure.state === openState)), [issues, q, app, stage, assignee, severity, workstream, blockedOnly, openState]);
  const select = (label: string, value: string, set: (v: string) => void, options: string[], labelOf: (v: string) => string = v => v) => <label className={styles.field}><span>{label}</span><select value={value} onChange={e => set(e.target.value)}><option value="">All</option>{options.map(o => <option key={o} value={o}>{labelOf(o)}</option>)}</select></label>;
  return (
    <section>
      <div className={styles.filters} role="search">
        <label className={`${styles.field} ${styles.search}`}><span>Search</span><div className={styles.searchBox}><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Issue number or title" /></div></label>
        {select("App", app, setApp, uniq(i => [i.app]))}
        {select("Status", stage, setStage, Object.keys(STATUS_LABEL), v => STATUS_LABEL[v as PipelineStatus])}
        {select("Assignee", assignee, setAssignee, uniq(i => i.assignees))}
        {select("Severity", severity, setSeverity, uniq(i => [i.severity]))}
        {select("Workstream", workstream, setWorkstream, uniq(i => [i.workstream]))}
        <label className={styles.field}><span>Issue state</span><select value={openState} onChange={e => setOpenState(e.target.value)}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></select></label>
        <label className={styles.check}><input type="checkbox" checked={blockedOnly} onChange={e => setBlockedOnly(e.target.checked)} /> Blocked or failing only</label>
      </div>
      <IssueList title={`${shown.length} issue${shown.length === 1 ? "" : "s"}`} issues={shown} empty="No issues match these filters." onSelect={onSelect} />
    </section>
  );
}

function IssueList({ title, issues, empty, onSelect, showAction }: { title: string; issues: IssueView[]; empty: string; onSelect: (n: number) => void; showAction?: boolean }) {
  return (
    <section className={styles.panel}>
      <h2>{title}</h2>
      {!issues.length ? <p className={styles.muted}>{empty}</p> : <ul className={styles.list}>{issues.map(i => (
        <li key={i.number}>
          <button type="button" className={styles.row} onClick={() => onSelect(i.number)} aria-label={`Open details for issue ${i.number}: ${i.title}`}>
            <span className={styles.rowMain}><b>#{i.number}</b> {i.title}</span>
            <span className={styles.rowMeta}><Chip tone={STATUS_TONE[i.status]}>{i.statusLabel}</Chip>{i.closure.state === "closed" && <Chip tone={i.closure.consistency === "verified_live" ? "success" : "warning"}>{i.closure.consistency === "verified_live" ? "Closed, verified live" : "Closed, unverified"}</Chip>}{i.blocker && <Chip tone="danger">Blocked</Chip>}{i.stale && <Chip tone="warning">Stale</Chip>}</span>
            {showAction && <span className={styles.action}>{i.nextAction}</span>}
          </button>
        </li>))}</ul>}
    </section>
  );
}

function Stepper({ steps }: { steps: LifecycleStep[] }) {
  return <ol className={styles.steps}>{steps.map(s => (
    <li key={s.key}><div className={styles.stepHead}><b>{s.label}</b> <Chip tone={TONE[s.status]}>{STEP_TEXT[s.status]}</Chip></div><p>{s.note}</p>
      {s.evidence && <small>Source: {s.evidence.source}{s.evidence.at ? ` · ${london(s.evidence.at)}` : ""} {s.evidence.url && <Link href={s.evidence.url}>Evidence</Link>}</small>}</li>))}</ol>;
}

function Detail({ issue, onClose }: { issue: IssueView; onClose: () => void }) {
  return (
    <section className={styles.panel} aria-labelledby="issue-detail-title">
      <button type="button" className={styles.secondary} onClick={onClose}><ArrowLeft size={15} aria-hidden="true" /> Back to list</button>
      <h2 id="issue-detail-title">#{issue.number} {issue.title}</h2>
      <p><Chip tone={STATUS_TONE[issue.status]}>{issue.statusLabel}</Chip> {issue.closure.state === "closed" ? <Chip tone={issue.closure.consistency === "verified_live" ? "success" : "warning"}>{`Issue closed${issue.closure.closedAt ? " " + london(issue.closure.closedAt) : ""}${issue.closure.consistency === "closed_without_production_evidence" ? ": no production evidence" : ""}`}</Chip> : <Chip tone="neutral">Issue open</Chip>}</p>
      <div className={styles.next}><b>Next action for owner:</b> {issue.nextAction}</div>
      <dl className={styles.facts}>
        <div><dt>GitHub issue</dt><dd><Link href={issue.url}>Issue #{issue.number}</Link></dd></div>
        <div><dt>App / workstream</dt><dd>{issue.app} · {issue.workstream}</dd></div>
        <div><dt>Severity</dt><dd>{issue.severity}</dd></div>
        <div><dt>Assignees</dt><dd>{issue.assignees.join(", ") || "None"}</dd></div>
        <div><dt>Blocker</dt><dd>{issue.blocker || "None recorded"}</dd></div>
        <div><dt>Last update</dt><dd>{london(issue.updatedAt)}</dd></div>
        <div><dt>Governed workspace lease</dt><dd>Not connected</dd></div>
        <div><dt>Staging / production serving SHA</dt><dd>{issue.steps.filter(s => s.key === "staging" || s.key === "production").map(s => `${s.label}: ${STEP_TEXT[s.status]}`).join("; ")}</dd></div>
      </dl>
      <h3>Pull requests ({issue.pullRequests.length})</h3>
      {!issue.pullRequests.length ? <p className={styles.muted}>No linked pull request.</p> : <ul className={styles.plain}>{issue.pullRequests.map(p => <li key={p.number}><Link href={p.url}>PR #{p.number}</Link> {p.merged ? "merged" : p.draft ? "draft" : p.state} · head <Link href={p.commitUrl}>{p.headSha.slice(0, 7)}</Link>{p.mergeCommitSha && <> · merge <Link href={p.mergeCommitUrl}>{p.mergeCommitSha.slice(0, 7)}</Link></>} · CI {p.checks.state}{p.checks.url && <> <Link href={p.checks.url}>checks</Link></>}</li>)}</ul>}
      <h3>Lifecycle evidence</h3>
      <Stepper steps={issue.steps} />
    </section>
  );
}

function Releases({ snapshot }: { snapshot: DevelopmentSnapshot }) {
  return (
    <section className={styles.panel}>
      <h2>Merged changes and deployment evidence</h2>
      <p className={styles.muted}>Merged is not deployed. Staging and production appear as evidenced only when matched to serving provenance.</p>
      {!snapshot.releases.length ? <p className={styles.muted}>No merged pull requests in this snapshot.</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Pull request</th><th scope="col">Merged</th><th scope="col">Issues</th><th scope="col">Staging</th><th scope="col">Production</th></tr></thead><tbody>{snapshot.releases.map(r => <tr key={r.pullRequest}><td><Link href={r.url}>#{r.pullRequest}</Link> {r.title}<br /><Link href={r.commitUrl}>{r.mergeCommitSha.slice(0, 7)}</Link></td><td>{london(r.mergedAt)}</td><td>{r.issues.map(n => `#${n}`).join(", ") || "None"}</td><td><Chip tone={TONE[r.staging.status]}>{STEP_TEXT[r.staging.status]}</Chip></td><td><Chip tone={TONE[r.production.status]}>{STEP_TEXT[r.production.status]}</Chip></td></tr>)}</tbody></table></div>}
    </section>
  );
}

function Uat({ snapshot, onSelect }: { snapshot: DevelopmentSnapshot; onSelect: (n: number) => void }) {
  const uatSource = snapshot.sources.find(s => s.id === "uat");
  const relevant = snapshot.issues.filter(i => ["awaiting_uat", "uat_failed", "uat_accepted"].includes(i.status));
  return (
    <>
      {uatSource?.state !== "connected" && <p className={styles.notice} role="status"><Chip tone="info">Not connected</Chip> {uatSource?.detail}</p>}
      <IssueList title="On staging or under UAT" issues={relevant} empty="No issue has staging evidence to test." onSelect={onSelect} showAction />
    </>
  );
}

function Activity({ snapshot }: { snapshot: DevelopmentSnapshot }) {
  return <section className={styles.panel}><h2>Recent GitHub activity</h2>{!snapshot.activity.length ? <p className={styles.muted}>No activity.</p> : <ul className={styles.plain}>{snapshot.activity.map(a => <li key={`${a.kind}-${a.number}`}>{london(a.at)} · {a.summary}: <Link href={a.url}>#{a.number}</Link> {a.title}</li>)}</ul>}</section>;
}
