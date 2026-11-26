import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  loadHospitalityCatalogue, type CachedCatalogue, type CatalogueLoadResult, type CatalogueManifest,
} from "@fika/server-shared/hospitality-catalogue-client";
import { deliveryWeekday, resolveHospitalityOffering, type CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";
import type { Menu } from "./contract";
import { StudioProblem } from "./problem";
import { studioUpstream, studioUpstreamHeaders } from "./data-trace";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export const publicCataloguePath = "/api/hospitality-catalogue/public-package";
export const compressedCatalogueLimit = 8 * 1024 * 1024;
const decodedLimit = 32 * 1024 * 1024;
const caches = new Map<string, CachedCatalogue>();
const verifiedGzip = new Map<string, { contentHash: string; bytes: Uint8Array<ArrayBuffer> }>();
const downloads = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

export function verifiedPublicCatalogueBytes(hub: string, contentHash: string) {
  const current = verifiedGzip.get(hub);
  return current?.contentHash === contentHash ? current.bytes : undefined;
}

/** Use only the authenticated public-safe Hub projection. Never accept a cached package as current. */
export async function readStudioCatalogue(hub: string, sessionCookie: string, requestHub: typeof fetch = fetch): Promise<CatalogueLoadResult & { manifest: CatalogueManifest }> {
  const read = async (suffix: string) => {
    const response = await studioUpstream(suffix ? "hub.catalogue.public-package" : "hub.catalogue.public-manifest", () => requestHub(hub + publicCataloguePath + suffix, {
      headers: { cookie: sessionCookie, ...studioUpstreamHeaders() }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(5000),
    }));
    if (!response.ok) throw catalogueUnavailable();
    return response;
  };
  try {
    let currentManifest: CatalogueManifest | undefined;
    let fetchedBytes: Uint8Array<ArrayBuffer> | undefined;
    const result = await loadHospitalityCatalogue({
      store: {
        read: async () => caches.get(hub),
        write: async value => { caches.set(hub, value); },
        clear: async () => { caches.delete(hub); },
      },
      async fetchManifest() {
        const manifest = await (await read("")).json() as CatalogueManifest;
        if (manifest.dataset !== "hospitality-booking/catalogue" || manifest.compressedSize > compressedCatalogueLimit ||
            manifest.uncompressedSize > decodedLimit) throw catalogueUnavailable();
        currentManifest = manifest;
        return manifest;
      },
      async fetchPackageBytes(contentHash) {
        const verified = verifiedPublicCatalogueBytes(hub, contentHash);
        if (verified) return verified;
        const key = hub + "/" + contentHash;
        let pending = downloads.get(key);
        if (!pending) {
          pending = (async () => {
            const response = await read("/" + contentHash);
            if (Number(response.headers.get("content-length")) > compressedCatalogueLimit) throw catalogueUnavailable();
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length > compressedCatalogueLimit) throw catalogueUnavailable();
            return bytes;
          })().finally(() => downloads.delete(key));
          downloads.set(key, pending);
        } else {
          recordDataAccess({ operation: "catalogue.public-gzip", source: "MEMORY", dataset: "hospitality-booking/catalogue",
            documents: 0, cacheResult: "IN_FLIGHT_JOIN" });
        }
        fetchedBytes = await pending;
        return fetchedBytes;
      },
      sha256Hex: async bytes => createHash("sha256").update(bytes).digest("hex"),
      gunzipText: async bytes => gunzipSync(bytes, { maxOutputLength: decodedLimit }).toString("utf8"),
    });
    if (result.source === "cache-unverified" || !currentManifest ||
        result.catalogue.schemaVersion !== currentManifest.schemaVersion || result.catalogue.contract !== currentManifest.contractVersion)
      throw catalogueUnavailable();
    if (fetchedBytes && result.source === "network") verifiedGzip.set(hub, { contentHash: result.contentHash, bytes: fetchedBytes });
    recordDataAccess({ operation: "catalogue.public-projection", source: result.source === "cache" ? "APP_CACHE" : "SNAPSHOT",
      documents: result.catalogue.items.length, cacheResult: result.source === "cache" ? "HIT" : "MISS",
      packageVersion: currentManifest.packageVersion, dataset: currentManifest.dataset });
    return { ...result, manifest: currentManifest };
  } catch {
    throw catalogueUnavailable();
  }
}

export function catalogueUnavailable() {
  return new StudioProblem(503, "CATALOGUE_UNAVAILABLE", "The current Hospitality catalogue could not be verified.");
}

export function studioCatalogueOptions(catalogue: CataloguePackage) {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en-GB");
  return {
    items: catalogue.items.map(({ id, name, category }) => ({ id, name, category })).sort(byName),
    sites: catalogue.oplocs.map(({ id, label: name }) => ({ id, name })).sort(byName),
  };
}

export function siteOfferings(menu: Menu, catalogue: CataloguePackage, siteId: string, eventDate: string) {
  if (!catalogue.oplocs.some(site => site.id === siteId)) {
    throw new StudioProblem(422, "UNKNOWN_HOSPITALITY_SITE", "Choose an active site from the current Hub catalogue.");
  }
  const friday = deliveryWeekday(eventDate) === 5;
  return menu.sections.flatMap(section => {
    if (!section.catalogueItemId) return [];
    const result = resolveHospitalityOffering(catalogue, section.catalogueItemId, siteId, { serviceDate: eventDate });
    if (!result.available || result.offering.quoteRequired || (friday && result.offering.bookingPolicy?.fridayUnavailable)) return [];
    const { constraints, name, price } = result.offering;
    return [{ sectionId: section.id, label: name, constraints, price }];
  });
}
