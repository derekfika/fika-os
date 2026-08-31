import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { reconcileDeliveredInDay } from "../lib/delivered-in-reconciliation";
import { readDeliveredInProjection } from "../lib/delivered-in-projection-store";

const oplocId = "oploc:reconcile-test";
const serviceDate = "2026-08-24";
const sourcePublication = { publicationId: "publication:reconcile", sourceWeekId: "week:reconcile", weekCommencing: serviceDate, weekEnding: "2026-08-30", days: [{ publicationDayId: "publication-day:reconcile", sourceDayId: "source-day:reconcile", date: serviceDate, dayName: "Monday", version: 1, status: "published" as const, contentHash: "menu-hash", entries: [{ sourceEntryId: "entry:reconcile", slot: "SALAD 1", dishName: "Test salad", portions: 2, allocations: [{ destinationId: oplocId, destinationLabel: "Reconcile site", quantity: 2 }], allergens: { milk: "clear" as const } }], allergenSignoff: {} }] };
const request = { headers: new Headers() } as never;

function fetchSequence(cpuAvailable = true) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/delivered-in/access")) return new Response(JSON.stringify({ access: { email: "admin@local.fika", oplocIds: [oplocId], permissions: ["delivered_in.view"] }, sites: [{ oplocId, label: "Reconcile site" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/rolling-menu/publications")) return new Response(JSON.stringify({ publications: [sourcePublication] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/delivered-in/review") && cpuAvailable) return new Response(JSON.stringify({ status: "pending", signatures: [], entries: {} }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("unavailable", { status: 503 });
  };
}

test("reconciliation creates, then no-ops a current projection and preserves it on upstream failure", async () => {
  const root = await mkdtemp(`${tmpdir()}\\fika-delivered-in-reconcile-`);
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR; const previousFetch = globalThis.fetch;
  process.env.FIKA_SNAPSHOT_DIR = root; globalThis.fetch = fetchSequence(true) as typeof fetch;
  try {
    const created = await reconcileDeliveredInDay(request, oplocId, serviceDate); assert.equal(created.status, "created");
    const current = await reconcileDeliveredInDay(request, oplocId, serviceDate); assert.equal(current.status, "current");
    globalThis.fetch = fetchSequence(false) as typeof fetch;
    await assert.rejects(() => reconcileDeliveredInDay(request, oplocId, serviceDate));
    assert.equal((await readDeliveredInProjection(oplocId, serviceDate))?.value.projectionVersion, 1);
  } finally { globalThis.fetch = previousFetch; if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot; await rm(root, { recursive: true, force: true }); }
});
