import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { assignPrimaryCustodian, assignSite, grantAuthority, grantStandardApplicationAccess, revokeAuthority, revokeSite, revokeStandardApplicationAccess, setFullAccess, setIdentityKind, setIdentityStatus, linkLegend } from "@/lib/authmod-core";
import { buildAuthmodAccount } from "@/lib/authmod-admin-read-model";

const Command = z.object({ action: z.enum(["status", "kind", "legend", "custodian", "site", "app", "full-access", "authority-grant", "authority-revoke"]), expectedVersion: z.number().int().positive().optional(), reason: z.string().trim().min(3).max(500), status: z.enum(["active", "inactive", "revoked"]).optional(), identityKind: z.enum(["person", "operational"]).optional(), representedOplocId: z.string().trim().min(1).optional(), operationalPurpose: z.string().trim().max(200).optional(), legendId: z.string().trim().min(1).optional(), custodianLegendId: z.string().trim().min(1).optional(), oplocId: z.string().trim().min(1).optional(), appId: z.string().trim().min(1).optional(), enabled: z.boolean().optional(), fullAccess: z.boolean().optional(), grantId: z.string().trim().min(1).optional(), resource: z.string().trim().min(1).optional(), authorityAction: z.enum(["View", "Contribute", "Manage", "Approve", "Publish", "Administer"]).optional(), scope: z.object({ kind: z.enum(["organisation", "oploc", "resource"]), ids: z.array(z.string()).max(100) }).optional() }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthmodAdminContext(request); const id = (await params).id; const command = Command.parse(await request.json()); const identity = await context.repository.getIdentity(id); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 }); if (command.expectedVersion !== undefined && command.expectedVersion !== identity.version) throw Object.assign(new Error("This account changed since it was opened. Refresh and review before saving."), { status: 409, code: "AUTHMOD_VERSION_CONFLICT" });
    if (command.action === "status") await setIdentityStatus(context.repository, { identityId: id, status: command.status!, actor: context.principal, reason: command.reason });
    else if (command.action === "kind") await setIdentityKind(context.repository, { identityId: id, identityKind: command.identityKind!, representedOplocId: command.representedOplocId, operationalPurpose: command.operationalPurpose, actor: context.principal, reason: command.reason });
    else if (command.action === "legend") await linkLegend(context.repository, { identityId: id, legendId: command.legendId!, actor: context.principal, reason: command.reason });
    else if (command.action === "custodian") await assignPrimaryCustodian(context.repository, { operationalIdentityId: id, custodianLegendId: command.custodianLegendId!, actor: context.principal, reason: command.reason });
    else if (command.action === "site") command.enabled ? await assignSite(context.repository, { identityId: id, oplocId: command.oplocId!, actor: context.principal, reason: command.reason }) : await revokeSite(context.repository, { identityId: id, oplocId: command.oplocId!, actor: context.principal, reason: command.reason });
    else if (command.action === "app") command.enabled ? await grantStandardApplicationAccess(context.repository, { identityId: id, appId: command.appId!, actor: context.principal }) : await revokeStandardApplicationAccess(context.repository, { identityId: id, appId: command.appId!, actor: context.principal, reason: command.reason });
    else if (command.action === "full-access") await setFullAccess(context.repository, { identityId: id, fullAccess: command.fullAccess!, actor: context.principal, reason: command.reason });
    else if (command.action === "authority-grant") await grantAuthority(context.repository, { subjectId: id, subjectType: "interactive", actor: context.principal, appId: command.appId!, resource: command.resource!, action: command.authorityAction!, scope: command.scope!, reason: command.reason });
    else if (command.action === "authority-revoke") await revokeAuthority(context.repository, { grantId: command.grantId!, actor: context.principal, reason: command.reason });
    return NextResponse.json({ account: await buildAuthmodAccount(context.repository, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
