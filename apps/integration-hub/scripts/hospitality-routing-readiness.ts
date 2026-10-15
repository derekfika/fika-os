/**
 * READ-ONLY readiness report for governed Hospitality production routing, per platform.
 *
 *   npx tsx scripts/hospitality-routing-readiness.ts --project fika-os-dev
 *
 * For each platform it reports: brochure items, canonical Hub Menu Items present, governed routing records (decided), Unclassified,
 * Routing conflicts, and whether the platform is READY to be added to HOSPITALITY_GOVERNED_ROUTING_PLATFORMS (every brochure item promoted
 * and classified, no conflicts). Also lists the legacy-map decisions still relied upon per platform. Writes nothing.
 */
import { execFileSync } from "node:child_process";
import { localAngelCourtMenuCatalogue, localCfcMenuCatalogue, localMnkMenuCatalogue, localMunichReMenuCatalogue, localRcoaMenuCatalogue } from "@fika/server-shared/hospitality-catalogue";
import { LEGACY_HOSPITALITY_MENU_ROUTING } from "../lib/connections-service";
import { governedRoutingPlatforms, memberStateForReport } from "../lib/hospitality-routing-readiness";

const project = process.argv[process.argv.indexOf("--project") + 1];
if (!project || project.startsWith("--")) throw new Error("--project is required.");
const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const query = async (collection: string, where?: unknown) => ((await (await fetch(`${base}:runQuery`, { method: "POST", headers, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], ...(where ? { where } : {}), limit: 2000 } }) })).json()) as Array<{ document?: { fields: Record<string, any> } }>).filter((row) => row.document).map((row) => row.document!.fields);

const canonical = new Set((await query("integrationHubCanonical", { fieldFilter: { field: { fieldPath: "entityType" }, op: "EQUAL", value: { stringValue: "Hospitality Menu Item" } } })).map((fields) => fields.canonicalId.stringValue as string));
const routing = new Map((await query("integrationHubHospitalityMenuProductionRouting")).map((fields) => [fields.menuItemId.stringValue as string, (fields.workstreams?.arrayValue?.values || []).map((value: { stringValue: string }) => value.stringValue)] as const));
const catalogues = { mnk: localMnkMenuCatalogue, "angel-court": localAngelCourtMenuCatalogue, cfc: localCfcMenuCatalogue, "munich-re": localMunichReMenuCatalogue, rcoa: localRcoaMenuCatalogue } as const;
const governed = governedRoutingPlatforms();

for (const [platform, catalogue] of Object.entries(catalogues)) {
  const items = catalogue.items.filter((item) => item.lifecycleState === "active");
  const promoted = items.filter((item) => canonical.has(item.canonicalId));
  const states = promoted.map((item) => memberStateForReport(routing.get(item.canonicalId)));
  const count = (state: string) => states.filter((value) => value === state).length;
  const legacyKeys = items.filter((item) => item.source.sourceItemId in LEGACY_HOSPITALITY_MENU_ROUTING).map((item) => item.source.sourceItemId);
  const ready = promoted.length === items.length && count("unclassified") === 0 && count("conflict") === 0;
  console.log(JSON.stringify({ platform, governedNow: governed.includes(platform), brochureItems: items.length, promoted: promoted.length, notPromoted: items.length - promoted.length, classified: promoted.length - count("unclassified"), unclassified: count("unclassified"), conflicts: count("conflict"), inHouse: count("in-house"), cpuSandwiches: count("sandwiches"), cpuHospitality: count("hospitality"), readyToGovern: ready, legacyDecisionsRelied: legacyKeys }));
}
