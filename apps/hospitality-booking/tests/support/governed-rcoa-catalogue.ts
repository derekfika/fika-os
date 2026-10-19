import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { localRcoaMenuCatalogue } from "../../lib/local-rcoa-menu";
import { portalMenuFromCatalogue } from "../../lib/hospitality-portal-catalogue";

export const RCOA_OPLOC = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
export const SERVICE_DATE = "2026-10-19";

/** A governed catalogue package shaped like the published one: stable Item IDs in the hospitality-menu-item namespace (not the legacy source IDs). */
export const governedId = (sourceItemId: string, index: number) => `hospitality-menu-item:${index % 6 === 0 ? "mnk" : "rcoa"}:${sourceItemId}`;
export const governedPackage = {
  schemaVersion: 1, contract: "fika.hospitality-catalogue-package.v1",
  oplocs: [{ id: RCOA_OPLOC, label: "RCoA" }, { id: "oploc:rcoa-test", label: "RCoA (test)" }], exceptions: [],
  items: localRcoaMenuCatalogue.items.map((item, index) => ({
    id: governedId(item.source.sourceItemId, index), name: item.name, category: item.category, description: item.description,
    defaultPrices: [{ amount: item.pricing.unitPrice, vatRate: item.pricing.vatRate ?? 0.2, from: "2026-01-01" }], defaultMinimumQuantity: item.orderingConstraints.minimumQuantity,
    defaultMinimumGuests: item.orderingConstraints.minimumGuests || undefined, defaultMode: "standard",
    configuration: { servingInfo: item.pricing.servingInfo, choices: item.optionGroups.map((group) => ({ id: group.id, label: group.label, controlType: group.selectionType, required: group.required, options: group.options.map((option, optionIndex) => ({ id: `${group.id}:${optionIndex}`, label: option.label })) })) },
    dietaryInformation: [], allergenInformation: [],
  })),
};
export const governedMenu = portalMenuFromCatalogue(governedPackage as never, RCOA_OPLOC, SERVICE_DATE);

const bytes = gzipSync(Buffer.from(JSON.stringify(governedPackage)));
const contentHash = createHash("sha256").update(bytes).digest("hex");
const manifest = { dataset: "hospitality-booking/catalogue", packageVersion: 1, schemaVersion: 1, contractVersion: "fika.hospitality-catalogue-package.v1", objectName: `hospitality-booking/catalogue/${contentHash}.json.gz`, compression: "gzip", contentHash, compressedSize: bytes.byteLength, uncompressedSize: JSON.stringify(governedPackage).length, recordCount: governedPackage.items.length, generatedAt: "2026-10-19T08:00:00.000Z" };

/** Serves the Hub catalogue endpoints the server-side loader calls; undefined for every other URL. */
export function governedCatalogueResponse(url: string): Response | undefined {
  if (url.endsWith("/api/hospitality-catalogue/public-package")) return Response.json(manifest);
  if (url.endsWith(`/api/hospitality-catalogue/public-package/${contentHash}`)) return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/octet-stream" } });
  return undefined;
}

/** Legacy source ID -> governed stable Item ID, for tests whose client logic still builds requests from the legacy snapshot menu. */
export const legacyToGovernedId = new Map(localRcoaMenuCatalogue.items.map((item, index) => [item.source.sourceItemId, governedId(item.source.sourceItemId, index)] as const));
export function withGovernedIds<T extends { requests: Array<{ order: { items: Array<{ itemId: string }> } }> }>(submission: T): T {
  return { ...submission, requests: submission.requests.map((request) => ({ ...request, order: { ...request.order, items: request.order.items.map((item) => ({ ...item, itemId: legacyToGovernedId.get(item.itemId) || item.itemId })) } })) };
}
