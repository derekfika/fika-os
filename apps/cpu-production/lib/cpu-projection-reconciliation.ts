import type { NextRequest } from "next/server";
import { canonicalDigestsMatch, canonicalProductionDigest, type CanonicalProductionDigest, type CanonicalProductionDigestSet } from "@fika/server-shared/canonical-production-digest";
import { db } from "./firebase-admin";
import { hubJson } from "./production-http-client";
import { cpuProjections } from "./cpu-projection-repository";
import { latestCpuChangeSequence, rebuildCpuDayProjection, rebuildCpuWeekProjection, weekCommencingFor, type CpuDayProjection, type CpuWeekProjection } from "./cpu-projection";

/**
 * CPU projection <-> canonical Production reconciliation.
 *
 * Every CPU week/day projection stores the canonical digest (`canonicalId|version|status` of every Hub order in scope,
 * cancelled included) it was built from. Reconciliation asks the Hub - the authority - for its current digest of a week
 * (ONE cheap Hub call, no order bodies are transported or compared) and compares it with the stored one. A mismatch means
 * the projection silently diverged, and is repaired by a normal canonical rebuild. Bounded by design:
 *  - a fixed look-back/look-ahead window of weeks, at most `maxWeeks` due weeks per tick;
 *  - a per-week state document with a next-check time (10 min when consistent, exponential back-off to 30 min otherwise);
 *  - one rebuild attempt per check, then one verification - a week that is still moving is reported `unstable` and left
 *    for the next due check rather than looped on.
 */

export type ReconciliationMode = "off" | "report" | "enforce";
export function reconciliationMode(env: NodeJS.ProcessEnv = process.env): ReconciliationMode {
  const configured = env.FIKA_CPU_PROJECTION_RECONCILIATION;
  if (configured === "off" || configured === "report" || configured === "enforce") return configured;
  return ["staging", "production"].includes(env.FIKA_RUNTIME_MODE || "") ? "enforce" : "off";
}

const STATE_COLLECTION = "fikaCpuProjectionReconciliationV1";
const CONSISTENT_INTERVAL_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const BASE_BACKOFF_MS = 60_000;
export const RECONCILIATION_WEEKS_BEHIND = 2;
export const RECONCILIATION_WEEKS_AHEAD = 4;
export const RECONCILIATION_MAX_WEEKS_PER_TICK = 3;

export type ReconciliationOutcome = {
  weekCommencing: string;
  /** consistent: nothing to do. diverged: found (report/dry-run only). rebuilt: found and repaired + verified. unstable: still moving after repair. error: could not check. */
  state: "consistent" | "diverged" | "rebuilt" | "unstable" | "error";
  reasons: string[];
  hub?: CanonicalProductionDigest;
  stored?: Partial<CanonicalProductionDigest>;
  mismatchedDays: string[];
  error?: string;
};

export type ReconciliationDependencies = {
  fetchHubDigest: (request: NextRequest, weekCommencing: string) => Promise<CanonicalProductionDigestSet>;
  readWeek: (weekCommencing: string) => Promise<Partial<CpuWeekProjection> | undefined>;
  readDay: (serviceDate: string) => Promise<Partial<CpuDayProjection> | undefined>;
  rebuild: (request: NextRequest, weekCommencing: string, mismatchedDays: string[]) => Promise<void>;
};

const isDigestSet = (value: unknown): value is { digest: CanonicalProductionDigestSet } => Boolean(value && typeof value === "object" && typeof (value as { digest?: { digest?: unknown } }).digest?.digest === "string");
export const weekDays = (weekCommencing: string) => Array.from({ length: 5 }, (_, index) => { const date = new Date(`${weekCommencing}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index); return date.toISOString().slice(0, 10); });

const defaults: ReconciliationDependencies = {
  fetchHubDigest: async (request, weekCommencing) => (await hubJson(request, `/api/production?weekCommencing=${encodeURIComponent(weekCommencing)}&digest=1`, { method: "GET", headers: { accept: "application/json" } }, isDigestSet)).digest,
  readWeek: async weekCommencing => { const snapshot = await cpuProjections().doc(`week:${weekCommencing}`).get(); return snapshot.exists ? snapshot.data() as Partial<CpuWeekProjection> : undefined; },
  readDay: async serviceDate => { const snapshot = await cpuProjections().doc(serviceDate).get(); return snapshot.exists ? snapshot.data() as Partial<CpuDayProjection> : undefined; },
  rebuild: async (request, weekCommencing, mismatchedDays) => {
    const days = weekDays(weekCommencing);
    // Never let the projection's sequence lag the change log: use the newest recorded CPU change for the week.
    const sequence = Math.max(0, ...await Promise.all(days.map(date => latestCpuChangeSequence(date))));
    await rebuildCpuWeekProjection(request, weekCommencing, sequence);
    for (const date of mismatchedDays) await rebuildCpuDayProjection(request, date, sequence);
  },
};

/** Compare a week (and its already-materialised days) with the Hub's canonical digest. Read-only. */
export async function diagnoseCpuWeek(request: NextRequest, weekCommencing: string, dependencies: ReconciliationDependencies = defaults) {
  const hub = await dependencies.fetchHubDigest(request, weekCommencing);
  const [week, ...days] = await Promise.all([dependencies.readWeek(weekCommencing), ...weekDays(weekCommencing).map(date => dependencies.readDay(date))]);
  const reasons: string[] = [];
  if (!week) reasons.push("no week projection stored (created on first read)");
  else if (!week.canonicalDigest) reasons.push("week projection carries no canonical digest");
  else if (!canonicalDigestsMatch(week.canonicalDigest, hub)) reasons.push(`week projection built from ${week.canonicalDigest.count} canonical orders; Hub holds ${hub.count} with a different version/status set`);
  const mismatchedDays: string[] = [];
  weekDays(weekCommencing).forEach((date, index) => {
    const day = days[index];
    if (!day) return; // an unmaterialised day is built from canonical state when first read
    const expected = hub.days[date] || canonicalProductionDigest([]);
    if (!canonicalDigestsMatch(day.canonicalDigest, expected)) { mismatchedDays.push(date); reasons.push(`${date} day projection ${day.canonicalDigest ? "differs from" : "has no digest for"} the Hub canonical set`); }
  });
  // A week with no projection at all is not divergence - nothing derived exists to be wrong.
  const diverged = Boolean(week) && reasons.length > 0 || mismatchedDays.length > 0;
  return { hub, stored: week?.canonicalDigest, reasons: week || mismatchedDays.length ? reasons : [], mismatchedDays, diverged, weekExists: Boolean(week) };
}

export async function reconcileCpuWeek(request: NextRequest, weekCommencing: string, options: { mode?: ReconciliationMode; dependencies?: ReconciliationDependencies } = {}): Promise<ReconciliationOutcome> {
  const mode = options.mode ?? reconciliationMode();
  const dependencies = options.dependencies ?? defaults;
  try {
    const diagnosis = await diagnoseCpuWeek(request, weekCommencing, dependencies);
    const base = { weekCommencing, reasons: diagnosis.reasons, hub: { digest: diagnosis.hub.digest, count: diagnosis.hub.count }, ...(diagnosis.stored ? { stored: { digest: diagnosis.stored.digest, count: diagnosis.stored.count } } : {}), mismatchedDays: diagnosis.mismatchedDays };
    if (!diagnosis.diverged) return { ...base, state: "consistent" };
    if (mode !== "enforce") return { ...base, state: "diverged" };
    await dependencies.rebuild(request, weekCommencing, diagnosis.mismatchedDays);
    const verification = await diagnoseCpuWeek(request, weekCommencing, dependencies);
    return verification.diverged ? { ...base, state: "unstable", reasons: [...diagnosis.reasons, "still diverged after rebuild - canonical state is changing; will re-check after back-off"] } : { ...base, state: "rebuilt" };
  } catch (error) {
    return { weekCommencing, state: "error", reasons: [], mismatchedDays: [], error: error instanceof Error ? error.message : "Reconciliation failed." };
  }
}

type ReconciliationState = { weekCommencing: string; lastCheckedAt: string; nextCheckAt: string; lastState: ReconciliationOutcome["state"]; consecutiveProblems: number; lastRebuiltAt?: string; lastReasons: string[]; lastError?: string };

export const nextCheckDelayMs = (state: ReconciliationOutcome["state"], consecutiveProblems: number) =>
  state === "consistent" ? CONSISTENT_INTERVAL_MS : Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, consecutiveProblems - 1));

export function reconciliationWeeks(now = new Date()) {
  const current = weekCommencingFor(now.toISOString().slice(0, 10));
  return Array.from({ length: RECONCILIATION_WEEKS_BEHIND + 1 + RECONCILIATION_WEEKS_AHEAD }, (_, index) => {
    const date = new Date(`${current}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + (index - RECONCILIATION_WEEKS_BEHIND) * 7);
    return date.toISOString().slice(0, 10);
  });
}

/** Scheduled sweep: checks the weeks whose next-check time has passed, at most `maxWeeks`, recording state for back-off. */
export async function reconcileCpuProjectionsIfDue(request: NextRequest, options: { now?: Date; maxWeeks?: number; mode?: ReconciliationMode; dependencies?: ReconciliationDependencies } = {}) {
  const mode = options.mode ?? reconciliationMode();
  if (mode === "off") return { mode, checked: 0, outcomes: [] as ReconciliationOutcome[] };
  const now = options.now ?? new Date();
  const states = await Promise.all(reconciliationWeeks(now).map(async week => { const snapshot = await db.collection(STATE_COLLECTION).doc(week).get(); return { week, state: snapshot.exists ? snapshot.data() as ReconciliationState : undefined }; }));
  const due = states.filter(({ state }) => !state || state.nextCheckAt <= now.toISOString()).slice(0, options.maxWeeks ?? RECONCILIATION_MAX_WEEKS_PER_TICK);
  const outcomes: ReconciliationOutcome[] = [];
  for (const { week, state } of due) {
    const outcome = await reconcileCpuWeek(request, week, { mode, dependencies: options.dependencies });
    outcomes.push(outcome);
    const problems = outcome.state === "consistent" ? 0 : (state?.consecutiveProblems || 0) + 1;
    const at = now.toISOString();
    await db.collection(STATE_COLLECTION).doc(week).set({
      weekCommencing: week, lastCheckedAt: at, nextCheckAt: new Date(now.getTime() + nextCheckDelayMs(outcome.state, problems)).toISOString(), lastState: outcome.state, consecutiveProblems: problems,
      ...(outcome.state === "rebuilt" ? { lastRebuiltAt: at } : state?.lastRebuiltAt ? { lastRebuiltAt: state.lastRebuiltAt } : {}),
      lastReasons: outcome.reasons.slice(0, 10), ...(outcome.error ? { lastError: outcome.error } : {}),
    } satisfies ReconciliationState);
  }
  return { mode, checked: outcomes.length, outcomes };
}
