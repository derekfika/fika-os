import { NextRequest, NextResponse } from "next/server";
import { callerFor, isHubError } from "../../../lib/hub-client";

export async function GET(req: NextRequest) {
  try { const { actor } = await callerFor(req); return NextResponse.json({ name: actor.name || "Signed in" }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Not signed in." } }, { status: isHubError(error) ? error.status : 401 }); }
}
