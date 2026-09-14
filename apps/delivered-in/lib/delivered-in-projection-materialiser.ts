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
  let review: Review | undefined;
  let cpuFailure: { code: string; message: string } | undefined;
  try {
    review = await input.loadReview(input.request, input.day.date, input.site.oplocId, input.day.contentHash);
  } catch (error) {
    const detail = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
    const code = typeof detail.code === "string" ? detail.code : "CPU_DAILY_PACKET_INVALID";
    cpuFailure = { code, message: typeof detail.message === "string" ? detail.message : "CPU allergen data could not be verified." };
  }
  const packetEntries = review?.entries;
  const missingDish = review?.cpuReview.status === "signed"
    ? input.day.entries.find(entry => !packetEntries?.has(entry.canonicalDishId || entry.sourceEntryId))
    : undefined;
  if (missingDish) cpuFailure = { code: "CPU_PACKET_MISSING_DISH", message: `The signed CPU packet does not contain allocated dish ${missingDish.canonicalDishId || missingDish.sourceEntryId}.` };
  const sourceEntries = input.day.entries.map(entry => {
    const packetId = entry.canonicalDishId || entry.sourceEntryId;
    const packetReviewed = review?.cpuReview.status === "signed" && !cpuFailure ? packetEntries?.get(packetId) : undefined;
    const allergenKeys = Object.keys(entry.allergens);
    const allergens = packetReviewed && packetReviewed.allergenState !== "unrecorded"
      ? Object.fromEntries(allergenKeys.map(key => [key, packetReviewed.allergens[key] || "unrecorded" as const]))
      : Object.fromEntries(allergenKeys.map(key => [key, "unrecorded" as const]));
    const allergensVisible = review?.cpuReview.status === "signed" && !cpuFailure && packetReviewed?.allergenState !== "unrecorded" && Object.values(allergens).every(state => state !== "unrecorded");
    return {
      ...entry,
      allergensVisible,
      allergens,
      ...(packetReviewed?.mayContainNotes ? { mayContainNotes: packetReviewed.mayContainNotes } : {}),
    };
  });
  const artifact = review?.cpuReview.status === "signed" && !cpuFailure ? await latestSiteMenuArtifactHosted(input.site.oplocId, input.day.sourceDayId) : undefined;
  const cpuException = cpuFailure
    || (!review ? { code: "CPU_REVIEW_UNAVAILABLE", message: "CPU allergen data was unavailable while building this projection." } : review.cpuReview.status !== "signed" ? { code: "CPU_REVIEW_UNSIGNED", message: "CPU allergen data is pending review/signoff." } : undefined);
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
        orderIds: review?.orderIds || [],
        ...(review?.updatedAt ? { updatedAt: review.updatedAt } : {}),
        ...(review?.package || {}),
        ...(review?.package?.releaseId ? { releaseId: review.package.releaseId } : {}),
      },
      deliveredIn: { ...(artifact?.artifactId ? { siteMenuArtifactId: artifact.artifactId } : {}), generatedAt: new Date().toISOString() },
    },
    generatedAt: new Date().toISOString(),
    state: {
      freshness: "current",
      completeness: review?.package?.sourceCompleteness === "partial" ? "partial" : "complete",
      menu: input.day.entries.length ? "present" : "empty",
      cpu: cpuException ? "unavailable" : review?.package?.sourceStatus === "valid_empty" ? "present" : review?.cpuReview.status === "signed" ? "present" : "pending",
      exceptions: [
        ...(!input.governed ? [{ code: "OPLOC_NOT_GOVERNED", source: "integration-hub" as const, message: "The destination is not present in the current OPLOC authority." }] : []),
        ...(cpuException ? [{ ...cpuException, source: "cpu-production" as const }] : []),
      ],
    },
  };
  return projection;
}

export async function materialiseDeliveredInDay(input: { request: NextRequest; site: Site; day: ProjectedDay; loadReview: ReviewLoader; governed: boolean }) {
  const projection = await buildDeliveredInDayProjection(input);
  return (await writeDeliveredInProjection(projection)).projection;
}
