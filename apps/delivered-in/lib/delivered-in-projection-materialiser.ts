import type { NextRequest } from "next/server";
import { latestSiteMenuArtifactHosted } from "./site-menu-store";
import { siteMenuState } from "./site-menu";
import type { ProjectedDay, Site } from "./projection";
import type { DeliveredInDayProjection } from "./delivered-in-day-projection";
import { projectionId } from "./delivered-in-day-projection";
import { writeDeliveredInProjection } from "./delivered-in-projection-store";

type Review = {
  entries: Map<string, { allergens: Record<string, "clear" | "contains" | "may_contain" | "unrecorded">; allergenState?: "clear" | "contains" | "may_contain" | "unrecorded"; mayContainNotes?: string }>;
  cpuReview: { status: "pending" | "signed"; signatures: Array<{ role: string; printedName: string; signedAt: string }>; drivePdfUrl?: string };
  orderIds: string[];
  updatedAt?: string;
  package?: { packageVersion?: number; contentHash?: string; sourceBundleHash?: string; sourceVersion?: string; contractVersion?: string; sourceCompleteness?: "complete" | "partial"; sourceStatus?: "current" | "partial" | "valid_empty"; releaseId?: string; releaseVersion?: string; signedAt?: string; generatedAt?: string };
};

export type ReviewLoader = (request: NextRequest, date: string, oplocId: string, sourceBundleHash?: string) => Promise<Review | undefined>;

export async function buildDeliveredInDayProjection(input: { request: NextRequest; site: Site; day: ProjectedDay; loadReview: ReviewLoader; governed: boolean }): Promise<DeliveredInDayProjection> {
  const review = await input.loadReview(input.request, input.day.date, input.site.oplocId, input.day.contentHash);
  if (!review) throw Object.assign(new Error("CPU review data is unavailable; the previous Delivered-In projection must be retained."), { code: "CPU_REVIEW_UNAVAILABLE", status: 503 });
  if (review.cpuReview.status !== "signed") throw Object.assign(new Error("CPU allergen data is not signed; no current Delivered-In menu may be generated."), { code: "CPU_REVIEW_UNSIGNED", status: 503 });
  const packetEntries = review.entries;
  const sourceEntries = input.day.entries.filter(entry => {
    const stableDishId = entry.canonicalDishId || entry.sourceEntryId;
    if (!packetEntries.has(stableDishId)) throw Object.assign(new Error(`The signed CPU packet does not contain allocated dish ${stableDishId}.`), { code: "CPU_PACKET_MISSING_DISH", status: 503 });
    return true;
  }).map(entry => {
    const reviewed = review?.entries.get(entry.sourceEntryId);
    const packetId = entry.canonicalDishId || entry.sourceEntryId;
    const packetReviewed = reviewed || packetEntries.get(packetId);
    return {
      ...entry,
      allergensVisible: packetReviewed?.allergenState !== "unrecorded",
      allergens: packetReviewed
        ? packetReviewed.allergenState === "unrecorded"
          ? Object.fromEntries(Object.keys(entry.allergens).map(key => [key, "unrecorded" as const]))
          : Object.fromEntries(Object.keys(entry.allergens).map(key => [key, packetReviewed.allergens[key] || "clear"]))
        : Object.fromEntries(Object.keys(entry.allergens).map(key => [key, "unrecorded" as const])),
      ...(packetReviewed?.mayContainNotes ? { mayContainNotes: packetReviewed.mayContainNotes } : {}),
    };
  });
  const artifact = review?.cpuReview.status === "signed" ? await latestSiteMenuArtifactHosted(input.site.oplocId, input.day.sourceDayId) : undefined;
  const projection: DeliveredInDayProjection = {
    ...input.day,
    // The CPU packet's signed PDF is the safety reference for Delivered-In;
    // do not let an older Menu Planning archive link masquerade as it.
    ...(review?.cpuReview.drivePdfUrl ? { drivePdfUrl: review.cpuReview.drivePdfUrl } : {}),
    projectionId: projectionId(input.site.oplocId, input.day.date),
    projectionVersion: 0,
    contractVersion: "delivered-in.day.v1",
    oplocId: input.site.oplocId,
    oplocLabel: input.site.label,
    serviceDate: input.day.date,
    entries: sourceEntries,
    siteMenu: siteMenuState(input.day, artifact),
    sourceLineage: {
      menu: { publicationId: input.day.publicationId, publicationDayId: input.day.publicationDayId, sourceDayId: input.day.sourceDayId, version: input.day.version, contentHash: input.day.contentHash },
      cpu: {
        orderIds: review.orderIds,
        ...(review.updatedAt ? { updatedAt: review.updatedAt } : {}),
        ...(review.package || {}),
        ...(review.package?.releaseId ? { releaseId: review.package.releaseId } : {}),
      },
      deliveredIn: { ...(artifact?.artifactId ? { siteMenuArtifactId: artifact.artifactId } : {}), generatedAt: new Date().toISOString() },
    },
    generatedAt: new Date().toISOString(),
    state: {
      freshness: "current",
      completeness: review.package?.sourceCompleteness === "partial" ? "partial" : "complete",
      menu: input.day.entries.length ? "present" : "empty",
      cpu: review.package?.sourceStatus === "valid_empty" ? "present" : review.cpuReview.status === "signed" ? "present" : "pending",
      exceptions: [
        ...(!input.governed ? [{ code: "OPLOC_NOT_GOVERNED", source: "integration-hub" as const, message: "The destination is not present in the current OPLOC authority." }] : []),
        ...(!review ? [{ code: "CPU_REVIEW_UNAVAILABLE", source: "cpu-production" as const, message: "CPU review data was unavailable while building this projection." }] : []),
      ],
    },
  };
  return projection;
}

export async function materialiseDeliveredInDay(input: { request: NextRequest; site: Site; day: ProjectedDay; loadReview: ReviewLoader; governed: boolean }) {
  const projection = await buildDeliveredInDayProjection(input);
  return (await writeDeliveredInProjection(projection)).projection;
}
