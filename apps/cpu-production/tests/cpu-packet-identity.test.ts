import assert from "node:assert/strict";
import test from "node:test";
import { buildDailySignedOplocBundle } from "@fika/server-shared/daily-signed-oploc-bundle";
import { allergenMatrixContentHash } from "../lib/cpu-allergen-release";
import { buildCpuPacketItems } from "../lib/cpu-packet-identity";
import type { PlannedMenuItem } from "../app/lib/production-plan";
import type { ProductionOrder } from "../lib/production-types";

const sourceHash = "a".repeat(64);
const line = (index: number, overrides: Record<string, unknown> = {}) => ({
  canonicalId: `production-line:order:${index}`,
  sourceBookingLineId: `menu-entry:order:${index}`,
  sourceMenuItemId: `menu-item:local:dish-${index}`,
  itemName: `Dish ${index}`,
  ...overrides,
});
const order = (origin: ProductionOrder["origin"], lines: unknown[]) => ({ canonicalId: "production-order:identity-test", origin, lines } as unknown as ProductionOrder);
const item = (index: number, sourceLineId = `production-line:order:${index}`): PlannedMenuItem => ({
  id: `planned-item:${index}`,
  sourceLineId,
  name: `Dish ${index}`,
  note: "",
  subItems: [
    { id: `sub:${index}:main`, name: `Dish ${index}`, quantity: 1, allergens: { milk: "contains" }, note: "", evidenceStatus: "completed" },
    { id: `sub:${index}:side`, name: `Dish ${index} side`, quantity: 1, allergens: { milk: "clear" }, note: "", evidenceStatus: "completed" },
  ],
});

test("Menu Planning packet identity prefers authoritative sourceMenuItemId over production line identity", () => {
  const lines = [line(1), line(2)];
  const menuItems = [item(1), item(2)];
  const before = structuredClone({ lines, menuItems });
  const packetItems = buildCpuPacketItems(menuItems, order("menu_planning", lines));

  assert.deepEqual(packetItems.map(candidate => candidate.menuItemId), [
    "menu-item:local:dish-1",
    "menu-item:local:dish-1:sub:sub:1:side",
    "menu-item:local:dish-2",
    "menu-item:local:dish-2:sub:sub:2:side",
  ]);
  assert.deepEqual({ lines, menuItems }, before);
  assert.equal(allergenMatrixContentHash(menuItems), allergenMatrixContentHash(before.menuItems));
});

test("packet identity falls back to source booking line, then legacy deterministic identities", () => {
  const menuFallback = buildCpuPacketItems([item(1)], order("menu_planning", [line(1, { sourceMenuItemId: undefined })]));
  assert.equal(menuFallback[0].menuItemId, "menu-entry:order:1");

  const legacy = buildCpuPacketItems([item(1)], order("legacy_import", [line(1)]));
  assert.equal(legacy[0].menuItemId, "menu-entry:order:1");

  const missingLineage = buildCpuPacketItems([{ ...item(1), sourceLineId: undefined }], order("cpu_created", [line(1)]));
  assert.equal(missingLineage[0].menuItemId, "menu-entry:order:1");

  const unknownLineage = buildCpuPacketItems([item(1, "old-plan-line:1")], order("menu_planning", [line(1)]));
  assert.equal(unknownLineage[0].menuItemId, "old-plan-line:1");
});

test("the canonical identity is what the signed packet publishes without changing source lineage or signatures", () => {
  const menuItems = [item(1)];
  const productionOrder = order("menu_planning", [line(1)]);
  const signatures = [
    { role: "production_chef" as const, printedName: "Production Chef", signedAt: "2026-09-14T08:00:00.000Z", signatureDataUrl: "data:image/png;base64,chef" },
    { role: "head_chef_site_manager" as const, printedName: "Head Chef", signedAt: "2026-09-14T08:01:00.000Z", signatureDataUrl: "data:image/png;base64:manager" },
  ];
  const built = buildDailySignedOplocBundle({
    bundleId: "cpu-allergen:identity-test",
    serviceDate: "2026-09-14",
    oploc: { id: "oploc:test", name: "Identity Test" },
    source: { id: productionOrder.canonicalId, revision: 8, contentHash: sourceHash },
    signatures,
    masterSheet: { fileId: "drive:master", contentHash: "b".repeat(64) },
    pdf: { fileId: "drive:pdf", contentHash: "c".repeat(64), url: "https://drive.example/pdf" },
    items: buildCpuPacketItems(menuItems, productionOrder),
    signedAt: "2026-09-14T08:02:00.000Z",
  });

  assert.equal(built.packet.items[0].menuItemId, "menu-item:local:dish-1");
  assert.deepEqual(built.bundle.source, { id: productionOrder.canonicalId, revision: 8, contentHash: sourceHash });
  assert.deepEqual(built.bundle.signatures, signatures);
  assert.equal(built.packet.contentHash.length, 64);
});
