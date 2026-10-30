"use client";
import { formatCatalogueChoices } from "@fika/server-shared/hospitality-effective-offering";

import type { ProductionOrder } from "../../lib/production-types";
import { cpuSourceLabel } from "../../lib/production-presentation";
import "./production-order-detail.css";
import BookingContext from "./BookingContext";

function dateLabel(order: ProductionOrder) {
  const date = order.serviceDate || order.requiredBy.slice(0, 10);
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function ProductionOrderDetail({ order, close, openPlanner }: { order: ProductionOrder; close: () => void; openPlanner: () => void }) {
  const total = order.lines.reduce((sum, line) => sum + line.customerQuantity, 0);
  return <aside className="production-order-detail" role="dialog" aria-modal="true" aria-label="Production order detail">
    <header><div><small>{cpuSourceLabel(order)}</small><h2>{order.destinationLabel || order.destinationOplocId || "Production order"}</h2><p>{dateLabel(order)} · {total.toLocaleString()} items</p></div><button type="button" onClick={close} aria-label="Close production order detail">×</button></header>
    <div className="production-order-detail__status"><strong>{order.status.replaceAll("_", " ")}</strong><span>{order.requiredBy?.replace("T", " · ") || "Required time TBC"}</span></div>
    <section><h3>What was ordered</h3><p className="production-order-detail__muted">Customer-ordered quantities for this job.</p><div className="production-order-detail__lines">{order.lines.map(line => <div key={line.canonicalId}><strong>{line.customerQuantity.toLocaleString()}</strong><span>{line.itemName}<small>{line.customerUnit}</small>{line.choices?.length ? <small>{formatCatalogueChoices(line.choices).join(" · ")}</small> : null}</span></div>)}</div></section>
    <section><h3>Job details</h3><dl className="production-order-detail__facts"><div><dt>Client</dt><dd>{order.clientName || "Not supplied"}</dd></div><div><dt>Required ready</dt><dd>{order.requiredBy?.replace("T", " · ") || "Time TBC"}</dd></div><div><dt>Production lines</dt><dd>{order.lines.length}</dd></div><div><dt>Destination</dt><dd>{order.destinationLabel || order.destinationOplocId || "Not assigned"}</dd></div></dl></section><BookingContext order={order} />
    <footer><button type="button" className="production-order-detail__planner" onClick={openPlanner}>Open production planner</button><button type="button" onClick={close}>Close</button></footer>
  </aside>;
}
