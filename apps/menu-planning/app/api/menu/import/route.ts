import { NextResponse } from "next/server";
import { inspectWorkbook } from "@/lib/importer";
export async function POST(request: Request) { try { const buffer = await request.arrayBuffer(); const report = inspectWorkbook(buffer, request.headers.get("x-workbook-name") || "uploaded-workbook.xlsx"); return NextResponse.json({ report }); } catch (error) { return NextResponse.json({ error: { message: `Workbook could not be inspected: ${(error as Error).message}` } }, { status: 422 }); } }
