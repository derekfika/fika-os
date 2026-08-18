import { NextResponse } from "next/server";
import { connectionsOverview } from "../../../../integration-hub/lib/connections-service";

export async function GET() {
  try {
    const overview = await connectionsOverview();
    const oplocs = overview.oplocs
      .filter((oploc) => oploc.lifecycleState === "active")
      .map((oploc) => ({ canonicalId: oploc.canonicalId, label: oploc.label || oploc.canonicalId }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return NextResponse.json({ oplocs }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ oplocs: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
