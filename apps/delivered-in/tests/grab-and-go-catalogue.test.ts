import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { grabAndGoCatalogueManifestMatches } from "../app/lib/grab-and-go-catalogue-indexeddb";

const manifest = { dataset: "snapshots/cpu-production/grab-and-go-catalogue", packageVersion: 1, schemaVersion: 1, contractVersion: "cpu-production.grab-and-go-catalogue.v1", objectName: "catalogue/v1.json.gz", compression: "gzip" as const, contentHash: "hash", compressedSize: 1, uncompressedSize: 1, recordCount: 1, generatedAt: "now", scope: "global" };

test("Grab & Go cache is content/version validated and isolated by a dedicated store", async () => {
  const cache = await readFile(new URL("../app/lib/grab-and-go-catalogue-indexeddb.ts", import.meta.url), "utf8");
  assert.match(cache, /grab-and-go-catalogue/);
  assert.match(cache, /window\.location\.origin/);
  assert.match(cache, /accountScope/);
  assert.equal(grabAndGoCatalogueManifestMatches(manifest, manifest), true);
  assert.equal(grabAndGoCatalogueManifestMatches(manifest, { ...manifest, packageVersion: 2 }), false);
  assert.equal(grabAndGoCatalogueManifestMatches(manifest, { ...manifest, contentHash: "other" }), false);
});

test("hosted Grab & Go routes use the CPU package boundary and never the old local catalogue file", async () => {
  const route = await readFile(new URL("../app/api/delivered-in/grab-and-go/route.ts", import.meta.url), "utf8");
  const production = await readFile(new URL("../app/api/delivered-in/grab-and-go/production/route.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../lib/grab-and-go-store.ts", import.meta.url), "utf8");
  assert.match(route, /getGrabAndGoCataloguePackage/);
  assert.match(production, /getGrabAndGoCataloguePackage/);
  assert.doesNotMatch(store, /grab-and-go-catalogue\.json/);
  assert.doesNotMatch(route, /readGrabAndGoCatalogue/);
  assert.doesNotMatch(production, /readGrabAndGoCatalogue/);
});

test("G&G save returns the durable order even when downstream projection is pending", async () => {
  const route = await readFile(new URL("../app/api/delivered-in/grab-and-go/route.ts", import.meta.url), "utf8");
  assert.match(route, /allowPending: true/);
  assert.match(route, /handoff/);
});
