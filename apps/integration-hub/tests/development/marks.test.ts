import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fixtureExternal, fixtureIssues, fixturePulls, FIXTURE_NOW } from "../../lib/development/fixtures";
import { applyMark, createInMemoryMarksStore, createRateLimiter, MarkCommandSchema, MAX_BODY_BYTES, type MarkCommand, type MarksStore } from "../../lib/development/marks";
import { createFirestoreMarksStore, type FsDatabase } from "../../lib/development/marks-firestore";
import { handleMarksHistoryGet, handleMarksPost, type MarksRouteDeps } from "../../lib/development/marks-route";
import { ownerHandled, reconcileOwnerMarks, snapshotTrusted, verifiedStagingSha, type IssueMarks } from "../../lib/development/marks-shared";
import { handleDevelopmentGet } from "../../lib/development/route";
import { buildSnapshot } from "../../lib/development/snapshot";
import type { DevelopmentSnapshot } from "../../lib/development/types";

const snapshot = () => buildSnapshot({ repository: "o/r", data: { issues: fixtureIssues, pulls: fixturePulls, partialReasons: [] }, external: fixtureExternal, now: FIXTURE_NOW, lastVerified: FIXTURE_NOW.toISOString() });
const STAGING_SHA = "c".repeat(40); // fixture: issue 103 is on staging at this build, verified
const OTHER_SHA = "e".repeat(40);
const owner = { principal: { id: "identity-owner", displayName: "Derek" }, actor: { uid: "uid-1", name: "Derek B" } };

let counter = 0;
const cmd = (o: Partial<MarkCommand> & Record<string, unknown> = {}) => ({ issueNumber: 108, kind: "checked", expectedVersion: 0, idempotencyKey: `test-key-${String(++counter).padStart(16, "0")}`, ...o });
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/development/marks", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
function deps(over: Partial<MarksRouteDeps> = {}, store: MarksStore = createInMemoryMarksStore()): MarksRouteDeps & { marks: ReturnType<typeof createInMemoryMarksStore> } {
  return { authorize: async () => owner, assertSameOrigin: () => {}, service: { get: async () => snapshot() }, marks: store, rateLimiter: createRateLimiter(1000, 60_000), now: () => FIXTURE_NOW, ...over } as never;
}
const errorOf = async (res: Response) => (await res.json()) as { error: { code: string; message: string } };

// ---------- (A) contrast: tokens must resolve ----------
const css = readFileSync(new URL("../../app/development/development.module.css", import.meta.url), "utf8");
const hubTokens = readFileSync(new URL("../../app/styles/fika-tokens.css", import.meta.url), "utf8");
const defined = new Map<string, string>();
for (const source of [hubTokens, css]) for (const m of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) defined.set(m[1], m[2].trim());
const resolve = (value: string, depth = 0): string => { if (depth > 8) throw new Error("token cycle"); return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, name) => { const next = defined.get(name); if (!next) throw new Error(`unresolved token ${name}`); return resolve(next, depth + 1); }); };
const luminance = (hex: string) => { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? [...h].map(c => c + c).join("") : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0); };
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("A: every var(--token) in development.module.css resolves to a token the Hub defines", () => {
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]));
  for (const name of used) assert.doesNotThrow(() => resolve(`var(${name})`), `${name} must resolve`);
  for (const name of used) assert.doesNotMatch(resolve(`var(${name})`), /var\(/, `${name} must resolve to a plain value`);
});

test("A: primary button, active tab and secondary controls have at least 4.5:1 contrast", () => {
  const decl = (body: string, prop: string) => { const m = body.match(new RegExp(`(?:^|;)${prop}:([^;]+)`)); assert.ok(m, prop); return resolve(m![1].trim()); };
  const pairs: [string, string, string][] = [[".primary", "background", "color"], [".tabActive", "background", "color"], [".secondary,.tab", "background", "color"]];
  for (const [selector, bg, fg] of pairs) {
    const body = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.,]/g, c => "\\" + c)}\\{([^}]*)\\}`))?.[1]; assert.ok(body, selector);
    assert.ok(contrast(decl(body, bg), decl(body, fg)) >= 4.5, `${selector} ${decl(body, bg)} on ${decl(body, fg)}`);
  }
  assert.ok(!/color:#fff/i.test(css), "no hard-coded white label on a token background");
});

// ---------- (B) route guards ----------
test("B: POST fails closed on 401/403 and unexpected auth errors; the store and snapshot are never touched", async () => {
  for (const status of [401, 403, undefined]) {
    let touched = false; const d = deps({ authorize: async () => { throw Object.assign(new Error("x"), status ? { status } : {}); }, service: { get: async () => { touched = true; return snapshot(); } } });
    const res = await handleMarksPost(post(cmd()), d);
    assert.equal(res.status, status ?? 403);
    assert.equal(touched, false); assert.equal(d.marks.events.length, 0);
    assert.ok(!/issues|lastVerified/.test(JSON.stringify(await res.json())));
  }
});

test("B: history GET is admission-gated too", async () => {
  const d = deps({ authorize: async () => { throw Object.assign(new Error("no"), { status: 401 }); } });
  assert.equal((await handleMarksHistoryGet(new Request("http://localhost/api/development/marks?issue=108"), d)).status, 401);
});

test("B: an incomplete AUTHMOD context cannot write (no actor, no write)", async () => {
  const d = deps({ authorize: async () => ({ actor: {}, principal: {} }) });
  const res = await handleMarksPost(post(cmd()), d);
  assert.equal(res.status, 403); assert.equal(d.marks.events.length, 0);
});

test("B: actor is derived server-side; a client-supplied actor is refused and never stored", async () => {
  const d = deps();
  for (const extra of [{ actor: "Mallory" }, { actorId: "x" }, { actorName: "x" }, { at: "2020-01-01T00:00:00Z" }, { shaVerified: true }]) {
    const res = await handleMarksPost(post(cmd(extra)), d);
    assert.equal(res.status, 422, JSON.stringify(extra));
  }
  assert.equal(d.marks.events.length, 0);
  const ok = await handleMarksPost(post(cmd()), d);
  assert.equal(ok.status, 200);
  const stored = d.marks.events[0];
  assert.equal(stored.actorId, "identity-owner"); assert.equal(stored.actorName, "Derek");
  assert.equal(stored.at, FIXTURE_NOW.toISOString());
  assert.equal(stored.ownerRecorded, true);
});

test("B: same-origin, JSON content type, size and rate limits", async () => {
  const d = deps({ assertSameOrigin: () => { throw new Error("bad origin"); } });
  assert.equal((await handleMarksPost(post(cmd()), d)).status, 403);
  const d2 = deps();
  assert.equal((await handleMarksPost(post(cmd(), { "content-type": "text/plain" }), d2)).status, 415);
  assert.equal((await handleMarksPost(post("x".repeat(MAX_BODY_BYTES + 10)), d2)).status, 413);
  assert.equal((await handleMarksPost(post("{not json"), d2)).status, 400);
  assert.equal(d2.marks.events.length, 0);
  const limited = deps({ rateLimiter: createRateLimiter(2, 60_000) });
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) statuses.push((await handleMarksPost(post(cmd({ kind: "blocked-note", note: "n", expectedVersion: Math.min(i, 2) })), limited)).status);
  assert.deepEqual(statuses.slice(2), [429, 429]);
});

test("B: strict validation", () => {
  const bad: Record<string, unknown>[] = [
    cmd({ issueNumber: 0 }), cmd({ issueNumber: 1.5 }), cmd({ kind: "merge" as never }), cmd({ expectedVersion: -1 }), cmd({ idempotencyKey: "short" }), cmd({ idempotencyKey: "has spaces and is long enough" }),
    cmd({ note: "x".repeat(301) }), cmd({ note: "bell\u0007" }), cmd({ boundSha: "abc" }), cmd({ boundSha: STAGING_SHA.toUpperCase(), kind: "uat-accepted" }),
    cmd({ kind: "clear" }), cmd({ kind: "clear", target: "nonsense" as never }), cmd({ kind: "checked", target: "checked" }), cmd({ kind: "blocked-note" }), cmd({ kind: "checked", boundSha: STAGING_SHA }), cmd({ kind: "clear", target: "uat", boundSha: STAGING_SHA }),
  ];
  for (const b of bad) assert.equal(MarkCommandSchema.safeParse(b).success, false, JSON.stringify(b));
  assert.equal(MarkCommandSchema.safeParse(cmd({ kind: "clear", target: "checked" })).success, true);
});

test("B: unknown issue is rejected; unavailable issue data fails closed", async () => {
  const d = deps();
  assert.equal((await handleMarksPost(post(cmd({ issueNumber: 99999 })), d)).status, 404);
  const empty = deps({ service: { get: async () => ({ ...snapshot(), issues: [] }) } });
  assert.equal((await handleMarksPost(post(cmd()), empty)).status, 503);
  assert.equal(d.marks.events.length + empty.marks.events.length, 0);
});

test("B: optimistic concurrency rejects a stale expectedVersion and leaves state alone", async () => {
  const d = deps();
  assert.equal((await handleMarksPost(post(cmd({ expectedVersion: 0 })), d)).status, 200);
  const stale = await handleMarksPost(post(cmd({ kind: "blocked-note", note: "x", expectedVersion: 0 })), d);
  assert.equal(stale.status, 409); assert.equal((await errorOf(stale)).error.code, "MARK_VERSION_CONFLICT");
  assert.equal(d.marks.events.length, 1); assert.equal(d.marks.states.get(108)!.version, 1);
  assert.equal((await handleMarksPost(post(cmd({ kind: "blocked-note", note: "x", expectedVersion: 1 })), d)).status, 200);
});

test("B: replaying the same idempotency key does not duplicate; a different payload under the same key is refused", async () => {
  const d = deps(); const body = cmd({ note: "looks good" });
  const first = await handleMarksPost(post(body), d); const again = await handleMarksPost(post(body), d); const third = await handleMarksPost(post(body), d);
  assert.equal(first.status, 200); assert.equal(again.status, 200); assert.equal(third.status, 200);
  assert.equal(((await again.json()) as { replayed: boolean }).replayed, true);
  assert.equal(d.marks.events.length, 1); assert.equal(d.marks.audit.length, 1); assert.equal(d.marks.states.get(108)!.version, 1);
  const reuse = await handleMarksPost(post({ ...body, note: "different" }), d);
  assert.equal(reuse.status, 409); assert.equal((await errorOf(reuse)).error.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(d.marks.events.length, 1);
  // concurrent identical submissions (double click) also produce one event
  const d2 = deps(); const b2 = cmd();
  const results = await Promise.all([handleMarksPost(post(b2), d2), handleMarksPost(post(b2), d2)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]); assert.equal(d2.marks.events.length, 1);
});

test("B: UAT binds the verified serving build; a different build is refused; no SHA bound to the wrong build", async () => {
  const d = deps();
  const ok = await handleMarksPost(post(cmd({ issueNumber: 103, kind: "uat-accepted", boundSha: STAGING_SHA })), d);
  assert.equal(ok.status, 200);
  const event = d.marks.events[0]; assert.equal(event.boundSha, STAGING_SHA); assert.equal(event.shaVerified, true);
  const omitted = await handleMarksPost(post(cmd({ issueNumber: 103, kind: "uat-failed", expectedVersion: 1 })), d);
  assert.equal(omitted.status, 200); assert.equal(d.marks.events[1].boundSha, STAGING_SHA); assert.equal(d.marks.events[1].shaVerified, true);
  const changed = await handleMarksPost(post(cmd({ issueNumber: 103, kind: "uat-accepted", expectedVersion: 2, boundSha: OTHER_SHA })), d);
  assert.equal(changed.status, 409); assert.equal((await errorOf(changed)).error.code, "UAT_BUILD_CHANGED");
  assert.equal(d.marks.events.length, 2);
});

test("B: with no verified staging build, UAT needs a typed SHA and is labelled unverified", async () => {
  const d = deps();
  const missing = await handleMarksPost(post(cmd({ issueNumber: 108, kind: "uat-accepted" })), d);
  assert.equal(missing.status, 422); assert.equal((await errorOf(missing)).error.code, "UAT_SHA_REQUIRED");
  assert.equal(d.marks.events.length, 0);
  const typed = await handleMarksPost(post(cmd({ issueNumber: 108, kind: "uat-accepted", boundSha: OTHER_SHA })), d);
  assert.equal(typed.status, 200);
  assert.equal(d.marks.events[0].boundSha, OTHER_SHA); assert.equal(d.marks.events[0].shaVerified, false);
  // a stale snapshot never counts as verification
  const stale = deps({ service: { get: async () => ({ ...snapshot(), flags: { ...snapshot().flags, stale: true } }) } });
  const res = await handleMarksPost(post(cmd({ issueNumber: 103, kind: "uat-accepted", boundSha: STAGING_SHA })), stale);
  assert.equal(res.status, 200); assert.equal(stale.marks.events[0].shaVerified, false);
});

test("B: marks never alter verified lifecycle state or the GitHub-derived snapshot", async () => {
  const before = JSON.stringify(snapshot());
  const d = deps();
  for (const [i, body] of [cmd({ issueNumber: 101, kind: "deployed-staging" }), cmd({ issueNumber: 101, kind: "pushed-to-production", expectedVersion: 1 }), cmd({ issueNumber: 108, kind: "uat-accepted", boundSha: OTHER_SHA })].entries()) assert.equal((await handleMarksPost(post(body), d)).status, 200, String(i));
  assert.equal(JSON.stringify(snapshot()), before);
  const res = await handleDevelopmentGet(new Request("http://localhost/api/development"), { authorize: async () => owner, service: { get: async () => snapshot() }, marks: d.marks });
  const body = (await res.json()) as DevelopmentSnapshot;
  const { marks, ...verified } = body;
  assert.equal(JSON.stringify(verified), before);
  assert.equal(marks!.available, true); assert.equal(marks!.byIssue["101"].slots.production!.kind, "pushed-to-production");
  const v101 = body.issues.find(i => i.number === 101)!;
  assert.equal(v101.status, "merged_awaiting_deploy"); assert.equal(v101.steps.find(s => s.key === "production")!.status, "pending");
  const v102 = body.issues.find(i => i.number === 102)!; assert.equal(v102.steps.find(s => s.key === "uat")!.status, "failed");
});

test("B: a marks outage degrades to unavailable marks without hiding verified data", async () => {
  const res = await handleDevelopmentGet(new Request("http://localhost/api/development"), { authorize: async () => owner, service: { get: async () => snapshot() }, marks: { readAll: async () => { throw new Error("firestore down"); } } });
  const body = (await res.json()) as DevelopmentSnapshot;
  assert.equal(res.status, 200); assert.equal(body.marks!.available, false); assert.ok(body.issues.length > 0);
  assert.ok(!JSON.stringify(body.marks).includes("firestore down"));
});

test("B: history is append-only, newest first, and clearing adds an event rather than deleting one", async () => {
  const d = deps();
  await handleMarksPost(post(cmd({ note: "first" })), d);
  await handleMarksPost(post(cmd({ kind: "blocked-note", note: "waiting", expectedVersion: 1 })), d);
  const firstEvent = structuredClone(d.marks.events[0]);
  await handleMarksPost(post(cmd({ kind: "clear", target: "checked", expectedVersion: 2 })), d);
  assert.equal(d.marks.events.length, 3);
  assert.deepEqual(d.marks.events[0], firstEvent, "earlier events are never rewritten");
  assert.deepEqual(d.marks.events.map(e => [e.version, e.previousVersion]), [[1, 0], [2, 1], [3, 2]]);
  const state = d.marks.states.get(108)!; assert.equal(state.slots.checked, undefined); assert.equal(state.slots.blocked!.note, "waiting");
  const history = (await (await handleMarksHistoryGet(new Request("http://localhost/api/development/marks?issue=108"), d)).json()) as { events: { version: number; kind: string }[] };
  assert.deepEqual(history.events.map(e => e.version), [3, 2, 1]);
  assert.equal(history.events[0].kind, "clear");
  assert.equal(d.marks.audit.length, 3);
  assert.equal((await handleMarksPost(post(cmd({ kind: "clear", target: "uat", expectedVersion: 3 })), d)).status, 409);
});

test("B: the marks route module can reach no deploy, GitHub write or issue-close path", () => {
  for (const file of ["marks.ts", "marks-route.ts", "marks-firestore.ts"]) {
    const src = readFileSync(new URL(`../../lib/development/${file}`, import.meta.url), "utf8");
    assert.ok(!/api\.github\.com|method:\s*["'](PATCH|PUT|DELETE)|\bdeploy\(|child_process|firebase-tools/i.test(src), file);
  }
});

// ---------- Firestore store against an in-memory fake (transactions, aggregate, audit) ----------
/* eslint-disable @typescript-eslint/no-explicit-any -- loose in-memory stand-in for the Admin SDK surface */
const DELETE = Symbol("delete");
const isDelete = (data: any, field: string) => field.split(".").reduce((o: any, p) => o?.[p], data) === DELETE;
function fakeFirestore() {
  const docs = new Map<string, Record<string, any>>();
  const direct = (colPath: string) => [...docs.entries()].filter(([k]) => k.startsWith(colPath + "/") && !k.slice(colPath.length + 1).includes("/"));
  const snapOf = (d?: Record<string, any>) => ({ exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) });
  class Ref { constructor(readonly path: string) {} collection(n: string) { return new Col(`${this.path}/${n}`); } async get() { return snapOf(docs.get(this.path)); } }
  class Query { constructor(readonly run: () => any[]) {} limit(n: number) { return new Query(() => this.run().slice(0, n)); } async get() { return { docs: this.run().map(snapOf) }; } }
  class Col extends Query {
    constructor(readonly path: string) { super(() => direct(path).map(([, d]) => d)); }
    doc(id = crypto.randomUUID()) { return new Ref(`${this.path}/${id}`); }
    where(f: string, _op: "==", v: unknown) { return new Query(() => direct(this.path).map(([, d]) => d).filter(d => d[f] === v)); }
    orderBy(f: string, dir: "asc" | "desc") { return { limit: (n: number) => new Query(() => direct(this.path).map(([, d]) => d).sort((a, b) => (dir === "desc" ? b[f] - a[f] : a[f] - b[f])).slice(0, n)) }; }
  }
  const db = {
    collection: (n: string) => new Col(n),
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const pending: (() => void)[] = []; let wrote = false;
      const tx = {
        async get(t: any) { assert.equal(wrote, false, "reads must precede writes"); return t instanceof Ref ? snapOf(docs.get(t.path)) : t.get(); },
        set(ref: Ref, data: any, opts?: { mergeFields: string[] }) { wrote = true; pending.push(() => { if (!opts) { docs.set(ref.path, structuredClone(data)); return; } const cur = structuredClone(docs.get(ref.path) || {}); for (const field of opts.mergeFields) { if (isDelete(data, field)) { const parts = field.split("."); let o = cur; for (const p of parts.slice(0, -1)) o = o[p] || {}; delete o[parts[parts.length - 1]]; continue; } const parts = field.split("."); let o = cur; let src = data; for (const p of parts.slice(0, -1)) { o[p] ||= {}; o = o[p]; src = src[p]; } o[parts[parts.length - 1]] = structuredClone(src[parts[parts.length - 1]]); } docs.set(ref.path, cur); }); },
        create(ref: Ref, data: any) { wrote = true; pending.push(() => { if (docs.has(ref.path)) throw new Error("ALREADY_EXISTS"); docs.set(ref.path, structuredClone(data)); }); },
      };
      const out = await fn(tx); pending.forEach(f => f()); return out;
    },
  };
  return { db: db as unknown as FsDatabase, docs };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
const ctx = { actorId: "identity-owner", actorUid: "uid-1", actorName: "Derek", now: FIXTURE_NOW };
const parse = (o: Record<string, unknown>) => MarkCommandSchema.parse(cmd(o));

test("Firestore store: append writes state, event, audit and aggregate together; replay writes nothing", async () => {
  const { db, docs } = fakeFirestore(); const store = createFirestoreMarksStore(async () => db, async () => DELETE);
  const c = parse({ note: "ok" });
  const r1 = await store.append(c, ctx); const size = docs.size;
  assert.equal(r1.replayed, false);
  assert.ok(docs.has("development_dashboard_marks/issue-108")); assert.ok(docs.has("development_dashboard_marks/current"));
  assert.equal([...docs.keys()].filter(k => k.startsWith("development_dashboard_marks/issue-108/events/")).length, 1);
  assert.equal([...docs.keys()].filter(k => k.startsWith("integrationHubGovernanceAudit/")).length, 1);
  const r2 = await store.append(c, ctx);
  assert.equal(r2.replayed, true); assert.equal(docs.size, size);
  assert.equal((await store.readAll())["108"].version, 1);
  await assert.rejects(store.append(parse({ expectedVersion: 0, kind: "blocked-note", note: "x" }), ctx), /changed since you opened/);
  await store.append(parse({ expectedVersion: 1, kind: "blocked-note", note: "x" }), ctx);
  assert.deepEqual((await store.history(108)).map(e => e.version), [2, 1]);
});

test("Firestore store: a clear removes the slot from the aggregate and the aggregate is rebuilt from authority when missing", async () => {
  const { db, docs } = fakeFirestore(); const store = createFirestoreMarksStore(async () => db, async () => DELETE);
  await store.append(parse({ issueNumber: 7, note: "a" }), ctx);
  await store.append(parse({ issueNumber: 8, note: "b" }), ctx);
  await store.append(parse({ issueNumber: 7, kind: "clear", target: "checked", expectedVersion: 1 }), ctx);
  assert.equal((await store.readAll())["7"], undefined, "an issue with no marks left is dropped from the aggregate");
  assert.equal(docs.get("development_dashboard_marks/issue-7")!.version, 2, "authoritative state keeps the version");
  docs.delete("development_dashboard_marks/current");
  const rebuilt = await store.readAll();
  assert.equal(rebuilt["8"].slots.checked!.kind, "checked"); assert.equal(rebuilt["7"], undefined);
  docs.delete("development_dashboard_marks/current");
  await store.append(parse({ issueNumber: 9, note: "c" }), ctx);
  const afterWrite = await store.readAll();
  assert.deepEqual(Object.keys(afterWrite).sort(), ["8", "9"], "a write with no aggregate must not start a partial one");
});

// ---------- pure helpers ----------
test("applyMark is pure: input state is not mutated", () => {
  const state: IssueMarks = { issueNumber: 5, version: 1, slots: { checked: { kind: "checked", actorId: "a", actorName: "A", at: "2026-10-01T00:00:00.000Z", eventId: "e" } } };
  const frozen = structuredClone(state);
  applyMark(state, undefined, parse({ issueNumber: 5, kind: "clear", target: "checked", expectedVersion: 1 }), ctx);
  assert.deepEqual(state, frozen);
});

test("reconcile shows verified and owner-recorded side by side; mismatching UAT build is flagged", () => {
  const issue = buildSnapshot({ repository: "o/r", data: { issues: fixtureIssues, pulls: fixturePulls, partialReasons: [] }, external: fixtureExternal, now: FIXTURE_NOW, lastVerified: "" }).issues;
  const i101 = issue.find(i => i.number === 101)!; const i103 = issue.find(i => i.number === 103)!;
  assert.equal(verifiedStagingSha(i103), STAGING_SHA); assert.equal(verifiedStagingSha(i101), undefined);
  const entry = (kind: "deployed-staging" | "uat-accepted", boundSha?: string, shaVerified?: boolean) => ({ kind, boundSha, shaVerified, actorId: "a", actorName: "Derek", at: "2026-11-01T10:00:00.000Z", eventId: "e1" });
  const stagingClaim = reconcileOwnerMarks(i101, { issueNumber: 101, version: 1, slots: { staging: entry("deployed-staging") } });
  assert.equal(stagingClaim[0].differs, true); assert.equal(stagingClaim[0].verifiedText, "Pending"); assert.match(stagingClaim[0].ownerText, /owner says/);
  const wrongBuild = reconcileOwnerMarks(i103, { issueNumber: 103, version: 1, slots: { uat: entry("uat-accepted", OTHER_SHA, true) } });
  assert.match(wrongBuild[0].warning!, /staging now serves/);
  const unverified = reconcileOwnerMarks(i101, { issueNumber: 101, version: 1, slots: { uat: entry("uat-accepted", OTHER_SHA, false) } });
  assert.match(unverified[0].warning!, /unverified/);
});

test("My actions: a current checked/accepted mark hides the item, a later change or a different build brings it back", () => {
  const issues = snapshot().issues; const i = issues.find(x => x.number === 103)!;
  const slotsOf = (at: string, kind: "checked" | "uat-accepted", boundSha?: string) => ({ issueNumber: 103, version: 1, slots: kind === "checked" ? { checked: { kind, actorId: "a", actorName: "D", at, eventId: "e" } } : { uat: { kind, boundSha, shaVerified: true, actorId: "a", actorName: "D", at, eventId: "e" } } });
  assert.equal(ownerHandled(i, undefined), false);
  assert.equal(ownerHandled(i, slotsOf("2026-11-01T11:00:00.000Z", "checked")), true);
  assert.equal(ownerHandled(i, slotsOf("2026-01-01T00:00:00.000Z", "checked")), false, "issue changed after the check");
  assert.equal(ownerHandled(i, slotsOf("2026-01-01T00:00:00.000Z", "uat-accepted", STAGING_SHA)), true);
  assert.equal(ownerHandled(i, slotsOf("2026-11-01T11:00:00.000Z", "uat-accepted", OTHER_SHA)), false, "different build from what staging serves");
  assert.equal(i.ownerAction, true, "the verified owner-action flag is untouched");
});

test("UI: owner view label, confirm step showing the bound SHA, no alert/prompt/confirm dialogs", () => {
  const src = readFileSync(new URL("../../app/development/DevelopmentApp.tsx", import.meta.url), "utf8");
  assert.match(src, /Owner view/); assert.doesNotMatch(src, /Read-only · owner view/);
  assert.match(src, /Owner-recorded/); assert.match(src, /Bound to build/); assert.match(src, /Confirm UAT|Confirm \$\{/);
  assert.doesNotMatch(src, /\b(window\.)?(alert|prompt|confirm)\(/);
  assert.match(src, /idempotencyKey/); assert.doesNotMatch(src, /body\.actor|actor:/);
});

// ---------- review follow-up (P3-2..P3-6) ----------
test("P3-2: notes are kept out of the aggregate (history and authoritative state hold them)", async () => {
  const { db, docs } = fakeFirestore(); const store = createFirestoreMarksStore(async () => db, async () => DELETE);
  await store.append(parse({ issueNumber: 20, note: "private reasoning text" }), ctx);
  assert.ok(!JSON.stringify(docs.get("development_dashboard_marks/current")).includes("private reasoning"));
  assert.equal((await store.readAll())["20"].slots.checked!.note, undefined);
  assert.equal((await store.history(20))[0].note, "private reasoning text");
  assert.equal((docs.get("development_dashboard_marks/issue-20") as { slots: { checked: { note: string } } }).slots.checked.note, "private reasoning text");
});

test("P3-3: a GET with a missing aggregate computes read-only and writes nothing", async () => {
  const { db, docs } = fakeFirestore(); const store = createFirestoreMarksStore(async () => db, async () => DELETE);
  await store.append(parse({ issueNumber: 30, note: "n" }), ctx);
  docs.delete("development_dashboard_marks/current");
  const before = [...docs.keys()].sort().join();
  const read = await store.readAll();
  assert.equal(read["30"].slots.checked!.kind, "checked");
  assert.equal([...docs.keys()].sort().join(), before); assert.ok(!docs.has("development_dashboard_marks/current"));
  const empty = fakeFirestore(); await createFirestoreMarksStore(async () => empty.db, async () => DELETE).readAll();
  assert.equal(empty.docs.size, 0);
});

test("P3-4: audit doc id equals its auditId and uses the Firebase uid as actorId, keeping the principal id", async () => {
  const { db, docs } = fakeFirestore(); const store = createFirestoreMarksStore(async () => db, async () => DELETE);
  const r = await store.append(parse({ issueNumber: 40 }), ctx);
  const audit = docs.get(`integrationHubGovernanceAudit/audit_${r.event.eventId}`) as { auditId: string; actorId: string; principalId: string };
  assert.ok(audit, "doc id is audit_<eventId>");
  assert.equal(audit.auditId, `audit_${r.event.eventId}`); assert.equal(audit.actorId, "uid-1"); assert.equal(audit.principalId, "identity-owner");
  const mem = createInMemoryMarksStore(); await mem.append(parse({ issueNumber: 41 }), ctx);
  assert.equal(mem.audit[0].actorId, "uid-1");
});

test("P3-4: the route needs both the Firebase uid and the principal id", async () => {
  const d = deps({ authorize: async () => ({ principal: { id: "p", displayName: "D" }, actor: {} }) });
  assert.equal((await handleMarksPost(post(cmd()), d)).status, 403);
  const ok = deps(); await handleMarksPost(post(cmd()), ok);
  assert.equal(ok.marks.audit[0].actorId, "uid-1"); assert.equal(ok.marks.events[0].actorId, "identity-owner");
});

test("P3-5: the body read is capped by streaming, with or without Content-Length", async () => {
  const d = deps();
  const chunk = new TextEncoder().encode("x".repeat(1024)); let sent = 0;
  const stream = new ReadableStream({ pull(c) { if (sent++ >= 64) c.close(); else c.enqueue(chunk); } });
  const req = new Request("http://localhost/api/development/marks", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal(req.headers.get("content-length"), null);
  const res = await handleMarksPost(req, d);
  assert.equal(res.status, 413); assert.ok(sent < 20, `stopped reading early (read ${sent} chunks)`);
  assert.equal((await handleMarksPost(post(cmd()), d)).status, 200, "a small valid body still passes");
});

test("P3-6: stale, partial, unavailable or errored snapshots are never described as verified", async () => {
  const base = snapshot();
  for (const flag of ["stale", "partial", "unavailable", "error"] as const) {
    const flags = { ...base.flags, [flag]: true };
    assert.equal(snapshotTrusted({ flags }), false, flag);
    const untrusted = deps({ service: { get: async () => ({ ...base, flags }) } });
    await handleMarksPost(post(cmd({ issueNumber: 103, kind: "uat-accepted", boundSha: STAGING_SHA })), untrusted);
    assert.equal(untrusted.marks.events[0].shaVerified, false, flag);
  }
  assert.equal(snapshotTrusted(base), true);
  const src = readFileSync(new URL("../../app/development/DevelopmentApp.tsx", import.meta.url), "utf8");
  assert.match(src, /trusted \? verifiedStagingSha\(issue\) : undefined/);
  assert.match(src, /trusted=\{snapshotTrusted\(snapshot\)\}/);
});
