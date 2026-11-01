import type { MarksView } from "./marks-shared";
// Development dashboard (#241) shared types. Everything here is serialisable and safe for the browser:
// no credential, request header or raw GitHub body text ever appears in these shapes.

export type StepKey = "started" | "coded" | "tested" | "merged" | "staging" | "uat" | "production";
export type StepStatus = "evidenced" | "pending" | "failed" | "not_reached" | "not_connected";

export interface Evidence { source: string; at?: string; url?: string; detail?: string; sha?: string }
export interface LifecycleStep { key: StepKey; label: string; status: StepStatus; evidence?: Evidence; note: string }

export type PipelineStatus = "not_started" | "in_progress" | "ci_failing" | "merged_awaiting_deploy" | "awaiting_uat" | "uat_failed" | "uat_accepted" | "live";

export interface ChecksSummary { state: "success" | "failure" | "pending" | "none" | "unknown"; total: number; failing: string[]; url?: string; completedAt?: string }

export interface PullRequestView {
  number: number; title: string; url: string; state: "open" | "closed"; draft: boolean; merged: boolean; mergedAt?: string;
  headSha: string; headRef: string; mergeCommitSha?: string; commitUrl: string; mergeCommitUrl?: string;
  createdAt: string; updatedAt: string; checks: ChecksSummary;
}

export interface IssueClosure { state: "open" | "closed"; closedAt?: string; reason?: string; consistency: "n/a" | "verified_live" | "closed_without_production_evidence" | "closed_not_planned" }

export interface IssueView {
  number: number; title: string; url: string; labels: string[]; assignees: string[];
  app: string; workstream: string; severity: string; blocker?: string;
  createdAt: string; updatedAt: string; stale: boolean;
  pullRequests: PullRequestView[]; primaryPullRequest?: number;
  steps: LifecycleStep[]; status: PipelineStatus; statusLabel: string; closure: IssueClosure;
  nextAction: string; ownerAction: boolean;
}

// External evidence providers. v1 has none connected; the derivation consumes them when present
// so a future provider (release journal, UAT register, workspace registry) plugs in without changes.
export interface DeploymentRecord { app?: string; environment: "staging" | "production"; sourceSha: string; buildId?: string; deployedAt: string; status: "serving" | "submitted" | "failed"; source: string; evidenceUrl?: string }
export interface UatRecord { issueNumber: number; sourceSha: string; buildId?: string; result: "accepted" | "failed" | "pending"; recordedAt: string; recordedBy: string; evidenceUrl?: string }
export interface WorkspaceRecord { issueNumber: number; workspace: string; owner: string; status: string; at: string }
export interface ExternalEvidence {
  deployments: { connected: boolean; records: DeploymentRecord[] };
  uat: { connected: boolean; records: UatRecord[] };
  workspaces: { connected: boolean; records: WorkspaceRecord[] };
}
export const noExternalEvidence = (): ExternalEvidence => ({ deployments: { connected: false, records: [] }, uat: { connected: false, records: [] }, workspaces: { connected: false, records: [] } });

export interface RawIssue { number: number; title: string; url: string; state: "open" | "closed"; stateReason?: string; labels: string[]; assignees: string[]; createdAt: string; updatedAt: string; closedAt?: string }
export interface RawPull extends PullRequestView { linkedIssues: number[] }

export interface SourceStatus { id: "github" | "releases" | "uat" | "workspaces"; label: string; state: "connected" | "partial" | "stale" | "not_connected" | "unavailable" | "error"; detail: string; lastVerified?: string }
export interface SnapshotFlags { stale: boolean; partial: boolean; unavailable: boolean; error: boolean }
export interface SummaryCounts { openIssues: number; inProgress: number; awaitingUat: number; blocked: number; genuinelyClosed: number; staleOrUnverified: number }
export interface ActivityItem { at: string; kind: "issue" | "pull_request"; number: number; title: string; url: string; summary: string }
export interface ReleaseRow { pullRequest: number; title: string; url: string; mergedAt: string; commitUrl: string; mergeCommitSha: string; issues: number[]; staging: LifecycleStep; production: LifecycleStep }

export interface DevelopmentSnapshot {
  schema: 1; repository: string; generatedAt: string; lastVerified: string | null; flags: SnapshotFlags; reasons: string[];
  rateLimit?: { limit: number; remaining: number; resetAt: string };
  sources: SourceStatus[]; summary: SummaryCounts; issues: IssueView[]; releases: ReleaseRow[]; activity: ActivityItem[];
  /** Owner-recorded assertions, kept apart from the verified fields above. Added per request by the route, never cached with GitHub data. */
  marks?: MarksView;
}
