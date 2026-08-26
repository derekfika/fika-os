import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { assignPrimaryCustodian, assignSite, createDelegation, grantAuthority, grantStandardApplicationAccess, revokeAuthority, revokeSite, revokeStandardApplicationAccess, setFullAccess, setIdentityKind, setIdentityStatus, linkLegend } from "@/lib/authmod-core";
import { buildAuthmodAccount } from "@/lib/authmod-admin-read-model";
import { resolveAuthmodReason } from "@/lib/authmod-reasons";

const common = { expectedVersion: z.number().int().positive().optional(), reason: z.string().trim().min(3).max(500).optional(), reasonCode: z.string().trim().optional(), reasonNote: z.string().trim().max(500).optional() };
const period = { accessType: z.enum(["permanent", "temporary", "cover"]).optional(), effectiveFrom: z.string().datetime().optional(), effectiveTo: z.string().datetime().optional() };
const Command = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("status"), status: z.enum(["active", "inactive", "revoked"]) }),
  z.object({ ...common, action: z.literal("kind"), identityKind: z.enum(["person", "operational"]), representedOplocId: z.string().trim().min(1).optional(), operationalPurpose: z.string().trim().max(200).optional() }),
  z.object({ ...common, action: z.literal("legend"), legendId: z.string().trim().min(1) }),
  z.object({ ...common, action: z.literal("custodian"), custodianLegendId: z.string().trim().min(1) }),
  z.object({ ...common, action: z.literal("site"), oplocId: z.string().trim().min(1), enabled: z.boolean(), ...period }),
  z.object({ ...common, action: z.literal("app"), appId: z.string().trim().min(1), enabled: z.boolean(), ...period }),
  z.object({ ...common, action: z.literal("full-access"), fullAccess: z.boolean() }),
  z.object({ ...common, action: z.literal("authority-grant"), appId: z.string().trim().min(1), resource: z.string().trim().min(1), authorityAction: z.enum(["View", "Contribute", "Manage", "Approve", "Publish", "Administer"]), scope: z.object({ kind: z.enum(["organisation", "oploc", "resource"]), ids: z.array(z.string()).max(100) }), effectiveFrom: z.string().datetime().optional(), effectiveTo: z.string().datetime().optional() }),
  z.object({ ...common, action: z.literal("authority-revoke"), grantId: z.string().trim().min(1) }),
  z.object({ ...common, action: z.literal("delegation"), delegatorId: z.string().trim().min(1), sourceGrantId: z.string().trim().min(1), authorityAction: z.enum(["View", "Contribute", "Manage", "Approve", "Publish", "Administer"]), scope: z.object({ kind: z.enum(["organisation", "oploc", "resource"]), ids: z.array(z.string()).max(100) }), effectiveFrom: z.string().datetime(), effectiveTo: z.string().datetime() }),
]);
function validateCommandPeriod(command: z.infer<typeof Command>) { if (command.action === "site" || command.action === "app") { if (command.accessType && command.accessType !== "permanent" && (!command.effectiveFrom || !command.effectiveTo || Date.parse(command.effectiveFrom) >= Date.parse(command.effectiveTo))) throw Object.assign(new Error("Temporary or cover access requires effectiveFrom before effectiveTo."), { status: 422, code: "AUTHMOD_EFFECTIVE_PERIOD_INVALID" }); } if (command.action === "authority-grant" && command.resource === "authmod" && command.effectiveTo) throw Object.assign(new Error("AUTHMOD Admin is direct and permanent in this phase."), { status: 422, code: "AUTHMOD_ADMIN_PERMANENT_ONLY" }); if (command.action === "delegation" && Date.parse(command.effectiveFrom) >= Date.parse(command.effectiveTo)) throw Object.assign(new Error("Delegation effectiveFrom must be before effectiveTo."), { status: 422, code: "AUTHMOD_EFFECTIVE_PERIOD_INVALID" }); }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthmodAdminContext(request); const id = (await params).id; const command = Command.parse(await request.json()); const reason = resolveAuthmodReason(command); validateCommandPeriod(command); const identity = await context.repository.getIdentity(id); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 }); if (command.expectedVersion !== undefined && command.expectedVersion !== identity.version) throw Object.assign(new Error("This account changed since it was opened. Refresh and review before saving."), { status: 409, code: "AUTHMOD_VERSION_CONFLICT" });
    if (command.action === "status") await setIdentityStatus(context.repository, { identityId: id, status: command.status!, actor: context.principal, reason });
    else if (command.action === "kind") await setIdentityKind(context.repository, { identityId: id, identityKind: command.identityKind!, representedOplocId: command.representedOplocId, operationalPurpose: command.operationalPurpose, actor: context.principal, reason });
    else if (command.action === "legend") await linkLegend(context.repository, { identityId: id, legendId: command.legendId!, actor: context.principal, reason });
    else if (command.action === "custodian") await assignPrimaryCustodian(context.repository, { operationalIdentityId: id, custodianLegendId: command.custodianLegendId!, actor: context.principal, reason });
    else if (command.action === "site") command.enabled ? await assignSite(context.repository, { identityId: id, oplocId: command.oplocId, actor: context.principal, accessType: command.accessType, reason, effectivePeriod: { effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo } }) : await revokeSite(context.repository, { identityId: id, oplocId: command.oplocId, actor: context.principal, reason });
    else if (command.action === "app") command.enabled ? await grantStandardApplicationAccess(context.repository, { identityId: id, appId: command.appId, actor: context.principal, accessType: command.accessType, reason, effectivePeriod: { effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo } }) : await revokeStandardApplicationAccess(context.repository, { identityId: id, appId: command.appId, actor: context.principal, reason });
    else if (command.action === "full-access") await setFullAccess(context.repository, { identityId: id, fullAccess: command.fullAccess!, actor: context.principal, reason });
    else if (command.action === "authority-grant") await grantAuthority(context.repository, { subjectId: id, subjectType: "interactive", actor: context.principal, appId: command.appId, resource: command.resource, action: command.authorityAction, scope: command.scope, effectivePeriod: { effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo }, reason });
    else if (command.action === "authority-revoke") await revokeAuthority(context.repository, { grantId: command.grantId, actor: context.principal, reason });
    else if (command.action === "delegation") await createDelegation(context.repository, { delegatorId: command.delegatorId, delegateId: id, sourceGrantId: command.sourceGrantId, action: command.authorityAction, scope: command.scope, effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo, actor: context.principal, reason });
    return NextResponse.json({ account: await buildAuthmodAccount(context.repository, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
