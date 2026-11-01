import type { ChecksSummary, RawIssue, RawPull } from "./types";

// Server-side only. The credential is read from server environment and used solely in the outbound
// Authorization header. It is never placed in any returned value, error message or log line.
export const TOKEN_ENV = "FIKA_DEV_DASHBOARD_GITHUB_TOKEN";
export const REPO_ENV = "FIKA_DEV_DASHBOARD_GITHUB_REPO";
export const DEFAULT_REPO = "derekfika/fika-os";
export const MAX_CHECK_LOOKUPS = 20;
export const PAGE_SIZE = 100;
const RATE_LIMIT_FLOOR = 10;

export type FetchResponse = { status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> };
export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<FetchResponse>;

export class GithubError extends Error {
  constructor(public code: "github_auth" | "github_not_found" | "github_rate_limited" | "github_unavailable", message: string, public resetAt?: string) { super(message); }
}

export function githubConfig(env: Record<string, string | undefined> = process.env) {
  const token = env[TOKEN_ENV]?.trim() || undefined;
  const repo = env[REPO_ENV]?.trim() || DEFAULT_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { token: undefined, repo: DEFAULT_REPO, invalidRepo: true };
  return { token, repo, invalidRepo: false };
}

export interface RateLimit { limit: number; remaining: number; resetAt: string }
export interface GithubFetchResult { issues: RawIssue[]; pulls: RawPull[]; rateLimit?: RateLimit; partialReasons: string[] }

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

function readRate(res: FetchResponse): RateLimit | undefined {
  const limit = Number(res.headers.get("x-ratelimit-limit")); const remaining = Number(res.headers.get("x-ratelimit-remaining")); const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset) || !res.headers.get("x-ratelimit-remaining")) return undefined;
  return { limit, remaining, resetAt: new Date(reset * 1000).toISOString() };
}

export function summariseChecks(runs: Json[]): ChecksSummary {
  if (!runs.length) return { state: "none", total: 0, failing: [] };
  const failing = runs.filter(r => ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(str(r.conclusion))).map(r => str(r.name));
  const pending = runs.some(r => str(r.status) !== "completed");
  const succeeded = runs.filter(r => str(r.conclusion) === "success").length;
  const completedAt = runs.map(r => str(r.completed_at)).filter(Boolean).sort().pop();
  const failedRun = runs.find(r => failing.includes(str(r.name)));
  const url = str((failedRun || runs[0]).html_url) || undefined;
  const state = failing.length ? "failure" : pending ? "pending" : succeeded ? "success" : "none";
  return { state, total: runs.length, failing, url, completedAt };
}

/** Issues/PRs reference one another by `#N`; the PR head branch convention `issue-N` also links. Bodies are parsed here and never returned. */
export function linkedIssueNumbers(title: string, body: string, headRef: string): number[] {
  const found = new Set<number>();
  for (const m of `${title}\n${body}`.matchAll(/(?:^|[^\w&/])#(\d{1,7})\b/g)) found.add(Number(m[1]));
  const ref = headRef.match(/(?:^|[/-])issue-(\d{1,7})(?:$|[-/])/i);
  if (ref) found.add(Number(ref[1]));
  return [...found];
}

export async function fetchGithubData(options: { token: string; repo: string; fetcher: Fetcher; knownRateLimit?: RateLimit; now?: Date }): Promise<GithubFetchResult> {
  const { token, repo, fetcher } = options;
  const now = options.now || new Date();
  if (options.knownRateLimit && options.knownRateLimit.remaining < RATE_LIMIT_FLOOR && Date.parse(options.knownRateLimit.resetAt) > now.getTime()) {
    throw new GithubError("github_rate_limited", "GitHub rate limit is nearly exhausted; waiting for reset.", options.knownRateLimit.resetAt);
  }
  const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "user-agent": "fika-os-development-dashboard" };
  let rateLimit: RateLimit | undefined;
  const partialReasons: string[] = [];
  async function get(path: string): Promise<{ body: unknown; hasNext: boolean }> {
    let res: FetchResponse;
    try { res = await fetcher(`https://api.github.com/repos/${repo}${path}`, { headers }); } catch { throw new GithubError("github_unavailable", "GitHub could not be reached."); }
    rateLimit = readRate(res) || rateLimit;
    if (res.status === 401) throw new GithubError("github_auth", "The server GitHub credential was rejected.");
    if (res.status === 429 || (res.status === 403 && rateLimit && rateLimit.remaining === 0)) throw new GithubError("github_rate_limited", "GitHub rate limit reached.", rateLimit?.resetAt);
    if (res.status === 403) throw new GithubError("github_auth", "The server GitHub credential lacks access to this repository.");
    if (res.status === 404) throw new GithubError("github_not_found", "Repository not found or not visible to the server credential.");
    if (res.status < 200 || res.status >= 300) throw new GithubError("github_unavailable", `GitHub responded with status ${res.status}.`);
    return { body: await res.json(), hasNext: /rel="next"/.test(res.headers.get("link") || "") };
  }
  const issuePage = await get(`/issues?state=all&sort=updated&direction=desc&per_page=${PAGE_SIZE}`);
  const pullPage = await get(`/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE_SIZE}`);
  if (issuePage.hasNext) partialReasons.push(`Only the ${PAGE_SIZE} most recently updated issues are shown.`);
  if (pullPage.hasNext) partialReasons.push(`Only the ${PAGE_SIZE} most recently updated pull requests are shown.`);

  const issues: RawIssue[] = arr(issuePage.body).filter(i => !i.pull_request).map(i => ({
    number: Number(i.number), title: str(i.title), url: str(i.html_url), state: i.state === "closed" ? "closed" : "open",
    ...(str(i.state_reason) ? { stateReason: str(i.state_reason) } : {}),
    labels: arr(i.labels).map(l => str(l.name)).filter(Boolean), assignees: arr(i.assignees).map(a => str(a.login)).filter(Boolean),
    createdAt: str(i.created_at), updatedAt: str(i.updated_at), ...(str(i.closed_at) ? { closedAt: str(i.closed_at) } : {}),
  }));

  const pulls: RawPull[] = arr(pullPage.body).map(p => {
    const head = (p.head || {}) as Json; const headSha = str(head.sha); const mergeSha = str(p.merge_commit_sha);
    const merged = Boolean(str(p.merged_at)); const url = str(p.html_url);
    const base = url.replace(/\/pull\/\d+$/, "");
    return {
      number: Number(p.number), title: str(p.title), url, state: p.state === "closed" ? "closed" : "open", draft: Boolean(p.draft), merged,
      ...(merged ? { mergedAt: str(p.merged_at) } : {}), headSha, headRef: str(head.ref), ...(merged && mergeSha ? { mergeCommitSha: mergeSha, mergeCommitUrl: `${base}/commit/${mergeSha}` } : {}),
      commitUrl: `${base}/commit/${headSha}`, createdAt: str(p.created_at), updatedAt: str(p.updated_at),
      checks: { state: "unknown", total: 0, failing: [] } as ChecksSummary,
      linkedIssues: linkedIssueNumbers(str(p.title), str(p.body), str(head.ref)),
    } satisfies RawPull;
  });

  // Only PRs that map to a listed issue need CI. Open PRs first, then most recent merged, bounded.
  const issueNumbers = new Set(issues.map(i => i.number));
  const wanted = pulls.filter(p => p.linkedIssues.some(n => issueNumbers.has(n)) && p.headSha)
    .sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || b.updatedAt.localeCompare(a.updatedAt));
  const lookups = wanted.slice(0, MAX_CHECK_LOOKUPS);
  if (wanted.length > lookups.length) partialReasons.push(`CI status was read for ${lookups.length} of ${wanted.length} linked pull requests.`);
  for (const pr of lookups) {
    if (rateLimit && rateLimit.remaining < RATE_LIMIT_FLOOR) { partialReasons.push("CI lookups stopped early to preserve the GitHub rate limit."); break; }
    try { const { body } = await get(`/commits/${pr.headSha}/check-runs?per_page=100`); pr.checks = summariseChecks(arr((body as Json).check_runs)); }
    catch (error) { if (error instanceof GithubError && error.code === "github_rate_limited") { partialReasons.push("CI lookups stopped: GitHub rate limit reached."); break; } partialReasons.push(`CI status for PR #${pr.number} could not be read.`); }
  }
  return { issues, pulls, rateLimit, partialReasons };
}
