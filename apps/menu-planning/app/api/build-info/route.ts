import { NextResponse } from "next/server";
import { fikaBuildIdentity } from "@fika/server-shared/build-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { buildSha } = fikaBuildIdentity();
    return NextResponse.json({ appId: "menu-planning", buildSha }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ code: "BUILD_PROVENANCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
