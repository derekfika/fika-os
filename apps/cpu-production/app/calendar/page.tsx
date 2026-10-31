"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductionOrder } from "../../lib/production-types";
import ProductionCalendar from "../ui/ProductionCalendar";
import { ProductionFilterSummary, ProductionSiteFilter } from "../ui/ProductionSiteFilter";
import { activeFilterChips, buildSiteOptions, eligibleOrders, filterOrdersBySites, resolveViewState, unscopedOrderCount } from "../../lib/production-view-filters";
import HospitalityAllergenDetail from "../ui/HospitalityAllergenDetail";
import "./page.css";

export default function CalendarHome() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]); const [selected, setSelected] = useState<ProductionOrder>(); const [error, setError] = useState(""); const [refreshing, setRefreshing] = useState(false);
  const [sites, setSites] = useState<string[]>([]);
  const [settled, setSettled] = useState(false);
  const siteLabels = useRef(new Map<string, string>());
  const load = async (showFeedback = false) => { if (showFeedback) setRefreshing(true); try { const response = await fetch("/api/production", { cache: "no-store" }); const body = await response.json(); if (!response.ok) setError(body.error?.message || "Could not load production work."); else { setOrders(body.orders || []); setSelected(current => current ? (body.orders || []).find((order: ProductionOrder) => order.canonicalId === current.canonicalId) : undefined); } } finally { if (showFeedback) setRefreshing(false); setSettled(true); } };
  useEffect(() => { void load(); }, []);
  const siteOptions = useMemo(() => buildSiteOptions(orders), [orders]);
  for (const option of siteOptions) siteLabels.current.set(option.id, option.label);
  // The calendar keeps cancellation notices visible, exactly as the dashboard Week view does.
  const calendarEligible = eligibleOrders(orders, { keepCancellationNotices: true });
  // Pass every loaded order to the calendar exactly as before; only the site selection narrows it.
  const visibleOrders = filterOrdersBySites(orders, sites);
  const distinct = (list: { canonicalId: string }[]) => new Set(list.map((order) => order.canonicalId)).size;
  const viewState = resolveViewState({ loading: !settled, error, eligibleCount: distinct(calendarEligible), shownCount: distinct(filterOrdersBySites(calendarEligible, sites)) });
  const chips = activeFilterChips({ sites, siteLabels: siteLabels.current });
  return <main className="cpu-calendar-home"><header className="cpu-header"><div><p>FIKA OS · CPU Production</p><h1>Production week, <em>in hand.</em></h1><p>Every booking, quantity and destination in one scan-first production view.</p></div><button onClick={() => void load(true)} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></header><div className="cpu-main">{error && <p role="alert">{error}</p>}<ProductionSiteFilter options={siteOptions} selected={sites} onChange={setSites} /><ProductionFilterSummary chips={chips} onRemove={(chip) => setSites((current) => current.filter((id) => `site:${id}` !== chip.key))} onReset={() => setSites([])} state={viewState} shownCount={distinct(filterOrdersBySites(calendarEligible, sites))} eligibleCount={distinct(calendarEligible)} allSitesCount={distinct(calendarEligible)} unscopedCount={unscopedOrderCount(calendarEligible)} siteFiltered={sites.length > 0} /><ProductionCalendar orders={visibleOrders} scopeNote={sites.length ? "Selected sites only" : undefined} open={setSelected} /><p className="cpu-boundary-note">This view reads governed Production Orders. It does not alter hospitality bookings, Calendar or legacy CPU records.</p></div>{selected && <HospitalityAllergenDetail order={selected} close={() => setSelected(undefined)} onSaved={async (close = true) => { await load(); if (close) setSelected(undefined); }} />}</main>;
}
