import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@hub/lib/auth";
import { assertPermission } from "@hub/lib/authmod";
import {
  createCpuProductionOrder,
  productionQueue,
  productionOrderDetail,
  transitionProductionOrder,
  updateProductionLines,
} from "@hub/lib/production-domain";
import { hospitalityMenuProductionRouting } from "@hub/lib/connections-service";
import { localFixtureOrders, updateLocalFixture } from "../local-fixtures";
import {
  filterProductionOrdersForDashboard,
  normaliseProductionDashboardView,
  type ProductionDashboardView,
} from "../../../lib/dashboard-views";
import { filterProductionOrdersForScope, normaliseProductionScope, type ProductionScope } from "../../../lib/production-scope";

const localActor = {
  uid: "local-cpu",
  name: "Production chef (local)",
  role: "integration-admin" as const,
  synthetic: true as const,
};
async function actorFor(
  request: NextRequest,
  allowed?: ("integration-admin" | "reviewer" | "viewer")[],
) {
  try {
    return await requireActor(request, allowed);
  } catch (error) {
    if (
      process.env.NODE_ENV !== "production" &&
      (error as { status?: number }).status === 401
    )
      return localActor;
    throw error;
  }
}

const Cpu = z
  .object({
    action: z.literal("cpu-create"),
    idempotencyKey: z.string().trim().min(8),
    clientName: z.string().trim().min(1),
    serviceDate: z.string(),
    deliveryDateTime: z.string(),
    requiredBy: z.string(),
    serviceWindow: z.object({
      startTime: z.string(),
      endTime: z.string().optional(),
    }),
    productionLocationId: z.string().optional(),
    destinationOplocId: z.string().optional(),
    requiresDelivery: z.boolean().optional().default(true),
    deliveryLocation: z.string().trim().min(1),
    floorRoom: z.string().optional(),
    contact: z.string().optional(),
    serviceType: z.string().trim().min(1),
    pax: z.number().int().positive(),
    lines: z
      .array(
        z.object({
          itemName: z.string().trim().min(1),
          customerQuantity: z.number().positive(),
          customerUnit: z.string().trim().min(1),
          productionQuantity: z.number().positive().optional(),
          productionUnit: z.string().optional(),
          dietary: z.record(z.string(), z.unknown()).optional(),
          notes: z.string().optional(),
        }),
      )
      .min(1),
    priority: z.enum(["normal", "high", "urgent"]).optional(),
    sourceReference: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();
const Transition = z
  .object({
    action: z.literal("transition"),
    canonicalId: z.string().min(8),
    expectedVersion: z.number().int().positive(),
    status: z.enum([
      "received",
      "draft",
      "needs_review",
      "accepted",
      "planning",
      "planned",
      "amended",
      "menu_available",
      "rejected",
      "needs_clarification",
      "scheduled",
      "in_production",
      "partially_complete",
      "ready",
      "complete",
      "cancelled",
      "blocked",
      "failed",
      "reconciliation_required",
    ]),
    reason: z.string().trim().min(3),
  })
  .strict();
const UpdateLines = z
  .object({
    action: z.literal("update-lines"),
    canonicalId: z.string().min(8),
    expectedVersion: z.number().int().positive(),
    lines: z
      .array(
        z.object({
          canonicalId: z.string().min(8),
          productionQuantity: z.number().positive().optional(),
          productionUnit: z.string().trim().optional(),
          actualQuantity: z.number().nonnegative().optional(),
          shortfallQuantity: z.number().nonnegative().optional(),
          substitution: z.string().optional(),
          wasteQuantity: z.number().nonnegative().optional(),
          productionInstructions: z.string().optional(),
          dietaries: z.record(z.string(), z.unknown()),
          allergenEvidenceStatus: z
            .enum(["confirmed", "unreviewed", "missing", "conflicting"])
            .optional(),
        }),
      )
      .min(1),
  })
  .strict();
export async function GET(request: NextRequest) {
  try {
    const actor = await actorFor(request);
    assertPermission(actor, "canonical.view");
    const id = request.nextUrl.searchParams.get("canonicalId");
    const view = parseDashboardView(request.nextUrl.searchParams.get("view"));
    const scope = normaliseProductionScope(request.nextUrl.searchParams.get("scope"));
    const allProduction = request.nextUrl.searchParams.get("allProduction") === "true";
    if (id?.startsWith("production-order:v1:fixture:")) {
      const order = localFixtureOrders().find((item) => item.canonicalId === id);
      const filtered = order ? (await ordersForScope(await ordersForView([order], view, allProduction), scope))[0] : undefined;
      return NextResponse.json({ order: filtered, view, scope });
    }
    const fetched = await productionQueue();
    // In local development, keep the existing emulator orders visible while
    // adding the deterministic two-week fixture set.  The fixture IDs are
    // stable, so retries/reloads cannot duplicate them.  Never inject these
    // records into a production deployment.
    const sourceOrders = process.env.NODE_ENV !== "production" && process.env.FIKA_ENABLE_LOCAL_PRODUCTION_FIXTURES === "true"
      ? [...fetched, ...localFixtureOrders().filter(fixture =>
        !fetched.some(order =>
          order.canonicalId === fixture.canonicalId ||
          order.sourceBookingId === fixture.sourceBookingId,
        ),
      )]
      : fetched;
    const orders = await ordersForScope(await ordersForView(sourceOrders, view, allProduction), scope);
    return NextResponse.json({ orders, view, scope, localFixtures: process.env.NODE_ENV !== "production" && process.env.FIKA_ENABLE_LOCAL_PRODUCTION_FIXTURES === "true" });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: (error as { status?: number }).status || 500 },
    );
  }
}

async function ordersForScope(orders: Awaited<ReturnType<typeof productionQueue>>, scope: ProductionScope) {
  if (scope === "all") return orders;
  return filterProductionOrdersForScope(orders, scope, await hospitalityMenuProductionRouting());
}

function parseDashboardView(value: string | null): ProductionDashboardView {
  return normaliseProductionDashboardView(value);
}

async function ordersForView(
  orders: Awaited<ReturnType<typeof productionQueue>>,
  view: ProductionDashboardView,
  allProduction = false,
) {
  if (allProduction) return orders;
  if (view === "site_manager") return orders;
  return filterProductionOrdersForDashboard(
    orders,
    view,
    await hospitalityMenuProductionRouting(),
  );
}
export async function POST(request: NextRequest) {
  try {
    const actor = await actorFor(request, ["integration-admin", "reviewer"]);
    assertPermission(actor, "canonical.edit");
    const raw = await request.json();
    if (raw?.action === "cpu-create") {
      const command = Cpu.parse(raw);
      return NextResponse.json(
        await createCpuProductionOrder(actor, command, command.idempotencyKey),
      );
    }
    if (raw?.action === "update-lines") {
      const command = UpdateLines.parse(raw);
      if (command.canonicalId.startsWith("production-order:v1:fixture:")) {
        const updated = updateLocalFixture(command.canonicalId, (current) => ({
          ...current,
          version: current.version + 1,
          currentRevision: current.currentRevision + 1,
          lines: current.lines.map((line) => {
            const update = command.lines.find(
              (item) => item.canonicalId === line.canonicalId,
            );
            return update
              ? {
                  ...line,
                  ...(update.productionQuantity !== undefined
                    ? {
                        productionQuantity: update.productionQuantity,
                        productionUnit: update.productionUnit,
                      }
                    : {}),
                  ...(update.actualQuantity !== undefined
                    ? { actualQuantity: update.actualQuantity }
                    : {}),
                  ...(update.shortfallQuantity !== undefined
                    ? { shortfallQuantity: update.shortfallQuantity }
                    : {}),
                  ...(update.wasteQuantity !== undefined
                    ? { wasteQuantity: update.wasteQuantity }
                    : {}),
                  ...(update.substitution
                    ? { substitution: update.substitution }
                    : {}),
                  ...(update.productionInstructions
                    ? { productionInstructions: update.productionInstructions }
                    : {}),
                  ...(update.allergenEvidenceStatus
                    ? { allergenEvidenceStatus: update.allergenEvidenceStatus }
                    : {}),
                  dietaries: update.dietaries,
                  status:
                    update.actualQuantity !== undefined
                      ? "complete"
                      : line.status,
                }
              : line;
          }),
          audit: [
            ...current.audit,
            {
              action: "local-production-update",
              at: new Date().toISOString(),
              by: actor.uid,
            },
          ],
        }));
        return NextResponse.json({ order: updated, localFixture: true });
      }
      return NextResponse.json({
        order: await updateProductionLines(
          actor,
          command.canonicalId,
          command.expectedVersion,
          command.lines,
        ),
      });
    }
    const command = Transition.parse(raw);
    if (command.canonicalId.startsWith("production-order:v1:fixture:")) {
      const updated = updateLocalFixture(command.canonicalId, (current) => ({
        ...current,
        version: current.version + 1,
        status: command.status,
        audit: [
          ...current.audit,
          {
            action: "local-status-change",
            at: new Date().toISOString(),
            by: actor.uid,
            previousState: current.status,
            newState: command.status,
            reason: command.reason,
          },
        ],
      }));
      return NextResponse.json({ order: updated, localFixture: true });
    }
    return NextResponse.json({
      order: await transitionProductionOrder(
        actor,
        command.canonicalId,
        command.expectedVersion,
        command.status,
        command.reason,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: (error as { status?: number }).status || 500 },
    );
  }
}
