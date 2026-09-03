import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../../lib/api";
import { internalProductionRequestAllowed } from "../../../../lib/production-internal-auth";
import { getGrabAndGoCatalogueManifest, getGrabAndGoCataloguePackage } from "../../../../lib/grab-and-go-catalogue-package";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    if (!internalProductionRequestAllowed(request)) return NextResponse.json({ error: { code: "INTERNAL_AUTH_REQUIRED", message: "This catalogue boundary is internal-only." } }, { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } });
    if (request.nextUrl.searchParams.get("manifest") === "1") return NextResponse.json({ manifest: await getGrabAndGoCatalogueManifest() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    const packageValue = await getGrabAndGoCataloguePackage();
    return NextResponse.json({ catalogue: packageValue.value, manifest: packageValue.manifest }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
