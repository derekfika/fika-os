import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { materialiseExternalProductionOrder } from "@/lib/production-domain";
import { notifyCpuProjection } from "@/lib/cpu-projection-client";
import { internalProductionRequestAllowed } from "@/lib/production-internal-auth";
import { parseExternalProductionMaterialisation } from "@/lib/production-materialisation-contract";

export async function POST(request: NextRequest) { try { let actor; if (internalProductionRequestAllowed(request)) actor = { uid: "integration-materialiser", name: "Integration Materialiser", role: "integration-admin", synthetic: true } as const; else { actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.edit"); } const input = parseExternalProductionMaterialisation(await request.json()); const result = await materialiseExternalProductionOrder(actor, input); let cpuHandoff: "delivered" | "pending" = "delivered"; try { await notifyCpuProjection(result.order, input.status === "withdrawn" || input.status === "cancelled" ? "withdrawn" : input.status === "amended" ? "amended" : "created", `cpu-projection:${input.sourceDomain}:${input.sourceEntityId}:${input.destinationOplocId}:v${input.sourceVersion}`); } catch { cpuHandoff = "pending"; } return NextResponse.json({ ...result, cpuHandoff }); } catch (error) { return errorResponse(error); } }
