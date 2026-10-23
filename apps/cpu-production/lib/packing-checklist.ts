import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { ProductionOrder, ProductionLine } from "./production-types";
export const PACKING_COLLECTION = "fikaCpuPackingChecklistsV1";
export type PackingEntry = {
  fingerprint: string;
  packed: boolean;
  at: string;
  actorId: string;
};
export type PackingHead = {
  orderId: string;
  revision: number;
  entries: Record<string, PackingEntry>;
};
export type PackingCommand = {
  orderId: string;
  orderVersion: number;
  lineId: string;
  fingerprint: string;
  packed: boolean;
  expectedRevision: number;
  commandId: string;
};
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
export const packingHash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
export const packingError = (message: string, status = 409) =>
  Object.assign(new Error(message), { status });
export function packingFingerprint(o: ProductionOrder, l: ProductionLine) {
  const {
    status: _status,
    actualQuantity: _actual,
    shortfallQuantity: _shortfall,
    wasteQuantity: _waste,
    ...line
  } = l;
  return packingHash({
    orderId: o.canonicalId,
    date: o.serviceDate,
    requiredBy: o.requiredBy,
    service: o.serviceType,
    window: o.serviceWindow,
    destination: o.destinationOplocId,
    address: o.destinationAddress,
    publication: o.sourcePublicationDayId,
    sourceEntity: o.sourceEntityId,
    sourceVersion: o.sourceVersion,
    sourceHash: o.sourceContentHash,
    quote: o.sourceQuoteRevisionId,
    dietaries: o.bookingDietaries,
    notes: [o.bookingNotes, o.operationalNotes],
    line,
  });
}
export function validatePackingOrder(o: ProductionOrder) {
  if (o.supersededBy || ["cancelled", "rejected"].includes(o.status))
    throw packingError("This collection is cancelled or superseded.");
  if (
    o.lines.length > 250 ||
    new Set(o.lines.map((l) => l.canonicalId)).size !== o.lines.length
  )
    throw packingError(
      "Collection line identities are invalid or exceed the supported checklist size.",
      422,
    );
}
export function packingView(o: ProductionOrder, h?: PackingHead) {
  if (h && h.orderId !== o.canonicalId)
    throw packingError("Packing record identity mismatch.", 503);
  const lines = o.lines.map((l) => {
    const fingerprint = packingFingerprint(o, l),
      prior = h?.entries[packingHash(l.canonicalId)];
    return {
      lineId: l.canonicalId,
      fingerprint,
      packed: !!prior?.packed && prior.fingerprint === fingerprint,
      changed: !!prior && prior.fingerprint !== fingerprint,
    };
  });
  return {
    revision: h?.revision || 0,
    orderVersion: o.version,
    lines,
    packedCount: lines.filter((l) => l.packed).length,
  };
}
export class FirestorePackingRepository {
  constructor(private db: Firestore) {}
  ref(id: string) {
    return this.db.collection(PACKING_COLLECTION).doc(packingHash(id));
  }
  async read(o: ProductionOrder) {
    return packingView(
      o,
      (await this.ref(o.canonicalId).get()).data() as PackingHead | undefined,
    );
  }
  async change(o: ProductionOrder, c: PackingCommand, actorId: string) {
    validatePackingOrder(o);
    if (o.canonicalId !== c.orderId || o.version !== c.orderVersion)
      throw packingError("Collection changed. Refresh before packing.");
    const line = o.lines.find((l) => l.canonicalId === c.lineId);
    if (!line || packingFingerprint(o, line) !== c.fingerprint)
      throw packingError(
        "This dish changed or was removed. Refresh and check its requirements.",
      );
    const ref = this.ref(o.canonicalId),
      event = ref.collection("commands").doc(packingHash(c.commandId)),
      requestHash = packingHash({ command: c, actorId });
    return this.db.runTransaction(async (tx) => {
      const [headSnap, eventSnap] = await tx.getAll(ref, event);
      const head = headSnap.data() as PackingHead | undefined;
      const view = packingView(o, head);
      if (eventSnap.exists) {
        if (eventSnap.data()!.requestHash !== requestHash)
          throw packingError(
            "Packing command identity was reused with different content.",
          );
        return view;
      }
      if (view.revision !== c.expectedRevision)
        throw packingError(
          "Checklist changed on another device. Refresh and try again.",
        );
      const key = packingHash(c.lineId),
        prior = head?.entries[key];
      if (prior?.fingerprint === c.fingerprint && prior.packed === c.packed)
        return view;
      const at = new Date().toISOString(),
        next: PackingHead = {
          orderId: o.canonicalId,
          revision: view.revision + 1,
          entries: {
            ...head?.entries,
            [key]: {
              fingerprint: c.fingerprint,
              packed: c.packed,
              at,
              actorId,
            },
          },
        };
      // Only checklist state + its immutable audit/receipt are written. No CPU feed, plan, signatures, lifecycle or outbox changes.
      tx.set(ref, next);
      tx.create(event, {
        requestHash,
        commandId: c.commandId,
        action: c.packed ? "dish-packed" : "dish-unpacked",
        actorId,
        at,
        orderId: o.canonicalId,
        orderVersion: o.version,
        lineId: c.lineId,
        fingerprint: c.fingerprint,
        previous: prior || null,
        packed: c.packed,
        revision: next.revision,
      });
      return packingView(o, next);
    });
  }
}
