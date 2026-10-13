import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * Historical package compatibility (AGENTS.md 5.2). A week package published before reuse bindings existed (no `authorityBindingVersion`)
 * and untouched since MUST still load: it is served as-is, made safe on the response, and never rebuilt in place at an unchanged change
 * sequence (which the monotonic publisher rightly rejects as CPU_PACKAGE_SEQUENCE_CONFLICT). An integrity-corrupt package still
 * fails closed.
 *
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/cpu-production && npx tsx --test tests/cpu-legacy-package-read.test.ts"
 */
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const snapshotDir = mkdtempSync(path.join(tmpdir(), "cpu-legacy-package-"));
process.env.FIKA_SNAPSHOT_DIR = snapshotDir;
process.env.FIKA_CPU_PLAN_STORE = "memory";
process.env.CPU_PUBLIC_BASE_URL = "http://cpu.test";
process.env.FIKA_INTERNAL_API_TOKEN = "handler-test-token";
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };

const { NextRequest } = await import("next/server");
const { buildCpuDayProjection } = await import("../lib/cpu-projection");
const { publishCpuProjectionPackage, getCpuProjectionManifest } = await import("../lib/cpu-read-package");
const { UNVERIFIED_LEGACY_ATTENTION } = await import("../lib/cpu-projection-authority");
const { canonicalProductionDigestSet } = await import("@fika/server-shared/canonical-production-digest");
const route = emulatorUp ? await import("../app/api/production/route") : undefined;

const run = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let counter = 0;
const nextWeek = () => new Date(Date.UTC(2029, 1, 5 + 7 * (++counter))).toISOString().slice(0, 10);

const order = (id: string, week: string, overrides: Record<string, unknown> = {}) => ({
  canonicalId: id, entityType: "Production Order", schemaVersion: "1", version: 2, currentRevision: 1, requirementIds: [], sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`,
  origin: "menu_planning", requiresDelivery: true, destinationOplocId: "oploc:test", destinationLabel: "Test site", serviceType: "lunch", serviceDate: week, requiredBy: `${week}T11:00:00.000Z`,
  serviceWindow: { startTime: "11:00", endTime: "12:00" }, status: "cancelled", priority: "normal", lines: [], exceptions: [], createdAt: "2026-10-08T03:20:03.396Z", createdBy: "test", audit: [], ...overrides,
});

/** Publishes a week package exactly as an older release did: the same content WITHOUT the authority-binding marker, at a fixed change sequence. */
async function publishLegacyWeek(week: string, orders: Array<ReturnType<typeof order>>, tweak: (projection: Record<string, unknown>) => void = () => undefined) {
  const built = buildCpuDayProjection("all", orders as never, [], 684, 1) as unknown as Record<string, unknown>;
  delete built.authorityBindingVersion;
  tweak(built);
  const legacy = { ...built, serviceDate: week, weekCommencing: week, canonicalDigest: canonicalProductionDigestSet(orders as never) };
  return publishCpuProjectionPackage(legacy as never);
}
const loadWeek = async (week: string) => {
  const response = await route!.GET(new NextRequest(`http://localhost:3400/api/production?projection=1&weekCommencing=${week}&scope=all`, { method: "GET" }));
  return { status: response.status, body: await response.json() as { projection?: { orders: Array<Record<string, unknown>>; authorityBindingVersion?: number }; package?: { packageVersion?: number }; error?: { code?: string } } };
};

test("a legacy (pre-binding) week package with no changes since still loads: no sequence conflict, no in-place rebuild", opts, async () => {
  const week = nextWeek();
  const manifest = await publishLegacyWeek(week, [order(`production-order:v1:menu-planning:${run}:1`, week)]);
  const before = (await getCpuProjectionManifest(week, week))?.packageVersion ?? manifest.packageVersion;
  const result = await loadWeek(week);
  assert.equal(result.status, 200, JSON.stringify(result.body.error));
  assert.notEqual(result.body.error?.code, "CPU_PACKAGE_SEQUENCE_CONFLICT");
  assert.ok(result.body.projection, "the legacy projection is served");
  const after = (await getCpuProjectionManifest(week, week))?.packageVersion;
  assert.equal(after, before, "the package was not republished in place at the unchanged sequence");
  // loading again is stable (no write, no conflict on any later read)
  const again = await loadWeek(week);
  assert.equal(again.status, 200);
  assert.equal((await getCpuProjectionManifest(week, week))?.packageVersion, before);
});

test("a legacy package's Hospitality Planned entries are never trusted: they are downgraded on the response", opts, async () => {
  const week = nextWeek();
  const hospitality = order(`production-order:v1:booking:mnk:${run}:h`, week, { origin: "hospitality_booking", status: "accepted", version: 3 });
  await publishLegacyWeek(week, [hospitality], projection => {
    const orders = projection.orders as Array<Record<string, unknown>>;
    for (const entry of orders) { entry.workflowStatus = "planned"; entry.planningReadiness = "ready"; entry.allergenReadiness = "ready"; }
  });
  const result = await loadWeek(week);
  assert.equal(result.status, 200, JSON.stringify(result.body.error));
  const entry = result.body.projection!.orders[0];
  assert.notEqual(entry.workflowStatus, "planned", "an unverifiable legacy Planned entry is not shown as Planned");
  assert.equal(JSON.stringify(entry).includes(UNVERIFIED_LEGACY_ATTENTION), true, "it carries the unverified-legacy attention text");
});

test("an integrity-corrupt legacy package still fails closed (503) and is not silently rebuilt", opts, async () => {
  const week = nextWeek();
  const manifest = await publishLegacyWeek(week, [order(`production-order:v1:menu-planning:${run}:c`, week)]);
  writeFileSync(path.join(snapshotDir, manifest.objectName), Buffer.from("corrupted package bytes"));
  const result = await loadWeek(week);
  assert.equal(result.status, 503);
  assert.equal(result.body.error?.code, "CPU_PROJECTION_PACKAGE_INTEGRITY_FAILURE");
  assert.equal((await getCpuProjectionManifest(week, week))?.packageVersion, manifest.packageVersion, "no self-healing rebuild after an integrity failure");
});
