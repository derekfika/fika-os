import type { HospitalityMatrixStorageContext } from "@fika/server-shared/hospitality-matrix-storage";
import type { CanonicalBooking } from "./hospitality-booking-service";
import type { ProductionOrder } from "./production-domain";
import type { CanonicalRecord } from "./types";
import { resolveOplocId } from "./oploc-merge";

type StorageReads = {
  booking(id: string): Promise<Pick<CanonicalBooking, "canonicalId" | "service">>;
  settings(booking: Pick<CanonicalBooking, "service">): Promise<{ googleMatrixFolderId?: string }>;
  oploc(id: string): Promise<CanonicalRecord | undefined>;
};

/** Known-ID reads only; resolve historical identities through Hub's merge authority. */
export async function hospitalityMatrixStorageContext(
  order: Pick<ProductionOrder, "origin" | "sourceBookingId" | "destinationOplocId">,
  reads: StorageReads,
): Promise<HospitalityMatrixStorageContext> {
  if (order.origin !== "hospitality_booking") return { kind: "cpu-default" };
  const booking = await reads.booking(order.sourceBookingId);
  if (booking.canonicalId !== order.sourceBookingId || !booking.service.oplocId?.trim()) {
    throw new Error("Matrix storage requires the canonical Hospitality booking and its OPLOC.");
  }
  const records = new Map<string, CanonicalRecord>();
  async function canonicalId(id: string) {
    let current = id;
    for (let depth = 0; depth < 10; depth += 1) {
      let record = records.get(current);
      if (!record) {
        record = await reads.oploc(current);
        if (!record || record.canonicalId !== current || record.entityType !== "OPLOC") {
          throw new Error("Matrix storage OPLOC could not be verified in Hub.");
        }
        records.set(current, record);
      }
      const resolved = resolveOplocId([...records.values()], id);
      if (resolved !== current) { current = resolved; continue; }
      if (String(record.record.lifecycleState || "active") !== "active" || record.lifecycleStatus === "archived" || record.publicationStatus === "withdrawn") {
        throw new Error("Matrix storage requires an active canonical OPLOC.");
      }
      return current;
    }
    throw new Error("Matrix storage OPLOC redirect chain exceeds the supported depth.");
  }
  const oplocId = await canonicalId(booking.service.oplocId);
  if (order.destinationOplocId && await canonicalId(order.destinationOplocId) !== oplocId) {
    throw new Error("Matrix storage booking and Production Order OPLOCs conflict.");
  }
  const settings = await reads.settings(booking);
  return { kind: "hospitality-site", oplocId, ...(settings.googleMatrixFolderId?.trim() ? { googleMatrixFolderId: settings.googleMatrixFolderId.trim() } : {}) };
}
