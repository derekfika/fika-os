import { NextRequest, NextResponse } from "next/server";
import { importWorkbook, saveSnapshot, listWeeks, validateWeek } from "@/lib/rolling-menu";
import { readDeliveredInOplocs } from "@/lib/oploc-authority";

export async function POST(request: NextRequest) {
  try {
    const name = request.headers.get("x-workbook-name") || "uploaded-workbook.xlsx";
    const result = importWorkbook(Buffer.from(await request.arrayBuffer()), name, "historical-importer", await readDeliveredInOplocs(request));
    const snapshot = await saveSnapshot(result.snapshot);
    return NextResponse.json({ snapshot, weeks: await listWeeks(), blockers: validateWeek(snapshot), warnings: result.warnings, recognisedEntries: result.recognisedEntries });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Workbook import failed." } }, { status: 400 }); }
}
