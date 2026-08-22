"use client";
import { useEffect, useState } from "react";
import type { ProductionOrder } from "@hub/lib/production-domain";
import ProductionCalendar from "../ui/ProductionCalendar";
import LianaOrderDetail from "../ui/LianaOrderDetail";
import "./page.css";

export default function CalendarHome() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]); const [selected, setSelected] = useState<ProductionOrder>(); const [error, setError] = useState(""); const [refreshing, setRefreshing] = useState(false);
  const load = async (showFeedback = false) => { if (showFeedback) setRefreshing(true); try { const response = await fetch("/api/production", { cache: "no-store" }); const body = await response.json(); if (!response.ok) setError(body.error?.message || "Could not load production work."); else { setOrders(body.orders || []); setSelected(current => current ? (body.orders || []).find((order: ProductionOrder) => order.canonicalId === current.canonicalId) : undefined); } } finally { if (showFeedback) setRefreshing(false); } };
  useEffect(() => { void load(); }, []);
  return <main className="cpu-calendar-home"><header className="cpu-header"><div><p>FIKA OS · CPU Production</p><h1>Production week, <em>in hand.</em></h1><p>Every booking, quantity and destination in one scan-first production view.</p></div><button onClick={() => void load(true)} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></header><div className="cpu-main">{error && <p role="alert">{error}</p>}<ProductionCalendar orders={orders} open={setSelected} /><p className="cpu-boundary-note">This view reads governed Production Orders. It does not alter hospitality bookings, Calendar or legacy CPU records.</p></div>{selected && <LianaOrderDetail order={selected} close={() => setSelected(undefined)} onSaved={async (close = true) => { await load(); if (close) setSelected(undefined); }} />}</main>;
}
