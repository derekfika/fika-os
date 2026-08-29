"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductionOrder } from "../../lib/production-types";
import { buildDeliveredInDishRows, deliveredInTotals } from "../../lib/production-day";
import { cpuAttentionLabel, cpuLifecycle, cpuLifecycleLabels, cpuRequiredTime } from "../../lib/production-presentation";
import "./delivered-in-production-detail.css";
import "./delivered-in-allergen-matrix.css";

function dateLabel(order: ProductionOrder) { return new Date(`${order.serviceDate || order.requiredBy.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); }

export default function DeliveredInProductionDetail({ order, orders, close, onSaved }: { order: ProductionOrder; orders: ProductionOrder[]; close: () => void; onSaved: () => Promise<void> }) {
  const totals = deliveredInTotals(orders); const rows = useMemo(() => buildDeliveredInDishRows(orders), [orders]); const [cpuReviewed, setCpuReviewed] = useState<boolean>(); const lifecycle = cpuLifecycle(order); const allReviewed = cpuReviewed ?? (rows.length > 0 && rows.every(row => row.reviewed));
  useEffect(() => { let cancelled = false; const loadReview = async () => { const plans = await Promise.all(orders.map(async item => { const response = await fetch(`/api/production-plan?orderId=${encodeURIComponent(item.canonicalId)}`, { cache: "no-store" }); if (!response.ok) return undefined; return (await response.json() as { plan?: { menuItems?: Array<{ sourceLineId?: string; subItems?: Array<{ evidenceStatus?: string }> }> } }).plan; })); const reviewed = orders.every((item, index) => item.lines.every(line => plans[index]?.menuItems?.find(menuItem => menuItem.sourceLineId === line.canonicalId)?.subItems?.[0]?.evidenceStatus === "completed")); if (!cancelled) setCpuReviewed(orders.length > 0 && reviewed); }; void loadReview(); return () => { cancelled = true; }; }, [orders]);
  const attention = orders.find(item => cpuAttentionLabel(item));
  const snapshotMismatches = rows.filter(row => row.snapshotMismatch);
  const allergenHref = `/allergens?date=${encodeURIComponent(order.serviceDate || order.requiredBy.slice(0, 10))}`;
  return <aside className="delivered-in-detail" role="dialog" aria-modal="true" aria-label="Delivered-In production detail">
    <header><div><small>Delivered-In · {order.destinationLabel || order.destinationOplocId || "Destination"}</small><h2>{dateLabel(order)}</h2><p>{totals.portions.toLocaleString()} portions allocated to this OPLOC</p></div><button type="button" onClick={close} aria-label="Close production detail">×</button></header>
    <div className="delivered-in-detail-status"><span>{cpuLifecycleLabels[lifecycle]}</span>{attention && <strong>{cpuAttentionLabel(attention)}</strong>}<small>Required ready: {cpuRequiredTime(order)}</small></div>
    <nav className="delivered-in-tabs" aria-label="Delivered-In detail sections"><a href="#delivered-allocation">Portion allocations</a><a href="#delivered-allergens">Allergens</a><a href="#delivered-notes">Notes</a></nav>
    <section id="delivered-allergens"><div className="delivered-section-heading"><div><h3>Delivered-In allergen checker</h3><p>{rows.filter(row => row.snapshot).length}/{rows.length} dishes have published Menu Planning allergen data · {allReviewed ? "CPU reviewed" : "CPU review pending"}</p></div><a className="delivered-in-ack" href={allergenHref}>Open full allergen checker →</a></div>{snapshotMismatches.length > 0 && <div className="delivered-in-discrepancy" role="alert"><strong>⚠ Published allergen snapshot mismatch</strong><p>{snapshotMismatches.map(row => row.name).join(", ")}. Review the published evidence in the full checker before signing.</p></div>}<p className="delivered-in-muted">Acknowledge approved data, amend declarations, report discrepancies, and sign the completed matrix in the full Delivered-In checker.</p></section>
    <section id="delivered-allocation"><h3>Portion allocations</h3><p className="delivered-in-muted">Portions to prepare for this OPLOC. Combined preparation totals for all OPLOCs are shown in the Totals view.</p><div className="delivered-in-allocation-table-wrap"><table className="delivered-in-allocation-table"><thead><tr><th>Dish</th><th>Portions allocated</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><th>{row.name}</th><td>{row.quantity.toLocaleString()}</td></tr>)}</tbody></table></div></section>
    <section id="delivered-notes"><h3>Notes</h3><p className="delivered-in-muted">{[...new Set(orders.map(item => item.operationalNotes).filter(Boolean))].join(" · ") || "No operational notes recorded."}</p></section>
    <details className="delivered-in-technical"><summary>Details / technical traceability</summary><dl><dt>Source publication day</dt><dd>{order.sourcePublicationDayId || order.sourceEntityId || "Not supplied"}</dd><dt>Source versions</dt><dd>{[...new Set(orders.map(item => item.sourceVersion).filter(value => value !== undefined))].join(", ") || "Not supplied"}</dd><dt>Underlying Production Orders</dt><dd>{orders.map(item => item.canonicalId).join(" · ")}</dd><dt>Destination OPLOCs</dt><dd>{orders.map(item => item.destinationOplocId || "Not supplied").join(" · ")}</dd><dt>Source content hashes</dt><dd>{[...new Set(orders.map(item => item.sourceContentHash).filter(Boolean))].join(" · ") || "Not supplied"}</dd></dl></details>
    <footer><button type="button" onClick={close}>Close</button></footer>
  </aside>;
}
