import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { internalTokenAllowed } from "../../../../../../shared/internal-auth";
import { adHocProductionOrderId, type AdHocAllergenCheckerProjection } from "../../../../../../shared/ad-hoc-production-contract";
import { applyAdHocAllergenCheckerProjection } from "@/lib/production-domain";
import { currentCpuAdHocAllergenChecker } from "@/lib/cpu-ad-hoc-allergen-checker-client";

export const dynamic = "force-dynamic";

const Signature = z.object({ role: z.enum(["production_chef", "head_chef_site_manager"]), printedName: z.string().trim().min(1).max(120), signedAt: z.string().datetime() }).strict();
const Projection = z.object({
  requestId: z.string().min(1).max(120), canonicalId: z.string().min(1).max(240), releaseId: z.string().min(1).max(200),
  releaseVersion: z.number().int().positive(), sourceRevision: z.number().int().positive(), sourceVersion: z.number().int().positive(),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/i), state: z.enum(["current", "revoked"]), signedAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(), eventId: z.string().min(1).max(500),
  signatures: z.array(Signature).max(10), pdfAvailable: z.boolean(), fileName: z.string().max(240).optional(),
}).strict();

export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const parsed = Projection.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: { message: "A valid CPU allergen checker projection is required." } }, { status: 422, headers: { "Cache-Control": "no-store" } });
  const value = parsed.data;
  if (value.canonicalId !== adHocProductionOrderId(value.requestId) || value.eventId !== `adhoc-allergen-checker:${value.requestId}:${value.releaseId}:${value.state}`
    || (value.state === "current" && (!value.pdfAvailable || !value.fileName || !value.signatures.some(signature => signature.role === "production_chef") || !value.signatures.some(signature => signature.role === "head_chef_site_manager")))
    || (value.state === "revoked" && value.pdfAvailable)) {
    return NextResponse.json({ error: { message: "The allergen checker projection does not match its release lineage." } }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  let authority;
  try { authority = await currentCpuAdHocAllergenChecker(value.canonicalId); }
  catch { return NextResponse.json({ error: { message: "Current CPU release authority is unavailable; the Hub report was not applied." } }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  const sameSigners = (authority.signatures || []).map(signature => `${signature.role}\u0000${signature.printedName}\u0000${signature.signedAt}`).sort().join("\n")
    === value.signatures.map(signature => `${signature.role}\u0000${signature.printedName}\u0000${signature.signedAt}`).sort().join("\n");
  const expectedState = value.state === "current" ? "ready" : "revoked";
  if (authority.state !== expectedState || authority.releaseId !== value.releaseId || authority.releaseVersion !== value.releaseVersion
    || authority.sourceVersion !== value.sourceVersion || authority.sourceRevision !== value.sourceRevision || authority.sourceContentHash !== value.sourceContentHash
    || authority.signedAt !== value.signedAt || !sameSigners) {
    return NextResponse.json({ error: { message: "The CPU release changed or does not match this checker report." } }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const { fileName: _fileName, ...safeProjection } = value;
  const result = await applyAdHocAllergenCheckerProjection(safeProjection as AdHocAllergenCheckerProjection);
  if (result.reason === "order-not-found") return NextResponse.json({ error: { message: "The originating Ad-Hoc order was not found." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
