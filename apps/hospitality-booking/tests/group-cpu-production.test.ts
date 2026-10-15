import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import type { ReactElement, ReactNode } from "react";
import { planServiceProduction, requiresCpuSummary, sendPendingServices, serviceCpuRequirement, type ServiceProductionRow, type ServiceResult } from "../lib/cpu-production-plan";
import type { CanonicalBooking, ProductionOrder } from "../lib/canonical-types";

// CSS modules resolve to their class names so the presentational panel can be exercised without a bundler.
register("data:text/javascript," + encodeURIComponent("export async function load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true }; return next(url, context); }"));
const { BookingProductionPanel } = await import("../app/ui/BookingProductionPanel");

type Line = { state: string };
const booking = (id: string, lines: Line[] | undefined, extra: Partial<CanonicalBooking> = {}) => ({
  canonicalId: id, version: 3, commercialVersion: 1, lifecycleStatus: "Quoted",
  quoteState: { currentRevisionId: `${id}-q1`, revisions: [{ id: `${id}-q1`, pdfStatus: "saved", driveFileId: "file" }] },
  ...(lines ? { cpuRouting: { status: "x", statusLabel: "x", enforced: true, lines: lines.map((line, index) => ({ index, state: line.state, label: line.state })) } } : {}),
  ...extra,
}) as unknown as CanonicalBooking;
const coffeeNoCpu = { state: "in_house" };
const rows = (items: Array<[string, CanonicalBooking, string]>, orders: Record<string, ProductionOrder> = {}, results: Record<string, ServiceResult> = {}) => items.map(([, b, label]) => planServiceProduction(b, orders[b.canonicalId], label, results));

const A = booking("A", [coffeeNoCpu, { state: "cpu_hospitality" }]);
const B = booking("B", [coffeeNoCpu]);
const C = booking("C", [{ state: "cpu_sandwiches" }]);
const D = booking("D", [coffeeNoCpu]);
const groupRows = (results: Record<string, ServiceResult> = {}) => rows([["A", A, "09:00 · Hospitality"], ["B", B, "11:00 · Break"], ["C", C, "13:00 · Sandwiches"], ["D", D, "15:00 · Break"]], {}, results);

const text = (node: ReactNode): string => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text((node as ReactElement<{ children?: ReactNode }>).props?.children) : String(node);
const walk = (node: ReactNode, visit: (element: ReactElement<Record<string, unknown>>) => void) => {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(child => walk(child, visit));
  const element = node as ReactElement<Record<string, unknown>>;
  visit(element); walk(element.props?.children as ReactNode, visit);
};
const panel = (r: ServiceProductionRow[], results: Record<string, ServiceResult> = {}, onSend = () => {}, busy = false) => BookingProductionPanel({ rows: r, results, busy, onSend });
const buttons = (tree: ReactNode) => { const out: Array<ReactElement<Record<string, unknown>>> = []; walk(tree, el => { if (el.type === "button") out.push(el); }); return out; };

test("grouped booking: one Send to CPU for the 2 of 4 services that need CPU; never B or D", async () => {
  const r = groupRows();
  assert.deepEqual(r.map(row => row.requirement), ["cpu", "no_cpu", "cpu", "no_cpu"]);
  assert.equal(requiresCpuSummary(r), "2 of 4 services require CPU production");
  let sent = 0;
  const tree = panel(r, {}, () => { sent += 1; });
  assert.match(text(tree), /CPU production, allergens and menus/);
  assert.match(text(tree), /2 of 4 services require CPU production/);
  const send = buttons(tree).filter(b => text(b).includes("Send to CPU"));
  assert.equal(send.length, 1);
  (send[0].props.onClick as () => void)();
  assert.equal(sent, 1);
  const calls: string[] = [];
  const outcome = await sendPendingServices(r, async id => { calls.push(id); return { status: "sent" }; });
  assert.deepEqual(calls, ["A", "C"]);
  assert.deepEqual(Object.keys(outcome), ["A", "C"]);
  const listed = text(tree);
  assert.ok(listed.includes("09:00 · Hospitality") && listed.includes("13:00 · Sandwiches"));
  assert.ok(!listed.includes("11:00") && !listed.includes("15:00"), "No CPU services are not listed as production services");
});

test("partial failure reports per service and a retry sends only the failed service", async () => {
  const first: string[] = [];
  const outcome = await sendPendingServices(groupRows(), async id => { first.push(id); return id === "C" ? { status: "failed", message: "Version conflict" } : { status: "sent" }; });
  assert.deepEqual(first, ["A", "C"]);
  assert.equal(outcome.A.status, "sent"); assert.equal(outcome.C.status, "failed");
  const after = groupRows(outcome);
  assert.deepEqual(after.filter(row => row.requirement === "cpu").map(row => [row.bookingId, row.state]), [["A", "sent"], ["C", "pending"]]);
  const view = text(panel(after, outcome));
  assert.match(view, /09:00 · HospitalitySent/); assert.match(view, /13:00 · SandwichesFailed/); assert.match(view, /Version conflict/);
  const retry: string[] = [];
  await sendPendingServices(after, async id => { retry.push(id); return { status: "sent" }; });
  assert.deepEqual(retry, ["C"]);
  // a thrown error is contained: the other service is still attempted
  const thrown = await sendPendingServices(groupRows(), async id => { if (id === "A") throw new Error("network"); return { status: "sent" }; });
  assert.deepEqual([thrown.A.status, thrown.C.status], ["failed", "sent"]);
});

test("a service already holding a production order for its current quote is not sent again", async () => {
  const order = { canonicalId: "po-A", sourceReferences: { quoteRevisionId: "A-q1" } } as unknown as ProductionOrder;
  const r = rows([["A", A, "09:00 · Hospitality"], ["C", C, "13:00 · Sandwiches"]], { A: order });
  const calls: string[] = [];
  await sendPendingServices(r, async id => { calls.push(id); return { status: "sent" }; });
  assert.deepEqual(calls, ["C"]);
});

test("unresolved or conflicting routing is surfaced, never treated as No CPU, and is not sent", async () => {
  const missing = booking("M", [coffeeNoCpu, { state: "routing_required" }]);
  const conflict = booking("X", [{ state: "routing_conflict" }]);
  const mixed = booking("Y", [{ state: "cpu_hospitality" }, { state: "routing_required" }]);
  const r = rows([["M", missing, "09:00 · Break"], ["X", conflict, "10:00 · Lunch"], ["Y", mixed, "11:00 · Lunch"], ["C", C, "13:00 · Sandwiches"]]);
  assert.deepEqual(r.map(row => row.requirement), ["unresolved", "unresolved", "unresolved", "cpu"]);
  const view = text(panel(r));
  assert.match(view, /Routing needs review/); assert.match(view, /never treated as No CPU/);
  const calls: string[] = [];
  await sendPendingServices(r, async id => { calls.push(id); return { status: "sent" }; });
  assert.deepEqual(calls, ["C"]);
  assert.equal(serviceCpuRequirement({ routing: undefined, deliveryChargeRequired: true }), "cpu");
  assert.equal(serviceCpuRequirement({ routing: { status: "x", enforced: true, lines: [] } }), "unresolved");
});

test("delivered_in is a CPU workstream exactly like sandwiches and hospitality; only an explicit In house excludes an item", () => {
  const delivered = booking("DI", [coffeeNoCpu, { state: "cpu_delivered_in" }]);
  assert.equal(serviceCpuRequirement({ routing: delivered.cpuRouting }), "cpu");
  const [row] = rows([["DI", delivered, "09:00 · Delivered-In"]]);
  assert.equal(row.state, "pending");
  assert.equal(serviceCpuRequirement({ routing: booking("N", [coffeeNoCpu]).cpuRouting }), "no_cpu");
});

test("a group where every service is No CPU has a locked panel and sends nothing", async () => {
  const r = rows([["B", B, "11:00 · Break"], ["D", D, "15:00 · Break"]]);
  const tree = panel(r);
  const [send] = buttons(tree);
  assert.equal(send.props.disabled, true);
  assert.match(text(tree), /0 of 2 services require CPU production/);
  const calls: string[] = [];
  await sendPendingServices(r, async id => { calls.push(id); return { status: "sent" }; });
  assert.deepEqual(calls, []);
});

test("single-service booking uses the same panel and rules", async () => {
  const cpu = rows([["A", A, "09:00 · Hospitality"]]);
  const tree = panel(cpu);
  assert.equal(buttons(tree).filter(b => text(b) === "Send to CPU" && !b.props.disabled).length, 1);
  assert.match(text(tree), /1 of 1 service requires CPU production/);
  const none = rows([["B", B, "11:00 · Break"]]);
  const locked = panel(none);
  assert.equal(buttons(locked)[0].props.disabled, true);
  assert.match(text(locked), /produce this booking internally/);
  assert.equal(servicesToSendCount(none), 0);
});
const servicesToSendCount = (r: ServiceProductionRow[]) => r.filter(row => row.state === "pending").length;

test("the quote must be saved before a CPU service is sendable", () => {
  const unquoted = booking("U", [{ state: "cpu_hospitality" }], { lifecycleStatus: "New", quoteState: undefined } as Partial<CanonicalBooking>);
  const [row] = rows([["U", unquoted, "09:00 · Hospitality"]]);
  assert.equal(row.state, "awaiting_quote");
});

test("dashboard has no per-service Send to CPU and keeps the existing production command", () => {
  const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
  assert.equal((dashboard.match(/manager-cpu-action/g) || []).length, 0);
  assert.match(dashboard, /action: "production-handoff"/);
  assert.match(dashboard, /sendPendingServices\(productionRows/);
  assert.match(dashboard, /booking\.bookingGroup\s*\?\s*<p className="muted">CPU production, allergens and menus are managed once/);
  const detail = readFileSync(new URL("../app/ui/HospitalityGroupDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /\{!editing && production\}/);
});
