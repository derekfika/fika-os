import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";

export async function GET(request: NextRequest) { try { const context = await requireAuthmodAdminContext(request); const q = request.nextUrl.searchParams; return NextResponse.json(await context.repository.listAuditEvents({ limit: Number(q.get("limit") || 50), cursor: q.get("cursor") || undefined, actorId: q.get("actorId") || undefined, targetId: q.get("targetId") || undefined }), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
