import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { recordAdHocAllergenChecker } from "@/lib/ad-hoc-allergen-checker";
import { adHocOrderStatus } from "@/lib/production-domain";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { adHocProductionOrderId, type AdHocAllergenCheckerReport } from "../../../../../shared/ad-hoc-production-contract";

const text = (max: number) => z.string().trim().min(1).max(max);
const Report = z.object({
  canonicalId: text(200), state: z.enum(["signed", "withdrawn"]), releaseId: text(300), releaseVersion: z.number().int().positive(), sourceRevision: z.number().int().positive(),
  fileName: z.string().trim().max(300).optional(), driveUrl: z.string().trim().url().max(1000).optional(), signedAt: z.string().max(40).optional(),
  signers: z.array(z.object({ role: z.enum(["production_chef", "head_chef_site_manager"]), name: text(160) }).strict()).max(4).optional(), reason: z.string().trim().max(300).optional(),
}).strict() satisfies z.ZodType<AdHocAllergenCheckerReport>;

/**
 * CPU -> Hub: CPU reports the signed allergen checker of an Ad-Hoc order (or its withdrawal). Same CPU authority as lifecycle
 * transitions. The report is a derived projection for the requester; CPU remains the release authority.
 */
async function handlePost(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin", "reviewer"]);
    assertPermission(actor, "canonical.edit");
    const report = Report.parse(await request.json().catch(() => { throw Object.assign(new Error("A JSON body is required."), { status: 422 }); }));
    if (report.state === "signed" && !report.driveUrl) throw Object.assign(new Error("A signed allergen checker needs its PDF link."), { status: 422, code: "AD_HOC_CHECKER_LINK_REQUIRED" });
    const requestId = report.canonicalId.startsWith(adHocProductionOrderId("")) ? report.canonicalId.slice(adHocProductionOrderId("").length) : "";
    if (!requestId || !(await adHocOrderStatus(requestId))) throw Object.assign(new Error("No Ad-Hoc Production Order exists for this allergen checker."), { status: 404, code: "AD_HOC_ORDER_NOT_FOUND" });
    const result = await recordAdHocAllergenChecker(report);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}
export async function POST(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.ad-hoc-production.allergen-checker", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request));
}
