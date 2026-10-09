import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextRequest } from "next/server";
import { canonicalProductionDigest, canonicalProductionDigestSet } from "@fika/server-shared/canonical-production-digest";
import { compareMonotonicProjectionWrite } from "../lib/cpu-projection-repository";
import { diagnoseCpuWeek, nextCheckDelayMs, reconcileCpuWeek, reconciliationMode, reconciliationWeeks, type ReconciliationDependencies } from "../lib/cpu-projection-reconciliation";

const WEEK = "2026-10-05";
const request = {} as NextRequest;
const o = (id: string, version: number, status: string, serviceDate: string) => ({ canonicalId: id, version, status, serviceDate });
const v3 = [o("a", 5, "menu_available", "2026-10-05"), o("b", 5, "menu_available", "2026-10-09")];
const cancelled = v3.map(order => ({ ...order, version: 7, status: "cancelled" }));
const dayDoc = (orders: typeof v3, date: string) => ({ serviceDate: date, canonicalDigest: canonicalProductionDigest(orders.filter(order => order.serviceDate === date)) });

function harness(hubOrders: () => typeof v3, stored: { week?: unknown; days?: Record<string, unknown> }) {
  const calls = { rebuilds: 0, hubReads: 0 };
  const state = { week: stored.week as never, days: { ...(stored.days || {}) } as Record<string, never> };
  const dependencies: ReconciliationDependencies = {
    fetchHubDigest: async () => { calls.hubReads += 1; return canonicalProductionDigestSet(hubOrders()); },
    readWeek: async () => state.week,
    readDay: async date => state.days[date],
    rebuild: async (_request, _week, mismatchedDays) => {
      calls.rebuilds += 1;
      const orders = hubOrders();
      state.week = { weekCommencing: WEEK, canonicalDigest: canonicalProductionDigestSet(orders) } as never;
      for (const date of mismatchedDays) state.days[date] = dayDoc(orders, date) as never;
    },
  };
  return { dependencies, calls, state };
}

test("a projection built from the same canonical set is consistent and never rebuilt", async () => {
  const { dependencies, calls } = harness(() => v3, { week: { canonicalDigest: canonicalProductionDigestSet(v3) }, days: { "2026-10-09": dayDoc(v3, "2026-10-09") } });
  const outcome = await reconcileCpuWeek(request, WEEK, { mode: "enforce", dependencies });
  assert.equal(outcome.state, "consistent"); assert.equal(calls.rebuilds, 0); assert.equal(calls.hubReads, 1, "one cheap Hub digest call - no order bodies");
});

test("canonical cancellation the projection never heard about is detected and repaired by one canonical rebuild", async () => {
  // Projection still reflects v5 live orders; Hub now holds v7 cancelled (the 7 Oct divergence).
  const { dependencies, calls } = harness(() => cancelled, { week: { canonicalDigest: canonicalProductionDigestSet(v3) }, days: { "2026-10-09": dayDoc(v3, "2026-10-09") } });
  const outcome = await reconcileCpuWeek(request, WEEK, { mode: "enforce", dependencies });
  assert.equal(outcome.state, "rebuilt"); assert.equal(calls.rebuilds, 1); assert.deepEqual(outcome.mismatchedDays, ["2026-10-09"]);
});

test("report mode and dry runs only diagnose - they never write", async () => {
  const { dependencies, calls } = harness(() => cancelled, { week: { canonicalDigest: canonicalProductionDigestSet(v3) } });
  const outcome = await reconcileCpuWeek(request, WEEK, { mode: "report", dependencies });
  assert.equal(outcome.state, "diverged"); assert.equal(calls.rebuilds, 0); assert.ok(outcome.reasons.length > 0);
});

test("a projection stored before digests existed is treated as unknown, not consistent, and repaired once", async () => {
  const { dependencies, calls } = harness(() => v3, { week: { weekCommencing: WEEK } });
  assert.equal((await reconcileCpuWeek(request, WEEK, { mode: "enforce", dependencies })).state, "rebuilt");
  assert.equal((await reconcileCpuWeek(request, WEEK, { mode: "enforce", dependencies })).state, "consistent");
  assert.equal(calls.rebuilds, 1, "no repeated rebuild once the digest is stored");
});

test("a week that keeps moving is reported unstable after ONE rebuild - no rebuild loop", async () => {
  let version = 5;
  const moving = () => [o("a", ++version, "menu_available", "2026-10-05")];
  const { dependencies, calls } = harness(moving, { week: { canonicalDigest: canonicalProductionDigestSet(v3) } });
  const outcome = await reconcileCpuWeek(request, WEEK, { mode: "enforce", dependencies });
  assert.equal(outcome.state, "unstable"); assert.equal(calls.rebuilds, 1);
});

test("a week with no stored projection is not divergence (derived data is built on first read)", async () => {
  const { dependencies, calls } = harness(() => v3, {});
  const diagnosis = await diagnoseCpuWeek(request, WEEK, dependencies);
  assert.equal(diagnosis.diverged, false); assert.equal(calls.rebuilds, 0);
});

test("Hub failure is an error outcome, never a rebuild from partial data", async () => {
  const { dependencies, calls } = harness(() => v3, { week: { canonicalDigest: canonicalProductionDigestSet(cancelled) } });
  dependencies.fetchHubDigest = async () => { throw new Error("Integration Hub is unavailable."); };
  const outcome = await reconcileCpuWeek(request, WEEK, { mode: "enforce", dependencies });
  assert.equal(outcome.state, "error"); assert.equal(calls.rebuilds, 0);
});

test("back-off is bounded, the window is bounded, and mode defaults to off outside hosted runtimes", () => {
  assert.equal(nextCheckDelayMs("consistent", 0), 600_000);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(n => nextCheckDelayMs("unstable", n)), [60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000]);
  assert.equal(reconciliationWeeks(new Date("2026-10-09T10:00:00Z")).length, 7);
  assert.equal(reconciliationWeeks(new Date("2026-10-09T10:00:00Z"))[2], "2026-10-05");
  assert.equal(reconciliationMode({} as never), "off"); assert.equal(reconciliationMode({ FIKA_RUNTIME_MODE: "staging" } as never), "enforce");
  assert.equal(reconciliationMode({ FIKA_RUNTIME_MODE: "staging", FIKA_CPU_PROJECTION_RECONCILIATION: "report" } as never), "report");
});

test("equal-sequence conflicting content still conflicts by default; only an authoritative canonical rebuild may replace it", () => {
  const stored = { lastChangeSequence: 9, projectionContentHash: "a".repeat(64) };
  assert.throws(() => compareMonotonicProjectionWrite(stored, { lastChangeSequence: 9, projectionContentHash: "b".repeat(64) }), (error: { code?: string }) => error.code === "CPU_PROJECTION_SEQUENCE_CONFLICT");
  assert.equal(compareMonotonicProjectionWrite(stored, { lastChangeSequence: 8, projectionContentHash: "b".repeat(64) }).status, "superseded", "a lower sequence can never overwrite");
});
