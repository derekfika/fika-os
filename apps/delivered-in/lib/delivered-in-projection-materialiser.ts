import type { NextRequest } from "next/server";
import { latestSiteMenuArtifactHosted } from "./site-menu-store";
import { siteMenuState } from "./site-menu";
import type { ProjectedDay, Site } from "./projection";
import type { DeliveredInDayProjection } from "./delivered-in-day-projection";
import { projectionId } from "./delivered-in-day-projection";
import { writeDeliveredInProjection } from "./delivered-in-projection-store";

type Review = {
  entries: Map<string, { allergens: Record<string, "clear" | "contains" | "may_contain" | "unrecorded">; mayContainNotes?: string }>;
  cpuReview: { status: "pending" | "signed"; signatures: Array<{ role: string; printedName: string; signedAt: string }>; drivePdfUrl?: string };
  orderIds: string[];
  updatedAt?: string;
  package?: { packageVersion?: number; contentHash?: string; sourceVersion?: string; contractVersion?: string; sourceCompleteness?: "complete" | "partial"; sourceStatus?: "current" | "partial" | "valid_empty"; generatedAt?: string };
};

export type ReviewLoader = (request: NextRequest, date: string, oplocId: string) => Promise<Review | undefined>;

export async function buildDeliveredInDayProjection(input: { request: NextRequest; site: Site; day: ProjectedDay; loadReview: ReviewLoader; governed: boolean }): Promise<DeliveredInDayProjection> {
  const review = await input.loadReview(input.request, input.day.date, input.site.oplocId);
  if (!review) throw Object.assign(new Error("CPU review data is unavailable; the previous Delivered-In projection must be retained."), { code: "CPU_REVIEW_UNAVAILABLE", status: 503 });
  const sourceEntries = input.day.entries.map(entry => {
    const reviewed = review?.entries.get(entry.sourceEntryId);
    return {
      ...entry,
      allergensVisible: review?.cpuReview.status === "signed",
      allergens: review?.cpuReview.status === "signed" && reviewed ? reviewed.allergens : Object.fromEntries(Object.keys(entry.allergens).map(key => [key, "unrecorded" as const])),
      ...(reviewed?.mayContainNotes ? { mayContainNotes: reviewed.mayContainNotes } : {}),
    };
  });
  const artifact = review?.cpuReview.status === "signed" ? await latestSiteMenuArtifactHosted(input.site.oplocId, input.day.sourceDayId) : undefined;
  const projection: DeliveredInDayProjection = {
    ...input.day,
    projectionId: projectionId(input.site.oplocId, input.day.date),
    projectionVersion: 0,
    contractVersion: "delivered-in.day.v1",
    oplocId: input.site.oplocId,
    oplocLabel: input.site.label,
    serviceDate: input.day.date,
    entries: sourceEntries,
    siteMenu: review?.cpuReview.status === "signed" ? siteMenuState(input.day, artifact) : { status: "none" },
    sourceLineage: {
      menu: { publicationId: input.day.publicationId, publicationDayId: input.day.publicationDayId, sourceDayId: input.day.sourceDayId, version: input.day.version, contentHash: input.day.contentHash },
      cpu: {
        orderIds: review.orderIds,
        ...(review.updatedAt ? { updatedAt: review.updatedAt } : {}),
        ...(review.package || {}),
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
