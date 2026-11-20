import type { Firestore } from "firebase-admin/firestore";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { bookingLimit, futureBookingImpact, isCanonicalItemId, type ImpactRequest } from "./impact";

const maxMergeReads = 200;

export async function readStudioBookingImpact(
  db: Firestore, input: ImpactRequest, siteLabels: (ids: string[]) => Promise<Map<string, string>>, now?: Date,
) {
  return futureBookingImpact({
    async bookings(from, through) {
      const snapshot = await db.collection("fikaBookings")
        .where("service.eventDate", ">=", from).where("service.eventDate", "<=", through)
        .orderBy("service.eventDate")
        .select("entityType", "canonicalId", "lifecycleStatus", "service.eventDate", "service.oplocId", "order.items")
        .limit(bookingLimit + 1).get();
      recordDataAccess({ app: "integration-hub", source: "FIRESTORE", operation: "hospitality.studio-impact.bookings",
        dataset: "fikaBookings", documents: snapshot.size, firestoreReadKind: "query" });
      const rows = snapshot.docs.slice(0, bookingLimit).map(doc => {
        const row = doc.data();
        return row.canonicalId === doc.id ? row : { lifecycleStatus: row.lifecycleStatus };
      });
      return { rows, truncated: snapshot.size > bookingLimit };
    },
    async resolveItems(ids, priorityCount) {
      const merges = db.collection("integrationHubHospitalityMenuItemMerges");
      const cache = new Map<string, Promise<{ sourceMenuItemId: unknown; survivorMenuItemId: unknown } | null>>();
      const resolve = async (original: string) => {
        let id = original;
        const seen = new Set<string>();
        while (seen.size < 32 && !seen.has(id)) {
          seen.add(id);
          let read = cache.get(id);
          if (!read) {
            if (cache.size >= maxMergeReads) return;
            read = merges.doc(stableDocumentId(id)).get().then(doc => {
              recordDataAccess({ app: "integration-hub", source: "FIRESTORE", operation: "hospitality.studio-impact.item-merge",
                dataset: "integrationHubHospitalityMenuItemMerges", documents: Number(doc.exists),
                estimatedBillableReads: 1, firestoreReadKind: "document" });
              const data = doc.data();
              return data ? { sourceMenuItemId: data.sourceMenuItemId, survivorMenuItemId: data.survivorMenuItemId } : null;
            });
            cache.set(id, read);
          }
          const merge = await read;
          if (!merge) return id;
          if (merge.sourceMenuItemId !== id || !isCanonicalItemId(merge.survivorMenuItemId)) return;
          id = merge.survivorMenuItemId;
        }
      };
      const identities = (keys: string[]) => Promise.all(keys.map(async id => [id, await resolve(id)] as const));
      const requested = await identities(ids.slice(0, priorityCount));
      const observed = await identities(ids.slice(priorityCount));
      const values = [...requested, ...observed];
      return new Map(values.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
    },
    async itemLabels(ids) {
      const canonical = db.collection("integrationHubCanonical");
      const documents = await db.getAll(...ids.map(id => canonical.doc(stableDocumentId(id))), {
        fieldMask: ["canonicalId", "entityType", "record.name"],
      });
      recordDataAccess({ app: "integration-hub", source: "FIRESTORE", operation: "hospitality.studio-impact.items",
        dataset: "integrationHubCanonical", documents: documents.filter(doc => doc.exists).length,
        estimatedBillableReads: documents.length, firestoreReadKind: "document" });
      const labels = new Map<string, string>();
      for (const [index, doc] of documents.entries()) {
        const data = doc.data();
        if (data?.entityType === "Hospitality Menu Item" && data.canonicalId === ids[index]) {
          const name = typeof data.record?.name === "string" ? data.record.name.trim() : "";
          labels.set(ids[index], name || ids[index]);
        }
      }
      return labels;
    },
    siteLabels,
  }, input, now);
}
