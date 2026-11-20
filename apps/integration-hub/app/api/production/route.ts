import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { Transition } from "@/lib/production-transition-schema";
import { acknowledgeProductionCancellation, createProductionFromApprovedBooking, productionQueue, productionQueueForWeek, productionOrderDetail, transitionProductionOrder, type ProductionOrder, type ProductionStatus } from "@/lib/production-domain";
import { hospitalityMirrorAfterCpu } from "@/lib/cpux-mirror/queue";
import { notifyCpuProjection } from "@/lib/cpu-projection-client";
import { deliverLogisticsProjectionForProductionOrder } from "@/lib/logistics-projection-outbox";
import { hospitalityMatrixStorageContext } from "@/lib/hospitality-matrix-storage";
import { getBookingByCanonicalId, getDashboardQuoteSettingsForBooking } from "@/lib/hospitality-booking-service";
import { db } from "@/lib/firebase-admin";
import { canonicalDocumentId } from "@/lib/canonical-oplocs";
import type { CanonicalRecord } from "@/lib/types";
import { internalProductionRequestAllowed } from "@/lib/production-internal-auth";

function londonBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const Create = z.object({ action: z.literal("create"), bookingId: z.string().min(8), idempotencyKey: z.string().trim().min(8).max(200), conversions: z.record(z.string(), z.object({ quantity: z.number().positive(), unit: z.string().trim().min(1).max(80) })).optional() }).strict();

const AcknowledgeCancellation = z.object({ action: z.literal("acknowledge-cancellation"), canonicalId: z.string().min(8), expectedVersion: z.number().int().positive() }).strict();
export async function GET(request: NextRequest) {
  try {
    const actor = internalProductionRequestAllowed(request)
      ? { uid: "cpu-production", name: "CPU Production", role: "integration-admin", synthetic: true } as const
      : await requireActor(request);
    assertPermission(actor, "canonical.view");
    const id = request.nextUrl.searchParams.get("canonicalId");
    const serviceDate = request.nextUrl.searchParams.get("serviceDate") || londonBusinessDate();
    const weekCommencing = request.nextUrl.searchParams.get("weekCommencing") || undefined;
    const order = id ? await productionOrderDetail(id) : undefined;
    // Opt-in, server-owned context for the existing CPU -> Hospitality callback.
    // Ordinary queue/detail reads incur no additional configuration reads.
    const matrixStorage = order && request.nextUrl.searchParams.get("includeMatrixStorage") === "true"
      ? await hospitalityMatrixStorageContext(order, {
        booking: getBookingByCanonicalId,
        settings: getDashboardQuoteSettingsForBooking,
        oploc: async (oplocId) => {
          const snapshot = await db.collection("integrationHubCanonical").doc(canonicalDocumentId(oplocId)).get();
          return snapshot.exists ? snapshot.data() as CanonicalRecord : undefined;
        },
      }) : undefined;
    return NextResponse.json(id ? { order, ...(matrixStorage ? { matrixStorage } : {}) } : {
      orders: weekCommencing ? await productionQueueForWeek(weekCommencing) : await productionQueue(serviceDate),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin", "reviewer"]);
    assertPermission(actor, "canonical.edit");
    const input = await request.json();
    if (input?.action === "create") {
      const command = Create.parse(input);
      const result = await createProductionFromApprovedBooking(actor, command.bookingId, command.idempotencyKey, command.conversions || {});
      if (!result.order) return NextResponse.json({ ...result, cpuHandoff: "delivered", logisticsHandoff: "delivered" });
      return NextResponse.json({ ...result, ...await publishProductionChange(result.order, "created") });
    }
    if (input?.action === "acknowledge-cancellation") {
      const command = AcknowledgeCancellation.parse(input);
      return NextResponse.json({ order: await acknowledgeProductionCancellation(actor, command.canonicalId, command.expectedVersion) });
    }
    const command = Transition.parse(input);
    const order = await transitionProductionOrder(actor, command.canonicalId, command.expectedVersion, command.status as ProductionStatus, command.reason);
    return NextResponse.json({ order, ...await publishProductionChange(order, command.status === "cancelled" ? "withdrawn" : "amended") });
  } catch (error) { return errorResponse(error); }
}

async function publishProductionChange(order: ProductionOrder, changeType: "created" | "amended" | "withdrawn") {
  const cpuConfirmed = notifyCpuProjection(order, changeType, `cpu-projection:${order.canonicalId}:v${order.version}`)
    .then(result => result.applied === true, () => false);
  const logisticsHandoff = deliverLogisticsProjectionForProductionOrder(order)
    .then(delivery => !delivery || delivery.delivery.status === "delivered" ? "delivered" : "pending", () => "pending");
  const confirmed = await cpuConfirmed;
  const calendarMirror = await hospitalityMirrorAfterCpu(order, changeType, confirmed, false);
  return { cpuHandoff: confirmed ? "delivered" : "pending", logisticsHandoff: await logisticsHandoff, calendarMirror };
}
