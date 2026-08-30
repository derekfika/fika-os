import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { buildAuthmodAccounts } from "@/lib/authmod-admin-read-model";
import { createAuthIdentity } from "@/lib/authmod-core";
import { z } from "zod";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

const CreateBody = z.object({ displayName: z.string().trim().min(1).max(160), email: z.string().trim().email().optional(), identityKind: z.enum(["person", "operational"]), representedOplocId: z.string().trim().optional(), operationalPurpose: z.string().trim().max(160).optional() });

async function handleGet(request: NextRequest) {
  try { const context = await requireAuthmodAdminContext(request); const q = request.nextUrl.searchParams; return NextResponse.json({ accounts: await buildAuthmodAccounts(context.repository, { search: q.get("search") || undefined, kind: q.get("kind") || undefined, status: q.get("status") || undefined, siteId: q.get("siteId") || undefined, appId: q.get("appId") || undefined, special: q.get("special") === "true", expiringSoon: q.get("expiringSoon") === "true" }) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

async function handlePost(request: NextRequest) {
  try { const context = await requireAuthmodAdminContext(request); const body = CreateBody.parse(await request.json()); if (body.identityKind === "operational" && !body.representedOplocId && !body.operationalPurpose) throw Object.assign(new Error("Operational accounts need an OPLOC or operational function."), { status: 422, code: "AUTHMOD_OPERATIONAL_CONTEXT_REQUIRED" }); const identity = await createAuthIdentity(context.repository, { actor: context.principal, displayName: body.displayName, email: body.email, identityKind: body.identityKind, representedOplocId: body.identityKind === "operational" ? body.representedOplocId : undefined, operationalPurpose: body.identityKind === "operational" ? body.operationalPurpose : undefined, provenance: "manual-override" }); return NextResponse.json({ identity }, { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.accounts.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.accounts.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
