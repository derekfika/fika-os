import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { reconcileDeliveredInDay } from "../lib/delivered-in-reconciliation";
import { markDeliveredInProjectionDayUnavailable, readDeliveredInProjection, readDeliveredInProjectionIndex } from "../lib/delivered-in-projection-store";
import type { MenuPlanningWeekPacket } from "../lib/menu-planning-week-packet";

const oplocId = "oploc:reconcile-test";
const serviceDate = "2026-08-24";
const sourcePublication = { publicationId: "publication:reconcile", sourceWeekId: "week:reconcile", weekCommencing: serviceDate, weekEnding: "2026-08-30", days: [{ publicationDayId: "publication-day:reconcile", sourceDayId: "source-day:reconcile", date: serviceDate, dayName: "Monday", version: 1, status: "published" as const, contentHash: "menu-hash", entries: [{ sourceEntryId: "entry:reconcile", slot: "SALAD 1", dishName: "Test salad", portions: 2, allocations: [{ destinationId: oplocId, destinationLabel: "Reconcile site", quantity: 2 }], allergens: { milk: "clear" as const } }], allergenSignoff: {} }] };
const request = { headers: new Headers() } as never;

function fetchSequence(cpuAvailable = true) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/delivered-in/access")) return new Response(JSON.stringify({ access: { email: "admin@local.fika", oplocIds: [oplocId], permissions: ["delivered_in.view"] }, sites: [{ oplocId, label: "Reconcile site" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/rolling-menu/publications")) return cpuAvailable
      ? new Response(JSON.stringify({ publications: [sourcePublication] }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("unavailable", { status: 503 });
    return new Response("unavailable", { status: 503 });
  };
}

function authoritativeSource() {
  return async () => {
    const response = await fetch("/api/rolling-menu/publications");
    if (!response.ok) throw Object.assign(new Error("Menu Planning publication service is unavailable."), { status: response.status, code: "MENU_SOURCE_UNAVAILABLE" });
    return [sourcePublication];
  };
}

const maintenanceReview = async () => ({ entries: new Map(), cpuReview: { status: "signed" as const, signatures: [] }, orderIds: [], package: undefined });

const menuPacket: MenuPlanningWeekPacket = {
  schemaVersion: 1,
  publicationId: sourcePublication.publicationId,
  sourceWeekId: sourcePublication.sourceWeekId,
  week: { weekCommencing: serviceDate, weekEnding: sourcePublication.weekEnding },
  days: sourcePublication.days.map(day => ({ ...day, entries: day.entries.map(entry => ({ ...entry, portions: entry.allocations.reduce((total, allocation) => total + allocation.quantity, 0) })) })),
};

test("bounded internal reconciliation uses the immutable Menu packet without a browser cookie", async () => {
  const root = await mkdtemp(`${tmpdir()}\\fika-delivered-in-internal-reconcile-`);
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR; const previousFetch = globalThis.fetch;
  process.env.FIKA_SNAPSHOT_DIR = root;
  globalThis.fetch = (async () => { throw new Error("interactive access must not be called"); }) as typeof fetch;
  try {
    const result = await reconcileDeliveredInDay(request, oplocId, serviceDate, {
      readMenuPackets: async () => [menuPacket],
      loadReview: maintenanceReview,
      reconciliationContext: { mode: "internal", oplocId, serviceDate },
    });
    assert.equal(result.status, "created");
    assert.equal(result.projection?.oplocLabel, "oploc:reconcile-test");
  } finally {
    globalThis.fetch = previousFetch; if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded internal reconciliation fails closed instead of using interactive Menu fallback", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("interactive access must not be called"); }) as typeof fetch;
  try {
    await assert.rejects(() => reconcileDeliveredInDay(request, oplocId, serviceDate, {
      readMenuPackets: async () => [],
      reconciliationContext: { mode: "internal", oplocId, serviceDate },
    }), (error: unknown) => {
      const value = error as { status?: number; code?: string };
      return value.status === 503 && value.code === "MENU_SOURCE_UNAVAILABLE";
    });
  } finally { globalThis.fetch = previousFetch; }
});

test("bounded internal reconciliation cannot broaden beyond its supplied OPLOC and service date", async () => {
  await assert.rejects(() => reconcileDeliveredInDay(request, oplocId, serviceDate, {
    reconciliationContext: { mode: "internal", oplocId: "oploc:other", serviceDate },
  }), (error: unknown) => {
    const value = error as { status?: number; code?: string };
    return value.status === 409 && value.code === "DELIVERED_IN_RECONCILIATION_SCOPE_MISMATCH";
  });
});

test("interactive reconciliation still resolves normal session access", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "FIKA_SESSION_MISSING", message: "Your FIKA OS session is missing or has expired." } }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await assert.rejects(() => reconcileDeliveredInDay(request, oplocId, serviceDate, { readMenuPackets: async () => [menuPacket] }), (error: unknown) => (error as { status?: number; code?: string }).status === 401 && (error as { code?: string }).code === "FIKA_SESSION_MISSING");
  } finally { globalThis.fetch = previousFetch; }
});

test("reconciliation creates, then no-ops a current projection and preserves it on upstream failure", async () => {
  const root = await mkdtemp(`${tmpdir()}\\fika-delivered-in-reconcile-`);
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR; const previousFetch = globalThis.fetch;
  process.env.FIKA_SNAPSHOT_DIR = root; globalThis.fetch = fetchSequence(true) as typeof fetch;
  try {
    const sources = { readMenuPackets: async () => [], readAuthoritativePublications: authoritativeSource(), loadReview: maintenanceReview };
    const created = await reconcileDeliveredInDay(request, oplocId, serviceDate, sources); assert.equal(created.status, "created");
    const current = await reconcileDeliveredInDay(request, oplocId, serviceDate, sources); assert.equal(current.status, "current");
    globalThis.fetch = fetchSequence(false) as typeof fetch;
    await assert.rejects(() => reconcileDeliveredInDay(request, oplocId, serviceDate, { ...sources, loadReview: async () => { throw new Error("CPU packet unavailable"); } }));
    assert.equal((await readDeliveredInProjection(oplocId, serviceDate))?.value.projectionVersion, 1);
  } finally { globalThis.fetch = previousFetch; if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot; await rm(root, { recursive: true, force: true }); }
});

test("an omitted packet day falls back to authoritative Menu, restores availability, and keeps CPU failure degraded", async () => {
  const root = await mkdtemp(`${tmpdir()}\\fika-delivered-in-omitted-day-`);
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR; const previousFetch = globalThis.fetch;
  process.env.FIKA_SNAPSHOT_DIR = root; globalThis.fetch = fetchSequence(true) as typeof fetch;
  let authoritativeCalls = 0;
  const packet: MenuPlanningWeekPacket = { schemaVersion: 1, publicationId: sourcePublication.publicationId, sourceWeekId: sourcePublication.sourceWeekId, week: { weekCommencing: serviceDate, weekEnding: sourcePublication.weekEnding }, days: [] };
  try {
    await markDeliveredInProjectionDayUnavailable({ oplocId, serviceDate, weekCommencing: serviceDate });
    const result = await reconcileDeliveredInDay(request, oplocId, serviceDate, {
      readMenuPackets: async () => [packet],
      readAuthoritativePublications: async () => { authoritativeCalls += 1; return [sourcePublication]; },
      loadReview: async () => { throw Object.assign(new Error("CPU review lineage mismatch"), { code: "CPU_REVIEW_LINEAGE_MISMATCH" }); },
    });
    assert.equal(authoritativeCalls, 1);
    assert.equal(result.status, "created");
    assert.equal(result.projection?.state.freshness, "current");
    assert.equal(result.projection?.state.completeness, "complete");
    assert.equal(result.projection?.state.menu, "present");
    assert.equal(result.projection?.state.cpu, "unavailable");
    assert.equal(result.projection?.state.exceptions.some(exception => exception.code === "CPU_REVIEW_LINEAGE_MISMATCH"), true);
    const index = await readDeliveredInProjectionIndex(oplocId);
    assert.equal(index?.value.entries.find(entry => entry.serviceDate === serviceDate)?.completeness, "complete");
  } finally {
    globalThis.fetch = previousFetch; if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("authoritative withdrawal is distinct from packet omission", async () => {
  const root = await mkdtemp(`${tmpdir()}\\fika-delivered-in-withdrawn-day-`);
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR; const previousFetch = globalThis.fetch;
  process.env.FIKA_SNAPSHOT_DIR = root; globalThis.fetch = fetchSequence(true) as typeof fetch;
  const withdrawn = { ...sourcePublication, days: [{ ...sourcePublication.days[0], version: 2, status: "withdrawn" as const }] };
  try {
    const result = await reconcileDeliveredInDay(request, oplocId, serviceDate, {
      readMenuPackets: async () => [({ schemaVersion: 1, publicationId: sourcePublication.publicationId, sourceWeekId: sourcePublication.sourceWeekId, week: { weekCommencing: serviceDate, weekEnding: sourcePublication.weekEnding }, days: [] } as MenuPlanningWeekPacket)],
      readAuthoritativePublications: async () => [withdrawn],
    });
    assert.equal(result.status, "withdrawn");
    assert.equal((await readDeliveredInProjectionIndex(oplocId))?.value.entries.find(entry => entry.serviceDate === serviceDate)?.state, "withdrawn");
  } finally {
    globalThis.fetch = previousFetch; if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("authoritative Menu failure leaves an unavailable day unavailable and never withdraws it", async () => {
  const root = await mkdtemp(`${tmpdir()}\\fika-delivered-in-unavailable-day-`);
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR; const previousFetch = globalThis.fetch;
  process.env.FIKA_SNAPSHOT_DIR = root; globalThis.fetch = fetchSequence(true) as typeof fetch;
  try {
    await markDeliveredInProjectionDayUnavailable({ oplocId, serviceDate, weekCommencing: serviceDate });
    await assert.rejects(() => reconcileDeliveredInDay(request, oplocId, serviceDate, {
      readMenuPackets: async () => [({ schemaVersion: 1, publicationId: sourcePublication.publicationId, sourceWeekId: sourcePublication.sourceWeekId, week: { weekCommencing: serviceDate, weekEnding: sourcePublication.weekEnding }, days: [] } as MenuPlanningWeekPacket)],
      readAuthoritativePublications: async () => { throw Object.assign(new Error("Menu Planning unavailable"), { code: "MENU_SOURCE_UNAVAILABLE", status: 503 }); },
    }));
    const entry = (await readDeliveredInProjectionIndex(oplocId))?.value.entries.find(candidate => candidate.serviceDate === serviceDate);
    assert.equal(entry?.completeness, "unavailable");
    assert.notEqual(entry?.state, "withdrawn");
  } finally {
    globalThis.fetch = previousFetch; if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("a healthy packet day does not perform authoritative fallback", async () => {
  const root = await mkdtemp(`${tmpdir()}\\fika-delivered-in-healthy-packet-`);
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR; const previousFetch = globalThis.fetch;
  process.env.FIKA_SNAPSHOT_DIR = root; globalThis.fetch = fetchSequence(true) as typeof fetch;
  let authoritativeCalls = 0;
  const packet: MenuPlanningWeekPacket = { schemaVersion: 1, publicationId: sourcePublication.publicationId, sourceWeekId: sourcePublication.sourceWeekId, week: { weekCommencing: serviceDate, weekEnding: sourcePublication.weekEnding }, days: sourcePublication.days.map(day => ({ ...day, entries: day.entries.map(entry => ({ ...entry, portions: entry.portions })) })) };
  try {
    const result = await reconcileDeliveredInDay(request, oplocId, serviceDate, {
      readMenuPackets: async () => [packet],
      readAuthoritativePublications: async () => { authoritativeCalls += 1; return []; },
      loadReview: maintenanceReview,
    });
    assert.equal(result.status, "created");
    assert.equal(authoritativeCalls, 0);
  } finally {
    globalThis.fetch = previousFetch; if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
