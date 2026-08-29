import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { hospitalityMenuProductionRouting } from "@/lib/connections-service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "canonical.view");
    return NextResponse.json({ routing: await hospitalityMenuProductionRouting() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
