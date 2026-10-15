import type { GrabAndGoOrder, GrabAndGoProduct } from "./grab-and-go";
import { buildOccurrenceOrder, createTemplate, planNextOccurrence, transitionTemplate, type StandingOrder, type StandingOrderAction } from "./grab-and-go-standing";
import { commitStandingOccurrenceHosted, createStandingOrderHosted, getGrabAndGoOrderHosted, getStandingOrderHosted, listStandingOrdersHosted, saveStandingOrderHosted } from "./grab-and-go-store";

export type GenerationOutcome = { standingOrderId: string; oplocId: string; result: "created" | "skipped-existing-order" | "no-valid-lines" | "not-needed" | "conflict" | "error"; occurrenceDate?: string; reason?: string; droppedProductIds?: string[]; order?: GrabAndGoOrder };

/**
 * Daily evaluation. For every active template creates at most ONE future occurrence through the canonical submit
 * rules, then lets the caller hand the new order to production exactly as a manual order would be.
 * Safe to run repeatedly or concurrently: see commitStandingOccurrenceHosted.
 */
export async function generateDueStandingOrders(input: { products: GrabAndGoProduct[]; now?: Date; deliver?: (order: GrabAndGoOrder) => Promise<unknown> }) {
  const now = input.now || new Date(); const outcomes: GenerationOutcome[] = [];
  for (const template of await listStandingOrdersHosted({ status: "active" })) {
    const base = { standingOrderId: template.standingOrderId, oplocId: template.oplocId };
    try {
      const plan = planNextOccurrence(template, now);
      if (plan.action === "none") { outcomes.push({ ...base, result: "not-needed", reason: plan.reason }); continue; }
      const built = buildOccurrenceOrder(template, plan.occurrenceDate, input.products, now);
      if (!built.order) { outcomes.push({ ...base, result: "no-valid-lines", occurrenceDate: plan.occurrenceDate, droppedProductIds: built.dropped }); continue; }
      const committed = await commitStandingOccurrenceHosted({ standingOrderId: template.standingOrderId, expectedLast: template.lastOccurrenceDate, occurrenceDate: plan.occurrenceDate, order: built.order, at: now.toISOString() });
      outcomes.push({ ...base, result: committed, occurrenceDate: plan.occurrenceDate, droppedProductIds: built.dropped, ...(committed === "created" ? { order: built.order } : {}) });
      if (committed === "created" && input.deliver) { try { await input.deliver(built.order); } catch { /* source is committed; the outbox recovery job retries the CPU handoff */ } }
    } catch (error) { outcomes.push({ ...base, result: "error", reason: error instanceof Error ? error.message : "Unknown error" }); }
  }
  return { evaluated: outcomes.length, created: outcomes.filter(item => item.result === "created").length, outcomes };
}

export async function createStandingOrder(input: { oplocId: string; sourceDeliveryDate: string; weekdays: unknown; endDate?: unknown; actor: string; now?: Date }) {
  const source = await getGrabAndGoOrderHosted(input.oplocId, input.sourceDeliveryDate);
  if (!source) throw Object.assign(new Error("Grab & Go order not found."), { status: 404 });
  const template = createTemplate({ source, weekdays: input.weekdays, endDate: input.endDate, actor: input.actor, at: (input.now || new Date()).toISOString() });
  return createStandingOrderHosted(template, source.orderId, source.version);
}

export async function changeStandingOrder(input: { oplocId: string; standingOrderId: string; expectedVersion: number; change: Exclude<StandingOrderAction, { action: "update-from-order" }> | { action: "update-from-order"; deliveryDate: string }; actor: string; now?: Date }) {
  const current = await getStandingOrderHosted(input.standingOrderId);
  if (!current || current.oplocId !== input.oplocId) throw Object.assign(new Error("Standing order not found."), { status: 404 });
  if (current.version !== input.expectedVersion) throw Object.assign(new Error("This standing order changed elsewhere. Refresh and try again."), { status: 409 });
  let change: StandingOrderAction;
  if (input.change.action === "update-from-order") {
    const order = await getGrabAndGoOrderHosted(input.oplocId, (input.change as { deliveryDate: string }).deliveryDate);
    if (!order) throw Object.assign(new Error("Grab & Go order not found."), { status: 404 });
    change = { action: "update-from-order", order };
  } else change = input.change as StandingOrderAction;
  const next: StandingOrder = transitionTemplate(current, change, input.actor, (input.now || new Date()).toISOString());
  return saveStandingOrderHosted(next, input.expectedVersion);
}
