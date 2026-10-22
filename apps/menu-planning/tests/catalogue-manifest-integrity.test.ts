import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Firestore } from "@google-cloud/firestore";
import type { ReadPackageStore } from "@fika/server-shared/read-package";
import type { MenuItem } from "../lib/domain";

/**
 * Hosted catalogue write integrity against the real Firestore emulator:
 *   firebase emulators:exec --only firestore --project demo-fika-catalogue "npm test -- tests/catalogue-manifest-integrity.test.ts"
 * Skipped when no emulator is configured so the default unit run stays hermetic.
 */
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const skip = emulator ? false : "FIRESTORE_EMULATOR_HOST is not set";
const projectId = process.env.GCLOUD_PROJECT || "demo-fika-catalogue";

type Repo = typeof import("../lib/canonical-menu-repository");
type Source = typeof import("../lib/catalogue-source");
type Package = typeof import("../lib/catalogue-read-package");
type Manifest = typeof import("../lib/catalogue-manifest");
let repo: Repo, source: Source, pkg: Package, manifestLib: Manifest;
let db: Firestore;

function memoryStore(): ReadPackageStore {
  const objects = new Map<string, Uint8Array>();
  const manifests = new Map<string, any>();
  return {
    async putImmutable(name, bytes) { if (!objects.has(name)) objects.set(name, bytes); },
    async get(name) { return objects.get(name); },
    async has(name) { return objects.has(name); },
    async getManifest(key) { return manifests.get(key); },
    async putManifest(key, manifest) { manifests.set(key, manifest); },
  };
}

async function clear() {
  for (const name of ["fikaMenuPlanningCatalogue", "fikaMenuPlanningCatalogueManifests"]) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map(document => document.ref.delete()));
  }
  repo.invalidateHostedCatalogueCache();
}

async function persisted() {
  const snapshot = await db.collection("fikaMenuPlanningCatalogue").where("kind", "==", "dish").get();
  const items = snapshot.docs.map(document => document.data().record as MenuItem);
  const manifest = (await db.collection("fikaMenuPlanningCatalogueManifests").doc("catalogue").get()).data() || {};
  return { items, manifest, recomputed: source.catalogueSourceHash(items) };
}

/** The invariant under test: what is stored is exactly what the stored manifest identifies. */
async function assertAgrees(label: string) {
  const { items, manifest, recomputed } = await persisted();
  assert.equal(manifest.sourceHash, recomputed, `${label}: manifest hash must identify the persisted records`);
  assert.equal(manifest.dishCount, items.length, `${label}: dishCount`);
  assert.equal(manifest.catalogueVersion, manifest.sourceRevision, `${label}: revision alias`);
  assert.equal(manifest.packageState?.sourceHash, manifest.sourceHash, `${label}: packageState tracks the same source`);
  assert.equal(manifest.packageState?.sourceRevision, manifest.sourceRevision, `${label}: packageState revision`);
  return { items, manifest };
}

before(async () => {
  if (!emulator) return;
  Object.assign(process.env, { FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: projectId, GCLOUD_PROJECT: projectId });
  delete process.env.FIKA_SNAPSHOT_BUCKET; delete process.env.FIREBASE_STORAGE_BUCKET;
  repo = await import("../lib/canonical-menu-repository");
  source = await import("../lib/catalogue-source");
  pkg = await import("../lib/catalogue-read-package");
  manifestLib = await import("../lib/catalogue-manifest");
  db = new Firestore({ projectId });
  await clear();
});
after(async () => { if (emulator) await clear(); });

test("creation persists records and a manifest that agree", { skip }, async () => {
  await clear();
  await repo.createCanonicalMenuItem({ displayName: "Integrity Salad", category: "Salad", description: "Crisp leaves", mayContainNotes: "Nuts", methodSteps: ["Wash", "Dress"] }, "integrity-actor");
  const { items, manifest } = await assertAgrees("after create");
  assert.equal(items.length, 1);
  assert.equal(manifest.sourceRevision, 1);
  assert.equal(manifest.packageState.status === "current", false, "pending/failed until a package is materialised for this exact source");
});

test("edit that clears optional fields does not retain the cleared values (merge-set regression)", { skip }, async () => {
  await clear();
  const created = await repo.createCanonicalMenuItem({ displayName: "Clearing Dish", category: "Hot Main", subcategory: "Roast", description: "Old description", preparationNotes: "Old prep", mayContainNotes: "Old notes", methodSteps: ["Old step"] }, "integrity-actor");
  await repo.updateCanonicalMenuItem(created.canonicalId, { displayName: "Clearing Dish", category: "Hot Main" }, "integrity-actor");
  const { items, manifest } = await assertAgrees("after clearing edit");
  const record = items[0] as unknown as Record<string, unknown>;
  for (const key of ["description", "subcategory", "preparationNotes"]) assert.equal(key in record, false, `${key} must not survive a clearing edit`);
  assert.equal(record.canonicalId, created.canonicalId, "stable dish ID is preserved");
  assert.equal(record.category, "Hot Main");
  assert.equal(manifest.sourceRevision, 2);
  assert.equal(items[0].revision, 2);
});

test("edit, archive and rename keep records, counts and manifest in agreement; IDs and categories are preserved", { skip }, async () => {
  await clear();
  const a = await repo.createCanonicalMenuItem({ displayName: "Dish Alpha", category: "Sauce", description: "a" }, "integrity-actor");
  const b = await repo.createCanonicalMenuItem({ displayName: "Dish Beta", category: "Soup", description: "b" }, "integrity-actor");
  await repo.updateCanonicalMenuItem(a.canonicalId, { displayName: "Dish Alpha Renamed", category: "Garnish", description: "changed" }, "integrity-actor");
  await repo.archiveCanonicalMenuItem(b.canonicalId, "integrity-actor");
  const { items, manifest } = await assertAgrees("after edit+archive");
  assert.equal(items.length, 2);
  assert.equal(manifest.sourceRevision, 4);
  assert.deepEqual(items.map(item => item.canonicalId).sort(), [a.canonicalId, b.canonicalId].sort());
  assert.equal(items.find(item => item.canonicalId === a.canonicalId)!.category, "Garnish");
  assert.equal(items.find(item => item.canonicalId === b.canonicalId)!.reviewStatus, "archived");
});

test("pending state replaces the previous package state instead of inheriting it", { skip }, async () => {
  await clear();
  await repo.createCanonicalMenuItem({ displayName: "State Dish", category: "Fish" }, "integrity-actor");
  const ref = db.collection("fikaMenuPlanningCatalogueManifests").doc("catalogue");
  await ref.set({ packageState: { status: "failed", lastError: "stale-error", packageHash: "stale-hash", packageVersion: 1 } }, { mergeFields: ["packageState"] });
  repo.invalidateHostedCatalogueCache();
  const dish = (await persisted()).items[0];
  await repo.updateCanonicalMenuItem(dish.canonicalId, { displayName: "State Dish", category: "Fish", description: "new" }, "integrity-actor");
  const { manifest } = await assertAgrees("after state reset");
  assert.notEqual(manifest.packageState.lastError, "stale-error");
  assert.equal(manifest.packageState.packageVersion, undefined);
  assert.equal(manifest.packageState.packageHash, undefined);
});

test("concurrent writers serialise: every committed revision is distinct and the final manifest matches the records", { skip }, async () => {
  await clear();
  const names = Array.from({ length: 8 }, (_, index) => `Concurrent Dish ${index}`);
  await Promise.all(names.map(name => repo.createCanonicalMenuItem({ displayName: name, category: "Salad", description: name }, "integrity-actor")));
  const first = await assertAgrees("after concurrent creates");
  assert.equal(first.items.length, names.length, "no concurrent create is lost");
  assert.equal(first.manifest.sourceRevision, names.length, "one revision per committed mutation");

  repo.invalidateHostedCatalogueCache();
  await Promise.all(first.items.map(item => repo.updateCanonicalMenuItem(item.canonicalId, { displayName: item.displayName, category: "Salad" }, "integrity-actor")));
  const second = await assertAgrees("after concurrent clearing edits");
  assert.equal(second.items.length, names.length);
  assert.ok(second.items.every(item => !("description" in item)));
  assert.equal(second.manifest.sourceRevision, names.length * 2);
});

test("a package is asserted current only for a catalogue whose hash matches its records", { skip }, async () => {
  await clear();
  const created = await repo.createCanonicalMenuItem({ displayName: "Package Dish", category: "Cold Protein", description: "x" }, "integrity-actor");
  await repo.updateCanonicalMenuItem(created.canonicalId, { displayName: "Package Dish", category: "Cold Protein" }, "integrity-actor");
  const store = memoryStore();
  const state = await manifestLib.getCatalogueManifest();
  const result = await pkg.materialiseCataloguePackage(undefined, state, store);
  assert.equal(result.status, "current");
  const { manifest } = await assertAgrees("after materialisation");
  assert.equal(manifest.packageState.status, "current");
  assert.equal(manifest.packageState.packageHash, result.manifest!.contentHash);

  // A catalogue whose stored hash does not identify its records must never be certified current.
  await db.collection("fikaMenuPlanningCatalogueManifests").doc("catalogue").set({ sourceHash: "0".repeat(64), packageState: { status: "pending", sourceRevision: manifest.sourceRevision, sourceHash: "0".repeat(64) } }, { mergeFields: ["sourceHash", "packageState"] });
  const inconsistent = await pkg.materialiseCataloguePackage(undefined, await manifestLib.getCatalogueManifest(), memoryStore());
  assert.notEqual(inconsistent.status, "current");
  assert.notEqual(((await db.collection("fikaMenuPlanningCatalogueManifests").doc("catalogue").get()).data() || {}).packageState?.status, "current");
});
