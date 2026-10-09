import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { materialiseExternalProductionOrder } from "@/lib/production-domain";
import { deliverCpuProjectionForOrder } from "@/lib/cpu-projection-outbox";
import { deliverLogisticsProjectionForProductionOrder } from "@/lib/logistics-projection-outbox";
import { internalProductionRequestAllowed } from "@/lib/production-internal-auth";
import { parseExternalProductionMaterialisation } from "@fika/server-shared/external-production";

export async function POST(request: NextRequest) { try { let actor; if (internalProductionRequestAllowed(request)) actor = { uid: "integration-materialiser", name: "Integration Materialiser", role: "integration-admin", synthetic: true } as const; else { actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.edit"); } const input = parseExternalProductionMaterialisation(await request.json()); const result = await materialiseExternalProductionOrder(actor, input); let logisticsHandoff: "delivered" | "pending" = "delivered"; try { const delivery = await deliverLogisticsProjectionForProductionOrder(result.order); if (delivery && delivery.delivery.status !== "delivered") logisticsHandoff = "pending"; } catch { logisticsHandoff = "pending"; } // Durable CPU handoff: the obligation already exists (staged with the order, or ensured here for a replay of an existing
  // canonical version). One delivery attempt now; whatever is not acknowledged stays pending/failed and is retried by the outbox tick.
  const cpuProjection = await deliverCpuProjectionForOrder(result.order); const cpuHandoff: "delivered" | "pending" = cpuProjection.state === "pending" ? "pending" : "delivered"; return NextResponse.json({ ...result, cpuHandoff, cpuProjection, logisticsHandoff }); } catch (error) { return errorResponse(error); } }
