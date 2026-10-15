import type { Firestore } from "firebase-admin/firestore";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { parseCanonical } from "./schemas";
import { sha256 } from "./profiler";
import type { CanonicalRecord } from "./types";
import { canonicalisationHash, groupSnapshot, verifyMergeInvariants, type CatalogueSnapshot, type MergeGroup, type RoutingDoc } from "./hospitality-catalogue-canonicalisation";

/** Firestore retries recheck every reviewed guard before any write. */
export async function applyCanonicalisationGroup(db: Firestore, group: MergeGroup) {
  const canonical = db.collection("integrationHubCanonical"); const routing = db.collection("integrationHubHospitalityMenuProductionRouting");
  const merges = db.collection("integrationHubHospitalityMenuItemMerges"); const audit = db.collection("integrationHubGovernanceAudit");
  const actor = "migration:hospitality-catalogue-canonicalisation"; const now = new Date().toISOString();
  return db.runTransaction(async transaction => {
    const docs = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    const read = async (ref: FirebaseFirestore.DocumentReference) => { if (!docs.has(ref.path)) docs.set(ref.path, await transaction.get(ref)); return docs.get(ref.path)!; };
    const receiptRef = audit.doc(`canonicalisation-${group.id}-${canonicalisationHash({ operations: group.operations, expectedState: group.expectedState })}`);
    const receipt = await read(receiptRef);
    const current: CatalogueSnapshot = { items: [], offerings: [], routing: [], merges: [] };
    for (const id of group.memberIds) {
      const item = await read(canonical.doc(stableDocumentId(id)));
      if (item.exists) current.items.push(item.data() as CanonicalRecord);
      const route = await read(routing.doc(stableDocumentId(id)));
      if (route.exists) current.routing.push(route.data() as RoutingDoc);
      const merge = await read(merges.doc(stableDocumentId(id)));
      if (merge.exists) current.merges!.push(merge.data() as NonNullable<CatalogueSnapshot["merges"]>[number]);
      // Membership queries detect new/repointed offerings, including survivor duplicates.
      const offerings = await transaction.get(canonical.where("entityType", "==", "Hospitality Menu Offering").where("record.hospitalityMenuItemId", "==", id));
      for (const offering of offerings.docs) { docs.set(offering.ref.path, offering); current.offerings.push(offering.data() as CanonicalRecord); }
    }
    for (const offering of group.expectedState.offerings) await read(canonical.doc(stableDocumentId(offering.canonicalId)));
    const currentHash = canonicalisationHash(groupSnapshot(current, group.memberIds));
    const stale = () => new Error(`Stale catalogue plan/conflict for group ${group.id}: relevant state changed. Regenerate and review a new plan before applying.`);
    if (receipt.exists) {
      if (receipt.data()?.postStateHash !== currentHash) throw stale();
      return "already-applied" as const;
    }
    if (currentHash !== canonicalisationHash(group.expectedState)) throw stale();
    // Stage writes; the atomic audit receipt records exact committed state for safe retries.
    const staged = new Map<string, { ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData }>();
    const stage = (ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData, merge = false) => {
      const previous = staged.get(ref.path)?.data || docs.get(ref.path)?.data() || {};
      staged.set(ref.path, { ref, data: merge ? { ...previous, ...data } : data });
    };
    const rewrite = (snapshot: FirebaseFirestore.DocumentSnapshot, entityType: "Hospitality Menu Item" | "Hospitality Menu Offering", change: (record: Record<string, unknown>) => Record<string, unknown>) => {
      const current = snapshot.data(); if (!current) throw new Error(`Missing ${entityType} ${snapshot.id}.`);
      const record = change({ ...current.record, version: Number(current.record.version || 0) + 1, updatedAt: now, updatedBy: actor });
      const parsed = parseCanonical(entityType, record); if (!parsed.success) throw new Error(`${entityType} ${current.canonicalId} would be invalid: ${parsed.error.issues[0]?.message}`);
      stage(snapshot.ref, { ...current, record, dataHash: sha256(JSON.stringify(record)) });
    };
    for (const operation of group.operations) {
      if (operation.op === "update-survivor") rewrite(await read(canonical.doc(stableDocumentId(operation.itemId))), "Hospitality Menu Item", record => ({ ...record, providerMappings: operation.providerMappings }));
      else if (operation.op === "repoint-offering") {
        const snapshot = await read(canonical.doc(stableDocumentId(operation.offeringId)));
        if (snapshot.data()?.record.hospitalityMenuItemId === operation.toItemId) continue; // already applied
        rewrite(snapshot, "Hospitality Menu Offering", record => ({ ...record, hospitalityMenuItemId: operation.toItemId, ...(operation.configurationPatch ? { configuration: { ...(record.configuration as object | undefined), ...operation.configurationPatch } } : {}) }));
      }
      else if (operation.op === "archive-item") { const snapshot = await read(canonical.doc(stableDocumentId(operation.itemId))); if (snapshot.data()?.record.lifecycleState !== "archived") rewrite(snapshot, "Hospitality Menu Item", record => ({ ...record, lifecycleState: "archived" })); }
      else if (operation.op === "copy-routing") { const snapshot = await read(routing.doc(stableDocumentId(operation.toItemId))); if (!snapshot.exists) stage(snapshot.ref, { menuItemId: operation.toItemId, workstreams: operation.workstreams, version: 1, createdAt: now, updatedAt: now, updatedBy: actor, inheritedFrom: operation.fromItemId }); }
      else if (operation.op === "supersede-routing") { const snapshot = await read(routing.doc(stableDocumentId(operation.itemId))); if (snapshot.exists) stage(snapshot.ref, { supersededBy: operation.supersededBy, supersededAt: now }, true); }
      else if (operation.op === "record-merge") stage(merges.doc(stableDocumentId(operation.sourceItemId)), { sourceMenuItemId: operation.sourceItemId, survivorMenuItemId: operation.survivorItemId, mergedAt: now, mergedBy: actor }, true);
    }
    const after = structuredClone(current);
    for (const { ref, data } of staged.values()) {
      if (ref.parent.id === canonical.id) {
        const records = data.entityType === "Hospitality Menu Item" ? after.items : after.offerings;
        const index = records.findIndex(record => record.canonicalId === data.canonicalId);
        if (index >= 0) records[index] = data as CanonicalRecord;
      } else if (ref.parent.id === routing.id) {
        const index = after.routing.findIndex(row => row.menuItemId === data.menuItemId);
        if (index >= 0) after.routing[index] = data as RoutingDoc; else after.routing.push(data as RoutingDoc);
      } else if (ref.parent.id === merges.id) {
        const index = after.merges!.findIndex(row => row.sourceMenuItemId === data.sourceMenuItemId);
        if (index >= 0) after.merges![index] = data as NonNullable<CatalogueSnapshot["merges"]>[number]; else after.merges!.push(data as NonNullable<CatalogueSnapshot["merges"]>[number]);
      }
    }
    const problems = verifyMergeInvariants(current, after);
    if (problems.length) throw new Error(`Group ${group.id} violates invariants: ${problems.join("; ")}`);
    for (const { ref, data } of staged.values()) transaction.set(ref, data);
    transaction.create(receiptRef, { action: "Hospitality Menu Items canonicalised", entityReference: group.id, actorId: actor, timestamp: now, reason: "Approved catalogue canonicalisation: site copies merged into one canonical Menu Item.", operations: group.operations.length, reviewedStateHash: canonicalisationHash(group.expectedState), postStateHash: canonicalisationHash(groupSnapshot(after, group.memberIds)) });
    return "applied" as const;
  });
}
