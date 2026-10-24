import { NextRequest, NextResponse } from "next/server";
import { requestActor } from "../../../lib/actor";

export async function GET(req: NextRequest) {
  try { const actor = await requestActor(req); return NextResponse.json({ name: actor.name }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Not signed in." } }, { status: (error as { status?: number }).status || 401 }); }
}
