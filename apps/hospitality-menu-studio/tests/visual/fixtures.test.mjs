import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { dishSchema } from "../../../shared/hospitality-menu-studio-content.ts";
import { productMenuDraft, productMenuSummary } from "../../../shared/hospitality-menu-studio-product-content.ts";
import { isCataloguePayload } from "../../components/catalogue-state.ts";
import { dishes, fixtureDate, itemId, sites, visualResponse } from "./fixtures.mjs";

const response = (path, method = "GET") => visualResponse(new URL(path, "http://127.0.0.1:13422"), method);

test("visual fixtures match the application schemas and resolve every assigned dish revision", () => {
  const revisions = new Set(dishes.map(dish => {
    const parsed = dishSchema.parse(dish);
    return `${parsed.id}@${parsed.version}`;
  }));
  const { items: listing } = response("/api/studio/product-menus").json;
  assert(listing.length >= 3);
  for (const { publicationStatus, hasPublishedRevision, ...value } of listing) {
    assert.equal(publicationStatus, "draft");
    assert.equal(hasPublishedRevision, false);
    const summary = productMenuSummary.parse(value);
    const product = productMenuDraft.parse(response("/api/studio/product-menus?itemId=" + summary.itemId).json.item);
    const schedule = product.configuration.schedule;
    for (const choices of schedule.kind === "fixed" ? [schedule.choices] : schedule.weeks) {
      for (const reference of [...choices.dishes, ...choices.groups.flatMap(group => group.dishes)]) {
        assert(revisions.has(`${reference.dishId}@${reference.revision}`));
      }
    }
  }
  assert(isCataloguePayload(response("/api/catalogue").json));
});

test("the shared bootstrap manifest binds exact gzip bytes and excludes archived products", () => {
  const manifest = response("/api/catalogue/public-package").json;
  assert.deepEqual(response("/api/studio/product-menus?includeCatalogueManifest=1").json.catalogueManifest, manifest);
  const { body: gzip } = response("/api/catalogue/public-package/" + manifest.contentHash);
  assert.equal(gzip.length, manifest.compressedSize);
  assert.equal(createHash("sha256").update(gzip).digest("hex"), manifest.contentHash);
  const plain = gunzipSync(gzip);
  assert.equal(plain.length, manifest.uncompressedSize);
  const catalogue = JSON.parse(plain);
  assert.equal(catalogue.schemaVersion, manifest.schemaVersion);
  assert.equal(catalogue.contract, manifest.contractVersion);
  assert(!catalogue.items.some(item => item.id === itemId("seasonal-soup")));
  const admin = response("/api/catalogue").json;
  for (const product of catalogue.items) {
    const row = admin.rows.find(row => row.itemId === product.id);
    assert.deepEqual(row.availableAt, product.allowedOplocIds ?? sites.map(site => site.id));
  }
});

test("the fixture rejects writes and returns only draft customer data", () => {
  assert.equal(response("/api/studio/product-publication", "POST"), undefined);
  assert.equal(response("/api/studio", "POST"), undefined);
  assert.equal(response("/api/catalogue", "POST"), undefined);
  assert.equal(response("/api/bookings"), undefined);
  const menu = response("/api/studio/product-menus?itemId=" + itemId("finger-food")).json.item;
  const reference = menu.configuration.schedule.weeks[0].dishes[0];
  const { items } = response(`/api/studio/product-menus?dishRevisions=${reference.dishId}@${reference.revision}`).json;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, reference.dishId);
  assert(!Object.hasOwn(items[0], "kitchenDescription"));
  const query = new URLSearchParams({ itemId: menu.itemId, siteId: sites[0].id, eventDate: fixtureDate });
  assert.equal(response("/api/studio/product-preview?" + query).json.draftOnly, true);
});
