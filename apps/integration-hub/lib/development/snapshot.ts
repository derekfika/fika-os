import { fetchGithubData, githubConfig, GithubError, TOKEN_ENV, type Fetcher, type GithubFetchResult, type RateLimit } from "./github";
import { buildIssueView } from "./lifecycle";
import { noExternalEvidence, type ActivityItem, type DevelopmentSnapshot, type ExternalEvidence, type IssueView, type RawPull, type ReleaseRow, type SourceStatus, type SummaryCounts } from "./types";

export const CACHE_TTL_MS = 60_000;
export const MIN_REFRESH_INTERVAL_MS = 30_000;
export const FAILURE_COOLDOWN_MS = 30_000;
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

export function buildSnapshot(input: { repository: string; data: GithubFetchResult; external: ExternalEvidence; now: Date; lastVerified: string }): DevelopmentSnapshot {
  const { data, external, now } = input;
  const byIssue = new Map<number, RawPull[]>();
  for (const pr of data.pulls) for (const n of pr.linkedIssues) byIssue.set(n, [...(byIssue.get(n) || []), pr]);
  const issues = data.issues.map(issue => buildIssueView(issue, byIssue.get(issue.number) || [], external, now)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const partial = data.partialReasons.length > 0;
  const releases: ReleaseRow[] = data.pulls.filter(p => p.merged && p.mergeCommitSha).map(p => {
    const linked = issues.filter(i => i.pullRequests.some(x => x.number === p.number));
    const view = linked[0];
    return { pullRequest: p.number, title: p.title, url: p.url, mergedAt: p.mergedAt || "", commitUrl: p.mergeCommitUrl || p.commitUrl, mergeCommitSha: p.mergeCommitSha!, issues: linked.map(i => i.number), staging: view?.steps.find(s => s.key === "staging") || stepFor(p, external, "staging"), production: view?.steps.find(s => s.key === "production") || stepFor(p, external, "production") };
  }).sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)).slice(0, 30);
  const activity: ActivityItem[] = [
    ...data.issues.map(i => ({ at: i.updatedAt, kind: "issue" as const, number: i.number, title: i.title, url: i.url, summary: i.state === "closed" ? "Issue closed" : "Issue updated" })),
    ...data.pulls.map(p => ({ at: p.updatedAt, kind: "pull_request" as const, number: p.number, title: p.title, url: p.url, summary: p.merged ? "Pull request merged" : p.state === "closed" ? "Pull request closed unmerged" : p.draft ? "Draft pull request updated" : "Pull request updated" })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  const sources: SourceStatus[] = [
    { id: "github", label: "GitHub issues, pull requests and checks", state: partial ? "partial" : "connected", detail: partial ? data.partialReasons.join(" ") : "Read server-side from the GitHub API.", lastVerified: input.lastVerified },
    external.deployments.connected ? { id: "releases", label: "Release journal and serving provenance", state: "connected", detail: "Connected." } : { id: "releases", label: "Release journal and serving provenance", state: "not_connected", detail: "Not connected. Merged is never shown as deployed; staging and production steps stay unverified." },
    external.uat.connected ? { id: "uat", label: "UAT and owner acceptance register", state: "connected", detail: "Connected." } : { id: "uat", label: "UAT and owner acceptance register", state: "not_connected", detail: "Not connected. UAT acceptance is never inferred." },
    external.workspaces.connected ? { id: "workspaces", label: "Governed workspace status", state: "connected", detail: "Connected." } : { id: "workspaces", label: "Governed workspace status", state: "not_connected", detail: "Not connected. Workspace leases are held in the local governed registry, which this server cannot read." },
  ];
  return {
    schema: 1, repository: input.repository, generatedAt: now.toISOString(), lastVerified: input.lastVerified,
    flags: { stale: false, partial, unavailable: false, error: false }, reasons: [...data.partialReasons],
    ...(data.rateLimit ? { rateLimit: data.rateLimit } : {}), sources, summary: summarise(issues), issues, releases, activity,
  };
}

// A release row for a merged PR that maps to no listed issue still reports staging/production honestly.
function stepFor(p: RawPull, external: ExternalEvidence, key: "staging" | "production") {
  void p;
  return { key, label: key === "staging" ? "Deployed to staging" : "Production live", status: external.deployments.connected ? "pending" as const : "not_connected" as const, note: external.deployments.connected ? "No matching serving evidence." : "Release provenance is not connected." };
}

export function summarise(issues: IssueView[]): SummaryCounts {
  const open = issues.filter(i => i.closure.state === "open");
  return {
    openIssues: open.length,
    inProgress: open.filter(i => ["in_progress", "ci_failing", "merged_awaiting_deploy"].includes(i.status)).length,
    awaitingUat: open.filter(i => i.status === "awaiting_uat").length,
    blocked: open.filter(i => i.blocker || i.status === "ci_failing" || i.status === "uat_failed").length,
    genuinelyClosed: issues.filter(i => i.closure.consistency === "verified_live").length,
    staleOrUnverified: issues.filter(i => i.stale || i.closure.consistency === "closed_without_production_evidence").length,
  };
}

export function unavailableSnapshot(repository: string, now: Date, reason: string, error = false): DevelopmentSnapshot {
  return {
    schema: 1, repository, generatedAt: now.toISOString(), lastVerified: null, flags: { stale: false, partial: false, unavailable: true, error }, reasons: [reason],
    sources: [{ id: "github", label: "GitHub issues, pull requests and checks", state: error ? "error" : "unavailable", detail: reason }],
    summary: { openIssues: 0, inProgress: 0, awaitingUat: 0, blocked: 0, genuinelyClosed: 0, staleOrUnverified: 0 }, issues: [], releases: [], activity: [],
  };
}

export interface SnapshotServiceOptions { env?: Record<string, string | undefined>; fetcher?: Fetcher; now?: () => Date; external?: () => ExternalEvidence }

/** Cached, single-flight snapshot service. A failed refresh serves the last good snapshot flagged stale; it never fabricates data. */
export function createSnapshotService(options: SnapshotServiceOptions = {}) {
  const now = options.now || (() => new Date());
  const fetcher: Fetcher = options.fetcher || ((url, init) => fetch(url, { ...init, cache: "no-store" }) as unknown as ReturnType<Fetcher>);
  let good: { snapshot: DevelopmentSnapshot; at: number } | undefined;
  let rateLimit: RateLimit | undefined;
  let blockedUntil = 0;
  let inflight: Promise<DevelopmentSnapshot> | undefined;

  const stale = (reason: string, error: boolean): DevelopmentSnapshot | undefined => good && ({ ...good.snapshot, generatedAt: now().toISOString(), flags: { ...good.snapshot.flags, stale: true, error }, reasons: [...good.snapshot.reasons, reason], sources: good.snapshot.sources.map(s => s.id === "github" ? { ...s, state: "stale" as const, detail: reason } : s) });

  async function refresh(repo: string, token: string): Promise<DevelopmentSnapshot> {
    const at = now();
    try {
      const data = await fetchGithubData({ token, repo, fetcher, knownRateLimit: rateLimit, now: at });
      rateLimit = data.rateLimit || rateLimit;
      const snapshot = buildSnapshot({ repository: repo, data, external: (options.external || noExternalEvidence)(), now: at, lastVerified: at.toISOString() });
      good = { snapshot, at: at.getTime() };
      return snapshot;
    } catch (cause) {
      const err = cause instanceof GithubError ? cause : undefined;
      const reset = err?.resetAt ? Date.parse(err.resetAt) : NaN;
      if (err?.code === "github_rate_limited") { blockedUntil = Number.isFinite(reset) ? Math.max(reset, at.getTime() + FAILURE_COOLDOWN_MS) : at.getTime() + DEFAULT_RATE_LIMIT_COOLDOWN_MS; rateLimit = rateLimit ? { ...rateLimit, remaining: 0 } : undefined; }
      else blockedUntil = at.getTime() + FAILURE_COOLDOWN_MS; // any other failure (auth, 404, network) backs off briefly
      const reason = err ? err.message : "GitHub data could not be refreshed.";
      return stale(reason, err?.code !== "github_rate_limited") || unavailableSnapshot(repo, at, reason, err?.code !== "github_rate_limited");
    }
  }

  return {
    async get(opts: { refresh?: boolean } = {}): Promise<DevelopmentSnapshot> {
      const config = githubConfig(options.env);
      const at = now();
      if (config.invalidRepo) return unavailableSnapshot(config.repo, at, "The configured repository name is invalid.", true);
      if (!config.token) return unavailableSnapshot(config.repo, at, `GitHub is not connected: no server credential is configured (${TOKEN_ENV}).`);
      const age = good ? at.getTime() - good.at : Infinity;
      if (good && (age < MIN_REFRESH_INTERVAL_MS || (!opts.refresh && age < CACHE_TTL_MS))) return good.snapshot;
      if (at.getTime() < blockedUntil) return stale(`GitHub refresh paused; next attempt after ${new Date(blockedUntil).toISOString()}.`, false) || unavailableSnapshot(config.repo, at, "GitHub rate limit reached; waiting for reset.");
      inflight ||= refresh(config.repo, config.token).finally(() => { inflight = undefined; });
      return inflight;
    },
  };
}

export const developmentSnapshotService = createSnapshotService();
