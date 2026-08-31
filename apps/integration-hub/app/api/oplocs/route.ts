import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

export const dynamic = "force-dynamic";

async function handleGet(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "canonical.view");
    // The package is display/reference data only. AUTHMOD is evaluated above;
    // package possession or contents never grant an OPLOC entitlement.
    const { value } = await getOplocReadPackage();
    return NextResponse.json(validateOplocReadPackage(value), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "OPLOC authority is unavailable." } }, { status: Number((error as { status?: number }).status) || 503 });
  }
}

export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.oploc.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request));
}
