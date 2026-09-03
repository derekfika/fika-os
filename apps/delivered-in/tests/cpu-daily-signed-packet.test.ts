import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDailySignedOplocBundle,
  dailyBundleManifestKey,
  encodeDailySignedOplocBundlePackage,
} from "@fika/server-shared/daily-signed-oploc-bundle";
import { cpuDailyPacketReview, readCpuDailySignedPacket } from "../lib/cpu-daily-signed-packet";

const sourceHash = "a".repeat(64);

test("Delivered-In consumes the CPU shared daily bundle gzip package end-to-end", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fika-cpu-daily-consumer-"));
  const previous = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    const built = buildDailySignedOplocBundle({
      bundleId: "cpu-allergen:2026-09-03:oploc:haleon:r7",
      serviceDate: "2026-09-03",
      oploc: { id: "oploc:haleon", name: "Haleon" },
      source: { id: "menu-day:2026-09-03", revision: 7, contentHash: sourceHash },
      signatures: [
        { role: "production_chef", printedName: "Production Chef", signedAt: "2026-09-03T09:00:00.000Z" },
        { role: "head_chef_site_manager", printedName: "Head Chef", signedAt: "2026-09-03T09:01:00.000Z" },
      ],
      masterSheet: { fileId: "drive:master", contentHash: "b".repeat(64) },
      pdf: { fileId: "drive:pdf", url: "https://drive.google.test/pdf", contentHash: "c".repeat(64) },
      items: [{ menuItemId: "entry:1", menuItemName: "Lunch", allergens: { milk: "contains", gluten: "clear" } }],
    });
    const published = { ...built.bundle, status: "published" as const, publishedAt: "2026-09-03T09:02:00.000Z" };
    const encoded = encodeDailySignedOplocBundlePackage(published, built.packet, 1);
    await mkdir(path.join(root, "manifests"), { recursive: true });
    await mkdir(path.dirname(path.join(root, encoded.manifest.objectName)), { recursive: true });
    await writeFile(path.join(root, encoded.manifest.objectName), encoded.bytes);
    await writeFile(path.join(root, "manifests", `${dailyBundleManifestKey(published.serviceDate, published.oploc.id).replaceAll("/", "_")}.json`), JSON.stringify(encoded.manifest));

    const packet = await readCpuDailySignedPacket(published.serviceDate, published.oploc.id, sourceHash);
    assert.equal(packet?.manifest.dataset, "snapshots/cpu-production/daily-signed-oploc-bundle");
    assert.equal(packet?.manifest.compression, "gzip");
    assert.match(packet?.manifest.objectName || "", /\.json\.gz$/);
    assert.notEqual(packet?.manifest.contentHash, packet?.packet.contentHash);
    assert.ok(packet);
    assert.equal(packet.bundle.packet.objectName.endsWith(`${packet.packet.contentHash}.json`), true);
    assert.equal(packet?.sourceBundleHash, sourceHash);
    assert.equal(packet?.signedPdfUrl, "https://drive.google.test/pdf");
    assert.equal(cpuDailyPacketReview(packet!).entries.get("entry:1")?.allergens.milk, "contains");
    assert.equal(cpuDailyPacketReview(packet!).entries.get("entry:1")?.allergens.gluten, undefined);
  } finally {
    if (previous === undefined) delete process.env.FIKA_SNAPSHOT_DIR;
    else process.env.FIKA_SNAPSHOT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Delivered-In rejects a shared daily package bound to another Menu Planning source hash", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fika-cpu-daily-source-"));
  const previous = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    const built = buildDailySignedOplocBundle({
      bundleId: "cpu-allergen:2026-09-03:oploc:haleon:r8", serviceDate: "2026-09-03", oploc: { id: "oploc:haleon", name: "Haleon" }, source: { revision: 8, contentHash: sourceHash },
      signatures: [{ role: "production_chef", printedName: "Production Chef", signedAt: "2026-09-03T09:00:00.000Z" }, { role: "head_chef_site_manager", printedName: "Head Chef", signedAt: "2026-09-03T09:01:00.000Z" }],
      masterSheet: { fileId: "drive:master", contentHash: "b".repeat(64) }, pdf: { fileId: "drive:pdf", url: "https://drive.google.test/pdf", contentHash: "c".repeat(64) }, items: [{ menuItemId: "entry:1", menuItemName: "Lunch", allergens: { milk: "contains" } }],
    });
    const published = { ...built.bundle, status: "published" as const, publishedAt: "2026-09-03T09:02:00.000Z" };
    const encoded = encodeDailySignedOplocBundlePackage(published, built.packet, 1);
    await mkdir(path.join(root, "manifests"), { recursive: true });
    await mkdir(path.dirname(path.join(root, encoded.manifest.objectName)), { recursive: true });
    await writeFile(path.join(root, encoded.manifest.objectName), encoded.bytes);
    await writeFile(path.join(root, "manifests", `${dailyBundleManifestKey(published.serviceDate, published.oploc.id).replaceAll("/", "_")}.json`), JSON.stringify(encoded.manifest));
    await assert.rejects(() => readCpuDailySignedPacket(published.serviceDate, published.oploc.id, "d".repeat(64)), /source hash/i);
  } finally {
    if (previous === undefined) delete process.env.FIKA_SNAPSHOT_DIR;
    else process.env.FIKA_SNAPSHOT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
