import type { DeploymentRecord, Evidence, ExternalEvidence, IssueClosure, IssueView, LifecycleStep, PipelineStatus, RawIssue, RawPull, StepKey, StepStatus } from "./types";

const LABELS: Record<StepKey, string> = { started: "Started", coded: "Coded", tested: "Tested", merged: "Merged", staging: "Deployed to staging", uat: "UAT accepted", production: "Production live" };
export const STEP_ORDER: StepKey[] = ["started", "coded", "tested", "merged", "staging", "uat", "production"];
export const STALE_AFTER_DAYS = 14;
const sha7 = (sha?: string) => (sha || "").slice(0, 7);
const step = (key: StepKey, status: StepStatus, note: string, evidence?: Evidence): LifecycleStep => ({ key, label: LABELS[key], status, note, ...(evidence ? { evidence } : {}) });

/** The PR that best represents the work: latest merged, else most recently updated open, else most recently updated. */
export function primaryPull(pulls: RawPull[]): RawPull | undefined {
  const byUpdated = (a: RawPull, b: RawPull) => b.updatedAt.localeCompare(a.updatedAt);
  const merged = pulls.filter(p => p.merged).sort((a, b) => (b.mergedAt || "").localeCompare(a.mergedAt || ""));
  return merged[0] || pulls.filter(p => p.state === "open").sort(byUpdated)[0] || [...pulls].sort(byUpdated)[0];
}

function matching(records: DeploymentRecord[], env: "staging" | "production", shas: string[], app: string) {
  return records.filter(r => r.environment === env && shas.includes(r.sourceSha) && (!r.app || app === "unassigned" || r.app.toLowerCase() === app.toLowerCase()));
}

/**
 * Evidence-derived lifecycle. Never infers a later step from an earlier one: merged is not deployed,
 * deployed is not UAT accepted, and UAT only counts when recorded against the exact build serving on staging.
 */
export function deriveSteps(issueNumber: number, app: string, pulls: RawPull[], external: ExternalEvidence): LifecycleStep[] {
  const pr = primaryPull(pulls);
  if (!pr) return [
    step("started", "not_reached", "No linked pull request found."),
    ...STEP_ORDER.slice(1).map(key => step(key, "not_reached", "Not reached: no linked pull request.")),
  ];
  const out: LifecycleStep[] = [];
  const earliest = [...pulls].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  out.push(step("started", "evidenced", pulls.length > 1 ? pulls.length + " linked pull requests; first opened " + earliest.createdAt.slice(0, 10) + "." : "Pull request opened.", { source: "GitHub pull request #" + earliest.number, at: earliest.createdAt, url: earliest.url }));
  const codedEvidence = { source: "GitHub commit " + sha7(pr.headSha), at: pr.updatedAt, url: pr.commitUrl };
  out.push(pr.draft && !pr.merged ? step("coded", "pending", "Draft pull request; not yet ready for review.", codedEvidence) : step("coded", "evidenced", "Pull request ready with head commit " + sha7(pr.headSha) + ".", codedEvidence));
  const c = pr.checks;
  const ciEvidence: Evidence = { source: "GitHub checks on " + sha7(pr.headSha), at: c.completedAt, url: c.url || pr.url };
  out.push(c.state === "success" ? step("tested", "evidenced", c.total + " check(s) passed on " + sha7(pr.headSha) + ".", ciEvidence)
    : c.state === "failure" ? step("tested", "failed", "Failing: " + c.failing.slice(0, 3).join(", ") + ".", ciEvidence)
    : c.state === "pending" ? step("tested", "pending", "Checks still running.", ciEvidence)
    : c.state === "none" ? step("tested", "pending", "No CI checks reported for " + sha7(pr.headSha) + ".")
    : step("tested", "not_connected", "CI status was not read in this snapshot."));
  out.push(pr.merged
    ? step("merged", "evidenced", "Merged" + (pr.mergeCommitSha ? " as " + sha7(pr.mergeCommitSha) : "") + ".", { source: "GitHub pull request #" + pr.number, at: pr.mergedAt, url: pr.mergeCommitSha && pr.mergeCommitUrl ? pr.mergeCommitUrl : pr.url })
    : step("merged", "not_reached", "Pull request not merged."));

  const shas = [pr.mergeCommitSha, pr.headSha].filter(Boolean) as string[];
  let stagingRecord: DeploymentRecord | undefined;
  if (!pr.merged) out.push(step("staging", "not_reached", "Not reached: not merged."));
  else if (!external.deployments.connected) out.push(step("staging", "not_connected", "Release and serving provenance is not connected; merged code is not assumed deployed."));
  else {
    const recs = matching(external.deployments.records, "staging", shas, app).sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
    stagingRecord = recs.find(r => r.status === "serving");
    const latest = recs[0];
    const evidenceOf = (r: DeploymentRecord): Evidence => ({ source: r.source, at: r.deployedAt, url: r.evidenceUrl });
    out.push(stagingRecord ? step("staging", "evidenced", "Staging serving " + sha7(stagingRecord.sourceSha) + ".", evidenceOf(stagingRecord))
      : latest?.status === "failed" ? step("staging", "failed", "Staging deployment of " + sha7(latest.sourceSha) + " failed.", evidenceOf(latest))
      : latest ? step("staging", "pending", "Submitted but not yet verified as serving.", evidenceOf(latest))
      : step("staging", "pending", "No matching staging deployment evidenced for " + sha7(pr.mergeCommitSha || pr.headSha) + "."));
  }

  let uatAccepted = false;
  if (!stagingRecord) out.push(step("uat", pr.merged && !external.deployments.connected ? "not_connected" : "not_reached", pr.merged && !external.deployments.connected ? "Cannot be assessed without staging evidence; acceptance is never inferred from merge or deployment." : "Not reached: staging deployment not evidenced."));
  else if (!external.uat.connected) out.push(step("uat", "not_connected", "UAT register is not connected; acceptance is never inferred."));
  else {
    const uatRecs = external.uat.records.filter(r => r.issueNumber === issueNumber).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const exact = uatRecs.find(r => r.sourceSha === stagingRecord!.sourceSha && (!r.buildId || !stagingRecord!.buildId || r.buildId === stagingRecord!.buildId));
    const other = uatRecs[0];
    const ev = (r: { recordedAt: string; recordedBy: string; evidenceUrl?: string }): Evidence => ({ source: "UAT record by " + r.recordedBy, at: r.recordedAt, url: r.evidenceUrl });
    if (exact?.result === "accepted") { uatAccepted = true; out.push(step("uat", "evidenced", "Accepted against build " + sha7(exact.sourceSha) + ".", ev(exact))); }
    else if (exact?.result === "failed") out.push(step("uat", "failed", "UAT failed on build " + sha7(exact.sourceSha) + ".", ev(exact)));
    else if (exact) out.push(step("uat", "pending", "UAT in progress on build " + sha7(exact.sourceSha) + ".", ev(exact)));
    else if (other) out.push(step("uat", "pending", "Latest UAT record is for a different build (" + sha7(other.sourceSha) + "); staging serves " + sha7(stagingRecord.sourceSha) + ". Re-test required.", ev(other)));
    else out.push(step("uat", "pending", "Awaiting UAT on staging build " + sha7(stagingRecord.sourceSha) + "."));
  }

  if (!pr.merged) out.push(step("production", "not_reached", "Not reached: not merged."));
  else if (!external.deployments.connected) out.push(step("production", "not_connected", "Release and serving provenance is not connected; production state is unknown, not assumed."));
  else {
    const prod = matching(external.deployments.records, "production", shas, app).filter(r => r.status === "serving").sort((a, b) => b.deployedAt.localeCompare(a.deployedAt))[0];
    out.push(prod ? step("production", "evidenced", "Production serving " + sha7(prod.sourceSha) + (uatAccepted || !external.uat.connected ? "." : "; no matching UAT acceptance is recorded."), { source: prod.source, at: prod.deployedAt, url: prod.evidenceUrl }) : step("production", "pending", "No matching production serving evidence."));
  }
  return out;
}

export function pipelineStatus(steps: LifecycleStep[]): { status: PipelineStatus; label: string } {
  const get = (k: StepKey) => steps.find(s => s.key === k)!;
  if (get("started").status !== "evidenced") return { status: "not_started", label: "Not started" };
  if (get("production").status === "evidenced") return { status: "live", label: "Production live" };
  if (get("uat").status === "failed") return { status: "uat_failed", label: "On staging, UAT failed" };
  if (get("uat").status === "evidenced") return { status: "uat_accepted", label: "UAT accepted, not live" };
  if (get("staging").status === "evidenced") return { status: "awaiting_uat", label: "On staging, awaiting UAT" };
  if (get("merged").status === "evidenced") return { status: "merged_awaiting_deploy", label: get("staging").status === "not_connected" ? "Merged, deployment not evidenced" : "Merged, not deployed" };
  if (get("tested").status === "failed") return { status: "ci_failing", label: "CI failing" };
  return { status: "in_progress", label: "In progress" };
}

export function closureFor(issue: RawIssue, steps: LifecycleStep[]): IssueClosure {
  if (issue.state === "open") return { state: "open", consistency: "n/a" };
  const live = steps.find(s => s.key === "production")!.status === "evidenced";
  const consistency = issue.stateReason === "not_planned" ? "closed_not_planned" : live ? "verified_live" : "closed_without_production_evidence";
  return { state: "closed", closedAt: issue.closedAt, reason: issue.stateReason, consistency };
}

const labelValue = (labels: string[], prefixes: string[]) => {
  for (const l of labels) { const m = l.match(new RegExp("^(?:" + prefixes.join("|") + ")[:/]\\s*(.+)$", "i")); if (m) return m[1].trim(); }
  return "";
};
/** Heuristic classification from labels / title prefix. Documented: app:*, workstream:*, severity:*, blocked. */
export function classify(issue: RawIssue) {
  const titleApp = issue.title.match(/^\[([^\]]+)\]/)?.[1] || "";
  const app = labelValue(issue.labels, ["app"]) || titleApp || "unassigned";
  const workstream = labelValue(issue.labels, ["workstream", "programme", "program"]) || "unassigned";
  const severity = labelValue(issue.labels, ["severity", "priority"]) || issue.labels.find(l => /^p[0-3]$/i.test(l))?.toUpperCase() || "unrated";
  const blocker = issue.labels.find(l => /^((status|state)[:/])?blocked$/i.test(l) || /^blocker$/i.test(l));
  return { app, workstream, severity, blocker };
}

function nextAction(status: PipelineStatus, issue: RawIssue, pr: RawPull | undefined, steps: LifecycleStep[], blocker: string | undefined, closure: IssueClosure): { text: string; owner: boolean } {
  if (closure.state === "closed") return closure.consistency === "closed_without_production_evidence" ? { text: "Closed without production evidence: confirm it was released, or reopen.", owner: true } : { text: "No action.", owner: false };
  if (blocker) return { text: "Resolve blocker (" + blocker + ").", owner: true };
  const staging = steps.find(s => s.key === "staging")!;
  switch (status) {
    case "not_started": return { text: "No work evidenced. Prioritise or assign if it should proceed.", owner: false };
    case "in_progress": return pr && !pr.draft && pr.checks.state === "success" ? { text: "Review PR #" + pr.number + " and integrate if satisfied.", owner: true } : { text: "Work in progress; no owner action yet.", owner: false };
    case "ci_failing": return { text: "CI is failing on PR #" + pr?.number + "; the implementing agent must fix it before review.", owner: false };
    case "merged_awaiting_deploy": return { text: staging.status === "not_connected" ? "Merged. The dashboard cannot see releases yet; confirm staging state in the governed deployment record." : "Merged. Decide whether to deploy to staging (governed fika deploy).", owner: true };
    case "awaiting_uat": return { text: "Run UAT on the staging build and record the result.", owner: true };
    case "uat_failed": return { text: "UAT failed on staging: triage and fix before any production release.", owner: true };
    case "uat_accepted": return { text: "UAT accepted. Production release needs an explicit owner release instruction.", owner: true };
    case "live": return { text: "Live in production: verify, then close issue #" + issue.number + ".", owner: true };
  }
}

export function buildIssueView(issue: RawIssue, pulls: RawPull[], external: ExternalEvidence, now: Date): IssueView {
  const { app, workstream, severity, blocker } = classify(issue);
  const steps = deriveSteps(issue.number, app, pulls, external);
  const { status, label } = pipelineStatus(steps);
  const closure = closureFor(issue, steps);
  const pr = primaryPull(pulls);
  const action = nextAction(status, issue, pr, steps, blocker, closure);
  const stale = issue.state === "open" && now.getTime() - Date.parse(issue.updatedAt) > STALE_AFTER_DAYS * 86400000;
  return {
    number: issue.number, title: issue.title, url: issue.url, labels: issue.labels, assignees: issue.assignees, app, workstream, severity, ...(blocker ? { blocker } : {}),
    createdAt: issue.createdAt, updatedAt: issue.updatedAt, stale,
    pullRequests: pulls.map(({ linkedIssues, ...view }) => { void linkedIssues; return view; }), ...(pr ? { primaryPullRequest: pr.number } : {}),
    steps, status, statusLabel: label, closure, nextAction: action.text, ownerAction: action.owner,
  };
}
