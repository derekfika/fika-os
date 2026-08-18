import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { serviceArrangementsOverview } from "@/lib/service-arrangements-service";
export async function GET(request: NextRequest) { try { const actor = await requireActor(request); assertPermission(actor, "canonical.view"); return NextResponse.json(await serviceArrangementsOverview(), { headers: { "Cache-Control": "no-store, max-age=0" } }); } catch (error) { return errorResponse(error); } }
