import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function handleGet(request: NextRequest) { try { const context = await requireAuthmodAdminContext(request); const search = request.nextUrl.searchParams.get("search") || ""; return NextResponse.json({ applications: (await context.repository.listApplications()).filter(value => value.enabled), oplocs: await context.repository.listActiveOplocs(), legends: await context.repository.listLegendReferences(search, 1000) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.options.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
