import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireLogisticsAccess } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { assertSharedPlannerAccess } from "@/lib/resource-authority";
import { fetchOplocs } from "@/lib/upstream";

const locations = z.array(z.object({ id: z.string().min(1), label: z.string().min(1), address: z.string().optional() })).min(1).max(1500);

export async function GET(request: NextRequest) {
  try {
    const principal = await requireLogisticsAccess(request);
    // Movement creation is shared planner work; this catalogue does not grant access.
    assertSharedPlannerAccess(principal);
    try {
      const oplocs = locations.parse(await fetchOplocs(request.headers.get("cookie") || undefined));
      return NextResponse.json({ oplocs }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      throw Object.assign(new Error("Governed locations are temporarily unavailable."), { status: 503, code: "LOGISTICS_LOCATIONS_UNAVAILABLE", cause });
    }
  } catch (error) { return errorResponse(error); }
}
