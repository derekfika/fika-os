import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { createServicePrincipal, revokeServicePrincipal } from "@/lib/authmod-core";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

const Body = z.object({ action: z.enum(["create", "revoke"]), principalId: z.string().optional(), name: z.string().trim().min(1).max(160).optional(), ownerDomain: z.string().trim().min(1).max(160).optional(), description: z.string().trim().max(500).optional(), allowedAudiences: z.array(z.string().trim().min(1)).max(30).optional(), reason: z.string().trim().min(3).max(500) }).strict();
async function handleGet(request: NextRequest) { try { const context = await requireAuthmodAdminContext(request); return NextResponse.json({ services: await context.repository.listServicePrincipals() }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
async function handlePost(request: NextRequest) { try { const context = await requireAuthmodAdminContext(request); const body = Body.parse(await request.json()); if (body.action === "create") await createServicePrincipal(context.repository, { actor: context.principal, name: body.name!, ownerDomain: body.ownerDomain!, description: body.description, allowedAudiences: body.allowedAudiences || [] }); else await revokeServicePrincipal(context.repository, { principalId: body.principalId!, actor: context.principal, reason: body.reason }); return NextResponse.json({ services: await context.repository.listServicePrincipals() }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.services.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.services.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
