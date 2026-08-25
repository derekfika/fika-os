import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { resolveAccessImportRow, type ImportDecision } from "@/lib/authmod-core";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { const context = await requireAuthmodAdminContext(request); const body = await request.json() as { rowId: string; decision: ImportDecision }; return NextResponse.json({ resolution: await resolveAccessImportRow(context.repository, { importId: (await params).id, rowId: body.rowId, actor: context.principal, decision: body.decision }) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
