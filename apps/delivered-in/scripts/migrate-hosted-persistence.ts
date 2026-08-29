import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { listGrabAndGoOrders, listSiteMenuArtifacts } from "../lib/migration-compat";

const apply = process.argv.includes("--apply");
const orders = listGrabAndGoOrders();
const artifacts = listSiteMenuArtifacts();
const duplicateOrderIds = [...new Set(orders.filter((order, index, all) => all.findIndex(candidate => candidate.orderId === order.orderId) !== index).map(order => order.orderId))];
const invalidOrders = orders.filter(order => !order.orderId || !order.oplocId || !order.deliveryDate);
const invalidArtifacts = artifacts.filter(artifact => !artifact.artifactId || !artifact.oplocId || !artifact.sourceDayId || !artifact.generatedAt);
if (duplicateOrderIds.length || invalidOrders.length || invalidArtifacts.length) throw new Error(`Invalid migration source: duplicate order IDs=${duplicateOrderIds.join(", ") || "none"}; invalid orders=${invalidOrders.length}; invalid site-menu artifacts=${invalidArtifacts.length}`);
const currentArtifacts = [...new Map<string, (typeof artifacts)[number]>(artifacts.map(artifact => [`${artifact.oplocId}:${artifact.sourceDayId}`, artifact] as const).sort(([, a], [, b]) => a.generatedAt.localeCompare(b.generatedAt))).values()];
const duplicateArtifactKeys = [...new Set(artifacts.filter((artifact, index, all) => all.findIndex(candidate => candidate.oplocId === artifact.oplocId && candidate.sourceDayId === artifact.sourceDayId) !== index).map(artifact => `${artifact.oplocId}:${artifact.sourceDayId}`))];
const revisionIds = [...new Set(artifacts.map(artifact => artifact.artifactId))];
if (revisionIds.length !== artifacts.length) throw new Error("Invalid migration source: duplicate site-menu artifact IDs.");
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  grabAndGo: { sourceRecords: orders.length, ordersToMigrate: orders.length, revisionsOrHistoryToMigrate: orders.reduce((total, order) => total + order.history.length, 0), duplicates: duplicateOrderIds, skipped: 0, invalid: invalidOrders.length },
  siteMenus: { sourceArtifacts: artifacts.length, currentRecordsToMigrate: currentArtifacts.length, historicalRevisionsToMigrate: artifacts.length, repeatedCurrentKeysAreHistory: duplicateArtifactKeys.length, duplicates: [], skipped: 0, invalid: invalidArtifacts.length },
  targets: { orderCollection: "fikaDeliveredInGrabAndGoOrdersV1", siteMenuCollection: "fikaDeliveredInSiteMenusV1", siteMenuRevisionSubcollection: "revisions" },
  deterministic: true,
  plannedWrites: orders.length + currentArtifacts.length + artifacts.length,
}, null, 2));
if (!apply) process.exit(0);
const operations = [
  ...orders.map(order => ({ ref: db.collection("fikaDeliveredInGrabAndGoOrdersV1").doc(stableDocumentId(order.orderId)), value: order })),
  ...currentArtifacts.map(artifact => ({ ref: db.collection("fikaDeliveredInSiteMenusV1").doc(stableDocumentId(`${artifact.oplocId}:${artifact.sourceDayId}`)), value: { artifact, updatedAt: artifact.generatedAt } })),
  ...artifacts.map(artifact => ({ ref: db.collection("fikaDeliveredInSiteMenusV1").doc(stableDocumentId(`${artifact.oplocId}:${artifact.sourceDayId}`)).collection("revisions").doc(stableDocumentId(artifact.artifactId)), value: { artifact, recordedAt: artifact.generatedAt } })),
];
for (let offset = 0; offset < operations.length; offset += 400) { const batch = db.batch(); for (const operation of operations.slice(offset, offset + 400)) batch.set(operation.ref, operation.value, { merge: false }); await batch.commit(); }
console.log(`Migrated ${orders.length} Grab & Go order(s) and ${artifacts.length} site-menu artifact(s).`);
