import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { publishBrochureCandidate, publishReviewedBrochureImport, reviewBrochureCandidate } from "@/lib/hospitality-catalogue-service";
import { db } from "@/lib/firebase-admin";
import type { CanonicalRecord } from "@/lib/types";

const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), candidateId: z.string().min(8), proposedName: z.string().optional(), proposedCategory: z.string().optional(), proposedItemId: z.string().min(8).optional(), oplocId: z.string().min(8).optional(), operationalAreaId: z.string().min(8).optional(), offeringMode: z.enum(["standard", "quote_only"]).optional(), priceAmount: z.number().nonnegative().optional(), vatRate: z.number().min(0).max(1).optional(), effectiveFrom: z.string().date().optional() }).strict(),
  z.object({ action: z.literal("ignore"), candidateId: z.string().min(8), ignoreReason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ action: z.literal("publish"), candidateId: z.string().min(8) }).strict(),
  z.object({ action: z.literal("publish-import"), brochureImportId: z.string().min(8) }).strict(),
]);

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.edit"); const command = Command.parse(await request.json());
    if (command.action === "publish" || command.action === "publish-import") { if (actor.role !== "integration-admin") throw Object.assign(new Error("Only an Integration Administrator can publish reviewed hospitality records."), { status: 403 }); return NextResponse.json(command.action === "publish" ? await publishBrochureCandidate(actor, command.candidateId) : await publishReviewedBrochureImport(actor, command.brochureImportId)); }
    return NextResponse.json(await reviewBrochureCandidate(actor, command));
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: NextRequest) {
  try {
    await requireActor(request, ["integration-admin", "reviewer"]);
    const records = (await db.collection("integrationHubCanonical").get()).docs.map(document => document.data() as CanonicalRecord);
    const imports = records.filter(record => record.entityType === "Hospitality Brochure Import").sort((a, b) => String(b.record.createdAt).localeCompare(String(a.record.createdAt)));
    const candidates = records.filter(record => record.entityType === "Hospitality Brochure Candidate");
    const reviewState = request.nextUrl.searchParams.get("reviewState");
    return NextResponse.json({ imports, candidates: reviewState ? candidates.filter(candidate => candidate.record.reviewState === reviewState) : candidates, menuItems: records.filter(record => record.entityType === "Hospitality Menu Item"), oplocs: records.filter(record => record.entityType === "OPLOC" && record.record.lifecycleState === "active" && record.publicationStatus === "published"), areas: records.filter(record => record.entityType === "Operational Area" && record.record.lifecycleState === "active" && record.publicationStatus === "published") });
  } catch (error) { return errorResponse(error); }
}
