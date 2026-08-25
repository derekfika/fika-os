import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { commitAccessImportAsAdmin } from "@/lib/authmod-core";

const Body = z.object({
  idempotencyKey: z.string().trim().min(3).max(200),
  decisions: z.record(z.string(), z.object({
    identityId: z.string().optional(), accept: z.boolean(), identityKind: z.enum(["person", "operational"]).optional(), legendId: z.string().optional(), representedOplocId: z.string().optional(), operationalPurpose: z.string().optional(), primaryCustodianLegendId: z.string().optional(),
    createIdentity: z.object({ displayName: z.string().min(1), email: z.string().optional(), externalProvider: z.string().optional(), externalUid: z.string().optional() }).optional(),
  })).default({}),
});
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { const context = await requireAuthmodAdminContext(request); const body = Body.parse(await request.json()); return NextResponse.json(await commitAccessImportAsAdmin(context.repository, { importId: (await params).id, actor: context.principal, decisions: body.decisions, idempotencyKey: body.idempotencyKey }), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
