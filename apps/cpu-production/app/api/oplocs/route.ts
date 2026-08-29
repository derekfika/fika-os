import { NextResponse } from "next/server";
import { listActiveCanonicalOplocs } from "@hub/lib/canonical-oplocs";

export async function GET() {
  try {
    const records = await listActiveCanonicalOplocs();
    return NextResponse.json(
      { oplocs: records.map(record => ({ canonicalId: record.canonicalId, label: String(record.record?.approvedName || record.canonicalId) })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ oplocs: [] }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
