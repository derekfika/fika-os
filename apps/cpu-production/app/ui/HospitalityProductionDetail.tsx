"use client";
import { formatCatalogueChoices } from "@fika/server-shared/hospitality-effective-offering";

import type { ProductionOrder } from "../../lib/production-types";
import { eventGuestCountLabel, orderedQuantityLabel } from "../../lib/ordered-quantity";
import "./hospitality-production-detail.css";
import BookingContext from "./BookingContext";
import SignedAllergenPdfAction from "./SignedAllergenPdfAction";

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

export default function HospitalityProductionDetail({
  order,
  close,
  openAllergens,
}: {
  order: ProductionOrder;
  close: () => void;
  openAllergens: () => void;
}) {
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
        <p className="hospitality-production-detail__muted">Customer-ordered quantities for this hospitality booking.</p>
        <div className="hospitality-production-detail__lines">
          {order.lines.map((line) => (
            <div key={line.canonicalId}>
              <strong>{orderedQuantityLabel(line)}</strong>
              <span>{line.itemName}<small>Customer ordered</small>{line.choices?.length ? <small>{formatCatalogueChoices(line.choices).join(" · ")}</small> : null}</span>
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
      <SignedAllergenPdfAction orderId={order.canonicalId} />
      <BookingContext order={order} />
      <footer>
        <button type="button" className="hospitality-production-detail__allergens" onClick={openAllergens}>Open allergen editor</button>
        <button type="button" onClick={close}>Close</button>
      </footer>
    </aside>
  );
}
