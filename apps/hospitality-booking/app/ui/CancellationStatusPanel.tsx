"use client";
import type { CancellationView } from "../../lib/cancellation-status";
import styles from "./CancellationStatusPanel.module.css";

export type CancellationRetryOutcome = { stage: "complete" | "pending" | "review_required"; reasons: string[] };

/** Cancellation progress using the amendment workflow's step pattern. Green appears only for outcomes the Hub has recorded as complete. */
export function CancellationStatusPanel({ view, reason, emailQueued, retry, busy, error, onRetry }: {
  view: CancellationView; reason?: string; emailQueued?: boolean; retry?: CancellationRetryOutcome; busy: boolean; error?: string; onRetry(): void;
}) {
  if (view.stage === "not_cancelled") return null;
  const tone = view.tone === "success" ? styles.success : view.tone === "danger" ? styles.danger : view.tone === "warning" ? styles.warning : styles.neutral;
  const downstreamClass = view.complete ? styles.stepDone : view.stage === "review_required" ? styles.stepBad : styles.stepWait;
  const downstreamMark = view.complete ? "✓" : view.stage === "review_required" ? "!" : "…";
  const downstreamState = view.complete ? "Complete" : view.stage === "review_required" ? "Manual review required" : "Pending";
  return <section className={`${styles.panel} ${tone}`} aria-label="Cancellation status" aria-busy={busy || undefined}>
    <h3 className={styles.title}>{view.headline}<span className={styles.chip}>{downstreamState}</span></h3>
    <p className={styles.detail}>{view.detail}</p>
    <ol className={styles.steps} aria-label="Cancellation progress">
      <li className={styles.stepDone}><span aria-hidden="true">✓</span><div><strong>Cancellation recorded</strong><small>The booking is cancelled in FIKA OS.{reason ? ` Reason: ${reason}` : ""}</small></div></li>
      <li className={downstreamClass}><span aria-hidden="true">{downstreamMark}</span><div><strong>CPU and Logistics withdrawal — {downstreamState.toLowerCase()}</strong><small>{view.complete ? "No active production or delivery work remains." : "Production and delivery work may still be active."}</small></div></li>
      {emailQueued && <li><span aria-hidden="true">✉</span><div><strong>Customer email queued</strong><small>Delivery is tracked separately and is not confirmed here.</small></div></li>}
    </ol>
    {retry && !view.complete && <div role="status"><p className={styles.meta}>Last retry: {retry.stage === "review_required" ? "CPU review is still required." : "withdrawal is still pending."}</p>{retry.reasons.length > 0 && <ul className={styles.reasons}>{retry.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}</div>}
    {error && <p role="alert" className={styles.error}>{error} The cancellation itself is not affected; you can retry.</p>}
    {view.retryable && <div className={styles.actions}>
      <button type="button" disabled={busy} aria-busy={busy} onClick={onRetry}>{busy ? "Retrying…" : view.retryLabel}</button>
      <span className={styles.meta}>Replays the authorised cancellation. It does not repeat the cancellation or the customer email.</span>
    </div>}
  </section>;
}
