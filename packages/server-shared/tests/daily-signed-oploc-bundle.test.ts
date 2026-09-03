import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDailySignedOplocBundle,
  createDailyBundleInvalidation,
  publishDailySignedOplocBundle,
  type DailyBundleDurableStore,
} from "../src/daily-signed-oploc-bundle";

const source = { id: "cpu-plan:2026-09-03", revision: 7, contentHash: "a".repeat(64) };
const signatures = [
  { role: "production_chef" as const, printedName: "Chef One", signedAt: "2026-09-03T09:00:00.000Z", actor: "chef:1" },
  { role: "head_chef_site_manager" as const, printedName: "Chef Two", signedAt: "2026-09-03T09:05:00.000Z", actor: "chef:2" },
];
const artifact = (fileId: string, hash = "b".repeat(64)) => ({ fileId, contentHash: hash });
const items = [
  { menuItemId: "menu:1", menuItemName: "Lunch", allergens: { gluten: "contains" } },
  { menuItemId: "sub:2", menuItemName: "Sauce", allergens: { sesame: "may_contain" } },
];

function build(oploc: { id: string; name: string }, serviceDate = "2026-09-03") {
  return buildDailySignedOplocBundle({
    bundleId: `cpu:${serviceDate}:${oploc.id}`,
    serviceDate,
    oploc,
    source,
    signatures,
    masterSheet: artifact(`drive:master:${serviceDate}`),
    pdf: artifact(`drive:pdf:${serviceDate}:${oploc.id}`),
    items,
    signedAt: "2026-09-03T09:10:00.000Z",
  });
}

test("daily bundles are distinct by service day and OPLOC while sharing one source revision/hash", () => {
  const haleon = build({ id: "oploc:haleon", name: "Haleon" });
  const xchange = build({ id: "oploc:xchange", name: "FIKA Xchange" });
  const nextDay = build({ id: "oploc:haleon", name: "Haleon" }, "2026-09-04");
  assert.notEqual(haleon.bundle.bundleId, xchange.bundle.bundleId);
  assert.notEqual(haleon.bundle.bundleId, nextDay.bundle.bundleId);
  assert.equal(haleon.bundle.source.contentHash, xchange.bundle.source.contentHash);
  assert.equal(haleon.bundle.source.revision, xchange.bundle.source.revision);
});

test("the minimized packet preserves every CPU sub-item and allergen state", () => {
  const built = build({ id: "oploc:haleon", name: "Haleon" });
  assert.deepEqual(built.packet.items, [
    { menuItemId: "menu:1", menuItemName: "Lunch", allergenNames: ["gluten"], mayContainAllergenNames: [], allergenState: "contains" },
    { menuItemId: "sub:2", menuItemName: "Sauce", allergenNames: [], mayContainAllergenNames: ["sesame"], allergenState: "may_contain" },
  ]);
  assert.equal(built.packet.source.contentHash, built.bundle.source.contentHash);
  assert.equal(built.packet.contentHash, built.bundle.packet.contentHash);
});

test("publication verifies all durable bytes before writing the manifest last", async () => {
  const built = build({ id: "oploc:haleon", name: "Haleon" });
  const events: string[] = [];
  const store: DailyBundleDurableStore = {
    async putPacket() { events.push("packet"); },
    async verifyArtifact(artifactToVerify) { events.push(`verify:${artifactToVerify.fileId}`); return true; },
    async putManifest(bundle) { events.push(`manifest:${bundle.status}`); },
  };
  const published = await publishDailySignedOplocBundle(built.bundle, built.packet, built.packetBytes, store, "2026-09-03T09:20:00.000Z");
  assert.equal(published.status, "published");
  assert.equal(events.at(-1), "manifest:published");
  assert.equal(events[0], "packet");
  assert.match(events[1], /^verify:object:daily-signed-oploc-bundle\.v1:/);
  assert.deepEqual(events.slice(2, 4), ["verify:drive:master:2026-09-03", "verify:drive:pdf:2026-09-03:oploc:haleon"]);
});

test("missing PDF blocks signed status before any durable write", async () => {
  assert.throws(() => buildDailySignedOplocBundle({
    bundleId: "cpu:2026-09-03:oploc:haleon",
    serviceDate: "2026-09-03",
    oploc: { id: "oploc:haleon", name: "Haleon" },
    source,
    signatures,
    masterSheet: artifact("drive:master"),
    pdf: undefined,
    items,
  }), /pdf.*required.*signed status is blocked/i);
});

test("withdrawal preserves signed hashes in an immutable tombstone lineage", () => {
  const built = build({ id: "oploc:haleon", name: "Haleon" });
  const tombstone = createDailyBundleInvalidation(built.bundle, { kind: "withdrawn", reason: "Corrected allergen matrix", invalidatedBy: "chef:1", invalidatedAt: "2026-09-03T10:00:00.000Z" });
  assert.equal(tombstone.status, "withdrawn");
  assert.equal(tombstone.invalidation?.priorBundleId, built.bundle.bundleId);
  assert.equal(tombstone.invalidation?.priorPdfContentHash, built.bundle.pdf.contentHash);
  assert.equal(tombstone.invalidation?.priorPacketContentHash, built.bundle.packet.contentHash);
});
