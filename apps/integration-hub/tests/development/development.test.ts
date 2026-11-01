import assert from "node:assert/strict";
import test from "node:test";
import { fixtureExternal, fixtureIssues, fixturePulls, FIXTURE_NOW } from "../../lib/development/fixtures";
import { buildSnapshot, createSnapshotService, summarise } from "../../lib/development/snapshot";
import { buildIssueView } from "../../lib/development/lifecycle";
import { noExternalEvidence, type DevelopmentSnapshot } from "../../lib/development/types";
import { fetchGithubData, linkedIssueNumbers, TOKEN_ENV, type Fetcher } from "../../lib/development/github";
import { handleDevelopmentGet } from "../../lib/development/route";

const SECRET = "ghp_SECRET_TOKEN_VALUE_123";
const view = (n: number, external = fixtureExternal) => {
  const issue = fixtureIssues.find(i => i.number === n)!;
  return buildIssueView(issue, fixturePulls.filter(p => p.linkedIssues.includes(n)), external, FIXTURE_NOW);
};
const stepStatus = (v: ReturnType<typeof view>, key: string) => v.steps.find(s => s.key === key)!.status;

test("merged-but-not-deployed and staging-but-UAT-failed are distinct states", () => {
  const notDeployed = view(101); const uatFailed = view(102);
  assert.equal(notDeployed.status, "merged_awaiting_deploy");
  assert.equal(stepStatus(notDeployed, "merged"), "evidenced");
  assert.equal(stepStatus(notDeployed, "staging"), "pending");
  assert.equal(uatFailed.status, "uat_failed");
  assert.equal(stepStatus(uatFailed, "staging"), "evidenced");
  assert.equal(stepStatus(uatFailed, "uat"), "failed");
  assert.notEqual(notDeployed.status, uatFailed.status);
});

test("lifecycle never over-claims without external evidence", () => {
  const v = view(104, noExternalEvidence());
  assert.equal(stepStatus(v, "merged"), "evidenced");
  for (const key of ["staging", "uat", "production"]) assert.notEqual(stepStatus(v, key), "evidenced", key);
  assert.equal(stepStatus(v, "staging"), "not_connected");
  assert.notEqual(v.status, "live");
  assert.equal(v.closure.consistency, "closed_without_production_evidence");
});

test("UAT is never inferred from deployment and must match the staging build", () => {
  assert.equal(stepStatus(view(103), "uat"), "pending");
  assert.equal(view(103).status, "awaiting_uat");
  const old = view(109);
  assert.equal(stepStatus(old, "staging"), "evidenced");
  assert.equal(stepStatus(old, "uat"), "pending");
  assert.match(old.steps.find(s => s.key === "uat")!.note, /different build/);
});

test("closed is separate: verified live vs closed without production evidence", () => {
  assert.equal(view(104).closure.consistency, "verified_live");
  assert.equal(view(104).status, "live");
  assert.equal(view(105).closure.consistency, "closed_without_production_evidence");
  assert.notEqual(view(105).status, "live");
});

test("CI failure, draft and blocker are surfaced", () => {
  assert.equal(view(106).status, "ci_failing");
  assert.equal(stepStatus(view(106), "tested"), "failed");
  assert.equal(stepStatus(view(107), "coded"), "pending");
  assert.equal(view(107).blocker, "blocked");
  assert.equal(view(108).status, "not_started");
});

test("every evidenced step carries source and a link where available", () => {
  for (const issue of fixtureIssues) for (const s of view(issue.number).steps.filter(x => x.status === "evidenced")) {
    assert.ok(s.evidence?.source, `${issue.number}/${s.key} source`);
    assert.ok(s.evidence?.at || s.key === "tested", `${issue.number}/${s.key} timestamp`);
  }
});

test("summary counts only verified closure as genuinely closed", () => {
  const issues = fixtureIssues.map(i => view(i.number));
  const s = summarise(issues);
  assert.equal(s.genuinelyClosed, 1);
  assert.ok(s.staleOrUnverified >= 2);
  assert.equal(s.awaitingUat, 2);
});

test("issue-to-PR multi-mapping and reference parsing", () => {
  assert.equal(view(109).pullRequests.length, 2);
  assert.deepEqual(linkedIssueNumbers("Fix #12", "closes #34 and org/repo#99", "codex/issue-56-x").sort(), [12, 34, 56]);
});

const json = (body: unknown, headers: Record<string, string> = {}, status = 200) => ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => body });
const rate = { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4990", "x-ratelimit-reset": "1893456000" };
function fakeGithub(overrides: { fail?: () => boolean; status?: number; link?: string } = {}): { fetcher: Fetcher; calls: { url: string; auth: string }[] } {
  const calls: { url: string; auth: string }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    if (overrides.fail?.()) throw new Error("network " + init.headers.authorization);
    if (overrides.status) return json({ message: "x" }, rate, overrides.status);
    if (url.includes("/issues?")) return json([{ number: 7, title: "[Hub] Thing", html_url: "https://github.com/o/r/issues/7", state: "open", labels: [{ name: "blocked" }], assignees: [{ login: "a" }], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-31T00:00:00Z" }, { number: 8, pull_request: {}, title: "pr as issue" }], { ...rate, ...(overrides.link ? { link: overrides.link } : {}) });
    if (url.includes("/pulls?")) return json([{ number: 8, title: "Fix #7", body: "private body text", html_url: "https://github.com/o/r/pull/8", state: "open", draft: false, head: { sha: "a".repeat(40), ref: "codex/issue-7" }, created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-31T00:00:00Z" }], rate);
    if (url.includes("/check-runs")) return json({ check_runs: [{ name: "Workflow / merge-gate", status: "completed", conclusion: "success", html_url: "https://github.com/o/r/runs/1", completed_at: "2026-10-31T00:10:00Z" }] }, rate);
    return json({}, rate, 404);
  };
  return { fetcher, calls };
}
const env = { [TOKEN_ENV]: SECRET };

test("no credential: snapshot is unavailable, empty and makes no GitHub call", async () => {
  const gh = fakeGithub();
  const snap = await createSnapshotService({ env: {}, fetcher: gh.fetcher }).get();
  assert.equal(snap.flags.unavailable, true);
  assert.equal(snap.issues.length, 0); assert.equal(snap.lastVerified, null);
  assert.equal(gh.calls.length, 0);
});

test("connected snapshot: lastVerified, links, not-connected sources, no credential or body text in payload", async () => {
  const gh = fakeGithub();
  const snap = await createSnapshotService({ env, fetcher: gh.fetcher, now: () => FIXTURE_NOW }).get();
  assert.equal(snap.lastVerified, FIXTURE_NOW.toISOString());
  assert.equal(snap.flags.stale || snap.flags.error || snap.flags.unavailable, false);
  assert.equal(snap.issues.length, 1);
  assert.equal(snap.issues[0].pullRequests[0].number, 8);
  assert.equal(snap.issues[0].steps.find(s => s.key === "tested")!.status, "evidenced");
  assert.equal(snap.issues[0].steps.find(s => s.key === "staging")!.status, "not_reached");
  assert.equal(snap.sources.find(s => s.id === "releases")!.state, "not_connected");
  assert.ok(gh.calls.every(c => c.auth === `Bearer ${SECRET}`));
  const body = JSON.stringify(snap);
  assert.ok(!body.includes(SECRET)); assert.ok(!body.includes("private body text")); assert.ok(!/authorization/i.test(body));
});

test("failed refresh serves last good snapshot flagged stale without leaking the credential", async () => {
  let t = FIXTURE_NOW.getTime(); let fail = false;
  const gh = fakeGithub({ fail: () => fail });
  const svc = createSnapshotService({ env, fetcher: gh.fetcher, now: () => new Date(t) });
  const first = await svc.get();
  fail = true; t += 120_000;
  const second = await svc.get();
  assert.equal(second.flags.stale, true); assert.equal(second.flags.error, true);
  assert.equal(second.lastVerified, first.lastVerified);
  assert.equal(second.issues.length, first.issues.length);
  assert.ok(!JSON.stringify(second).includes(SECRET));
});

test("first-ever failure is unavailable/error, never fabricated", async () => {
  const snap = await createSnapshotService({ env, fetcher: fakeGithub({ status: 401 }).fetcher, now: () => FIXTURE_NOW }).get();
  assert.equal(snap.flags.unavailable, true); assert.equal(snap.flags.error, true); assert.equal(snap.issues.length, 0);
});

test("truncated listing is flagged partial", async () => {
  const snap = await createSnapshotService({ env, fetcher: fakeGithub({ link: '<https://x>; rel="next"' }).fetcher, now: () => FIXTURE_NOW }).get();
  assert.equal(snap.flags.partial, true);
  assert.equal(snap.sources.find(s => s.id === "github")!.state, "partial");
});

test("rate limit: low remaining stops calls; cache coalesces reads", async () => {
  await assert.rejects(fetchGithubData({ token: SECRET, repo: "o/r", fetcher: async () => { throw new Error("must not call"); }, knownRateLimit: { limit: 5000, remaining: 2, resetAt: "2099-01-01T00:00:00Z" }, now: FIXTURE_NOW }), /rate limit/i);
  const gh = fakeGithub();
  const svc = createSnapshotService({ env, fetcher: gh.fetcher, now: () => FIXTURE_NOW });
  await Promise.all([svc.get(), svc.get(), svc.get()]); await svc.get({ refresh: true });
  assert.equal(gh.calls.filter(c => c.url.includes("/issues?")).length, 1);
});

test("rate-limited response blocks further calls until reset and serves stale", async () => {
  let t = FIXTURE_NOW.getTime(); let limited = false;
  const gh = fakeGithub();
  const svc = createSnapshotService({ env, now: () => new Date(t), fetcher: async (u, i) => limited ? json({}, { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(t / 1000) + 3600) }, 403) : gh.fetcher(u, i) });
  await svc.get(); limited = true; t += 120_000;
  const a = await svc.get(); assert.equal(a.flags.stale, true);
  limited = false; t += 60_000;
  const b = await svc.get(); assert.equal(b.flags.stale, true, "still blocked before reset");
});

const request = (url = "http://localhost/api/development") => new Request(url);
const denied = (status: number) => async () => { throw Object.assign(new Error("denied"), { status }); };

test("unauthenticated and unauthorised requests get 401/403 and never reach the data layer", async () => {
  for (const status of [401, 403]) {
    let called = false;
    const res = await handleDevelopmentGet(request(), { authorize: denied(status), service: { get: async () => { called = true; return {} as DevelopmentSnapshot; } } });
    assert.equal(res.status, status); assert.equal(called, false);
    const body = JSON.stringify(await res.json());
    assert.ok(!/issues|lastVerified|releases/.test(body));
  }
});

test("unexpected authorisation errors fail closed as 403", async () => {
  let called = false;
  const res = await handleDevelopmentGet(request(), { authorize: async () => { throw new Error("firestore down"); }, service: { get: async () => { called = true; return {} as DevelopmentSnapshot; } } });
  assert.equal(res.status, 403); assert.equal(called, false);
});

test("authorised request returns the snapshot, no-store, GET only semantics", async () => {
  const snap = buildSnapshot({ repository: "o/r", data: { issues: fixtureIssues, pulls: fixturePulls, partialReasons: [] }, external: fixtureExternal, now: FIXTURE_NOW, lastVerified: FIXTURE_NOW.toISOString() });
  const res = await handleDevelopmentGet(request(), { authorize: async () => ({}), service: { get: async () => snap } });
  assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(((await res.json()) as DevelopmentSnapshot).releases.length > 0, true);
});
