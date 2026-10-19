import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { register } from "node:module";
import { cancellationView, groupCancellationView, propagationOutcome } from "../lib/cancellation-status";

register("data:text/javascript," + encodeURIComponent("export async function load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true }; return next(url, context); }"));
const { CancellationStatusPanel } = await import("../app/ui/CancellationStatusPanel");

const cancelled = (c?: Record<string, string>) => ({ lifecycleStatus: "Cancelled", cancellation: c ? { reason: "Client request", ...c } : undefined });

test("only Hub-recorded completion is success; pending, review and legacy states are never green", () => {
  assert.equal(cancellationView({ lifecycleStatus: "Quoted" }).stage, "not_cancelled");
  const delivered = cancellationView(cancelled({ productionOutcome: "cancelled", downstreamPropagation: "delivered" }));
  assert.deepEqual([delivered.tone, delivered.complete, delivered.retryable], ["success", true, false]);
  const none = cancellationView(cancelled({ productionOutcome: "no_active_production_order" }));
  assert.deepEqual([none.tone, none.complete], ["success", true]);
  for (const c of [{ productionOutcome: "cancel_requested", downstreamPropagation: "pending" }, { productionOutcome: "cancel_requested" }, undefined]) {
    const v = cancellationView(cancelled(c as Record<string, string> | undefined));
    assert.deepEqual([v.stage, v.tone, v.complete, v.retryable], ["withdrawal_pending", "warning", false, true]);
  }
  const review = cancellationView(cancelled({ productionOutcome: "review_required", downstreamPropagation: "review_required" }));
  assert.deepEqual([review.stage, review.tone, review.complete, review.retryable], ["review_required", "danger", false, true]);
});

test("group is green only when every service is complete; partial cancellation is an alarm with no retry", () => {
  const done = cancelled({ productionOutcome: "cancelled", downstreamPropagation: "delivered" });
  assert.equal(groupCancellationView([done, done]).tone, "success");
  const mixed = groupCancellationView([done, cancelled({ downstreamPropagation: "pending" })]);
  assert.deepEqual([mixed.stage, mixed.complete, mixed.retryable], ["withdrawal_pending", false, true]);
  assert.equal(groupCancellationView([done, cancelled({ downstreamPropagation: "review_required" })]).stage, "review_required");
  const partial = groupCancellationView([done, { lifecycleStatus: "Quoted" }]);
  assert.deepEqual([partial.tone, partial.retryable], ["danger", false]);
  assert.equal(groupCancellationView([{ lifecycleStatus: "Quoted" }]).stage, "not_cancelled");
});

test("unrecognised retry payloads are treated as pending, with de-duplicated reasons", () => {
  assert.equal(propagationOutcome(undefined), undefined);
  assert.equal(propagationOutcome({ status: "weird" })?.stage, "pending");
  assert.equal(propagationOutcome({ status: "delivered" })?.stage, "complete");
  assert.deepEqual(propagationOutcome({ status: "pending", results: [{ reason: "A" }, { reason: "A" }, {}, { reason: "B" }] })?.reasons, ["A", "B"]);
});

test("panel renders text-labelled states, a retry only when allowed, and a disabled busy retry", () => {
  const render = (props: Partial<Parameters<typeof CancellationStatusPanel>[0]>) => renderToStaticMarkup(createElement(CancellationStatusPanel, { view: cancellationView(cancelled({ downstreamPropagation: "pending" })), busy: false, onRetry() {}, ...props }));
  const pending = render({ emailQueued: true });
  assert.match(pending, /withdrawal pending/); assert.match(pending, /Retry CPU and Logistics withdrawal/); assert.match(pending, /Customer email queued/); assert.match(pending, /not confirmed here/);
  assert.doesNotMatch(pending, /withdrawal complete/);
  assert.match(render({ busy: true }), /disabled=""[^>]*aria-busy="true"|aria-busy="true"[^>]*disabled=""/);
  const ok = render({ view: cancellationView(cancelled({ downstreamPropagation: "delivered" })) });
  assert.match(ok, /withdrawal complete/); assert.doesNotMatch(ok, /<button/);
  assert.match(render({ view: cancellationView(cancelled({ downstreamPropagation: "review_required" })) }), /Manual review required/);
  assert.match(render({ retry: { stage: "pending", reasons: ["Still waiting"] } }), /Last retry[\s\S]*Still waiting/);
  assert.match(render({ error: "Network" }), /role="alert"/);
  assert.equal(render({ view: cancellationView({ lifecycleStatus: "New" }) }), "");
});

test("dashboard and group wiring: shared panel, single-flight retry, group proxy with source hash, no raw colours", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const dashboard = read("../app/ui/HospitalityDashboard.tsx");
  assert.match(dashboard, /retryCancellation/); assert.match(dashboard, /cancelRetry\?\.busy/); assert.match(dashboard, /propagationOutcome\(body\.projectionPropagation\)/);
  const group = read("../app/ui/HospitalityGroupDetail.tsx");
  assert.match(group, /\/api\/booking-groups\/cancel/); assert.match(group, /expectedSourceHash: group\.sourceHash/); assert.match(group, /cancelLock\.current/);
  assert.doesNotMatch(group, /window\.(alert|confirm|prompt)|not yet available/);
  for (const css of ["../app/ui/CancellationStatusPanel.module.css"]) { const text = read(css); assert.match(text, /:focus-visible/); assert.match(text, /min-height: 44px/); assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b/i); }
});

test("wave integration renders grouped charges and cancellation together without losing pending recovery", async () => {
  const { HospitalityGroupDetail } = await import("../app/ui/HospitalityGroupDetail");
  const totals = { itemsNet: 40, chargesNet: 31, net: 71, vat: 14.2, gross: 85.2 };
  const services = [0, 1].map(index => ({ bookingId: `booking:wave:${index}`, sourceReference: `WAVE-${index}`, commercialVersion: 1, lifecycleStatus: "Quoted", serviceType: "meeting_hospitality", time: index ? "13:00" : "09:00", location: "Meeting room", guests: 10, lines: [], charges: index ? [] : [{ label: "AV hire", net: 31 }], totals: index ? { itemsNet: 20, chargesNet: 0, net: 20, vat: 4, gross: 24 } : { itemsNet: 20, chargesNet: 31, net: 51, vat: 10.2, gross: 61.2 } }));
  const group = { kind: "booking-group", id: "group:wave", reference: "WAVE", version: 1, sourceHash: "wave-source", client: { name: "Test", companyName: "Wave fixture", email: "test@example.test" }, eventDate: "2026-11-19", firstTime: "09:00", lastTime: "13:00", status: "Quoted", services, totals, routing: { cpuServices: 0, inHouseServices: 2, warnings: 0 } } as Parameters<typeof HospitalityGroupDetail>[0]["group"];
  const render = (value: typeof group) => renderToStaticMarkup(createElement(HospitalityGroupDetail, { group: value, busy: false, onQuote() {}, production: null, site: "rcoa", oplocId: "oploc:test", async onAmended() {}, onBusyChange() {} }));
  const active = render(group);
  for (const text of ["Services in this booking", "Manage charges", "AV hire", "£85.20", "Cancel booking"]) assert.ok(active.includes(text), text);
  assert.doesNotMatch(active, /Retry CPU and Logistics withdrawal/);
  const pending = render({ ...group, status: "Cancelled", services: group.services.map(service => ({ ...service, lifecycleStatus: "Cancelled", cancellation: { downstreamPropagation: "pending", productionOutcome: "cancel_requested" } })) });
  assert.match(pending, /withdrawal pending/); assert.match(pending, /Retry CPU and Logistics withdrawal/);
  assert.match(pending, /AV hire/); assert.doesNotMatch(pending, />Cancel booking<|withdrawal complete/);
  assert.match(pending, /<button[^>]*disabled=""[^>]*aria-label="Manage charges for/);
  const source = readFileSync(new URL("../app/ui/HospitalityGroupDetail.tsx", import.meta.url), "utf8");
  assert.match(source, /cancelLock\.current \|\| lock\.current \|\| chargeTarget/);
  assert.match(source, /ref=\{cancelDialog\}/); assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /prior\?\.isConnected/);
});
