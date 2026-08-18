import { NextResponse } from "next/server";
import { connectionsOverview } from "@hub/lib/connections-service";

export async function GET() {
  try {
    const overview = await connectionsOverview();
    return NextResponse.json(
      { oplocs: overview.oplocs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ oplocs: [] }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
