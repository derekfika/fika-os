import { NextRequest, NextResponse } from "next/server";
import { actorCanManageOrganisation, actorCanWriteOneOff, menuReadScopeKey, resolveMenuActor } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const actor = await resolveMenuActor(request);
    return NextResponse.json({
      canManage: actor.role !== "viewer",
      canManageOrganisation: actorCanManageOrganisation(actor),
      canManageAllSites: actorCanWriteOneOff(actor, "manage"),
      canPublish: actor.role === "integration-admin",
      canPublishAllSites: actorCanWriteOneOff(actor, "publish"),
      manageOplocIds: actor.permissions?.manageOplocIds ?? [],
      scopeKey: menuReadScopeKey(actor),
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 503, headers });
  }
}
