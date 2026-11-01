import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { loadHospitalityCatalogue, type CachedCatalogue } from "@fika/server-shared/hospitality-catalogue-client";
import { hubFetch } from "./hub";
import { hospitalityCatalogueServiceDate, portalMenuFromCatalogue } from "./hospitality-portal-catalogue";
import type { PortalMenuItem } from "./mnk-contract";
import { rcoaVisibilityFromCatalogue, type RcoaServiceVisibility } from "./rcoa-service-visibility";

/**
 * The menu RCoA booking validation trusts: the SAME governed catalogue package the portal displays (stable Item IDs, the RCoA
 * OPLOC's effective Offering, price and constraints), fetched server-side from the Hub and integrity-checked by the shared loader.
 * Booking validation fails closed: if the package cannot be verified as current, no booking is accepted (503), and it never falls
 * back to the legacy local snapshot in a hosted runtime.
 */
let cache: CachedCatalogue | undefined;

export async function loadGovernedRcoaMenu(oplocId: string, serviceDate = hospitalityCatalogueServiceDate()): Promise<{ menu: PortalMenuItem[]; visibility: RcoaServiceVisibility }> {
  const result = await loadHospitalityCatalogue({
    store: { read: async () => cache, write: async (record) => { cache = record; }, clear: async () => { cache = undefined; } },
    async fetchManifest() {
      const response = await hubFetch("/api/hospitality-catalogue/public-package");
      if (!response.ok) throw new Error("The Hospitality catalogue could not be checked.");
      return await response.json();
    },
    async fetchPackageBytes(contentHash) {
      const response = await hubFetch(`/api/hospitality-catalogue/public-package/${contentHash}`);
      if (!response.ok) throw new Error("The Hospitality catalogue could not be downloaded.");
      return new Uint8Array(await response.arrayBuffer());
    },
    sha256Hex: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
    gunzipText: async (bytes) => gunzipSync(bytes).toString("utf8"),
  });
  if (result.source === "cache-unverified") throw Object.assign(new Error("The menu could not be verified as current, so bookings are temporarily unavailable. Please try again shortly."), { status: 503 });
  const visibility = rcoaVisibilityFromCatalogue(result.catalogue, oplocId);
  return { menu: portalMenuFromCatalogue(result.catalogue, oplocId, serviceDate), visibility };
}
