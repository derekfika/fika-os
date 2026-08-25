import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { const context = await requireAuthmodAdminContext(request); const id = (await params).id; const record = await context.repository.getImport(id); if (!record) throw Object.assign(new Error("Import was not found."), { status: 404 }); return NextResponse.json({ record, resolutions: await context.repository.listImportResolutions(id) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
