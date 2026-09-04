import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { buildDailySignedOplocBundle, assertDailyAllergenPacket } from "@fika/server-shared/daily-signed-oploc-bundle";
import { buildCpuAllergenRelease, revokeCpuAllergenRelease } from "../../cpu-production/lib/cpu-allergen-release";
import { buildCpuAllergenReleaseEvent } from "../../cpu-production/lib/cpu-consumer-invalidation";
import { acknowledgeSafetyState, publishSafetyState, revokeSafetyState, type AllergenSafetyState } from "../lib/allergen-safety-state";

const date = "2026-09-07";
const siteA = "oploc:site-a";
const siteB = "oploc:site-b";
const source = { sourceDayId: "menu-day:2026-09-07", sourcePublicationDayId: "menu-publication-day:v7", sourceVersion: 7, sourceContentHash: "a".repeat(64) };
const signatures = [
  { role: "production_chef" as const, printedName: "Chef One", signedAt: "2026-09-07T08:00:00Z", actor: "person:one", attestation: "reviewed" },
  { role: "head_chef_site_manager" as const, printedName: "Chef Two", signedAt: "2026-09-07T08:01:00Z", actor: "person:two", attestation: "reviewed" },
];
const item = (allergen: string) => ({ id: "dish:salad", name: "Salad A", note: "", subItems: [{ id: "sub:salad", name: "Salad A", quantity: 1, allergens: { sulphites: allergen as "clear" | "contains" | "may_contain" }, note: "", evidenceStatus: "completed" as const }] });
const artifact = (id: string, hash = "b".repeat(64)) => ({ id, bookingId: "booking:1", fileName: `${id}.pdf`, createdAt: "2026-09-07T08:00:00Z", createdBy: "person:one", contentHash: hash, pdfStatus: "generated" as const, driveFileId: `drive:${id}`, driveStatus: "saved" as const });
const release = (version: number, allergen: string, previous?: ReturnType<typeof buildCpuAllergenRelease>) => buildCpuAllergenRelease({ serviceDate: date, ...source, version, signedAt: `2026-09-07T08:0${version}:00Z`, signatures, items: [item(allergen)], masterArtifact: artifact(`master-v${version}`), derivedArtifacts: [artifact(`site-v${version}`)], packetArtifacts: [artifact(`packet-v${version}`, `${String(version).repeat(64)}`)], ...(previous ? { previous } : {}) });

function packetFor(version: number, allergen: string) {
  const hash = `${String(version).repeat(64)}`;
  return buildDailySignedOplocBundle({
    bundleId: `bundle:${date}:v${version}`, serviceDate: date, oploc: { id: siteA, name: "Site A" }, source: { revision: version, contentHash: hash, id: source.sourceDayId }, signatures,
    masterSheet: { contentHash: hash, fileId: `master:${version}` }, pdf: { contentHash: hash, fileId: `pdf:${version}`, url: `https://example.test/pdf/${version}` }, packetArtifact: { fileId: `packet:${version}`, objectName: `packet/${version}.json` },
    items: [{ menuItemId: "dish:salad:sub:salad", menuItemName: "Salad A", allergens: { sulphites: allergen } }], signedAt: `2026-09-07T08:0${version}:00Z`, supersedesBundleId: version > 1 ? `bundle:${date}:v${version - 1}` : undefined,
  });
}

test("isolated signed allergen release lifecycle is replay-safe and fail-closed", () => {
  const root = mkdtempSync(join(tmpdir(), "fika-allergen-lifecycle-"));
  const database = new DatabaseSync(join(root, "lifecycle.sqlite"));
  database.exec("CREATE TABLE events (event_id TEXT PRIMARY KEY); CREATE TABLE safety (site_id TEXT, service_date TEXT, release_version TEXT, value TEXT, PRIMARY KEY(site_id, service_date, release_version)); CREATE TABLE menus (site_id TEXT PRIMARY KEY, release_version TEXT, status TEXT, regenerations INTEGER)");
  const readState = (siteId: string, version: string) => { const row = database.prepare("SELECT value FROM safety WHERE site_id = ? AND service_date = ? AND release_version = ?").get(siteId, date, version) as { value?: string } | undefined; return row?.value ? JSON.parse(row.value) as AllergenSafetyState : undefined; };
  const saveState = (state: AllergenSafetyState) => database.prepare("INSERT OR REPLACE INTO safety VALUES (?, ?, ?, ?)").run(state.siteId, state.serviceDate, state.releaseVersion, JSON.stringify(state));
  const apply = (event: ReturnType<typeof buildCpuAllergenReleaseEvent>, allocated: string[]) => {
    const replay = database.prepare("INSERT OR IGNORE INTO events VALUES (?)").run(event.eventId);
    if (Number(replay.changes) === 0) return "replayed";
    const current = readState(siteA, event.releaseVersion);
    if (event.eventType === "revoked") {
      if (current) saveState(revokeSafetyState(current, event.invalidatedAt || "2026-09-07T09:00:00Z"));
      database.prepare("UPDATE menus SET status = 'withdrawn' WHERE site_id = ? AND release_version = ?").run(siteA, event.releaseVersion);
      return "revoked";
    }
    const affected = event.changedDishIds.some(id => allocated.includes(id));
    const previous = [...database.prepare("SELECT release_version FROM menus WHERE site_id = ?").all(siteA) as Array<{ release_version: string }>][0];
    const shouldGenerate = affected || !previous;
    const next = publishSafetyState({ siteId: siteA, serviceDate: date, releaseId: event.releaseId, releaseVersion: event.releaseVersion, releaseHash: event.packetContentHash, previousReleaseId: previous ? `release:${previous.release_version}` : undefined, previousReleaseVersion: previous?.release_version, delta: event.delta, regenerated: shouldGenerate, updatedAt: "2026-09-07T10:00:00Z" });
    saveState(next);
    database.prepare("INSERT OR REPLACE INTO menus VALUES (?, ?, ?, COALESCE((SELECT regenerations FROM menus WHERE site_id = ?), 0) + ?)").run(siteA, event.releaseVersion, "current", siteA, shouldGenerate ? 1 : 0);
    return shouldGenerate ? "regenerated" : "unchanged";
  };
  try {
    const v1 = release(1, "clear");
    const p1 = packetFor(1, "clear");
    assertDailyAllergenPacket(p1.packet);
    const e1 = buildCpuAllergenReleaseEvent({ release: v1, oplocId: siteA, eventType: "published" });
    assert.deepEqual({ sourceDayId: e1.sourceDayId, sourcePublicationDayId: e1.sourcePublicationDayId, sourceVersion: e1.sourceVersion, sourceContentHash: e1.sourceContentHash }, source);
    assert.equal(apply(e1, []), "regenerated");
    database.prepare("INSERT INTO menus VALUES (?, ?, 'current', 1)").run(siteB, "v1");

    const v1Revoked = revokeCpuAllergenRelease(v1, { at: "2026-09-07T09:00:00Z", by: "person:one", reason: "Allergen correction" });
    assert.equal(v1Revoked.signatures.every(signature => !signature.valid), true);
    assert.equal(apply(buildCpuAllergenReleaseEvent({ release: v1Revoked, oplocId: siteA, eventType: "revoked" }), []), "revoked");
    assert.equal(readState(siteA, "v1")?.releaseStatus, "revoked_pending");
    assert.equal(readState(siteA, "v1")?.menuStatus, "withdrawn");
    assert.throws(() => acknowledgeSafetyState(readState(siteA, "v1")!, "person:one", "2026-09-07T09:01:00Z"));

    const v2 = release(2, "contains", v1);
    const p2 = packetFor(2, "contains");
    assertDailyAllergenPacket(p2.packet);
    assert.equal(p2.packet.contentHash, p2.bundle.packet.contentHash);
    const e2 = buildCpuAllergenReleaseEvent({ release: v2, oplocId: siteA, eventType: "published" });
    assert.deepEqual(v2.deltaFromPrevious, [{ menuItemId: "dish:salad:sub:salad", dishName: "Salad A", allergen: "sulphites", previously: "clear", now: "contains" }]);
    assert.equal(apply(e2, ["dish:salad:sub:salad"]), "regenerated");
    assert.equal(readState(siteA, "v2")?.reprintRequired, true);
    assert.deepEqual(readState(siteA, "v2")?.delta, v2.deltaFromPrevious);
    const ack = acknowledgeSafetyState(readState(siteA, "v2")!, "person:one", "2026-09-07T10:01:00Z");
    saveState(ack);
    assert.equal(readState(siteA, "v2")?.acknowledgement?.releaseVersion, "v2");
    assert.equal(readState(siteA, "v2")?.reprintRequired, true);

    const v3 = release(3, "may_contain", v2);
    const v3Revoked = revokeCpuAllergenRelease(v2, { at: "2026-09-07T11:00:00Z", by: "person:one", reason: "Further correction" });
    apply(buildCpuAllergenReleaseEvent({ release: v3Revoked, oplocId: siteA, eventType: "revoked" }), []);
    apply(buildCpuAllergenReleaseEvent({ release: v3, oplocId: siteA, eventType: "published" }), ["dish:salad:sub:salad"]);
    assert.equal(readState(siteA, "v3")?.acknowledgement, undefined);
    assert.equal(readState(siteA, "v3")?.reprintRequired, true);
    assert.equal((database.prepare("SELECT status FROM menus WHERE site_id = ?").get(siteB) as { status: string }).status, "current");
    assert.equal(apply(e2, ["dish:salad:sub:salad"]), "replayed");
    assert.throws(() => assertDailyAllergenPacket({ ...p2.packet, contentHash: "f".repeat(64) }));
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
