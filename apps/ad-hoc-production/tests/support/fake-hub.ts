import type { HubPort } from "../../lib/hub-client";
import type { HubError } from "../../lib/hub-client";
import { adHocProductionOrderId, type AdHocCancelCommand, type AdHocSendCommand } from "../../../shared/ad-hoc-production-contract";

type FakeOrder = { canonicalId: string; version: number; status: string; sourceVersion: number; lines: number; quantity: number };
type Operation = "send" | "cancel" | "status" | "access";

/**
 * A contract-faithful in-memory Hub for Ad-Hoc service tests. It mirrors the Hub's
 * documented behaviour (one order per request, idempotent per version, amendment
 * refused once CPU has started, repeat-safe cancel) and can inject the failures a
 * network produces: a failure before the change, or after it (a lost response).
 */
export class FakeHub implements HubPort {
  readonly orders = new Map<string, FakeOrder>();
  readonly calls: Array<{ op: Operation; requestId?: string; requestVersion?: number }> = [];
  private failures: Array<{ op: Operation; when: "before" | "after" }> = [];
  private delays = 0;

  failNext(op: Operation, when: "before" | "after") { this.failures.push({ op, when }); return this; }
  slow() { this.delays = 3; return this; }
  cpuCancel(requestId: string) { const order = this.orders.get(requestId); if (order) { order.status = "cancelled"; order.version += 1; } }
  cpuStart(requestId: string) { const order = this.orders.get(requestId); if (order) { order.status = "in_production"; order.version += 1; } }

  private take(op: Operation, when: "before" | "after") {
    const index = this.failures.findIndex(item => item.op === op && item.when === when);
    if (index < 0) return;
    this.failures.splice(index, 1);
    throw Object.assign(new Error("The Integration Hub did not confirm the change. It is safe to try again."), { status: 503, kind: "unconfirmed" }) as HubError;
  }
  private async yieldTurns() { for (let turn = 0; turn < this.delays; turn += 1) await Promise.resolve(); }

  async access() { this.calls.push({ op: "access" }); return { principal: { id: "fake-user", displayName: "Fake User" }, oplocs: [{ canonicalId: "oploc:fake", label: "Fake OPLOC", address: "1 Fake Street" }] }; }

  async send(command: AdHocSendCommand) {
    this.calls.push({ op: "send", requestId: command.requestId, requestVersion: command.requestVersion });
    this.take("send", "before");
    await this.yieldTurns();
    const canonicalId = adHocProductionOrderId(command.requestId);
    const existing = this.orders.get(command.requestId);
    let outcome: "created" | "amended" | "already_applied";
    if (!existing) { this.orders.set(command.requestId, { canonicalId, version: 1, status: "draft", sourceVersion: command.order.sourceVersion, lines: command.order.lines.length, quantity: command.order.lines[0].customerQuantity }); outcome = "created"; }
    else if (existing.sourceVersion >= command.order.sourceVersion) outcome = "already_applied";
    else if (!["draft", "needs_review", "needs_clarification", "accepted", "blocked"].includes(existing.status)) throw Object.assign(new Error(`CPU has already moved this order to ${existing.status}. Contact CPU to change it.`), { status: 422, kind: "rejected" }) as HubError;
    else { Object.assign(existing, { version: existing.version + 1, sourceVersion: command.order.sourceVersion, lines: command.order.lines.length, quantity: command.order.lines[0].customerQuantity }); outcome = "amended"; }
    const order = this.orders.get(command.requestId)!;
    this.take("send", "after");
    return { canonicalId, orderVersion: order.version, orderStatus: order.status, outcome, destination: command.order.destinationAddress ? { label: command.order.destinationAddress.label, address: command.order.destinationAddress.address } : { oplocId: command.order.destinationOplocId, label: "Fake OPLOC", address: "1 Fake Street" } };
  }

  async cancel(command: AdHocCancelCommand) {
    this.calls.push({ op: "cancel", requestId: command.requestId });
    this.take("cancel", "before");
    const order = this.orders.get(command.requestId);
    if (!order) throw Object.assign(new Error("The Integration Hub has no Production Order for this request."), { status: 404, kind: "not_found" }) as HubError;
    const outcome = order.status === "cancelled" ? "already_cancelled" as const : "cancelled" as const;
    if (outcome === "cancelled") { order.status = "cancelled"; order.version += 1; }
    this.take("cancel", "after");
    return { canonicalId: order.canonicalId, orderStatus: "cancelled", outcome };
  }

  async status(requestId: string) {
    this.calls.push({ op: "status", requestId });
    this.take("status", "before");
    const order = this.orders.get(requestId);
    return order ? { canonicalId: order.canonicalId, orderStatus: order.status, orderVersion: order.version, cancelled: order.status === "cancelled" } : null;
  }
}
