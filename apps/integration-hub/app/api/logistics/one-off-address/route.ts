import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, evaluateAuthority, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";
import { deliverLogisticsProjectionForProductionOrder } from "@/lib/logistics-projection-outbox";
import { confirmMenuOneOffProductionAddress } from "@/lib/production-domain";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";

const command = z.object({
  orderId: z.string().trim().min(1).max(1000),
  expectedVersion: z.number().int().positive(),
  address: z.string().trim().min(1).max(500),
}).strict();

export async function POST(request: NextRequest) {
  try {
    if (!internalTokenAllowed(request)) throw Object.assign(new Error("Use the Logistics planning dashboard to confirm the delivery address."), { status: 403 });
    const session = await requireFikaSession(request);
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, authmodIdentityId: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind, ...(session.representedOplocId ? { representedOplocId: session.representedOplocId } : {}) };
    const repository = new FirestoreAuthModRepository();
    const context = createAuthModEvaluationContext(repository, principal);
    const access = await resolveUserAccess(repository, { principal, appId: "logistics" }, context);
    if (!access.allowed) throw Object.assign(new Error("Logistics access is required."), { status: access.reasonCode === "store-unavailable" ? 503 : 403 });
    const application = await context.application("logistics");
    if (!application) throw Object.assign(new Error("Logistics authority is unavailable."), { status: 503 });
    if (!application.standardActions.includes("Manage")) throw Object.assign(new Error("Logistics Manage access is required."), { status: 403 });
    const authority = await evaluateAuthority(repository, { principal, appId: "logistics", resource: application.standardResource, action: "Manage", scope: { kind: "organisation", ids: [] } }, context);
    if (!authority.allowed) throw Object.assign(new Error("Logistics Manage access is required."), { status: authority.reasonCode === "store-unavailable" ? 503 : 403 });
    const parsed = command.safeParse(await request.json());
    if (!parsed.success) throw Object.assign(new Error("Supply the current order version and a delivery address of up to 500 characters."), { status: 422 });
    const { orderId, expectedVersion, address } = parsed.data;
    const order = await confirmMenuOneOffProductionAddress(orderId, expectedVersion, address, principal.id);
    const delivery = await deliverLogisticsProjectionForProductionOrder(order).catch(() => undefined);
    const projected = delivery?.delivery.status === "delivered";
    return NextResponse.json({ orderId, version: order.version, projected }, { status: projected ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
