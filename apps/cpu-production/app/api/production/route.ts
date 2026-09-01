import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../lib/api";
import { requireCpuActor } from "../../../lib/cpu-access-client";
import { acknowledgeProductionCancellation, createCpuProductionOrder, productionOrderDetail, productionQueue, productionQueueForWeek, reportProductionAllergenDiscrepancy, transitionProductionOrder, updateProductionLines } from "../../../lib/production-http-client";
import { ordersForScope } from "../../../lib/cpu-routing";
import { withReadableDestinations } from "../../../lib/cpu-oploc-labels";
import { filterCpuProjectionForScope } from "../../../lib/cpu-dashboard-adapter";
// Scope filtering remains backed by the existing hospitalityMenuProductionRouting adapter.
import { localFixtureOrders, updateLocalFixture } from "../local-fixtures";
import { normaliseProductionScope } from "../../../lib/production-scope";
import { appendCpuChange, buildCpuDayProjection, cpuProjections, listCpuChanges, listCpuWeekChanges, rebuildCpuDayProjection, rebuildCpuWeekProjection, weekCommencingFor } from "../../../lib/cpu-projection";
import { loadPlansForOrders } from "../../../lib/cpu-projection-repository";
import { recordDeliveredInReadBudget } from "../../../lib/delivered-in-read-budget";
import type { ProductionOrder } from "../../../lib/production-types";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { getCpuProjectionManifest, getCpuProjectionPackage, recordCpuPackageFallback } from "../../../lib/cpu-read-package";
import { rebuildCpuReviewPackage } from "../../../lib/cpu-review-package";
import { eventTypeForConsumers, notifyCpuConsumerInvalidations } from "../../../lib/cpu-consumer-invalidation";

const localActor = {
  uid: "local-cpu",
  name: "Production chef (local)",
  role: "integration-admin" as const,
  synthetic: true as const,
};
const actorFor = (request: NextRequest) => requireCpuActor(request);
function internalProjectionRequest(request: NextRequest) {
  const configured = process.env.FIKA_INTERNAL_API_TOKEN;
  return process.env.NODE_ENV !== "production" && !configured || Boolean(configured && request.headers.get("x-fika-internal-token") === configured);
}
function withServerTiming(response: NextResponse, timings: Record<string, number>) {
  response.headers.set("Server-Timing", Object.entries(timings).map(([name, duration]) => `${name};dur=${Math.max(0, duration).toFixed(1)}`).join(", "));
  return response;
}
async function rebuildCpuProjection(request: NextRequest, serviceDate: string, lastChangeSequence?: number) {
  const [rawOrders, previous] = await Promise.all([productionQueue(request, serviceDate === "all" ? undefined : serviceDate), cpuProjections().doc(serviceDate).get()]);
  const orders = await withReadableDestinations(request, rawOrders);
  const plans = await loadPlansForOrders(orders.map(order => order.canonicalId));
  const projection = buildCpuDayProjection(serviceDate, orders, plans, lastChangeSequence ?? Number(previous.data()?.lastChangeSequence || 0), Number(previous.data()?.revision || 0) + 1);
  await cpuProjections().doc(serviceDate).set(projection);
  return projection;
}

async function recordCpuChange(request: NextRequest, canonicalId: string, actorId: string, changeType: string, order?: ProductionOrder) {
  const current = order || await productionOrderDetail(request, canonicalId);
  const serviceDate = current?.serviceDate;
  if (!serviceDate) return current;
  const event = await appendCpuChange({ serviceDate, entityType: "productionOrder", entityId: canonicalId, revision: current.version, changeType, actorId, changedAt: new Date().toISOString() });
  await rebuildCpuProjection(request, serviceDate, event.sequence);
  await rebuildCpuWeekProjection(request, weekCommencingFor(serviceDate), event.sequence);
  const review = current?.destinationOplocId ? await rebuildCpuReviewPackage(request, serviceDate, current.destinationOplocId, event.sequence) : undefined;
  await notifyCpuConsumerInvalidations({ eventId: `cpu-change:${event.sequence}`, sourceEntityId: canonicalId, serviceDate, sourceVersion: current.version, changedAt: event.changedAt, changeType: eventTypeForConsumers(changeType), order: current, logistics: true, ...(review ? { reviewManifest: review.manifest } : {}) });
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
const AcknowledgeCancellation = z.object({ action: z.literal("acknowledge-cancellation"), canonicalId: z.string().min(8), expectedVersion: z.number().int().positive() }).strict();
async function handleGet(request: NextRequest) {
  try {
    const actor = await actorFor(request);
    if (request.nextUrl.searchParams.get("cacheScope") === "1") {
      const runtime = process.env.FIKA_RUNTIME_MODE || "unknown";
      const project = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "unknown";
      return NextResponse.json({ cacheScope: `${runtime}:${project}:${actor.uid}` });
    }
    const projectionDate = request.nextUrl.searchParams.get("serviceDate") || new Date().toISOString().slice(0, 10);
    if (request.nextUrl.searchParams.get("diagnostic") === "1") {
      const week = request.nextUrl.searchParams.get("weekCommencing");
      const projection = (await cpuProjections().doc(week ? `week:${week}` : projectionDate).get()).data() as { orders?: Array<Record<string, unknown>> } | undefined;
      const canonical = week ? await productionQueueForWeek(request, week) : await productionQueue(request, projectionDate);
      const weekEnd = week ? (() => { const date = new Date(`${week}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 4); return date.toISOString().slice(0, 10); })() : undefined;
      const canonicalById = new Map(canonical.filter((order) => !week || ((order.serviceDate || "") >= week && (order.serviceDate || "") <= weekEnd!)).map((order) => [order.canonicalId, order]));
      const projectedIds = new Set((projection?.orders || []).map((order) => String(order.id)));
      const missing = [...canonicalById.keys()].filter((id) => !projectedIds.has(id));
      const unexpected = [...projectedIds].filter((id) => !canonicalById.has(id));
      const expected = buildCpuDayProjection(week ? "all" : projectionDate, [...canonicalById.values()], await loadPlansForOrders([...canonicalById.keys()]));
      const projectedById = new Map((projection?.orders || []).map((order) => [String(order.id), order]));
      const fieldMismatches = expected.orders.filter((order) => {
        const actual = projectedById.get(order.id);
        return actual && JSON.stringify({ status: order.status, workflowStatus: order.workflowStatus, productionScope: order.productionScope, destination: order.destinationOplocId, quantities: order.quantities, attention: order.attention }) !== JSON.stringify({ status: actual.status, workflowStatus: actual.workflowStatus, productionScope: actual.productionScope, destination: actual.destinationOplocId, quantities: actual.quantities, attention: actual.attention });
      }).map((order) => order.id);
      return NextResponse.json({ scope: week ? { weekCommencing: week } : { serviceDate: projectionDate }, comparison: { canonicalCount: canonicalById.size, projectionCount: projection?.orders?.length || 0, missing, unexpected, fieldMismatches }, status: missing.length || unexpected.length || fieldMismatches.length ? "Projection out of sync" : "In sync" });
    }
    if (request.nextUrl.searchParams.get("projection") === "1") {
      const startedAt = performance.now();
      const week = request.nextUrl.searchParams.get("weekCommencing");
      const reconcile = request.nextUrl.searchParams.get("reconcile") === "1";
      if (!reconcile) {
        try {
          const packaged = await getCpuProjectionPackage(projectionDate, week || undefined);
          if (packaged) {
            const projection = packaged.value.projection;
            const filtered = filterCpuProjectionForScope(projection, normaliseProductionScope(request.nextUrl.searchParams.get("scope")));
            recordDeliveredInReadBudget({ stage: "package_body_load", projectionDocs: 0, selectedIds: filtered.orders.length });
            return withServerTiming(NextResponse.json({ projection: filtered, package: packaged.manifest }), { package: performance.now() - startedAt, total: performance.now() - startedAt });
          }
          recordCpuPackageFallback("missing");
          return withServerTiming(NextResponse.json({ error: { code: "CPU_PROJECTION_PACKAGE_UNAVAILABLE", message: "The CPU projection package is currently unavailable." }, freshness: "unavailable" }, { status: 503 }), { package: performance.now() - startedAt, total: performance.now() - startedAt });
        } catch {
          recordCpuPackageFallback("invalid");
          return withServerTiming(NextResponse.json({ error: { code: "CPU_PROJECTION_PACKAGE_INTEGRITY_FAILURE", message: "The CPU projection package failed integrity verification." }, freshness: "unavailable" }, { status: 503 }), { package: performance.now() - startedAt, total: performance.now() - startedAt });
        }
      } else recordCpuPackageFallback("explicit-reconciliation");
      const storedStartedAt = performance.now();
      const stored = await cpuProjections().doc(week ? `week:${week}` : projectionDate).get();
      const storedDuration = performance.now() - storedStartedAt;
      const storedData = stored.data() as { orders?: Array<{ id?: string; destinationLabel?: string; destinationOplocId?: string; origin?: string; status?: string; workflowStatus?: string; cancellationNotice?: string }> } | undefined;
      const needsReadableDestinations = storedData?.orders?.some((order) => order.destinationOplocId && order.destinationLabel === order.destinationOplocId);
      const needsCancellationRefresh = storedData?.orders?.some((order) => (order.status === "cancelled" || order.workflowStatus === "cancelled" || (order.origin === "hospitality_booking" && ["draft", "needs_review"].includes(order.status || ""))) && !order.cancellationNotice);
      const canonicalStartedAt = performance.now();
      const canonical = week ? await productionQueueForWeek(request, week) : await productionQueue(request, projectionDate);
      const canonicalDuration = performance.now() - canonicalStartedAt;
      const weekEnd = week ? (() => { const date = new Date(`${week}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 4); return date.toISOString().slice(0, 10); })() : undefined;
      const canonicalIds = new Set(canonical
        .filter((order) => !week || ((order.serviceDate || "") >= week && (order.serviceDate || "") <= weekEnd!))
        .map((order) => order.canonicalId));
      const projectedIds = new Set((storedData?.orders || []).map((order) => order.id).filter(Boolean));
      const needsOrderRefresh = canonicalIds.size !== projectedIds.size || [...canonicalIds].some((id) => !projectedIds.has(id));
      const requiresRefresh = !stored.exists || needsReadableDestinations || needsCancellationRefresh || needsOrderRefresh;
      const response = NextResponse.json({ projection: requiresRefresh ? week ? await rebuildCpuWeekProjection(request, week) : await rebuildCpuProjection(request, projectionDate) : stored.data() });
      recordDeliveredInReadBudget({ stage: requiresRefresh ? "projection_refresh" : "projection_body_load", projectionDocs: 1, canonicalOrderDocs: canonicalIds.size });
      return withServerTiming(response, { stored: storedDuration, canonical: canonicalDuration, total: performance.now() - startedAt });
    }
    if (request.nextUrl.searchParams.get("projectionHead") === "1") {
      const week = request.nextUrl.searchParams.get("weekCommencing");
      const manifest = await getCpuProjectionManifest(projectionDate, week || undefined);
      recordDeliveredInReadBudget({ stage: "warm_projection_head_check", projectionDocs: 0 });
      return NextResponse.json({ lastChangeSequence: Number(manifest?.sourceVersion?.replace("cpu-change-", "") || 0), revision: Number(manifest?.packageVersion || 0), packageVersion: manifest?.packageVersion || 0, contentHash: manifest?.contentHash, sourceVersion: manifest?.sourceVersion });
    }
    if (request.nextUrl.searchParams.has("changesSince")) {
      const startedAt = performance.now();
      const after = Number(request.nextUrl.searchParams.get("changesSince") || 0);
      const week = request.nextUrl.searchParams.get("weekCommencing");
      const queryStartedAt = performance.now();
      const changes = week ? await listCpuWeekChanges(after, week) : await listCpuChanges(after, projectionDate);
      const queryDuration = performance.now() - queryStartedAt;
      const response = NextResponse.json({ changes, projection: (await cpuProjections().doc(week ? `week:${week}` : projectionDate).get()).data() || null });
      return withServerTiming(response, { changes: queryDuration, total: performance.now() - startedAt });
    }
    const id = request.nextUrl.searchParams.get("canonicalId");
    const serviceDate = request.nextUrl.searchParams.get("serviceDate") || undefined;
    const scope = normaliseProductionScope(request.nextUrl.searchParams.get("scope"));
    if (id?.startsWith("production-order:v1:fixture:")) {
      const order = localFixtureOrders().find((item) => item.canonicalId === id);
      const filtered = order ? (await ordersForScope(request, [order], scope))[0] : undefined;
      return NextResponse.json({ order: filtered, scope });
    }
    if (id) {
      const order = await productionOrderDetail(request, id);
      if (!order) return NextResponse.json({ error: { message: "Production Order was not found." } }, { status: 404 });
      const readable = await withReadableDestinations(request, [order]);
      return NextResponse.json({ order: readable[0], scope });
    }
    const fetched = await productionQueue(request, serviceDate);
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
    const orders = await withReadableDestinations(request, await ordersForScope(request, sourceOrders, scope));
    return NextResponse.json({ orders, scope, localFixtures: includeLocalFixtures });
  } catch (error) {
    return errorResponse(error);
  }
}


async function handlePost(request: NextRequest) {
  try {
    const raw = await request.json();
    if (raw?.action === "sync-production-event") {
      if (!internalProjectionRequest(request)) return NextResponse.json({ error: { message: "Internal CPU projection access is not authorised." } }, { status: 401 });
      const serviceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(raw.serviceDate);
      const event = await appendCpuChange({ serviceDate, entityType: "productionOrder", entityId: z.string().min(1).parse(raw.entityId), revision: z.number().int().positive().parse(raw.revision), changeType: z.string().min(1).parse(raw.changeType), actorId: z.string().min(1).parse(raw.actorId || "integration-hub"), changedAt: z.string().min(1).parse(raw.changedAt || new Date().toISOString()), idempotencyKey: z.string().min(1).parse(raw.idempotencyKey) });
      const dayProjection = await rebuildCpuProjection(request, serviceDate, event.sequence);
      const weekProjection = await rebuildCpuWeekProjection(request, weekCommencingFor(serviceDate), event.sequence);
      const changedOrder = await productionOrderDetail(request, z.string().min(1).parse(raw.entityId));
      const review = changedOrder?.destinationOplocId ? await rebuildCpuReviewPackage(request, serviceDate, changedOrder.destinationOplocId, event.sequence) : undefined;
      await notifyCpuConsumerInvalidations({ eventId: `cpu-change:${event.sequence}`, sourceEntityId: event.entityId, serviceDate, sourceVersion: event.revision, changedAt: event.changedAt, changeType: eventTypeForConsumers(event.changeType), order: changedOrder || { origin: "menu_planning" }, logistics: true, ...(review ? { reviewManifest: review.manifest } : {}) });
      return NextResponse.json({ applied: true, duplicate: event.sequence < Number(raw.sequence || event.sequence), event, dayProjection, weekProjection });
    }
    const actor = await actorFor(request);
    if (raw?.action === "rebuild-cpu-projection") {
      const serviceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(raw.serviceDate);
      const projection = await rebuildCpuProjection(request, serviceDate);
      return NextResponse.json({ projection: await rebuildCpuWeekProjection(request, weekCommencingFor(serviceDate)), dayProjection: projection });
    }
    if (raw?.action === "cpu-create") {
      const command = Cpu.parse(raw);
      const result = await createCpuProductionOrder(request, command, command.idempotencyKey);
      if (result.order) await recordCpuChange(request, result.order.canonicalId, actor.uid, result.created ? "created" : "replayed", result.order);
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
      const order = (await updateProductionLines(request, command)).order;
      await recordCpuChange(request, command.canonicalId, actor.uid, "lines-updated", order);
      return NextResponse.json({ order });
    }
    if (raw?.action === "report-allergen-discrepancy") {
      const command = AllergenDiscrepancy.parse(raw);
      const result = await reportProductionAllergenDiscrepancy(request, command);
      await recordCpuChange(request, command.canonicalId, actor.uid, "allergen-discrepancy", result.order);
      return NextResponse.json(result);
    }
    if (raw?.action === "acknowledge-cancellation") {
      const command = AcknowledgeCancellation.parse(raw);
      const order = (await acknowledgeProductionCancellation(request, command)).order;
      await recordCpuChange(request, command.canonicalId, actor.uid, "cancelled-order-dismissed", order);
      return NextResponse.json({ order });
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
    const order = (await transitionProductionOrder(request, command)).order;
    await recordCpuChange(request, command.canonicalId, actor.uid, "status-changed", order);
    return NextResponse.json({ order });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
