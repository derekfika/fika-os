import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  CATALOGUE_PACKAGE_CONTRACT, type CataloguePackage, type PackageItem,
} from "@fika/server-shared/hospitality-effective-offering";
import { readStudioCatalogue, siteOfferings, studioCatalogueOptions } from "../lib/catalogue";
import type { Menu, Section } from "../lib/contract";
import { studioHandlers } from "../lib/http";

const baseItem: PackageItem = {
  id: "item-a", name: "Selectable product", category: "Hospitality",
  dietaryInformation: [], allergenInformation: [],
  defaultPrices: [{ amount: 17, vatRate: 20, from: "2026-12-01" }],
  defaultMinimumGuests: 12,
};
const catalogue: CataloguePackage = {
  contract: CATALOGUE_PACKAGE_CONTRACT, schemaVersion: 2,
  items: [baseItem, { ...baseItem, id: "quote", defaultMode: "quote_only", defaultPrices: [] }],
  oplocs: [{ id: "site-a", label: "Site A" }, { id: "site-b", label: "Site B" }],
  exceptions: [{
    id: "site-ban", oplocId: "site-b", itemId: baseItem.id, mode: "standard", available: false, prices: [],
  }],
};
const bytes = gzipSync(JSON.stringify(catalogue));
const hash = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  dataset: "hospitality-booking/catalogue", packageVersion: 1,
  schemaVersion: catalogue.schemaVersion, contractVersion: catalogue.contract,
  objectName: "fixtures/" + hash, compression: "gzip",
  contentHash: hash, compressedSize: bytes.length, uncompressedSize: Buffer.byteLength(JSON.stringify(catalogue)),
  recordCount: 5, generatedAt: "2026-11-18T12:00:00Z",
};
const bytesResponse = (content: Buffer) => new Response(Uint8Array.from(content));

test("Hub catalogue reads authenticate and verify raw bytes; stale cache and integrity failure stay closed", async () => {
  const hub = "http://localhost:3190";
  const path = hub + "/api/hospitality-catalogue/public-package";
  let downloads = 0;
  let authorityAvailable = true;
  const stub: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(init?.headers, { cookie: "fika_os_session=fixture" });
    if (!authorityAvailable) return new Response(null, { status: 403 });
    if (url === path) return Response.json(manifest);
    assert.equal(url, path + "/" + hash);
    downloads++;
    return bytesResponse(bytes);
  };
  const loaded = await readStudioCatalogue(hub, "fika_os_session=fixture", stub);
  assert.deepEqual(loaded.catalogue, catalogue);
  assert.equal((await readStudioCatalogue(hub, "fika_os_session=fixture", stub)).source, "cache");
  assert.equal(downloads, 1);
  authorityAvailable = false;
  await assert.rejects(readStudioCatalogue(hub, "fika_os_session=fixture", stub), { code: "CATALOGUE_UNAVAILABLE" });

  const corrupted = Buffer.from(bytes);
  corrupted[0] ^= 1;
  const corruptSource: typeof fetch = async url => String(url).endsWith(hash) ? bytesResponse(corrupted) : Response.json(manifest);
  await assert.rejects(readStudioCatalogue("http://localhost:3191", "fika_os_session=fixture", corruptSource), { code: "CATALOGUE_UNAVAILABLE" });
});

test("site preview uses Hub item IDs, event-date prices and defaults while excluding unavailable and quote-only products", () => {
  const section: Section = {
    id: "food", catalogueItemId: baseItem.id, name: "Food", mode: "static", staticDishIds: [],
    weeks: [[], [], [], [], [], []],
  };
  const menu: Menu = {
    id: "menu", name: "Draft", kind: "seasonal", version: 1, updatedAt: "", anchorMonday: "",
    startDate: "2026-11-18", endDate: "2026-12-31",
    sections: [section, { ...section, id: "enquiry", catalogueItemId: "quote" }, { ...section, id: "unmapped", catalogueItemId: "" }],
  };
  assert.deepEqual(siteOfferings(menu, catalogue, "site-a", "2026-11-30"), []);
  assert.deepEqual(siteOfferings(menu, catalogue, "site-b", "2026-12-01"), []);
  assert.deepEqual(siteOfferings(menu, catalogue, "site-a", "2026-12-01"), [{
    sectionId: "food", label: baseItem.name, price: { amount: 17, vatRate: 20, currency: "GBP" },
    constraints: { minimumGuests: 12 },
  }]);
  assert.throws(() => siteOfferings(menu, catalogue, "missing", "2026-12-01"), { code: "UNKNOWN_HOSPITALITY_SITE" });
  const fridayRestricted = { ...catalogue, items: [{ ...baseItem, bookingPolicy: { fridayUnavailable: true } }] };
  assert.deepEqual(siteOfferings(menu, fridayRestricted, "site-a", "2026-12-04"), []);
  assert.equal(siteOfferings(menu, fridayRestricted, "site-a", "2026-12-03").length, 1);
});

test("catalogue resources pass Studio authorization and use the Hub package without opening the draft store", async () => {
  const handlers = studioHandlers(async () => ({ id: "studio-editor", name: "Editor", canManage: false, canPublish: false }),
    () => assert.fail("Catalogue resources are package-only"), () => {}, async () => ({
      catalogue, contentHash: hash, generatedAt: manifest.generatedAt, source: "network", downloaded: true, notes: [],
    }));
  const result = await handlers.GET(new Request("http://localhost:13686/api/studio?list=catalogue"));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), studioCatalogueOptions(catalogue));
});
