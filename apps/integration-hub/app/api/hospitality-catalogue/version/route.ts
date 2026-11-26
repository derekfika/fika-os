import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission, hasPermission } from "@/lib/authmod";
import { db } from "@/lib/firebase-admin";
import { traceHospitalityCatalogue } from "@/lib/hospitality-catalogue-trace";
import { readCatalogueAdminVersion } from "@/lib/hospitality-catalogue-version";

export function GET(request: NextRequest) {
  return traceHospitalityCatalogue(request, "admin.version", "/api/hospitality-catalogue/version", async () => {
    try {
      const actor = await requireActor(request);
      assertPermission(actor, "canonical.view");
      const version = await readCatalogueAdminVersion(db);
      return NextResponse.json({
        ...version,
        canManage: hasPermission(actor, "hospitality.catalogue.manage"),
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { return errorResponse(error); }
  });
}
