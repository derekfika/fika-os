import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  loadHospitalityCatalogue, type CachedCatalogue, type CatalogueLoadResult, type CatalogueManifest,
} from "@fika/server-shared/hospitality-catalogue-client";
import { deliveryWeekday, resolveHospitalityOffering, type CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";
import type { Menu } from "./contract";
import { StudioProblem } from "./problem";

const path = "/api/hospitality-catalogue/public-package";
const compressedLimit = 8 * 1024 * 1024;
const decodedLimit = 32 * 1024 * 1024;
const caches = new Map<string, CachedCatalogue>();

/** Use only the authenticated public-safe Hub projection. Never accept a cached package as current. */
export async function readStudioCatalogue(hub: string, sessionCookie: string, requestHub: typeof fetch = fetch): Promise<CatalogueLoadResult> {
  const read = async (suffix: string) => {
    const response = await requestHub(hub + path + suffix, {
      headers: { cookie: sessionCookie }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw catalogueUnavailable();
    return response;
  };
  try {
    const result = await loadHospitalityCatalogue({
      store: {
        read: async () => caches.get(hub),
        write: async value => { caches.set(hub, value); },
        clear: async () => { caches.delete(hub); },
      },
      async fetchManifest() {
        const manifest = await (await read("")).json() as CatalogueManifest;
        if (manifest.dataset !== "hospitality-booking/catalogue" || manifest.compressedSize > compressedLimit ||
            manifest.uncompressedSize > decodedLimit) throw catalogueUnavailable();
        return manifest;
      },
      async fetchPackageBytes(contentHash) {
        const response = await read("/" + contentHash);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > compressedLimit) throw catalogueUnavailable();
        return bytes;
      },
      sha256Hex: async bytes => createHash("sha256").update(bytes).digest("hex"),
      gunzipText: async bytes => gunzipSync(bytes, { maxOutputLength: decodedLimit }).toString("utf8"),
    });
    if (result.source === "cache-unverified") throw catalogueUnavailable();
    return result;
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
