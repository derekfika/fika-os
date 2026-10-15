import { db } from "./firebase-admin";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { groupHash, MAX_GROUP_SERVICES } from "./hospitality-group-commercial";
import type { GroupQuoteHead, GroupQuoteStore, HospitalityGroupQuote } from "./hospitality-group-quote-workflow";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export const groupHeads = () => db.collection("fikaHospitalityBookingGroups");
export const groupQuotes = () => db.collection("fikaHospitalityGroupQuotes");
export const firestoreGroupQuoteStore: GroupQuoteStore = {
  transaction: run => db.runTransaction(async transaction => run({
    children: async id => {
      const result = await transaction.get(db.collection("fikaBookings").where("bookingGroup.id", "==", id).limit(MAX_GROUP_SERVICES + 1));
      recordDataAccess({ app: "integration-hub", operation: "hospitality.group-quote.children", source: "FIRESTORE", dataset: "fikaBookings", documents: result.size, firestoreReadKind: "query" });
      return result.docs.map(d => d.data() as CanonicalBooking);
    },
    head: async id => (await transaction.get(groupHeads().doc(groupHash(id)))).data() as GroupQuoteHead | undefined,
    quote: async id => (await transaction.get(groupQuotes().doc(id))).data() as HospitalityGroupQuote | undefined,
    putHead: head => { transaction.set(groupHeads().doc(groupHash(head.bookingGroupId)), head); },
    putQuote: quote => { transaction.set(groupQuotes().doc(quote.id), quote); },
    putChild: child => { transaction.set(db.collection("fikaBookings").doc(child.canonicalId), child); },
    audit: (id, event) => { transaction.create(db.collection("fikaBookingAudit").doc(id), { ...event, sourceApp: "hospitality-booking", sourceDomain: "hospitality", schemaVersion: "fika.hospitality-group-quote.v1" }); },
  })),
};

export async function groupQuoteHeadsAndLatest(ids: string[]) {
  if (!ids.length) return [];
  const heads = await db.getAll(...ids.map(id => groupHeads().doc(groupHash(id))));
  const existing = heads.filter(d => d.exists).map(d => d.data() as GroupQuoteHead);
  const quotes = existing.length ? await db.getAll(...existing.map(h => groupQuotes().doc(h.latestQuoteId))) : [];
  recordDataAccess({ app: "integration-hub", operation: "hospitality.group-quote.current", source: "FIRESTORE", dataset: "fikaHospitalityGroupQuotes", documents: heads.length + quotes.length, firestoreReadKind: "document" });
  return existing.map((head, i) => ({ head, quote: quotes[i].data() as HospitalityGroupQuote | undefined }));
}
