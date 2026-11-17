"use client";

import { useEffect, useState } from "react";
import { HOT_FORK_BUFFET_MENU_VERSION, HotForkBuffetTransportSelectionSchema, hotForkBuffetDish } from "@fika/server-shared/hospitality-buffet-selection";
import type { Site } from "../lib/projection";

type BuffetOrder = {
  canonicalId: string;
  clientName?: string;
  serviceDate: string;
  serviceTime?: string;
  serviceLocation?: { floorLevel?: string; roomOrArea?: string };
  siteLabel: string;
  guestCount?: number;
  status: string;
  dietaries: Record<string, unknown>;
  selection?: unknown;
  selectionState: "available" | "needs_review";
};

const mealLabels: Record<string, string> = { vegetarian: "Vegetarian", vegan: "Vegan", glutenFree: "Gluten-free", coeliac: "Coeliac", dairyFree: "Dairy-free", halal: "Halal", otherCount: "Other dietary meals", allergyDetails: "Allergy details", freeText: "Dietary notes" };
function dietarySummary(values: Record<string, unknown>) {
  return Object.entries(values).flatMap(([key, value]) => {
    if (typeof value === "number" && value > 0) return [`${mealLabels[key] || key.replaceAll("_", " ")}: ${value}`];
    if (value === true && mealLabels[key]) return [mealLabels[key]];
    if (typeof value === "string" && value.trim() && mealLabels[key]) return [`${mealLabels[key]}: ${value.trim()}`];
    return [];
  }).join(" · ");
}

export function HospitalityBuffetOrderCard({ order, siteLabel }: { order: BuffetOrder; siteLabel: string }) {
  const parsed = HotForkBuffetTransportSelectionSchema.safeParse(order.selection);
  const selection = parsed.success ? parsed.data : undefined;
  const name = (id: string) => (selection?.menuVersion === HOT_FORK_BUFFET_MENU_VERSION ? hotForkBuffetDish(id)?.name : undefined) || "Name unavailable for this saved menu version";
  const dessertIds = selection && "dessertIds" in selection ? selection.dessertIds : selection?.desserts.map(dessert => dessert.dishId) || [];
  const dessertIntent = selection && "dessertIds" in selection ? selection.packageId === "gold" ? " · 50/50 intent; chef allocates quantities" : " · chef allocates quantities" : " · saved historical selection";
  const dietaries = dietarySummary(order.dietaries || {});
  const room = [order.serviceLocation?.floorLevel, order.serviceLocation?.roomOrArea].filter(Boolean).join(" · ");
  return <article className="hospitality-buffet-card" data-booking-id={order.canonicalId}>
    <header><div><span className="hospitality-buffet-badge">Hot Fork Buffet</span><h3>{order.clientName || "Client not supplied"}</h3></div><span className="ops-chip ops-chip-neutral">{order.status.replaceAll("_", " ")}</span></header>
    <dl className="hospitality-buffet-facts"><div><dt>Service</dt><dd>{order.serviceDate}{order.serviceTime ? ` · ${order.serviceTime}` : ""}</dd></div><div><dt>Location</dt><dd>{room || siteLabel}{room ? ` · ${siteLabel}` : ""}</dd></div><div><dt>Guests</dt><dd>{order.guestCount?.toLocaleString("en-GB") || "Not recorded"}</dd></div><div><dt>Package</dt><dd>{selection ? `${selection.packageId === "gold" ? "Gold" : "Silver"} · saved menu ${selection.menuVersion}` : "Selection needs review"}</dd></div></dl>
    {selection ? <div className="hospitality-buffet-selection">
      <section><h4>Main dishes and customer portions</h4><ul>{selection.mains.map(main => <li key={main.dishId}><span>{name(main.dishId)}</span><strong>{main.portions} portions</strong></li>)}</ul></section>
      <section><h4>Salads · chef allocates quantities</h4><ul>{selection.saladIds.map(id => <li key={id}>{name(id)}</li>)}</ul></section>
      <section><h4>Desserts{dessertIntent}</h4><ul>{dessertIds.map(id => <li key={id}>{name(id)}</li>)}</ul></section>
    </div> : <p className="hospitality-buffet-error" role="status">Saved buffet selection is unavailable or malformed. Contact CPU before relying on these details.</p>}
    {dietaries && <p className="hospitality-buffet-dietaries"><strong>Dietary requirements:</strong> {dietaries}</p>}
    <p className="ops-muted hospitality-buffet-source-note">Read-only copy of the canonical CPU booking handoff. Buffet allergen states remain unrecorded pending the normal CPU review.</p>
  </article>;
}

export default function HospitalityBuffetOrders({ site, serviceDate }: { site: Site; serviceDate: string }) {
  const [orders, setOrders] = useState<BuffetOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setOrders([]);
    void fetch(`/api/delivered-in/hospitality-buffets?oplocId=${encodeURIComponent(site.oplocId)}&serviceDate=${encodeURIComponent(serviceDate)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => undefined) as { orders?: BuffetOrder[]; error?: { message?: string } } | undefined;
        if (!response.ok || !body?.orders) throw new Error(body?.error?.message || "Hospitality bookings could not be loaded.");
        setOrders(body.orders);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Hospitality bookings could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [site.oplocId, serviceDate]);

  return <section className="ops-panel hospitality-buffet-panel" aria-labelledby="hospitality-buffet-heading">
    <div className="ops-panel-heading"><div><p className="ops-eyebrow">Hospitality handoff</p><h2 id="hospitality-buffet-heading">Hot Fork Buffet bookings</h2></div><span className="ops-chip ops-chip-neutral">{site.label}</span></div>
    {loading ? <p className="ops-muted" role="status">Loading bookings for {serviceDate}…</p> : error ? <p className="hospitality-buffet-error" role="alert">{error}</p> : !orders.length ? <p className="ops-muted">No active Hot Fork Buffet bookings for this site and service date.</p> : <div className="hospitality-buffet-list">{orders.map(order => <HospitalityBuffetOrderCard key={order.canonicalId} order={order} siteLabel={site.label} />)}</div>}
  </section>;
}
