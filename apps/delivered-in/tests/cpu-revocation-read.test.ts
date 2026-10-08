import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildDailySignedOplocBundle, dailyBundleManifestKey, encodeDailySignedOplocBundlePackage } from "@fika/server-shared/daily-signed-oploc-bundle";
import { encodeReadPackage } from "@fika/server-shared/read-package";
import { readCpuDailySignedPacket } from "../lib/cpu-daily-signed-packet";
import { beginCpuReleaseReceipt, completeCpuReleaseReceipt, resetCpuReleaseReceiptsForTests, type CpuReleaseEventIdentity } from "../lib/cpu-release-receipts";
import { projectionManifestKey, readDeliveredInProjection } from "../lib/delivered-in-projection-store";

const date = "2026-10-19", site = "oploc:owned", sourceHash = "a".repeat(64);
const releaseId = (version: number) => `cpu-allergen-release:${date}:publication:owned:v${version}`;
const bundleId = (version: number) => `cpu-allergen:${date}:${site}:${releaseId(version)}`;

test("revocation blocks intact signed packets and cached projections before reconciliation; replacement stays independent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fika-revocation-read-"));
  const previous = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  resetCpuReleaseReceiptsForTests();
  const save = async (key: string, encoded: ReturnType<typeof encodeReadPackage>) => {
    await mkdir(path.join(root, "manifests"), { recursive: true });
    await mkdir(path.dirname(path.join(root, encoded.manifest.objectName)), { recursive: true });
    await writeFile(path.join(root, encoded.manifest.objectName), encoded.bytes);
    await writeFile(path.join(root, "manifests", `${key.replaceAll("/", "_")}.json`), JSON.stringify(encoded.manifest));
  };
  const packet = (version: number) => {
    const built = buildDailySignedOplocBundle({ bundleId: bundleId(version), serviceDate: date, oploc: { id: site, name: "Owned site" }, source: { id: "order:owned", revision: 1, contentHash: sourceHash }, signatures: [{ role: "production_chef", printedName: "UAT CHEF", signedAt: `${date}T08:00:00Z` }, { role: "head_chef_site_manager", printedName: "UAT MANAGER", signedAt: `${date}T08:01:00Z` }], masterSheet: { fileId: "master:owned", contentHash: "b".repeat(64) }, pdf: { fileId: `pdf:${version}`, url: `https://example.test/pdf/${version}`, contentHash: "c".repeat(64) }, items: [{ menuItemId: "entry:owned", menuItemName: "Owned salad", allergens: { milk: "contains", tree_nuts: "may_contain" } }] });
    return encodeDailySignedOplocBundlePackage({ ...built.bundle, status: "published", publishedAt: `${date}T08:02:00Z` }, built.packet, version);
  };
  const eventId = `cpu-allergen-release:${releaseId(1)}:revoked`;
  const revocation: CpuReleaseEventIdentity = { eventId, deliveryId: `${eventId}:delivered-in:${site}`, eventType: "revoked", releaseId: releaseId(1), releaseVersion: "v1", oplocId: site, serviceDate: date, sourceDayId: "day:owned", sourcePublicationDayId: "publication:owned", sourceVersion: 1, sourceContentHash: sourceHash, packetContentHash: "d".repeat(64) };
  try {
    const original = packet(1);
    await save(dailyBundleManifestKey(date, site), original);
    const projection = { projectionId: "projection:owned", projectionVersion: 1, contractVersion: "delivered-in.day.v1", oplocId: site, serviceDate: date, entries: [], sourceLineage: { cpu: { releaseId: bundleId(1) } }, state: { cpu: "present" } };
    const cached = encodeReadPackage("delivered-in/day", 1, projection, 0, { contractVersion: "delivered-in.day.v1", scope: `${site}:${date}` });
    await save(projectionManifestKey(site, date), cached);
    assert.ok(await readCpuDailySignedPacket(date, site, sourceHash));
    assert.ok(await readDeliveredInProjection(site, date));
    assert.equal((await beginCpuReleaseReceipt(revocation)).status, "claimed");
    // The processing receipt exists before the revoked event rebuilds any projection.
    assert.equal(await readCpuDailySignedPacket(date, site, sourceHash), undefined);
    assert.equal(await readDeliveredInProjection(site, date), undefined);
    await completeCpuReleaseReceipt(revocation, { result: "applied" });
    assert.equal(await readCpuDailySignedPacket(date, site, sourceHash), undefined);
    assert.deepEqual(await readFile(path.join(root, original.manifest.objectName)), Buffer.from(original.bytes));
    assert.deepEqual(await readFile(path.join(root, cached.manifest.objectName)), Buffer.from(cached.bytes));
    // A newer independently signed release is not revoked by the old receipt.
    await save(dailyBundleManifestKey(date, site), packet(2));
    assert.equal((await readCpuDailySignedPacket(date, site, sourceHash))?.bundle.bundleId, bundleId(2));
    // A later published head must not make an old revoked package authoritative again.
    const published = { ...revocation, eventType: "published" as const, releaseId: releaseId(2), releaseVersion: "v2", eventId: "published:2", deliveryId: "published:2" };
    await beginCpuReleaseReceipt(published); await completeCpuReleaseReceipt(published, { result: "applied" });
    await save(dailyBundleManifestKey(date, site), original);
    assert.equal(await readCpuDailySignedPacket(date, site, sourceHash), undefined);
    const corrupt = Buffer.from(original.bytes); corrupt[corrupt.length - 1] ^= 1;
    await writeFile(path.join(root, original.manifest.objectName), corrupt);
    await assert.rejects(readCpuDailySignedPacket(date, site, sourceHash), /integrity/);
  } finally {
    resetCpuReleaseReceiptsForTests();
    if (previous === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("hosted revocation lookup uses two known receipt IDs and fails closed on read or scope errors", async () => {
  const require = createRequire(import.meta.url), appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { typescriptLoader } = require("../../../scripts/testing/load-typescript.cjs");
  const requested: string[] = [];
  let readFailure = false, wrongScope = false;
  const db = { collection: (collection: string) => { assert.equal(collection, "fikaDeliveredInCpuReleaseReceiptsV1"); return { doc: (id: string) => id }; }, getAll: async (...ids: string[]) => {
    requested.push(...ids);
    if (readFailure) throw new Error("isolated receipt authority unavailable");
    return ids.map((_, index) => ({ exists: index === 1, data: () => ({ eventType: "revoked", releaseId: releaseId(1), serviceDate: date, oplocId: wrongScope ? "oploc:other" : site }) }));
  } };
  const load = typescriptLoader({ typescript: require("typescript"), appRoot, mocks: { [path.resolve(appRoot, "lib/firebase-admin.ts")]: { db }, "@fika/server-shared/data-source-meter-server": { recordDataAccess() {} } } });
  const receipts = load(path.resolve(appRoot, "lib/cpu-release-receipts.ts"));
  const previous = process.env.FIKA_RUNTIME_MODE; process.env.FIKA_RUNTIME_MODE = "staging";
  try {
    assert.equal(await receipts.cpuSignedBundleIsRevoked(site, date, bundleId(1)), true);
    assert.equal(requested.length, 2); assert.equal(new Set(requested).size, 2);
    assert.ok(requested.every(id => /^[a-f0-9]{64}$/.test(id)));
    readFailure = true;
    await assert.rejects(receipts.cpuSignedBundleIsRevoked(site, date, bundleId(1)), /authority unavailable/);
    readFailure = false; wrongScope = true;
    await assert.rejects(receipts.cpuSignedBundleIsRevoked(site, date, bundleId(1)), (error: any) => error.status === 503 && error.code === "CPU_RELEASE_REVOCATION_INVALID");
  } finally { if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previous; }
});
