import { randomUUID } from "node:crypto";
import { HISTORICAL_OPLOC_ID_ALIASES } from "@fika/server-shared/governed-oplocs";
import { applyOrderAction, type GrabAndGoOrder, type GrabAndGoOrderSource, type GrabAndGoProduct } from "./grab-and-go";
import { dispatchGrabHandoff, readGrabHandoffStates, type GrabHandoffState } from "./grab-and-go-handoff";
import { applyStandingAction, planStandingOccurrences, manualGenerationDates, standingDeliveryDates, upcomingGenerations, STANDING_DISPLAY_DAYS, STANDING_SYNC_DAYS, type Occurrence, type StandingAction, type StandingOperation, type StandingOrder, type StandingVersion } from "./grab-and-go-standing";
import { getGrabAndGoOrderHosted, getStandingOrderHosted, listActiveStandingOrdersHosted, listStandingOperationsHosted, listStandingVersionsHosted, recordStandingOperationHosted, saveGrabAndGoOrderHosted, saveStandingOrderHosted, type StandingGuard } from "./grab-and-go-store";

/**
 * Standing orders never write production/fulfilment state. Every change below is an ordinary Grab & Go order
 * version committed with its CPU handoff event by saveGrabAndGoOrderHosted, then delivered by the existing outbox.
 *
 * Generation schedule (Europe/London): Monday 12:01 creates Wednesday's order, Thursday 12:01 creates the following
 * Monday's. A run creates an order only for a date whose generation time has passed and whose cutoff is still open, so a
 * missed run recovers on the next run until the cutoff, and repeated runs are no-ops. Activating, amending or resuming a
 * template never creates orders; amendments only synchronise automatic orders that already exist.
 */
export type RunTrigger = GrabAndGoOrderSource["trigger"];
export type RunMode = "scheduled" | "sync" | "manual";
export type ItemOutcome = "created" | "amended" | "cancelled" | "unchanged" | "skipped-manual-order" | "skipped-cancelled" | "skipped-existing-order" | "unavailable-lines" | "template-changed" | "error";
export type RunItem = { deliveryDate: string; slotKey: string; outcome: ItemOutcome; orderVersion?: number; handoff?: "delivered" | "pending" | "intervention-required"; unavailableProductIds?: string[]; message?: string };
export type TemplateRun = { oplocId: string; standingOrderId: string; templateVersion: number; items: RunItem[]; error?: string };
export type GenerationRun = { ranAt: string; trigger: RunTrigger; templates: number; truncated: boolean; created: number; amended: number; cancelled: number; skipped: number; exceptions: number; pendingHandoffs: number; results: TemplateRun[] };

export const SCHEDULER_TEMPLATE_LIMIT = 50;
const status = (error: unknown) => Number((error as { status?: number })?.status) || 0;
const message = (error: unknown) => error instanceof Error ? error.message : "Unexpected error.";
const fail = (text: string, code: number) => Object.assign(new Error(text), { status: code });

/** Orders for the OPLOC may exist under the canonical id or a controlled historical alias of it. */
export const equivalentOplocIds = (oplocId: string) => [oplocId, ...Object.entries(HISTORICAL_OPLOC_ID_ALIASES).filter(([, value]) => value.id === oplocId).map(([alias]) => alias)];
async function loadOrdersByDate(oplocId: string, dates: string[]) {
  const orders = new Map<string, GrabAndGoOrder>();
  await Promise.all(dates.map(async date => {
    for (const id of equivalentOplocIds(oplocId)) { const order = await getGrabAndGoOrderHosted(id, date); if (order) { orders.set(date, order); return; } }
  }));
  return orders;
}
const automaticSource = (order: GrabAndGoOrder, head: StandingOrder, trigger: RunTrigger): GrabAndGoOrderSource => ({ ...order.source!, templateVersion: head.version, trigger });

async function commit(head: StandingOrder, order: GrabAndGoOrder, expectedOrderVersion: number | undefined, statuses: StandingGuard["statuses"], at: Date) {
  const guard: StandingGuard = { oplocId: head.oplocId, expectedVersion: head.version, statuses };
  await saveGrabAndGoOrderHosted(order, expectedOrderVersion, guard);
  return dispatchGrabHandoff(order, at);
}

export type ReconcileOptions = { now?: Date; trigger: RunTrigger; mode: RunMode; /** Person performing a manual action; scheduled runs act for the template's authorising person. */ actor?: string; /** Manual mode: the single delivery date to create. */ targetDate?: string; /** Withdraw outstanding automatic orders instead of creating/synchronising. */ cancelAutomatic?: boolean };

/** Reconcile one template against its upcoming deliveries. Idempotent: a second run changes nothing. */
export async function reconcileStandingOrder(head: StandingOrder, catalogue: GrabAndGoProduct[], options: ReconcileOptions): Promise<TemplateRun> {
  const now = options.now || new Date(); const at = now.toISOString(); const actor = options.actor || head.updatedBy;
  const run: TemplateRun = { oplocId: head.oplocId, standingOrderId: head.standingOrderId, templateVersion: head.version, items: [] };
  if (options.mode === "manual") {
    if (!options.targetDate || !manualGenerationDates(now).includes(options.targetDate)) throw fail("Manual generation is only available for the next two open delivery dates.", 422);
    if (head.status !== "active") throw fail("Only an active standing order can generate an order.", 409);
  }
  const plan = planStandingOccurrences(head, await loadOrdersByDate(head.oplocId, standingDeliveryDates(now, STANDING_SYNC_DAYS)), catalogue, now, STANDING_SYNC_DAYS);
  for (const occurrence of plan) {
    const item: RunItem = { deliveryDate: occurrence.deliveryDate, slotKey: occurrence.slotKey, outcome: "unchanged" }; const order = occurrence.order;
    if (options.mode === "manual" && occurrence.deliveryDate !== options.targetDate) continue;
    try {
      if (occurrence.cutoffPassed) { run.items.push({ ...item, message: "Cut-off has passed; the order is read-only." }); continue; }
      if (options.cancelAutomatic) {
        if (order?.status === "submitted" && order.control === "automatic") {
          const cancelled = applyOrderAction(order, { action: "cancel", oplocId: head.oplocId, deliveryDate: occurrence.deliveryDate, rotationWeek: occurrence.rotationWeek, expectedVersion: order.version, actor, at, automation: automaticSource(order, head, options.trigger) }, catalogue);
          run.items.push({ ...item, outcome: "cancelled", orderVersion: cancelled.version, handoff: await commit(head, cancelled, order.version, [head.status], now) });
        } else run.items.push(item);
        continue;
      }
      const lines = occurrence.templateLines;
      if (occurrence.state === "manual-order") run.items.push({ ...item, outcome: "skipped-manual-order" });
      else if (occurrence.state === "cancelled") run.items.push({ ...item, outcome: "skipped-cancelled" });
      else if (occurrence.state === "unavailable-lines") run.items.push({ ...item, outcome: "unavailable-lines", unavailableProductIds: occurrence.unavailableProductIds, message: "The catalogue no longer offers every template product for this date. Nothing was changed." });
      else if ((occurrence.state === "generate" && options.mode === "scheduled") || (occurrence.state === "generate" || occurrence.state === "scheduled") && options.mode === "manual") {
        const source: GrabAndGoOrderSource = { type: "standing-order", standingOrderId: head.standingOrderId, templateVersion: head.version, rotationWeek: occurrence.rotationWeek, weekday: occurrence.weekday, trigger: options.trigger, generatedAt: at };
        const created = applyOrderAction(undefined, { action: "submit", oplocId: head.oplocId, deliveryDate: occurrence.deliveryDate, rotationWeek: occurrence.rotationWeek, lines, actor, at, automation: source }, catalogue);
        run.items.push({ ...item, outcome: "created", orderVersion: 1, handoff: await commit(head, created, undefined, ["active"], now) });
      } else if (occurrence.state === "sync" && order && options.mode !== "manual") {
        const amended = applyOrderAction(order, { action: "amend", oplocId: head.oplocId, deliveryDate: occurrence.deliveryDate, rotationWeek: occurrence.rotationWeek, lines, expectedVersion: order.version, actor, at, automation: automaticSource(order, head, options.trigger) }, catalogue);
        run.items.push({ ...item, outcome: "amended", orderVersion: amended.version, handoff: await commit(head, amended, order.version, ["active"], now) });
      } else if (occurrence.state === "slot-removed" && order && options.mode !== "manual") {
        const cancelled = applyOrderAction(order, { action: "cancel", oplocId: head.oplocId, deliveryDate: occurrence.deliveryDate, rotationWeek: occurrence.rotationWeek, expectedVersion: order.version, actor, at, automation: automaticSource(order, head, options.trigger) }, catalogue);
        run.items.push({ ...item, outcome: "cancelled", orderVersion: cancelled.version, handoff: await commit(head, cancelled, order.version, ["active"], now), message: "The slot is no longer configured." });
      } else if (options.mode === "manual") run.items.push({ ...item, ...(order ? { orderVersion: order.version } : {}), message: "Nothing to generate for this date." });
      else run.items.push({ ...item, ...(order ? { orderVersion: order.version } : {}) });
    } catch (error) {
      if (status(error) === 409) {
        // Either the template moved on (pause/amendment landed first) or another writer already owns the order.
        const current = await getStandingOrderHosted(head.oplocId);
        if (!current || current.version !== head.version || current.status !== head.status) { run.items.push({ ...item, outcome: "template-changed", message: "The standing order changed during this run; nothing further was written." }); break; }
        run.items.push({ ...item, outcome: "skipped-existing-order", message: "The order changed elsewhere; it was left as found." }); continue;
      }
      if (status(error) === 422) { run.items.push({ ...item, outcome: "unavailable-lines", message: message(error) }); continue; }
      run.items.push({ ...item, outcome: "error", message: message(error) });
    }
  }
  return run;
}

/** An operation is only complete when every change reached CPU: a recorded-but-pending cancellation is not success. */
export const runIsComplete = (run: TemplateRun) => !run.error && run.items.every(item => !["error", "template-changed", "unavailable-lines"].includes(item.outcome) && (!item.handoff || item.handoff === "delivered" || !["created", "amended", "cancelled"].includes(item.outcome)));

const summarise = (results: TemplateRun[], trigger: RunTrigger, now: Date, truncated: boolean): GenerationRun => {
  const items = results.flatMap(result => result.items); const count = (...outcomes: ItemOutcome[]) => items.filter(item => outcomes.includes(item.outcome)).length;
  return { ranAt: now.toISOString(), trigger, templates: results.length, truncated, created: count("created"), amended: count("amended"), cancelled: count("cancelled"), skipped: count("skipped-manual-order", "skipped-cancelled", "skipped-existing-order"), exceptions: count("unavailable-lines", "error", "template-changed") + results.filter(result => result.error).length, pendingHandoffs: items.filter(item => item.handoff && item.handoff !== "delivered").length, results };
};

/** Scheduled entry point: bounded, replay-safe, recovers missed runs until cutoff, isolated per template. */
export async function runStandingGeneration(input: { catalogue: GrabAndGoProduct[]; now?: Date; oplocId?: string; limit?: number; trigger?: RunTrigger }): Promise<GenerationRun> {
  const now = input.now || new Date(); const trigger = input.trigger || "scheduler"; const limit = Math.min(Math.max(Math.floor(input.limit || SCHEDULER_TEMPLATE_LIMIT), 1), SCHEDULER_TEMPLATE_LIMIT);
  let heads: StandingOrder[]; let truncated = false;
  if (input.oplocId) { const head = await getStandingOrderHosted(input.oplocId); heads = head?.status === "active" ? [head] : []; }
  else { const found = await listActiveStandingOrdersHosted(limit + 1); truncated = found.length > limit; heads = found.slice(0, limit); }
  const results: TemplateRun[] = [];
  for (const head of heads) {
    try { results.push(await reconcileStandingOrder(head, input.catalogue, { now, trigger, mode: "scheduled" })); }
    catch (error) { results.push({ oplocId: head.oplocId, standingOrderId: head.standingOrderId, templateVersion: head.version, items: [], error: message(error) }); }
  }
  return summarise(results, trigger, now, truncated);
}

export type UpcomingDelivery = Omit<Occurrence, "order"> & {
  /** True when an authorised user may create this order now (active template, open date, one of the next two deliveries). */
  canGenerateNow: boolean;
  order?: { orderId: string; version: number; status: GrabAndGoOrder["status"]; control: "automatic" | "manual"; source?: GrabAndGoOrderSource; lines: GrabAndGoOrder["lines"]; updatedAt: string; updatedBy: string; handoff: GrabHandoffState; editable: boolean };
  exception?: string;
};
export type StandingOverview = { oplocId: string; standingOrder: StandingOrder | null; versions: StandingVersion[]; operations: StandingOperation[]; /** False when the history queries failed (for example a Firestore index is still building); the rest of the overview is unaffected. */ historyAvailable: boolean; upcoming: UpcomingDelivery[]; schedule: { nextGenerations: Array<{ deliveryDate: string; generationAt: string }>; timeZone: "Europe/London" }; horizonDays: number };

const EXCEPTIONS: Partial<Record<Occurrence["state"], string>> = {
  "manual-order": "A manually controlled order exists, so the standing order leaves it alone.",
  "unavailable-lines": "The catalogue no longer offers every product in this slot. No order will be created or changed until the slot is updated.",
  "slot-removed": "This slot was removed from the standing order; its automatic order will be withdrawn.",
  missed: "The schedule did not create this order before the cut-off, so no order exists for this date.",
};
/** Read-only overview for the Standing orders tab. Bounded: one head, ≤25 versions, ≤10 operations, ≤5 known order ids and their outbox ids. */
export async function standingOverview(oplocId: string, catalogue: GrabAndGoProduct[], now = new Date()): Promise<StandingOverview> {
  const history = Promise.all([listStandingVersionsHosted(oplocId, 25), listStandingOperationsHosted(oplocId, 10)]).then(([versions, operations]) => ({ versions, operations, historyAvailable: true }), () => ({ versions: [] as StandingVersion[], operations: [] as StandingOperation[], historyAvailable: false }));
  const [head, { versions, operations, historyAvailable }] = await Promise.all([getStandingOrderHosted(oplocId), history]);
  const plan = planStandingOccurrences(head, await loadOrdersByDate(oplocId, standingDeliveryDates(now, STANDING_DISPLAY_DAYS)), catalogue, now, STANDING_DISPLAY_DAYS);
  const handoffs = await readGrabHandoffStates(plan.flatMap(occurrence => occurrence.order ? [occurrence.order] : []));
  const eligible = new Set(manualGenerationDates(now));
  const upcoming = plan.map(({ order, ...occurrence }): UpcomingDelivery => {
    const handoff = order ? handoffs.get(order.orderId) || "not-tracked" : undefined;
    const activeWhileStopped = head && head.status !== "active" && order?.control === "automatic" && order.status === "submitted" && !occurrence.cutoffPassed;
    const exception = EXCEPTIONS[occurrence.state]
      || (activeWhileStopped ? `The standing order is ${head!.status}, but this automatic order is still active. Use “Cancel automatic orders” if it is no longer wanted.` : undefined)
      || (handoff === "intervention-required" ? "The production update needs administrator review." : undefined)
      || (handoff === "pending" ? (order!.status === "cancelled" ? "The cancellation is recorded but CPU has not been updated yet. Retry the production update." : "The production update to CPU is pending. Retry the production update if it does not clear.") : undefined);
    return { ...occurrence, canGenerateNow: Boolean(head?.status === "active" && !order && eligible.has(occurrence.deliveryDate) && ["generate", "scheduled"].includes(occurrence.state)), ...(order ? { order: { orderId: order.orderId, version: order.version, status: order.status, control: order.control === "automatic" ? "automatic" : "manual", ...(order.source ? { source: order.source } : {}), lines: order.lines, updatedAt: order.updatedAt, updatedBy: order.updatedBy, handoff: handoff!, editable: !occurrence.cutoffPassed && order.status === "submitted" } } : {}), ...(exception ? { exception } : {}) };
  });
  return { oplocId, standingOrder: head || null, versions, operations, historyAvailable, upcoming, schedule: { nextGenerations: upcomingGenerations(now), timeZone: "Europe/London" }, horizonDays: STANDING_DISPLAY_DAYS };
}

export type StandingMutation = { action: StandingAction | "cancel-upcoming" | "generate"; oplocId: string; actor: string; expectedVersion?: number; slots?: unknown; note?: string; deliveryDate?: string };
export type StandingMutationResult = { standingOrder: StandingOrder; unchanged?: boolean; version?: StandingVersion; reconcile?: TemplateRun; reconcileError?: string; /** False when any change has not reached CPU or any item failed: never present it as success. */ complete?: boolean; operationId?: string; auditError?: string };

async function audited(operation: "manual-generate" | "cancel-upcoming", head: StandingOrder, actor: string, run: TemplateRun, now: Date): Promise<Pick<StandingMutationResult, "operationId" | "auditError">> {
  const record: StandingOperation = { schemaVersion: 2, recordType: "operation", operationId: randomUUID(), standingOrderId: head.standingOrderId, oplocId: head.oplocId, operation, templateVersion: head.version, at: now.toISOString(), actor, complete: runIsComplete(run), items: run.items.filter(item => item.outcome !== "unchanged" || item.message).map(item => ({ deliveryDate: item.deliveryDate, outcome: item.outcome, ...(item.orderVersion ? { orderVersion: item.orderVersion } : {}), ...(item.handoff ? { handoff: item.handoff } : {}), ...(item.message ? { message: item.message } : {}) })) };
  try { await recordStandingOperationHosted(record); return { operationId: record.operationId }; } catch (error) { return { operationId: record.operationId, auditError: message(error) }; }
}

/** One audited template transition (or explicit operation), then a bounded synchronisation of automatic orders it affects. */
export async function mutateStandingOrder(input: StandingMutation, catalogue: GrabAndGoProduct[], now = new Date()): Promise<StandingMutationResult> {
  const existing = await getStandingOrderHosted(input.oplocId);
  if (input.action === "cancel-upcoming" || input.action === "generate") {
    if (!existing) throw fail("This site has no standing order.", 404);
    if (input.expectedVersion !== existing.version) throw fail(`This standing order changed elsewhere (expected version ${existing.version}). Refresh and try again.`, 409);
    if (input.action === "cancel-upcoming") {
      if (!["paused", "terminated"].includes(existing.status)) throw fail("Pause or terminate the standing order before cancelling its upcoming automatic orders.", 409);
      const run = await reconcileStandingOrder(existing, catalogue, { now, trigger: "manual-run", mode: "sync", actor: input.actor, cancelAutomatic: true });
      return { standingOrder: existing, unchanged: true, reconcile: run, complete: runIsComplete(run), ...(await audited("cancel-upcoming", existing, input.actor, run, now)) };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate || "")) throw fail("A delivery date is required.", 422);
    const run = await reconcileStandingOrder(existing, catalogue, { now, trigger: "manual-run", mode: "manual", actor: input.actor, targetDate: input.deliveryDate });
    return { standingOrder: existing, unchanged: true, reconcile: run, complete: runIsComplete(run), ...(await audited("manual-generate", existing, input.actor, run, now)) };
  }
  const sourceOrder = input.action === "populate-slot" ? await getGrabAndGoOrderHosted(input.oplocId, input.deliveryDate || "") : undefined;
  if (input.action === "populate-slot" && !sourceOrder) throw fail("That order was not found for this site.", 404);
  const transition = applyStandingAction(existing, { action: input.action, oplocId: input.oplocId, actor: input.actor, at: now.toISOString(), expectedVersion: input.expectedVersion, slots: input.slots, note: input.note, ...(sourceOrder ? { sourceOrder } : {}) }, catalogue);
  if (!transition.version) return { standingOrder: transition.head, unchanged: true };
  const head = await saveStandingOrderHosted(transition, existing?.version);
  const result: StandingMutationResult = { standingOrder: head, version: transition.version };
  // Only existing automatic orders are synchronised after an amendment; activation and resume never create orders.
  if (head.status === "active" && ["amended", "slot-populated", "resumed"].includes(transition.version.action)) {
    try { result.reconcile = await reconcileStandingOrder(head, catalogue, { now, trigger: transition.version.action === "resumed" ? "resume" : "amendment", mode: "sync", actor: input.actor }); result.complete = runIsComplete(result.reconcile); }
    catch (error) { result.reconcileError = message(error); result.complete = false; }
  }
  return result;
}
