"use client";
import { formatCatalogueChoices } from "@fika/server-shared/hospitality-effective-offering";

import { useEffect, useState } from "react";
import type { ProductionOrder } from "../../lib/production-types";
import { eventGuestCountLabel, orderedQuantityLabel, productionPrepLabel } from "../../lib/ordered-quantity";
import "./hospitality-production-detail.css";
import BookingContext from "./BookingContext";

function dateLabel(order: ProductionOrder) {
  const date = order.serviceDate || order.requiredBy.slice(0, 10);
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

type SignedPdf = { state: "loading" | "ready" | "pending" | "failed" | "unsigned" | "unavailable"; url?: string; message: string };

/** One known-ID read of this order's plan when the panel opens; the PDF is this order's own OPLOC checker, found by its stable order ID. */
function useSignedAllergenPdf(orderId: string): SignedPdf {
  const [value, setValue] = useState<SignedPdf>({ state: "loading", message: "Checking for the signed allergen checker…" });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/production-plan?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok || !body?.plan) return setValue({ state: "unavailable", message: "The signed allergen checker status could not be loaded." });
        const url = body.plan.matrixArtifact?.driveUrl as string | undefined;
        if (body.matrixStatus === "ready" && url) return setValue({ state: "ready", url, message: "" });
        if (body.matrixStatus === "failed") return setValue({ state: "failed", message: "Both signatures are recorded, but the PDF could not be saved to Drive. Open the allergen editor to retry." });
        const signed = Array.isArray(body.plan.signatures) && body.plan.signatures.length >= 2;
        setValue(signed
          ? { state: "pending", message: "Both signatures are recorded. The PDF is being prepared in Drive." }
          : { state: "unsigned", message: "Not signed yet. The PDF appears here once both chefs have signed." });
      })
      .catch(() => { if (!cancelled) setValue({ state: "unavailable", message: "The signed allergen checker status could not be loaded." }); });
    return () => { cancelled = true; };
  }, [orderId]);
  return value;
}

export default function HospitalityProductionDetail({
  order,
  close,
  openAllergens,
}: {
  order: ProductionOrder;
  close: () => void;
  openAllergens: () => void;
}) {
  const signedPdf = useSignedAllergenPdf(order.canonicalId);
  return (
    <aside className="hospitality-production-detail" role="dialog" aria-modal="true" aria-label="Hospitality production detail">
      <header>
        <div>
          <small>Hospitality production</small>
          <h2>{order.destinationLabel || order.destinationOplocId || "Destination not assigned"}</h2>
          <p>{dateLabel(order)} · Event guests: {eventGuestCountLabel(order.guestCount)}</p>
        </div>
        <button type="button" onClick={close} aria-label="Close hospitality production detail">×</button>
      </header>
      <div className="hospitality-production-detail__status">
        <strong>{order.status.replaceAll("_", " ")}</strong>
        <span>{order.requiredBy?.slice(0, 16).replace("T", " · ") || "Required time TBC"}</span>
      </div>
      <section>
        <h3>What to produce</h3>
        <p className="hospitality-production-detail__muted">Production quantities for this hospitality booking.</p>
        <div className="hospitality-production-detail__lines">
          {order.lines.map((line) => (
            <div key={line.canonicalId}>
              <strong>{orderedQuantityLabel(line)}</strong>
              <span>{line.itemName}<small>Customer ordered</small>{productionPrepLabel(line) ? <small>Prep: {productionPrepLabel(line)}</small> : null}{line.choices?.length ? <small>{formatCatalogueChoices(line.choices).join(" · ")}</small> : null}</span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3>Booking details</h3>
        <dl className="hospitality-production-detail__facts">
          <div><dt>Client</dt><dd>{order.clientName || "Not supplied"}</dd></div>
          <div><dt>Required ready</dt><dd>{order.requiredBy?.replace("T", " · ") || "Time TBC"}</dd></div>
          <div><dt>Production lines</dt><dd>{order.lines.length}</dd></div>
          <div><dt>Destination</dt><dd>{order.destinationLabel || order.destinationOplocId || "Not assigned"}</dd></div>
        </dl>
      </section>
      <section aria-labelledby="hospitality-signed-checker-title">
        <h3 id="hospitality-signed-checker-title">Signed allergen checker</h3>
        {signedPdf.state === "ready" && signedPdf.url
          ? <p><a href={signedPdf.url} target="_blank" rel="noopener noreferrer">Open signed allergen checker (PDF)</a></p>
          : <p className="hospitality-production-detail__muted">{signedPdf.message}</p>}
      </section>
      <BookingContext order={order} />
      <footer>
        <button type="button" className="hospitality-production-detail__allergens" onClick={openAllergens}>Open allergen editor</button>
        <button type="button" onClick={close}>Close</button>
      </footer>
    </aside>
  );
}
