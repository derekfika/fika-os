import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { serviceArrangementsOverview } from "@/lib/service-arrangements-service";
export async function GET(request: NextRequest) {
  try {
    let actor;
    try {
      actor = await requireActor(request);
    } catch (error) {
      // Match the local-development fallback used by the canonical OPLOC
      // endpoint. Production still requires a real synthetic local identity.
      if (process.env.NODE_ENV === "production" || (error as { status?: number }).status !== 401) throw error;
      actor = { role: "integration-admin" } as never;
    }
    assertPermission(actor, "canonical.view");
    return NextResponse.json(await serviceArrangementsOverview(), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return errorResponse(error);
  }
}
