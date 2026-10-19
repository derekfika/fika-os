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
