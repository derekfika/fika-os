"use client";

import "./reused-allergen-authority.css";
import type { ReuseView } from "../../lib/allergen-reuse-service";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });
const role = (value: string) => (value === "production_chef" ? "Production chef" : value === "head_chef_site_manager" ? "Head chef / site manager" : value.replaceAll("_", " "));

/**
 * Tells CPU, in plain language, that an allergen review can reuse a previously approved identical sandwich composition, or that
 * this booking has adopted one. It never says this booking was itself signed.
 */
export function ReusedAllergenAuthorityNotice({ reuse, busy, onApply }: { reuse?: ReuseView; busy: boolean; onApply: () => void }) {
  if (reuse?.applied) {
    const { provenance, valid, invalidReason } = reuse.applied;
    return (
      <section className="fika-reuse-notice" aria-label="Reused allergen approval" role="status">
        <strong>{valid ? "Approved by reuse of a previously approved sandwich set" : "A previously approved sandwich set no longer applies"}</strong>
        <p>
          {valid
            ? "This booking’s composition matches a sandwich set that was already reviewed and signed. This booking itself has not been signed; the approved allergen states were applied to it."
            : `${invalidReason || "The approval no longer applies."} A fresh allergen review is required.`}
        </p>
        <details>
          <summary>View the original approval</summary>
          <dl>
            <dt>Original booking</dt><dd>{provenance.origin.sourceBookingId || provenance.origin.orderId}</dd>
            <dt>Signed</dt><dd>{when(provenance.origin.signedAt)}</dd>
            <dt>Signed by</dt><dd>{provenance.origin.signatures.map(signature => `${signature.printedName} (${role(signature.role)})`).join("; ")}</dd>
            <dt>Release</dt><dd>{provenance.origin.releaseId} (version {provenance.origin.releaseVersion})</dd>
            <dt>Reused on</dt><dd>{when(provenance.adoptedAt)} by {provenance.adoptedBy}</dd>
          </dl>
        </details>
      </section>
    );
  }
  if (reuse?.candidate?.available) {
    const { origin } = reuse.candidate;
    return (
      <section className="fika-reuse-notice" aria-label="Previously approved sandwich set available">
        <strong>This composition matches a previously approved sandwich set</strong>
        <p>The same sandwiches were already reviewed and signed for another booking. You can apply those approved allergen states here instead of reviewing them again. You can still review and change them; any change returns this booking to normal review.</p>
        <details>
          <summary>View the original approval</summary>
          <dl>
            <dt>Original booking</dt><dd>{origin.sourceBookingId || origin.orderId}</dd>
            <dt>Signed</dt><dd>{when(origin.signedAt)}</dd>
            <dt>Signed by</dt><dd>{origin.signatures.map(signature => `${signature.printedName} (${role(signature.role)})`).join("; ")}</dd>
          </dl>
        </details>
        <button type="button" className="fika-reuse-apply" onClick={onApply} disabled={busy} aria-busy={busy ? true : undefined}>
          {busy ? <><span className="fika-spinner" aria-hidden="true" />Applying approved states…</> : "Apply previously approved allergen states"}
        </button>
      </section>
    );
  }
  return null;
}
