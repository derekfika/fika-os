import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@hub/lib/auth";
import { assertPermission } from "@hub/lib/authmod";
import { db } from "@hub/lib/firebase-admin";
import {
  createCpuProductionOrder,
  productionQueue,
  productionOrderDetail,
  transitionProductionOrder,
  updateProductionLines,
  reportProductionAllergenDiscrepancy,
} from "@hub/lib/production-domain";
import { hospitalityMenuProductionRouting } from "@hub/lib/connections-service";
import { localFixtureOrders, updateLocalFixture } from "../local-fixtures";
import { filterProductionOrdersForScope, normaliseProductionScope, type ProductionScope } from "../../../lib/production-scope";
import { appendCpuChange, buildCpuDayProjection, cpuPlans, cpuProjections, listCpuChanges } from "../../../lib/cpu-projection";
import type { ProductionOrder } from "@hub/lib/production-domain";

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
async function rebuildCpuProjection(serviceDate: string, lastChangeSequence?: number) {
  const [orders, planSnapshot, previous] = await Promise.all([productionQueue(serviceDate === "all" ? undefined : serviceDate), cpuPlans().get(), cpuProjections().doc(serviceDate).get()]);
  const plans = planSnapshot.docs.map((document) => document.data() as import("../../lib/production-plan").ProductionPlan);
  const projection = buildCpuDayProjection(serviceDate, orders, plans, lastChangeSequence ?? Number(previous.data()?.lastChangeSequence || 0), Number(previous.data()?.revision || 0) + 1);
  await cpuProjections().doc(serviceDate).set(projection);
  return projection;
}

async function recordCpuChange(canonicalId: string, actorId: string, changeType: string, order?: ProductionOrder) {
  const current = order || await productionOrderDetail(canonicalId);
  const serviceDate = current?.serviceDate;
  if (!serviceDate) return current;
  const event = await appendCpuChange({ serviceDate, entityType: "productionOrder", entityId: canonicalId, revision: current.version, changeType, actorId, changedAt: new Date().toISOString() });
  await rebuildCpuProjection(serviceDate, event.sequence);
  return current;
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
const AllergenDiscrepancy = z.object({ action: z.literal("report-allergen-discrepancy"), canonicalId: z.string().min(8), expectedVersion: z.number().int().positive(), note: z.string().trim().min(3) }).strict();
export async function GET(request: NextRequest) {
  try {
    const projectionDate = request.nextUrl.searchParams.get("serviceDate") || new Date().toISOString().slice(0, 10);
    if (request.nextUrl.searchParams.get("projection") === "1") {
      const stored = await cpuProjections().doc(projectionDate).get();
      return NextResponse.json({ projection: stored.exists ? stored.data() : await rebuildCpuProjection(projectionDate) });
    }
    if (request.nextUrl.searchParams.has("changesSince")) return NextResponse.json({ changes: await listCpuChanges(Number(request.nextUrl.searchParams.get("changesSince") || 0), projectionDate), projection: (await cpuProjections().doc(projectionDate).get()).data() || null });
    const actor = await actorFor(request);
    assertPermission(actor, "canonical.view");
    const id = request.nextUrl.searchParams.get("canonicalId");
    const serviceDate = request.nextUrl.searchParams.get("serviceDate") || undefined;
    const scope = normaliseProductionScope(request.nextUrl.searchParams.get("scope"));
    if (id?.startsWith("production-order:v1:fixture:")) {
      const order = localFixtureOrders().find((item) => item.canonicalId === id);
      const filtered = order ? (await ordersForScope([order], scope))[0] : undefined;
      return NextResponse.json({ order: filtered, scope });
    }
    const fetched = await productionQueue(serviceDate);
    // In local development, keep the existing emulator orders visible while
    // adding the deterministic two-week fixture set.  The fixture IDs are
    // stable, so retries/reloads cannot duplicate them.  Never inject these
    // records into a production deployment.
    // Keep the normal dashboard clean. Fixture orders remain available through
    // the explicit canonicalId fixture endpoint for focused development tests,
    // but must not appear alongside real emulator production work.
    const includeLocalFixtures = request.nextUrl.searchParams.get("includeFixtures") === "true" && process.env.NODE_ENV !== "production" && process.env.FIKA_ENABLE_LOCAL_PRODUCTION_FIXTURES === "true";
    const sourceOrders = includeLocalFixtures
      ? [...fetched, ...localFixtureOrders().filter(fixture =>
        !fetched.some(order =>
          order.canonicalId === fixture.canonicalId ||
          order.sourceBookingId === fixture.sourceBookingId,
        ),
      )]
      : fetched;
    const orders = await withReadableDestinations(await ordersForScope(sourceOrders, scope));
    return NextResponse.json({ orders, scope, localFixtures: includeLocalFixtures });
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

async function withReadableDestinations(orders: Awaited<ReturnType<typeof productionQueue>>) {
  if (!orders.length) return orders;
  const snapshot = await db.collection("integrationHubCanonical").get();
  const labels = new Map(snapshot.docs
    .map(document => document.data() as { entityType?: string; canonicalId?: string; record?: { approvedName?: string; lifecycleState?: string } })
    .filter(record => record.entityType === "OPLOC" && record.canonicalId && record.record?.approvedName && record.record.lifecycleState !== "decommissioned")
    .map(record => [record.canonicalId!, String(record.record!.approvedName)] as const));
  return orders.map(order => {
    const id = order.destinationOplocId;
    const label = id ? labels.get(id) : undefined;
    if (!id || !label) return order;
    const current = order.destinationLabel?.trim();
    if (!current || current === id) return { ...order, destinationLabel: label };
    if (current.startsWith(`${id} · `)) return { ...order, destinationLabel: `${label} · ${current.slice(id.length + 3)}` };
    return order;
  });
}

export async function POST(request: NextRequest) {
  try {
    const actor = await actorFor(request, ["integration-admin", "reviewer"]);
    assertPermission(actor, "canonical.edit");
    const raw = await request.json();
    if (raw?.action === "rebuild-cpu-projection") {
      const serviceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(raw.serviceDate);
      return NextResponse.json({ projection: await rebuildCpuProjection(serviceDate) });
    }
    if (raw?.action === "cpu-create") {
      const command = Cpu.parse(raw);
      const result = await createCpuProductionOrder(actor, command, command.idempotencyKey);
      if (result.order) await recordCpuChange(result.order.canonicalId, actor.uid, result.created ? "created" : "replayed", result.order);
      return NextResponse.json(result);
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
      const order = await updateProductionLines(
          actor,
          command.canonicalId,
          command.expectedVersion,
          command.lines,
        );
      await recordCpuChange(command.canonicalId, actor.uid, "lines-updated");
      return NextResponse.json({ order });
    }
    if (raw?.action === "report-allergen-discrepancy") {
      const command = AllergenDiscrepancy.parse(raw);
      const result = await reportProductionAllergenDiscrepancy(actor, command.canonicalId, command.expectedVersion, command.note);
      await recordCpuChange(command.canonicalId, actor.uid, "allergen-discrepancy", result.order);
      return NextResponse.json(result);
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
    const order = await transitionProductionOrder(
        actor,
        command.canonicalId,
        command.expectedVersion,
        command.status,
        command.reason,
      );
    await recordCpuChange(command.canonicalId, actor.uid, "status-changed", order);
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: (error as { status?: number }).status || 500 },
    );
  }
}
