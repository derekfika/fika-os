import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { authoriseCatalogueRead } from "@/lib/hospitality-catalogue-read-auth";
import { getPublicCataloguePackageManifest } from "@/lib/hospitality-catalogue-package";
import { traceHospitalityCatalogue } from "@/lib/hospitality-catalogue-trace";

/** Private bridge-readable head for the public-safe package; only stored metadata is read. */
export function GET(request: NextRequest) {
  return traceHospitalityCatalogue(request, "public.manifest", "/api/hospitality-catalogue/public-package", async () => {
    try {
      await authoriseCatalogueRead(request);
      const manifest = await getPublicCataloguePackageManifest();
      if (!manifest) return NextResponse.json({ error: { code: "CATALOGUE_PACKAGE_MISSING", message: "The public booking catalogue has not been published yet." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json(manifest, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return errorResponse(error); }
  });
}
