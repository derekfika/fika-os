"use client";
import { formatCatalogueChoices } from "@fika/server-shared/hospitality-effective-offering";

import type { ProductionOrder } from "../../lib/production-types";
import { orderedQuantityLabel } from "../../lib/ordered-quantity";
import { cpuAttentionLabel, cpuAttentionReasons, cpuLifecycle, cpuLifecycleLabels, cpuSourceLabel, isCpuWithdrawn } from "../../lib/production-presentation";
import "./production-order-detail.css";
import BookingContext from "./BookingContext";
import SignedAllergenPdfAction from "./SignedAllergenPdfAction";

function dateLabel(order: ProductionOrder) {
  const date = order.serviceDate || order.requiredBy.slice(0, 10);
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function ProductionOrderDetail({ order, close, openPlanner }: { order: ProductionOrder; close: () => void; openPlanner: () => void }) {
  return <aside className="production-order-detail" role="dialog" aria-modal="true" aria-label="Production order detail">
    <header><div><small>{cpuSourceLabel(order)}</small><h2>{order.destinationLabel || order.destinationOplocId || "Production order"}</h2><p>{dateLabel(order)} · {order.lines.length.toLocaleString()} ordered line{order.lines.length === 1 ? "" : "s"}</p></div><button type="button" onClick={close} aria-label="Close production order detail">×</button></header>
    <div className="production-order-detail__status"><strong>{cpuAttentionLabel(order) === "Needs review" ? "Needs review" : cpuLifecycleLabels[cpuLifecycle(order)]}</strong><span>{order.requiredBy?.replace("T", " · ") || "Required time TBC"}</span></div>
    {cpuAttentionReasons(order).map(reason => <p className="production-order-detail__muted" key={`${order.canonicalId}:${reason}`} role="status">{reason}</p>)}
    <section><h3>What was ordered</h3><p className="production-order-detail__muted">Customer-ordered quantities for this job.</p><div className="production-order-detail__lines">{order.lines.map(line => <div key={line.canonicalId}><strong>{orderedQuantityLabel(line)}</strong><span>{line.itemName}<small>Customer ordered</small>{line.choices?.length ? <small>{formatCatalogueChoices(line.choices).join(" · ")}</small> : null}</span></div>)}</div></section>
    <section><h3>Production quantities</h3><p className="production-order-detail__muted">Production quantities are shown only when explicitly recorded; customer portions are not substituted.</p><div className="production-order-detail__lines">{order.lines.map(line => { const configured = line.productionQuantity !== undefined && Number.isFinite(line.productionQuantity) && line.productionQuantity >= 0 && Boolean(line.productionUnit?.trim()); return <div key={`production:${line.canonicalId}`}><strong>{configured ? `${line.productionQuantity!.toLocaleString("en-GB")} ${line.productionUnit}` : "Not configured"}</strong><span>{line.itemName}<small>{configured ? "Recorded production quantity" : isCpuWithdrawn(order) ? "Historical order · not active demand" : "Needs review before production"}</small></span></div>; })}</div></section>
    <section><h3>Job details</h3><dl className="production-order-detail__facts"><div><dt>Client</dt><dd>{order.clientName || "Not supplied"}</dd></div><div><dt>Required ready</dt><dd>{order.requiredBy?.replace("T", " · ") || "Time TBC"}</dd></div><div><dt>Production lines</dt><dd>{order.lines.length}</dd></div><div><dt>Destination</dt><dd>{order.destinationLabel || order.destinationOplocId || "Not assigned"}</dd></div></dl></section><SignedAllergenPdfAction orderId={order.canonicalId} /><BookingContext order={order} />
    <footer><button type="button" className="production-order-detail__planner" onClick={openPlanner}>Open production planner</button><button type="button" onClick={close}>Close</button></footer>
  </aside>;
}
