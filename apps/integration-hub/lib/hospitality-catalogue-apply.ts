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
    const current: CatalogueSnapshot = { items: [], offerings: [], prices: [], routing: [], merges: [] };
    for (const id of group.memberIds) {
      const item = await read(canonical.doc(stableDocumentId(id)));
      if (item.exists) current.items.push(item.data() as CanonicalRecord);
      const route = await read(routing.doc(stableDocumentId(id)));
      if (route.exists) current.routing.push(route.data() as RoutingDoc);
      const merge = await read(merges.doc(stableDocumentId(id)));
      if (merge.exists) current.merges!.push(merge.data() as NonNullable<CatalogueSnapshot["merges"]>[number]);
      // Membership queries detect new/repointed offerings and Item-scoped (company default) Prices, including survivor duplicates.
      const related = await transaction.get(canonical.where("record.hospitalityMenuItemId", "==", id));
      for (const doc of related.docs) {
        docs.set(doc.ref.path, doc);
        const record = doc.data() as CanonicalRecord;
        if (record.entityType === "Hospitality Menu Offering") current.offerings.push(record); else if (record.entityType === "Hospitality Menu Price") current.prices!.push(record);
      }
    }
    // Site Prices hang off the group's Offerings: read them in the same transaction so price drift also invalidates a reviewed plan.
    const offeringIds = current.offerings.map(offering => offering.canonicalId);
    for (let index = 0; index < offeringIds.length; index += 30) {
      const priced = await transaction.get(canonical.where("record.hospitalityMenuOfferingId", "in", offeringIds.slice(index, index + 30)));
      for (const doc of priced.docs) { docs.set(doc.ref.path, doc); current.prices!.push(doc.data() as CanonicalRecord); }
    }
    for (const operation of group.operations) if (operation.op === "set-company-default" && operation.price) await read(canonical.doc(stableDocumentId(operation.price.priceId)));
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
    const rewrite = (snapshot: FirebaseFirestore.DocumentSnapshot, entityType: "Hospitality Menu Item" | "Hospitality Menu Offering" | "Hospitality Menu Price", change: (record: Record<string, unknown>) => Record<string, unknown>) => {
      // Several operations may touch one document (repoint + clear minimum): build on what is already staged.
      const current = staged.get(snapshot.ref.path)?.data ?? snapshot.data(); if (!current) throw new Error(`Missing ${entityType} ${snapshot.id}.`);
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
      else if (operation.op === "set-company-default") {
        const survivor = await read(canonical.doc(stableDocumentId(operation.itemId)));
        rewrite(survivor, "Hospitality Menu Item", record => ({ ...record, ...(operation.minimumQuantity !== undefined ? { defaultMinimumQuantity: operation.minimumQuantity } : {}) }));
        if (operation.price) {
          const ref = canonical.doc(stableDocumentId(operation.price.priceId));
          if (!(await read(ref)).exists) {
            const record = { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType: "Hospitality Menu Price", canonicalId: operation.price.priceId, hospitalityMenuItemId: operation.itemId, amount: operation.price.amount, currency: "GBP", vatRate: operation.price.vatRate, effectiveFrom: operation.price.effectiveFrom, lifecycleState: "active" };
            const parsed = parseCanonical("Hospitality Menu Price", record); if (!parsed.success) throw new Error(`Company default Price would be invalid: ${parsed.error.issues[0]?.message}`);
            stage(ref, { canonicalId: operation.price.priceId, entityType: "Hospitality Menu Price", record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: "published", publicationStatus: "published", publishedAt: now });
          }
        }
      }
      else if (operation.op === "archive-redundant-price") { const snapshot = await read(canonical.doc(stableDocumentId(operation.priceId))); if (snapshot.data()?.record.lifecycleState !== "archived") rewrite(snapshot, "Hospitality Menu Price", record => ({ ...record, lifecycleState: "archived" })); }
      else if (operation.op === "clear-offering-minimum") { const snapshot = await read(canonical.doc(stableDocumentId(operation.offeringId))); if (snapshot.data()?.record.minimumQuantity !== undefined || staged.has(snapshot.ref.path)) rewrite(snapshot, "Hospitality Menu Offering", record => { const next = { ...record }; delete next.minimumQuantity; return next; }); }
      else if (operation.op === "record-merge") stage(merges.doc(stableDocumentId(operation.sourceItemId)), { sourceMenuItemId: operation.sourceItemId, survivorMenuItemId: operation.survivorItemId, mergedAt: now, mergedBy: actor }, true);
    }
    const after = structuredClone(current);
    for (const { ref, data } of staged.values()) {
      if (ref.parent.id === canonical.id) {
        const records = data.entityType === "Hospitality Menu Item" ? after.items : data.entityType === "Hospitality Menu Price" ? after.prices! : after.offerings;
        const index = records.findIndex(record => record.canonicalId === data.canonicalId);
        if (index >= 0) records[index] = data as CanonicalRecord; else if (data.entityType === "Hospitality Menu Price") records.push(data as CanonicalRecord);
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
