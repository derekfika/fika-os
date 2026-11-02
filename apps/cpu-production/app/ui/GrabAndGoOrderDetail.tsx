"use client";

import type { ProductionOrder } from "../../lib/production-types";
import { orderedQuantityLabel } from "../../lib/ordered-quantity";
import "./grab-and-go-order-detail.css";

const dateLabel = (order: ProductionOrder) => new Date(`${order.serviceDate || order.requiredBy.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default function GrabAndGoOrderDetail({ order, close }: { order: ProductionOrder; close: () => void }) {
  return <aside className="grab-order-detail" role="dialog" aria-modal="true" aria-label="Grab and Go order detail">
    <header><div><small>Grab &amp; Go order</small><h2>{order.destinationLabel || order.destinationOplocId || "Destination not assigned"}</h2><p>{dateLabel(order)} · {order.lines.length.toLocaleString()} ordered line{order.lines.length === 1 ? "" : "s"}</p></div><button type="button" onClick={close} aria-label="Close Grab and Go order">×</button></header>
    <div className="grab-order-detail-status"><span>Ready for production</span><small>Submitted quantities · no allergen check required</small></div>
    <section><h3>What was ordered</h3><p className="grab-order-detail-muted">Customer-ordered quantities for the destination below.</p><div className="grab-order-detail-lines">{order.lines.map(line => <div key={line.canonicalId}><strong>{orderedQuantityLabel(line)}</strong><span>{line.itemName}<small>Customer ordered</small></span></div>)}</div></section>
    <section><h3>Delivery</h3><dl className="grab-order-detail-facts"><div><dt>Destination</dt><dd>{order.destinationLabel || order.destinationOplocId || "Not assigned"}</dd></div><div><dt>Required ready</dt><dd>{order.requiredBy?.slice(0, 16).replace("T", " · ") || "Time TBC"}</dd></div><div><dt>Service</dt><dd>Grab &amp; Go</dd></div></dl></section>
    <footer><button type="button" onClick={close}>Close</button></footer>
  </aside>;
}
