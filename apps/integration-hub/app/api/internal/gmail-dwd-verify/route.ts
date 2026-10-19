import { NextRequest, NextResponse } from "next/server";
import { internalProductionRequestAllowed } from "../../../../lib/production-internal-auth";
import { verifyGmailDwd } from "../../../../lib/workspace-gmail-dwd";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const mode = process.env.FIKA_RUNTIME_MODE;
  if ((mode !== "staging" && mode !== "production") || process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED !== "false") return new NextResponse(null, { status: 404 });
  if (mode === "production" && process.env.FIKA_HOSPITALITY_EMAIL_DWD_VERIFY_ENABLED !== "true") return new NextResponse(null, { status: 404 });
  if (!internalProductionRequestAllowed(request)) return new NextResponse(null, { status: 401 });
  const result = await verifyGmailDwd();
  return NextResponse.json(result, { status: result.tokenRequestSucceeded ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
