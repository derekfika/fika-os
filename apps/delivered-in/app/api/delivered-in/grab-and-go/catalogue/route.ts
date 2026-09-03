import { NextRequest, NextResponse } from "next/server";
import { resolveAccess } from "../../../../../lib/server";
import { getGrabAndGoCatalogueManifest, getGrabAndGoCataloguePackage } from "../../../../../lib/grab-and-go-catalogue-client";
import { assertAuthorisedOploc } from "../../../../../lib/projection";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveAccess(request, "grab-and-go");
    const selected = request.nextUrl.searchParams.get("oplocId") || resolved.access.oplocIds[0];
    if (!selected) throw Object.assign(new Error("Select an authorised Grab & Go site first."), { status: 422 });
    assertAuthorisedOploc(resolved.access, selected);
    if (request.nextUrl.searchParams.get("manifest") === "1") return NextResponse.json({ manifest: await getGrabAndGoCatalogueManifest() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    const packageValue = await getGrabAndGoCataloguePackage();
    return NextResponse.json({ catalogue: packageValue.catalogue, manifest: packageValue.manifest }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Grab & Go catalogue could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502, headers: { "Cache-Control": "no-store, max-age=0" } }); }
}
