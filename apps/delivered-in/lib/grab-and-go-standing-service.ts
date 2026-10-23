import { HISTORICAL_OPLOC_ID_ALIASES } from "@fika/server-shared/governed-oplocs";
import { applyOrderAction, type GrabAndGoOrder, type GrabAndGoOrderSource, type GrabAndGoProduct } from "./grab-and-go";
import { dispatchGrabHandoff, readGrabHandoffStates, type GrabHandoffState } from "./grab-and-go-handoff";
import { applyStandingAction, planStandingOccurrences, standingDeliveryDates, type Occurrence, type StandingAction, type StandingOrder, type StandingVersion } from "./grab-and-go-standing";
import { getGrabAndGoOrderHosted, getStandingOrderHosted, listActiveStandingOrdersHosted, listStandingVersionsHosted, saveGrabAndGoOrderHosted, saveStandingOrderHosted, type StandingGuard } from "./grab-and-go-store";

/**
 * Standing orders never write production/fulfilment state. Every change below is an ordinary Grab & Go order
 * version committed with its CPU handoff event by saveGrabAndGoOrderHosted, then delivered by the existing outbox.
 */
export type RunTrigger = GrabAndGoOrderSource["trigger"];
export type ItemOutcome = "created" | "amended" | "cancelled" | "unchanged" | "skipped-manual-order" | "skipped-cancelled" | "skipped-existing-order" | "unavailable-lines" | "template-changed" | "error";
export type RunItem = { deliveryDate: string; slotKey: string; outcome: ItemOutcome; orderVersion?: number; handoff?: "delivered" | "pending" | "intervention-required"; unavailableProductIds?: string[]; message?: string };
export type TemplateRun = { oplocId: string; standingOrderId: string; templateVersion: number; items: RunItem[]; error?: string };
export type GenerationRun = { ranAt: string; trigger: RunTrigger; templates: number; truncated: boolean; created: number; amended: number; cancelled: number; skipped: number; exceptions: number; results: TemplateRun[] };

export const SCHEDULER_TEMPLATE_LIMIT = 50;
const status = (error: unknown) => Number((error as { status?: number })?.status) || 0;
const message = (error: unknown) => error instanceof Error ? error.message : "Unexpected error.";

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

/** Reconcile one template against its upcoming deliveries. Idempotent: a second run changes nothing. */
export async function reconcileStandingOrder(head: StandingOrder, catalogue: GrabAndGoProduct[], options: { now?: Date; trigger: RunTrigger; cancelAutomatic?: boolean }): Promise<TemplateRun> {
  const now = options.now || new Date(); const at = now.toISOString(); const run: TemplateRun = { oplocId: head.oplocId, standingOrderId: head.standingOrderId, templateVersion: head.version, items: [] };
  const plan = planStandingOccurrences(head, await loadOrdersByDate(head.oplocId, standingDeliveryDates(now)), catalogue, now);
  for (const occurrence of plan) {
    const item: RunItem = { deliveryDate: occurrence.deliveryDate, slotKey: occurrence.slotKey, outcome: "unchanged" }; const order = occurrence.order;
    try {
      if (occurrence.cutoffPassed) { run.items.push({ ...item, outcome: "unchanged", message: "Cut-off has passed; the order is read-only." }); continue; }
      if (options.cancelAutomatic) {
        if (order?.status === "submitted" && order.control === "automatic") {
          const cancelled = applyOrderAction(order, { action: "cancel", oplocId: head.oplocId, deliveryDate: occurrence.deliveryDate, rotationWeek: occurrence.rotationWeek, expectedVersion: order.version, actor: head.updatedBy, at, automation: automaticSource(order, head, options.trigger) }, catalogue);
          run.items.push({ ...item, outcome: "cancelled", orderVersion: cancelled.version, handoff: await commit(head, cancelled, order.version, [head.status], now) });
        } else run.items.push(item);
        continue;
      }
      const lines = occurrence.templateLines;
      if (occurrence.state === "manual-order") run.items.push({ ...item, outcome: "skipped-manual-order" });
      else if (occurrence.state === "cancelled") run.items.push({ ...item, outcome: "skipped-cancelled" });
      else if (occurrence.state === "unavailable-lines") run.items.push({ ...item, outcome: "unavailable-lines", unavailableProductIds: occurrence.unavailableProductIds, message: "The catalogue no longer offers every template product for this date. Nothing was changed." });
      else if (occurrence.state === "generate") {
        const source: GrabAndGoOrderSource = { type: "standing-order", standingOrderId: head.standingOrderId, templateVersion: head.version, rotationWeek: occurrence.rotationWeek, weekday: occurrence.weekday, trigger: options.trigger, generatedAt: at };
        const created = applyOrderAction(undefined, { action: "submit", oplocId: head.oplocId, deliveryDate: occurrence.deliveryDate, rotationWeek: occurrence.rotationWeek, lines, actor: head.updatedBy, at, automation: source }, catalogue);
        run.items.push({ ...item, outcome: "created", orderVersion: 1, handoff: await commit(head, created, undefined, ["active"], now) });
      } else if (occurrence.state === "sync" && order) {
        const amended = applyOrderAction(order, { action: "amend", oplocId: head.oplocId, deliveryDate: occurrence.deliveryDate, rotationWeek: occurrence.rotationWeek, lines, expectedVersion: order.version, actor: head.updatedBy, at, automation: automaticSource(order, head, options.trigger) }, catalogue);
        run.items.push({ ...item, outcome: "amended", orderVersion: amended.version, handoff: await commit(head, amended, order.version, ["active"], now) });
      } else if (occurrence.state === "slot-removed" && order) {
        const cancelled = applyOrderAction(order, { action: "cancel", oplocId: head.oplocId, deliveryDate: occurrence.deliveryDate, rotationWeek: occurrence.rotationWeek, expectedVersion: order.version, actor: head.updatedBy, at, automation: automaticSource(order, head, options.trigger) }, catalogue);
        run.items.push({ ...item, outcome: "cancelled", orderVersion: cancelled.version, handoff: await commit(head, cancelled, order.version, ["active"], now), message: "The slot is no longer configured." });
      } else run.items.push({ ...item, ...(order ? { orderVersion: order.version } : {}) });
    } catch (error) {
      if (status(error) === 409) {
        // Either the template moved on (pause/amendment landed first) or another writer already owns the order.
        const current = await getStandingOrderHosted(head.oplocId);
        if (!current || current.version !== head.version || (current.status !== head.status)) { run.items.push({ ...item, outcome: "template-changed", message: "The standing order changed during this run; nothing further was written." }); break; }
        run.items.push({ ...item, outcome: "skipped-existing-order", message: "The order changed elsewhere; it was left as found." }); continue;
      }
      if (status(error) === 422) { run.items.push({ ...item, outcome: "unavailable-lines", message: message(error) }); continue; }
      run.items.push({ ...item, outcome: "error", message: message(error) });
    }
  }
  return run;
}

const summarise = (results: TemplateRun[], trigger: RunTrigger, now: Date, truncated: boolean): GenerationRun => {
  const items = results.flatMap(result => result.items); const count = (...outcomes: ItemOutcome[]) => items.filter(item => outcomes.includes(item.outcome)).length;
  return { ranAt: now.toISOString(), trigger, templates: results.length, truncated, created: count("created"), amended: count("amended"), cancelled: count("cancelled"), skipped: count("skipped-manual-order", "skipped-cancelled", "skipped-existing-order"), exceptions: count("unavailable-lines", "error", "template-changed") + results.filter(result => result.error).length, results };
};

/** Scheduled entry point: bounded, replay-safe and isolated per template. */
export async function runStandingGeneration(input: { catalogue: GrabAndGoProduct[]; now?: Date; oplocId?: string; limit?: number; trigger?: RunTrigger }): Promise<GenerationRun> {
  const now = input.now || new Date(); const trigger = input.trigger || "scheduler"; const limit = Math.min(Math.max(Math.floor(input.limit || SCHEDULER_TEMPLATE_LIMIT), 1), SCHEDULER_TEMPLATE_LIMIT);
  let heads: StandingOrder[]; let truncated = false;
  if (input.oplocId) { const head = await getStandingOrderHosted(input.oplocId); heads = head?.status === "active" ? [head] : []; }
  else { const found = await listActiveStandingOrdersHosted(limit + 1); truncated = found.length > limit; heads = found.slice(0, limit); }
  const results: TemplateRun[] = [];
  for (const head of heads) {
    try { results.push(await reconcileStandingOrder(head, input.catalogue, { now, trigger })); }
    catch (error) { results.push({ oplocId: head.oplocId, standingOrderId: head.standingOrderId, templateVersion: head.version, items: [], error: message(error) }); }
  }
  return summarise(results, trigger, now, truncated);
}

export type UpcomingDelivery = Omit<Occurrence, "order" | "templateLines"> & {
  templateLines: Occurrence["templateLines"];
  order?: { orderId: string; version: number; status: GrabAndGoOrder["status"]; control: "automatic" | "manual"; source?: GrabAndGoOrderSource; lines: GrabAndGoOrder["lines"]; updatedAt: string; updatedBy: string; handoff: GrabHandoffState; editable: boolean };
  exception?: string;
};
export type StandingOverview = { oplocId: string; standingOrder: StandingOrder | null; versions: StandingVersion[]; upcoming: UpcomingDelivery[]; horizonDays: number };

const EXCEPTIONS: Partial<Record<Occurrence["state"], string>> = {
  "manual-order": "A manually controlled order exists, so the standing order leaves it alone.",
  "unavailable-lines": "The catalogue no longer offers every product in this slot. No order will be created or changed until the slot is updated.",
  "slot-removed": "This slot was removed from the standing order; its automatic order will be withdrawn.",
};
/** Read-only overview for the Standing orders tab. Bounded: one head, ≤50 versions, ≤5 known order ids and their outbox ids. */
export async function standingOverview(oplocId: string, catalogue: GrabAndGoProduct[], now = new Date()): Promise<StandingOverview> {
  const [head, versions] = await Promise.all([getStandingOrderHosted(oplocId), listStandingVersionsHosted(oplocId)]);
  const plan = planStandingOccurrences(head, await loadOrdersByDate(oplocId, standingDeliveryDates(now)), catalogue, now);
  const handoffs = await readGrabHandoffStates(plan.flatMap(occurrence => occurrence.order ? [occurrence.order] : []));
  const upcoming = plan.map(({ order, ...occurrence }): UpcomingDelivery => {
    const handoff = order ? handoffs.get(order.orderId) || "not-tracked" : undefined;
    const exception = EXCEPTIONS[occurrence.state] || (handoff === "intervention-required" ? "The production update needs administrator review." : undefined);
    return { ...occurrence, ...(order ? { order: { orderId: order.orderId, version: order.version, status: order.status, control: order.control === "automatic" ? "automatic" : "manual", ...(order.source ? { source: order.source } : {}), lines: order.lines, updatedAt: order.updatedAt, updatedBy: order.updatedBy, handoff: handoff!, editable: !occurrence.cutoffPassed && order.status === "submitted" } } : {}), ...(exception ? { exception } : {}) };
  });
  return { oplocId, standingOrder: head || null, versions, upcoming, horizonDays: 14 };
}

export type StandingMutation = { action: StandingAction | "cancel-upcoming"; oplocId: string; actor: string; expectedVersion?: number; slots?: unknown; note?: string; deliveryDate?: string; upcomingOrders?: "keep" | "cancel" };
export type StandingMutationResult = { standingOrder: StandingOrder; unchanged?: boolean; version?: StandingVersion; reconcile?: TemplateRun; reconcileError?: string };

/** One audited template transition, then an idempotent reconciliation of the upcoming orders it affects. */
export async function mutateStandingOrder(input: StandingMutation, catalogue: GrabAndGoProduct[], now = new Date()): Promise<StandingMutationResult> {
  const existing = await getStandingOrderHosted(input.oplocId);
  if (input.action === "cancel-upcoming") {
    if (!existing || !["paused", "terminated"].includes(existing.status)) throw Object.assign(new Error("Only a paused or terminated standing order can withdraw its upcoming automatic orders."), { status: 409 });
    if (input.expectedVersion !== existing.version) throw Object.assign(new Error(`This standing order changed elsewhere (expected version ${existing.version}). Refresh and try again.`), { status: 409 });
    return { standingOrder: existing, unchanged: true, reconcile: await reconcileStandingOrder(existing, catalogue, { now, trigger: "manual-run", cancelAutomatic: true }) };
  }
  const sourceOrder = input.action === "populate-slot" ? await getGrabAndGoOrderHosted(input.oplocId, input.deliveryDate || "") : undefined;
  if (input.action === "populate-slot" && !sourceOrder) throw Object.assign(new Error("That order was not found for this site."), { status: 404 });
  const transition = applyStandingAction(existing, { action: input.action, oplocId: input.oplocId, actor: input.actor, at: now.toISOString(), expectedVersion: input.expectedVersion, slots: input.slots, note: input.note, ...(sourceOrder ? { sourceOrder } : {}) }, catalogue);
  if (!transition.version) return { standingOrder: transition.head, unchanged: true };
  const head = await saveStandingOrderHosted(transition, existing?.version);
  const result: StandingMutationResult = { standingOrder: head, version: transition.version };
  try {
    if (head.status === "active") result.reconcile = await reconcileStandingOrder(head, catalogue, { now, trigger: transition.version.action === "activated" ? "activation" : transition.version.action === "resumed" ? "resume" : "amendment" });
    else if ((head.status === "paused" || head.status === "terminated") && input.upcomingOrders === "cancel") result.reconcile = await reconcileStandingOrder(head, catalogue, { now, trigger: "manual-run", cancelAutomatic: true });
  } catch (error) { result.reconcileError = message(error); }
  return result;
}
