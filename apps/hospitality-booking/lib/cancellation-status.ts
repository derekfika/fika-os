/**
 * Presentation-only mapping of the Hub's recorded cancellation outcome. The Hub owns the truth
 * (dashboardWorkflow.cancellation); this never infers success the Hub has not recorded.
 */
export type CancellationFacts = {
  lifecycleStatus: string;
  cancellation?: { reason?: string; productionOutcome?: string; downstreamPropagation?: "pending" | "delivered" | "review_required"; notificationOutcome?: string };
};
export type CancellationStage = "not_cancelled" | "withdrawal_pending" | "review_required" | "complete" | "nothing_to_withdraw";
export type CancellationTone = "success" | "warning" | "danger" | "neutral";
export type CancellationView = {
  stage: CancellationStage;
  tone: CancellationTone;
  /** Always states the booking itself is cancelled; downstream state follows. */
  headline: string;
  detail: string;
  /** True only when the Hub has recorded that no CPU/Logistics work remains active. */
  complete: boolean;
  retryable: boolean;
  retryLabel?: string;
};

export function cancellationView(facts: CancellationFacts): CancellationView {
  if (facts.lifecycleStatus !== "Cancelled") return { stage: "not_cancelled", tone: "neutral", headline: "Not cancelled", detail: "", complete: false, retryable: false };
  const c = facts.cancellation;
  if (c?.productionOutcome === "no_active_production_order") return { stage: "nothing_to_withdraw", tone: "success", headline: "Cancelled — nothing to withdraw", detail: "No active Production Order existed, so no CPU or Logistics work needed to be withdrawn.", complete: true, retryable: false };
  if (c?.downstreamPropagation === "delivered") return { stage: "complete", tone: "success", headline: "Cancelled — CPU and Logistics withdrawal complete", detail: "The Hub has recorded that CPU and Logistics accepted the withdrawal.", complete: true, retryable: false };
  if (c?.downstreamPropagation === "review_required" || c?.productionOutcome === "review_required") return { stage: "review_required", tone: "danger", headline: "Cancelled — manual CPU review required", detail: "Production has advanced past the point where the Hub can withdraw it safely. CPU work may still be active until CPU staff review it. Re-checking does not override that review.", complete: false, retryable: true, retryLabel: "Re-check CPU review" };
  return { stage: "withdrawal_pending", tone: "warning", headline: "Cancelled — CPU and Logistics withdrawal pending", detail: c ? "The booking is cancelled, but CPU or Logistics has not yet confirmed withdrawal. Active production or delivery work may still exist. Retry is safe and will not duplicate the cancellation or the customer email." : "This older cancellation has no recorded downstream outcome. Retry to reconcile CPU and Logistics; it will not send another customer email.", complete: false, retryable: true, retryLabel: "Retry CPU and Logistics withdrawal" };
}

export type GroupCancellationView = CancellationView & { cancelled: number; total: number; counts: Record<CancellationStage, number> };

/** Group state is the worst child state; success only if every child is complete. */
export function groupCancellationView(services: CancellationFacts[]): GroupCancellationView {
  const counts: Record<CancellationStage, number> = { not_cancelled: 0, withdrawal_pending: 0, review_required: 0, complete: 0, nothing_to_withdraw: 0 };
  services.map(cancellationView).forEach(v => { counts[v.stage] += 1; });
  const total = services.length, cancelled = total - counts.not_cancelled;
  const base = { cancelled, total, counts };
  if (!cancelled) return { ...base, stage: "not_cancelled", tone: "neutral", headline: "Not cancelled", detail: "", complete: false, retryable: false };
  if (counts.not_cancelled) return { ...base, stage: "withdrawal_pending", tone: "danger", headline: `Partially cancelled — ${cancelled} of ${total} services`, detail: "Some services are still active. Refresh the booking and contact an administrator before relying on its state.", complete: false, retryable: false };
  if (counts.review_required) return { ...base, stage: "review_required", tone: "danger", headline: `All ${total} services cancelled — manual CPU review required`, detail: `${counts.review_required} ${counts.review_required === 1 ? "service has" : "services have"} production that CPU must review before it stops. CPU work may still be active.`, complete: false, retryable: true, retryLabel: "Re-check CPU review" };
  if (counts.withdrawal_pending) return { ...base, stage: "withdrawal_pending", tone: "warning", headline: `All ${total} services cancelled — CPU and Logistics withdrawal pending`, detail: `${counts.withdrawal_pending} ${counts.withdrawal_pending === 1 ? "service is" : "services are"} awaiting CPU or Logistics confirmation. Retry is safe and will not repeat the cancellation or customer emails.`, complete: false, retryable: true, retryLabel: "Retry CPU and Logistics withdrawal" };
  return { ...base, stage: "complete", tone: "success", headline: `All ${total} services cancelled — withdrawal complete`, detail: "The Hub has recorded that no CPU or Logistics work remains active for this booking.", complete: true, retryable: false };
}

export type PropagationOutcome = { stage: "complete" | "pending" | "review_required"; reasons: string[] };
/** Maps a Hub projectionPropagation payload; anything unrecognised is treated as NOT complete. */
export function propagationOutcome(propagation?: { status?: string; results?: unknown[] }): PropagationOutcome | undefined {
  if (!propagation) return undefined;
  const reasons = (propagation.results || []).map(r => (r as { reason?: unknown })?.reason).filter((r): r is string => typeof r === "string" && r.length > 0);
  const stage = propagation.status === "delivered" ? "complete" : propagation.status === "review_required" ? "review_required" : "pending";
  return { stage, reasons: [...new Set(reasons)] };
}
