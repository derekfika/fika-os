// Server-only owner-marks core (#241). Pure transition logic shared by the in-memory (test) and Firestore stores.
// Marks are append-only owner assertions; they never read or write verified GitHub / release evidence and trigger no deploy, GitHub write or issue close.
import crypto from "node:crypto";
import { z } from "zod";
import { MARK_KINDS, MARK_SLOTS, NOTE_MAX, SHA_PATTERN, SLOT_OF, type IssueMarks, type MarkEntry, type MarkEvent, type MarkKind, type MarkSlot } from "./marks-shared";

export const MAX_BODY_BYTES = 4096;
export const HISTORY_LIMIT = 50;
export const MARKS_SOURCE = "development-dashboard" as const;

export class MarkError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}

const NOTE = z.string().max(NOTE_MAX).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), "control characters are not allowed");
/** Strict: any unknown key (notably `actor`, `actorId`, `at`, `shaVerified`) is rejected, so the client can never supply identity, time or verification. */
export const MarkCommandSchema = z.object({
  issueNumber: z.number().int().min(1).max(9_999_999),
  kind: z.enum(MARK_KINDS),
  expectedVersion: z.number().int().min(0).max(1_000_000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  note: NOTE.optional(),
  boundSha: z.string().regex(SHA_PATTERN).optional(),
  target: z.enum(MARK_SLOTS).optional(),
}).strict().superRefine((c, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (c.kind === "clear") { if (!c.target) bad("target", "A mark to clear is required."); if (c.boundSha) bad("boundSha", "Not allowed when clearing."); }
  else if (c.target) bad("target", "Only allowed when clearing.");
  if (c.boundSha && !["uat-accepted", "uat-failed", "deployed-staging", "pushed-to-production"].includes(c.kind)) bad("boundSha", "A build SHA applies only to UAT, staging and production marks.");
  if (c.kind === "blocked-note" && !c.note?.trim()) bad("note", "A blocked note needs text.");
});
export type MarkCommand = z.infer<typeof MarkCommandSchema>;

/** Server-resolved facts about the issue; the client's claim about verification is never trusted. */
export interface MarkContext { actorId: string; actorName: string; /** Firebase uid: the actor identifier the existing governance audit records use. */ actorUid: string; now: Date; verifiedStagingSha?: string }

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const eventIdFor = (issueNumber: number, idempotencyKey: string) => `mk_${sha256(`${issueNumber}:${idempotencyKey}`).slice(0, 40)}`;
/** Replay fingerprint: everything that defines the action except the concurrency token (a retry carries the pre-write version). */
export const payloadHashOf = (c: MarkCommand) => sha256(JSON.stringify([c.issueNumber, c.kind, c.note?.trim() || "", c.boundSha || "", c.target || ""]));

export type ApplyResult = { replayed: true; event: MarkEvent; state: IssueMarks } | { replayed: false; event: MarkEvent; state: IssueMarks };

export function emptyMarks(issueNumber: number): IssueMarks { return { issueNumber, version: 0, slots: {} }; }

/** Resolve the build a UAT mark binds to. Verified serving SHA wins; otherwise the typed SHA is kept and labelled unverified. */
function resolveSha(c: MarkCommand, ctx: MarkContext): { boundSha?: string; shaVerified?: boolean } {
  const uat = c.kind === "uat-accepted" || c.kind === "uat-failed";
  if (ctx.verifiedStagingSha && uat) {
    if (c.boundSha && c.boundSha !== ctx.verifiedStagingSha) throw new MarkError(409, "UAT_BUILD_CHANGED", "Staging now serves a different build than the one you were shown. Refresh and test that build.");
    return { boundSha: ctx.verifiedStagingSha, shaVerified: true };
  }
  if (uat && !c.boundSha) throw new MarkError(422, "UAT_SHA_REQUIRED", "No verified staging build is available, so enter the full 40-character build SHA you tested.");
  return c.boundSha ? { boundSha: c.boundSha, shaVerified: false } : {};
}

/**
 * Pure transition. `existing` is the stored event for this idempotency key (if any), `state` the stored per-issue state (if any).
 * Order: idempotent replay first (so a retry after success is a no-op), then optimistic concurrency, then content rules.
 */
export function applyMark(state: IssueMarks | undefined, existing: MarkEvent | undefined, c: MarkCommand, ctx: MarkContext): ApplyResult {
  const current = state || emptyMarks(c.issueNumber);
  const eventId = eventIdFor(c.issueNumber, c.idempotencyKey);
  if (existing) {
    if (existing.payloadHash !== payloadHashOf(c)) throw new MarkError(409, "IDEMPOTENCY_KEY_REUSED", "That request key was already used for a different mark.");
    return { replayed: true, event: existing, state: current };
  }
  if (c.expectedVersion !== current.version) throw new MarkError(409, "MARK_VERSION_CONFLICT", "The marks for this issue changed since you opened it. Refresh and review before saving.", { currentVersion: current.version });
  const at = ctx.now.toISOString();
  const slot: MarkSlot = c.kind === "clear" ? c.target! : SLOT_OF[c.kind];
  const note = c.note?.trim() || undefined;
  const slots = { ...current.slots };
  let sha: { boundSha?: string; shaVerified?: boolean } = {};
  if (c.kind === "clear") {
    if (!slots[slot]) throw new MarkError(409, "MARK_NOT_SET", "There is no such mark to clear.");
    delete slots[slot];
  } else {
    sha = resolveSha(c, ctx);
    const entry: MarkEntry = { kind: c.kind, ...sha, ...(note ? { note } : {}), actorId: ctx.actorId, actorName: ctx.actorName, at, eventId };
    slots[slot] = entry;
  }
  const version = current.version + 1;
  const event: MarkEvent = {
    eventId, issueNumber: c.issueNumber, version, previousVersion: current.version, kind: c.kind as MarkKind, slot, ...sha, ...(note ? { note } : {}),
    actorId: ctx.actorId, actorName: ctx.actorName, at, idempotencyKey: c.idempotencyKey, payloadHash: payloadHashOf(c), source: MARKS_SOURCE, ownerRecorded: true,
  };
  return { replayed: false, event, state: { issueNumber: c.issueNumber, version, slots, updatedAt: at } };
}

/** The audit record written beside each event (existing integrationHubGovernanceAudit idiom). Contains no note body beyond what the event carries. */
export function auditRecordFor(event: MarkEvent, actorUid: string) {
  return { auditId: `audit_${event.eventId}`, action: `Development owner mark: ${event.kind}`, entityReference: `github-issue:${event.issueNumber}`, actorId: actorUid, principalId: event.actorId, actorName: event.actorName, timestamp: event.at, reason: "Owner-recorded assertion; not verified evidence.", oplocId: null, source: MARKS_SOURCE, eventId: event.eventId, version: event.version, boundSha: event.boundSha ?? null };
}

export interface MarksStore {
  /** Current derived marks for every marked issue (one document read). */
  readAll(): Promise<Record<string, IssueMarks>>;
  /** Newest-first history for one issue, bounded. */
  history(issueNumber: number, limit?: number): Promise<MarkEvent[]>;
  append(command: MarkCommand, ctx: MarkContext): Promise<ApplyResult>;
}

/** Deterministic store for tests and local use. Same transition logic as the Firestore store. */
export function createInMemoryMarksStore() {
  const states = new Map<number, IssueMarks>();
  const events: MarkEvent[] = [];
  const audit: ReturnType<typeof auditRecordFor>[] = [];
  const store: MarksStore & { events: MarkEvent[]; audit: typeof audit; states: Map<number, IssueMarks> } = {
    events, audit, states,
    async readAll() { return Object.fromEntries([...states].map(([n, s]) => [String(n), structuredClone(s)])); },
    async history(issueNumber, limit = HISTORY_LIMIT) { return events.filter(e => e.issueNumber === issueNumber).sort((a, b) => b.version - a.version).slice(0, limit).map(e => structuredClone(e)); },
    async append(command, ctx) {
      const id = eventIdFor(command.issueNumber, command.idempotencyKey);
      const result = applyMark(states.get(command.issueNumber), events.find(e => e.eventId === id), command, ctx);
      if (!result.replayed) { states.set(command.issueNumber, result.state); events.push(result.event); audit.push(auditRecordFor(result.event, ctx.actorUid)); }
      return structuredClone(result);
    },
  };
  return store;
}

/** Per-instance sliding window limiter (the owner is one person; this bounds a runaway client, not an attacker). */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return { allow(key: string) { const t = now(); const recent = (hits.get(key) || []).filter(x => t - x < windowMs); if (recent.length >= max) { hits.set(key, recent); return false; } recent.push(t); hits.set(key, recent); return true; } };
}
