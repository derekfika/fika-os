import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function handleGet(request: NextRequest) { try { const context = await requireAuthmodAdminContext(request); const q = request.nextUrl.searchParams; return NextResponse.json(await context.repository.listAuditEvents({ limit: Number(q.get("limit") || 50), cursor: q.get("cursor") || undefined, actorId: q.get("actorId") || undefined, targetId: q.get("targetId") || undefined }), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.audit.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
