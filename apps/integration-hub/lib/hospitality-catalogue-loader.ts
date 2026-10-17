/**
 * Firestore loaders for the Hospitality Catalogue screen.
 *
 * Read shape (COST-EFFICIENCY.md):
 *   full load (screen open / explicit reload): 4 bounded entityType queries (Items, Offerings, Prices, OPLOCs; <=1000 each),
 *     + routing collection + merge records + review decisions. ~400 documents for today’s ~90 Items; no scans of unrelated entities.
 *   after the operator’s own mutation: targeted refresh of only the touched Items =
 *     per Item: 1 item doc + 1 relation query (site exceptions + Item-scoped Prices) + 1 query for exception Prices + 1 routing doc, plus ~24 OPLOC documents once.
 *   no polling, no listeners.
 */
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { Actor } from "./auth";
import { hasPermission } from "./authmod";
import { db } from "./firebase-admin";
import { stableDocumentId } from "./canonical-editor";
import { listCanonicalRecordsByTypes } from "./canonical-oplocs";
import type { CanonicalRecord } from "./types";
import type { RoutingDoc } from "./hospitality-catalogue-canonicalisation";
import { buildCataloguePayload, buildCatalogueRows, type ReviewDecisionDoc } from "./hospitality-catalogue-read-model";
import { isActiveOplocRecord } from "./hospitality-catalogue-oploc";
import { REVIEW_DECISIONS_COLLECTION } from "./hospitality-catalogue-admin";
import type { CataloguePayload, CatalogueRow } from "./hospitality-catalogue-types";

const canonical = () => db.collection("integrationHubCanonical");
const text = (value: unknown) => (typeof value === "string" ? value : "");

function oplocViews(records: CanonicalRecord[]): CataloguePayload["oplocs"] {
  return records.filter(record => record.entityType === "OPLOC" && record.lifecycleStatus !== "archived")
    .map(record => ({ oplocId: record.canonicalId, label: text(record.record.approvedName) || "Unnamed location", active: isActiveOplocRecord(record) }))
    .sort((a, b) => a.label.localeCompare(b.label, "en-GB"));
}

export async function loadCataloguePayload(actor: Actor): Promise<CataloguePayload> {
  const [records, routing, merges, decisions] = await Promise.all([
    listCanonicalRecordsByTypes(["Hospitality Menu Item", "Hospitality Menu Offering", "Hospitality Menu Price", "OPLOC"], 1000) as Promise<CanonicalRecord[]>,
    db.collection("integrationHubHospitalityMenuProductionRouting").limit(2001).get(),
    db.collection("integrationHubHospitalityMenuItemMerges").limit(2001).get(),
    db.collection(REVIEW_DECISIONS_COLLECTION).limit(2001).get(),
  ]);
  recordDataAccess({ app: "integration-hub", operation: "hospitality-catalogue.load", source: "FIRESTORE", dataset: "integrationHubHospitalityMenuProductionRouting", documents: routing.size + merges.size + decisions.size, firestoreReadKind: "query" });
  const of = (type: string) => records.filter(record => record.entityType === type);
  return buildCataloguePayload({
    items: of("Hospitality Menu Item"), offerings: of("Hospitality Menu Offering"), prices: of("Hospitality Menu Price"),
    routing: routing.docs.map(doc => doc.data() as RoutingDoc), merges: merges.docs.map(doc => doc.data() as { sourceMenuItemId: string; survivorMenuItemId: string }),
    decisions: decisions.docs.map(doc => doc.data() as ReviewDecisionDoc),
  }, oplocViews(records), hasPermission(actor, "hospitality.catalogue.manage"));
}

/** Targeted post-mutation refresh: only the touched Items. Duplicate-candidate flags need the full load, so the client re-derives those. */
export async function loadCatalogueRows(itemIds: string[]): Promise<CatalogueRow[]> {
  const ids = [...new Set(itemIds)];
  const oplocRecords = (await canonical().where("entityType", "==", "OPLOC").get()).docs.map(doc => doc.data() as CanonicalRecord); // availability is the default at every active OPLOC (~24 documents)
  const loaded = await Promise.all(ids.map(async id => {
    const [item, relations, route] = await Promise.all([
      canonical().doc(stableDocumentId(id)).get(),
      canonical().where("record.hospitalityMenuItemId", "==", id).get(),
      db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(id)).get(),
    ]);
    const related = relations.docs.map(doc => doc.data() as CanonicalRecord);
    const offerings = related.filter(record => record.entityType === "Hospitality Menu Offering");
    const prices = related.filter(record => record.entityType === "Hospitality Menu Price");
    for (let index = 0; index < offerings.length; index += 30) {
      const chunk = offerings.slice(index, index + 30).map(offering => offering.canonicalId);
      prices.push(...(await canonical().where("record.hospitalityMenuOfferingId", "in", chunk).get()).docs.map(doc => doc.data() as CanonicalRecord));
    }
    recordDataAccess({ app: "integration-hub", operation: "hospitality-catalogue.refresh-item", source: "FIRESTORE", dataset: "integrationHubCanonical", documents: 2 + relations.size + prices.length, firestoreReadKind: "query" });
    return { item: item.exists ? item.data() as CanonicalRecord : undefined, offerings, prices, route: route.exists ? route.data() as RoutingDoc : undefined };
  }));
  const present = loaded.filter(entry => entry.item);
  return buildCatalogueRows({
    items: present.map(entry => entry.item!), offerings: present.flatMap(entry => entry.offerings), prices: present.flatMap(entry => entry.prices),
    routing: present.flatMap(entry => (entry.route ? [entry.route] : [])), oplocs: oplocViews(oplocRecords).map(oploc => ({ oplocId: oploc.oplocId, active: oploc.active })),
  }).rows;
}
