import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { getCataloguePackageManifest, rebuildCataloguePackage } from "@/lib/hospitality-catalogue-package";
import { authoriseCatalogueRead } from "@/lib/hospitality-catalogue-read-auth";

/** Normal startup path: the tiny manifest only. ZERO Firestore reads (it is a small object in package storage). */
export async function GET(request: NextRequest) {
  try {
    await authoriseCatalogueRead(request);
    const manifest = await getCataloguePackageManifest();
    if (!manifest) return NextResponse.json({ error: { code: "CATALOGUE_PACKAGE_MISSING", message: "The catalogue package has not been published yet. An administrator can rebuild it." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(manifest, { headers: { "Cache-Control": "no-cache" } }); // revalidate every time; the object itself is immutable
  } catch (error) { return errorResponse(error); }
}

/** Explicit, authenticated rebuild ("missing but rebuildable"): never a side effect of GET. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin"]);
    assertPermission(actor, "hospitality.catalogue.manage");
    const outcome = await rebuildCataloguePackage();
    return NextResponse.json({ status: outcome.status, manifest: outcome.manifest }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
