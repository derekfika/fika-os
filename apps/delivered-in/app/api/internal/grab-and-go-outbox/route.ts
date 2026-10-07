import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { recoverGrabHandoffs } from "../../../../lib/grab-and-go-handoff";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal recovery authority required." } }, { status: 403 });
  try {
    const body = await request.json() as { limit?: number };
    if (Object.keys(body).some(key => key !== "limit")) return NextResponse.json({ error: { message: "Only bounded recovery is supported." } }, { status: 422 });
    return NextResponse.json(await recoverGrabHandoffs(body.limit));
  } catch (error) { return NextResponse.json({ error: { message: "Grab & Go recovery failed." } }, { status: Number((error as { status?: number }).status) || 503 }); }
}
