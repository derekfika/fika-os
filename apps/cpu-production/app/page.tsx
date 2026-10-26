"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  ProductionOrder,
  ProductionStatus,
} from "../lib/production-types";
import type { AllergenCellState } from "./lib/production-plan";
import { matrixColumns } from "./ui/allergen-matrix";
import HospitalityAllergenDetail from "./ui/HospitalityAllergenDetail";
import ProductionCalendar from "./ui/ProductionCalendar";
import ProductionDayView from "./ui/ProductionDayView";
import DeliveredInProductionDetail from "./ui/DeliveredInProductionDetail";
import DeliveredMenuPlanner from "./ui/DeliveredMenuPlanner";
import PublishedMenuView from "./ui/PublishedMenuView";
import GrabAndGoProductionView from "./ui/GrabAndGoProductionView";
import GrabAndGoOrderDetail from "./ui/GrabAndGoOrderDetail";
import "./totals.css";
import "./kitchen.css";
import KitchenRunSheet from "./ui/KitchenRunSheet";
import { printKitchenDocument, totalsPrintHtml } from "./ui/kitchen-print";
import HospitalityProductionDetail from "./ui/HospitalityProductionDetail";
import ProductionOrderDetail from "./ui/ProductionOrderDetail";
import { CANONICAL_ALLERGEN_COLUMNS, normaliseOperationalAllergens, toggleOperationalAllergen, type CanonicalAllergenKey } from "../../shared/allergen-contract";
import { productionScopes, type ProductionScope } from "../lib/production-scope";
import { cpuAttentionKey, cpuAttentionLabel, cpuDestinationLabel, cpuDestinationOptionLabel, cpuLifecycle, cpuLifecycleLabels, cpuRequiredTime, cpuServiceWindow, cpuSourceLabel, isCpuWithdrawn, type CpuLifecycle } from "../lib/production-presentation";
import { aggregateProductionTotals, orderDate } from "../lib/production-day";
import { cpuProjectionHasAmbiguousWorkstreamMapping, cpuProjectionToOrders, dashboardOperationalDate, filterCpuProjectionForScope, weekCommencingFor } from "../lib/cpu-dashboard-adapter";
import { calendarDateInputPatch, calendarWeekChangePatch } from "../lib/cpu-week-date-sync";
import { addOperationalDays, filterProductionTotalsOrders, filterProductionTotalsOrdersToDates, formatProductionTotalsDateRange, formatProductionTotalsSelection, operationalWeekRange, productionTotalsWeekDates, resolveProductionTotalsRange } from "../lib/production-totals-range";
import { loadProductionTotalsRange } from "../lib/cpu-totals-loader";
import { readApiResponse } from "./lib/api-response";
import { readCpuProjection, writeCpuProjection } from "./lib/cpu-indexeddb";
import { europeLondonDate } from "../lib/operational-date";

const statuses: CpuLifecycle[] = ["received", "accepted", "planning", "planned", "ready", "in_production", "complete"];
const terminalStatuses = new Set<ProductionStatus>([
  "in_production",
  "partially_complete",
  "ready",
  "complete",
  "cancelled",
  "blocked",
  "failed",
  "reconciliation_required",
]);
function visibleStatus(order: ProductionOrder): ProductionStatus {
  // A newly-created local plan is only a draft projection; it must not hide a
  // more meaningful canonical status such as Accepted or Cancelled.
  if (
    !order.workflowStatus ||
    order.workflowStatus === "draft" ||
    terminalStatuses.has(order.status)
  )
    return order.status;
  return order.workflowStatus;
}
type View = "calendar" | "day" | "queue" | "run-sheet" | "totals" | "menu-planning" | "published-menus" | "grab-and-go";
const primaryNavigation: Array<{ icon: string; label: string; target: View }> = [
  { icon: "▦", label: "Week", target: "calendar" },
  { icon: "◷", label: "Day", target: "day" },
  { icon: "☷", label: "Queue", target: "queue" },
  { icon: "▤", label: "Run sheet", target: "run-sheet" },
  { icon: "▥", label: "Totals", target: "totals" },
];

export default function CpuProduction() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("");
  const [site, setSite] = useState("");
  const [date, setDate] = useState("");
  // Static App Hosting HTML and the first client render must share a clock-free state.
  const [todayKey, setTodayKey] = useState("");
  const [dayDate, setDayDate] = useState("");
  const [weekCommencing, setWeekCommencing] = useState("");
  const [totalsCustomRange, setTotalsCustomRange] = useState(false);
  const [totalsSelectedDays, setTotalsSelectedDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  useEffect(() => {
    const now = new Date();
    setTodayKey(europeLondonDate(now));
    const operationalDate = dashboardOperationalDate(now);
    setDayDate(operationalDate);
    setWeekCommencing(weekCommencingFor(operationalDate));
  }, []);
  const [productionScope, setProductionScope] = useState<ProductionScope>("all");
  const [view, setView] = useState<View>("calendar");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tabletNavigation, setTabletNavigation] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1360px), (pointer: coarse)");
    const update = () => setTabletNavigation(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!tabletNavigation) {
      drawerWasOpen.current = false;
      setDrawerOpen(false);
      return;
    }
    if (!drawerOpen) {
      if (drawerWasOpen.current) menuToggleRef.current?.focus();
      drawerWasOpen.current = false;
      return;
    }
    drawerWasOpen.current = true;
    const focusable = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, tabletNavigation]);
  const [selected, setSelected] = useState<ProductionOrder>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequest = useRef(0);
  const [showHospitalityAllergens, setShowHospitalityAllergens] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const loadGeneration = useRef(0);
  const lastQueryKey = useRef("");
  const load = async (showFeedback = false): Promise<ProductionOrder[]> => {
    if (view !== "totals" && (!dayDate || !weekCommencing)) return [];
    const requestId = ++loadGeneration.current;
    const isCurrentRequest = () => requestId === loadGeneration.current;
    if (showFeedback) setRefreshing(true);
    if (view === "totals") {
      const resolution = totalsCustomRange
        ? resolveProductionTotalsRange("custom", todayKey, customFrom, customTo)
        : weekCommencing ? { range: operationalWeekRange(weekCommencing) } : { error: "The selected production week is not ready yet." };
      if (!resolution.range) {
        setOrders([]);
        setTotalsLoading(false);
        setError(resolution.error);
        if (isCurrentRequest()) setRefreshing(false);
        return [];
      }
      setTotalsLoading(true);
      setOrders([]);
      setError("");
      try {
        const result = await loadProductionTotalsRange(
          resolution.range,
          productionScope,
          async (week, scope) => fetch(`/api/production?projection=1&weekCommencing=${encodeURIComponent(week)}&scope=${encodeURIComponent(scope)}`, { cache: "no-store" }),
          isCurrentRequest,
        );
        if (!isCurrentRequest() || result.status === "stale") return [];
        setOrders(result.orders);
        return result.orders;
      } catch (cause) {
        if (isCurrentRequest()) {
          setOrders([]);
          setError(cause instanceof Error ? cause.message : "Current production totals could not be verified. Refresh to try again.");
        }
        return [];
      } finally {
        if (isCurrentRequest()) {
          setTotalsLoading(false);
          setRefreshing(false);
        }
      }
    }
    const isDayProjection = view === "day";
    const projectionDate = isDayProjection ? dayDate : weekCommencing;
    const cacheKey = `${isDayProjection ? "day" : "week"}:${projectionDate}:${productionScope}`;
    if (lastQueryKey.current !== cacheKey) {
      lastQueryKey.current = cacheKey;
      setOrders([]);
    }
    try {
      // Compatibility marker for existing dashboard contract checks: /api/production?scope=${productionScope}
      const scopeResponse = await fetch("/api/production?cacheScope=1", { cache: "no-store" });
      const scopeBody = await readApiResponse<{ cacheScope?: string; error?: { message?: string } }>(scopeResponse);
      if (!isCurrentRequest()) return [];
      if (!scopeResponse.ok || !scopeBody.cacheScope) { setError(scopeBody.error?.message || "CPU cache scope could not be established."); setOrders([]); return []; }
      const cacheScope = scopeBody.cacheScope;
      const cached = await readCpuProjection<any>(cacheKey, cacheScope);
      if (!isCurrentRequest()) return [];
      if (cached?.value) {
        const cachedNeedsRecovery = cpuProjectionHasAmbiguousWorkstreamMapping(cached.value);
        if (cachedNeedsRecovery) {
          setOrders([]);
        } else {
          setOrders(cpuProjectionToOrders(filterCpuProjectionForScope(cached.value, productionScope)));
          setError("");
        }
        try {
          const head = await fetch(`/api/production?projectionHead=1&${isDayProjection ? `serviceDate=${encodeURIComponent(projectionDate)}` : `weekCommencing=${encodeURIComponent(projectionDate)}`}`, { cache: "no-store" });
          const headBody = await head.json() as { lastChangeSequence?: number; packageVersion?: number; contentHash?: string; sourceVersion?: string };
          if (!isCurrentRequest()) return [];
          if (!head.ok) { setOrders([]); setError("Production freshness could not be verified. Refresh to try again."); return []; }
          if (!cachedNeedsRecovery && Number(headBody.lastChangeSequence || 0) === cached.lastChangeSequence && Number(headBody.packageVersion || 0) === Number(cached.packageVersion || 0) && headBody.contentHash === cached.contentHash && headBody.sourceVersion === cached.sourceVersion) return cpuProjectionToOrders(filterCpuProjectionForScope(cached.value, productionScope));
          const response = await fetch(`/api/production?projection=1&${isDayProjection ? `serviceDate=${encodeURIComponent(projectionDate)}` : `weekCommencing=${encodeURIComponent(projectionDate)}`}&scope=${productionScope}`, { cache: "no-store" });
          const refreshedBody = await readApiResponse<{ projection?: any; package?: { packageVersion?: number; contentHash?: string; sourceVersion?: string } }>(response);
          if (!isCurrentRequest()) return [];
          const newer = refreshedBody.projection;
          if (response.ok && newer) {
            await writeCpuProjection({ key: cacheKey, schemaVersion: 1, cacheScope, fetchedAt: new Date().toISOString(), lastChangeSequence: Number(newer.lastChangeSequence || 0), revision: Number(newer.revision || 0), packageVersion: Number(refreshedBody.package?.packageVersion || 0), contentHash: refreshedBody.package?.contentHash, sourceVersion: refreshedBody.package?.sourceVersion, value: newer });
            if (!isCurrentRequest()) return [];
            const refreshed = cpuProjectionToOrders(filterCpuProjectionForScope(newer, productionScope));
            setOrders(refreshed);
            setError("");
            return refreshed;
          }
          setOrders([]);
          setError("Current production data could not be loaded. Refresh to try again.");
          return [];
        } catch {
          if (isCurrentRequest()) { setOrders([]); setError("Production freshness could not be verified. Refresh to try again."); }
          return [];
        }
      }
      const response = await fetch(`/api/production?projection=1&${isDayProjection ? `serviceDate=${encodeURIComponent(projectionDate)}` : `weekCommencing=${encodeURIComponent(projectionDate)}`}&scope=${productionScope}`, { cache: "no-store" });
      const body = await readApiResponse<{ projection?: any; package?: { packageVersion?: number; contentHash?: string; sourceVersion?: string }; error?: { message?: string } }>(response);
      if (!isCurrentRequest()) return [];
      if (!response.ok) { setOrders([]); setError(body.error?.message || "Could not load production."); return []; }
      const projection = body.projection;
      const projectedOrders: ProductionOrder[] = projection ? cpuProjectionToOrders(filterCpuProjectionForScope(projection, productionScope)) : [];
      if (projection) await writeCpuProjection({ key: cacheKey, schemaVersion: 1, cacheScope, fetchedAt: new Date().toISOString(), lastChangeSequence: Number(projection.lastChangeSequence || 0), revision: Number(projection.revision || 0), packageVersion: Number(body.package?.packageVersion || 0), contentHash: body.package?.contentHash, sourceVersion: body.package?.sourceVersion, value: projection });
      if (!isCurrentRequest()) return [];
      setOrders(projectedOrders);
      setError("");
      return projectedOrders;
    } finally {
      if (isCurrentRequest()) setRefreshing(false);
    }
  };
  useEffect(() => {
    void load();
  }, [view, date, dayDate, weekCommencing, productionScope, todayKey, totalsCustomRange, customFrom, customTo]);
  const sites = [
    ...new Set(
      orders.map((order) => order.destinationOplocId).filter(Boolean),
    ),
  ] as string[];
  const baseVisible = orders.filter(
    (order) =>
      (view === "calendar" ? (!isCpuWithdrawn(order) || Boolean(order.cancellationNotice)) : !isCpuWithdrawn(order)) &&
      (!status || cpuLifecycle(order) === status) &&
      (!origin || order.origin === origin) &&
      (!site || order.destinationOplocId === site),
  );
  const visible = baseVisible.filter(
    (order) => !date || orderDate(order) === date,
  );
  const summaryOrders = view === "calendar" ? baseVisible : visible;
  const totalsRangeResolution = useMemo(() => totalsCustomRange
    ? resolveProductionTotalsRange("custom", todayKey, customFrom, customTo)
    : weekCommencing ? { range: operationalWeekRange(weekCommencing) } : { error: "The selected production week is not ready yet." }, [totalsCustomRange, todayKey, customFrom, customTo, weekCommencing]);
  const totalsRange = totalsRangeResolution.range;
  const totalsWeekDates = productionTotalsWeekDates(weekCommencing);
  const selectedTotalsDates = totalsWeekDates.filter((_, index) => totalsSelectedDays.includes(index));
  const totalsSelectedOrders = totalsCustomRange
    ? filterProductionTotalsOrders(orders, totalsRange, site, origin)
    : filterProductionTotalsOrdersToDates(filterProductionTotalsOrders(orders, totalsRange, site, origin), selectedTotalsDates);
  const attentionCount = orders.filter((order) => Boolean(cpuAttentionLabel(order))).length;
  const chooseView = (target: View) => {
    if (target === "totals") {
      setTotalsCustomRange(false);
      setTotalsSelectedDays([0, 1, 2, 3, 4]);
      setCustomFrom("");
      setCustomTo("");
      setStatus("");
      setOrders([]);
      setTotalsLoading(true);
      setError("");
    }
    setView(target);
    setDrawerOpen(false);
  };
  const chooseDayView = () => {
    const selectedWeek = weekCommencing || weekCommencingFor(dayDate);
    const selectedDate = view === "totals"
      ? (selectedTotalsDates[0] || selectedWeek || dayDate)
      : date && weekCommencingFor(date) === selectedWeek
        ? date
        : dayDate && weekCommencingFor(dayDate) === selectedWeek
          ? dayDate
          : selectedWeek;
    setDayDate(selectedDate);
    setDate(selectedDate);
    setWeekCommencing(weekCommencingFor(selectedDate));
    chooseView("day");
  };
  const chooseWeekView = () => {
    if (view === "totals" && weekCommencing) setWeekCommencing(weekCommencing);
    chooseView("calendar");
  };
  const chooseRunSheetView = () => {
    if (view === "totals" && selectedTotalsDates[0]) setDate(selectedTotalsDates[0]);
    chooseView("run-sheet");
  };
  const chooseTotalsView = () => {
    if (!weekCommencing) {
      const selectedDate = date || dayDate;
      if (selectedDate) setWeekCommencing(weekCommencingFor(selectedDate));
    }
    chooseView("totals");
  };
  const chooseTotalsWeek = (nextWeek: string) => {
    setWeekCommencing(nextWeek);
    setDate("");
    setTotalsCustomRange(false);
    setCustomFrom("");
    setCustomTo("");
    setOrders([]);
    setTotalsLoading(true);
    setError("");
  };
  const selectTotalsDays = (days: number[]) => setTotalsSelectedDays([...new Set(days)].filter(day => day >= 0 && day < 7).sort((a, b) => a - b));
  const openAttentionQueue = () => {
    setStatus("");
    setOrigin("");
    setSite("");
    setDate("");
    chooseView("queue");
  };
  const openOrder = async (order: Pick<ProductionOrder, "canonicalId">, preserveOpen = false) => {
    if (!preserveOpen) setShowHospitalityAllergens(false);
    const requestId = ++detailRequest.current;
    const cachedOrder = orders.find((candidate) => candidate.canonicalId === order.canonicalId);
    setSelected(cachedOrder || (order as ProductionOrder));
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/production?canonicalId=${encodeURIComponent(order.canonicalId)}`, { cache: "no-store" });
      const body = await readApiResponse<{ order?: ProductionOrder; error?: { message?: string } }>(response);
      if (!response.ok || !body.order) throw new Error(body.error?.message || "Could not load the canonical Production Order.");
      if (requestId === detailRequest.current) setSelected(body.order as ProductionOrder);
    } catch (cause) {
      if (requestId === detailRequest.current) setDetailError(cause instanceof Error ? cause.message : "Could not load the canonical Production Order.");
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  };
  const acknowledgeCancelledBooking = async (order: ProductionOrder) => {
    setError("");
    const response = await fetch("/api/production", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "acknowledge-cancellation", canonicalId: order.canonicalId, expectedVersion: order.version }) });
    const body = await readApiResponse<{ order?: ProductionOrder; error?: { message?: string } }>(response);
    if (!response.ok) { setError(body.error?.message || "The cancelled booking could not be acknowledged."); return; }
    await load(true);
  };
  return (
    <main className={`cpu-app-shell${sidebarCollapsed ? " cpu-app-shell--sidebar-collapsed" : ""}`}>
      <aside
        className={`cpu-sidebar${drawerOpen ? " cpu-sidebar--open" : ""}`}
        id="cpu-primary-navigation"
        ref={sidebarRef}
        role={tabletNavigation && drawerOpen ? "dialog" : undefined}
        aria-label={tabletNavigation && drawerOpen ? "CPU Production menu" : undefined}
        aria-modal={tabletNavigation && drawerOpen ? true : undefined}
        aria-hidden={tabletNavigation ? !drawerOpen : undefined}
        inert={tabletNavigation && !drawerOpen}
      >
        <div className="cpu-sidebar-heading">
          <div className="cpu-brand">FIKA OS</div>
          <button type="button" className="cpu-sidebar-collapse" aria-label={sidebarCollapsed ? "Expand production navigation" : "Collapse production navigation"} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}><span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span></button>
          <button type="button" className="cpu-drawer-close" aria-label="Close production navigation" onClick={() => setDrawerOpen(false)}>×</button>
        </div>
        <div className="cpu-sidebar-label">CPU PRODUCTION</div>
        <nav aria-label="CPU Production navigation" className="cpu-sidebar-nav">
          {primaryNavigation.map(({ icon, label, target }) => (
            <button type="button" key={label} className={view === target ? "selected" : ""} aria-label={label} title={sidebarCollapsed ? label : undefined} aria-current={view === target ? "page" : undefined} onClick={() => chooseView(target)}>
              <span aria-hidden="true">{icon}</span><span className="cpu-nav-label">{label}</span>
              {target === "queue" && attentionCount > 0 && <span className="cpu-nav-badge" aria-label={`${attentionCount} need attention`}>{attentionCount}</span>}
            </button>
          ))}
        </nav>
        <div className="cpu-sidebar-rule" />
        <nav aria-label="Utility navigation" className="cpu-sidebar-nav cpu-sidebar-nav--utility">
          <span className="cpu-sidebar-nav-note">Settings and help are coming soon.</span>
        </nav>
        <div className="cpu-user-card"><div className="cpu-avatar">OS</div><div><strong>CPU Production</strong><small>Local workspace</small></div></div>
      </aside>
      <button
        type="button"
        className="cpu-sidebar-backdrop"
        hidden={!tabletNavigation || !drawerOpen}
        tabIndex={-1}
        aria-label="Close production navigation"
        onClick={() => setDrawerOpen(false)}
      />
      <div className="cpu-workspace">
        <header className="cpu-header">
          <button
            type="button"
            ref={menuToggleRef}
            className="cpu-tablet-menu-toggle"
            aria-label="Open production navigation"
            aria-expanded={drawerOpen}
            aria-controls="cpu-primary-navigation"
            onClick={() => setDrawerOpen(true)}
          ><span aria-hidden="true">☰</span><span>Menu</span></button>
          <div className="cpu-header-copy">
            <p className="cpu-kicker">FIKA OS · CPU</p>
            <h1>Production, <em>in hand.</em></h1>
            <p>See what needs preparing, when it is required and where intervention is needed.</p>
          </div>
          <div className="cpu-header-tools"><button type="button">▣ &nbsp; {todayKey ? new Date(`${todayKey}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Loading date…"} &nbsp;⌄</button></div>
          <small>Operational application&nbsp; · &nbsp;governed Production domain</small>
        </header>
        <div className="cpu-main">
        <nav className="cpu-production-scope" aria-label="Production type scope">
          <span>Scope</span>
          {productionScopes.map((scope) => (
            <button type="button" key={scope.id} className={productionScope === scope.id ? "selected" : ""} onClick={() => { setProductionScope(scope.id); setStatus(""); if (view === "totals") { setOrders([]); setTotalsLoading(true); setError(""); } }}>
              {scope.label}
            </button>
          ))}
        </nav>
        {view !== "totals" && <section className="cpu-summary" aria-label="Production status overview">
          {statuses.map((item) => (
            <button
              className={`status-${item} ${status === item ? "active" : ""}`}
              key={item}
              onClick={() => setStatus(status === item ? "" : item)}
            >
              <strong>
                {summaryOrders.filter((order) => !isCpuWithdrawn(order) && cpuLifecycle(order) === item).length}
              </strong>
              <span>{cpuLifecycleLabels[item]}</span>
            </button>
          ))}
        </section>}
        {view !== "totals" && attentionCount > 0 && <div className="cpu-tablet-attention" role="status">
          <span><strong>{attentionCount}</strong> production record{attentionCount === 1 ? "" : "s"} need{attentionCount === 1 ? "s" : ""} attention</span>
          <button type="button" onClick={openAttentionQueue}>Review in Queue</button>
        </div>}
        <div className="cpu-dashboard-columns">
        <section className="cpu-production-panel">
        <div className="cpu-toolbar">
          <div>
            <h2>
              {view === "calendar"
                ? "Production week"
                : view === "day"
                  ? "Production day"
                : view === "queue"
                  ? "Production queue"
                  : view === "run-sheet"
                    ? "Run sheet"
                : view === "published-menus"
                        ? "Published delivered-in menus"
                        : view === "grab-and-go"
                          ? "Grab & Go production"
                        : "Aggregated totals"}
            </h2>
            <p>
              {view === "calendar"
                ? "Monday to Friday at a glance: who, where, when and how much."
                : view === "totals"
                  ? "Customer-ordered production quantities across the selected dates."
                : "Required-ready times, locations, quantities and exceptions in one operational view."}
            </p>
          </div>
          <div className="cpu-toolbar-actions">
            {["calendar", "day", "run-sheet", "totals"].includes(view) && <div className="cpu-view-switch" role="group" aria-label="Production view">
              <button type="button" className={view === "calendar" ? "selected" : ""} aria-pressed={view === "calendar"} onClick={chooseWeekView}>Week</button>
              <button type="button" className={view === "day" ? "selected" : ""} aria-pressed={view === "day"} onClick={chooseDayView}>Day</button>
              <button type="button" className={view === "run-sheet" ? "selected" : ""} aria-pressed={view === "run-sheet"} onClick={chooseRunSheetView}>Run sheet</button>
              <button type="button" className={view === "totals" ? "selected" : ""} aria-pressed={view === "totals"} onClick={chooseTotalsView}>Totals</button>
            </div>}
            <button onClick={() => void load(true)} disabled={refreshing} aria-busy={refreshing} aria-label="Refresh production">
              {refreshing ? "Refreshing…" : "↻"}
            </button>
          </div>
        </div>
        {view !== "menu-planning" && view !== "published-menus" && view !== "grab-and-go" && <div className={`cpu-filters${view === "totals" ? " cpu-totals-filters" : ""}`}>
          {view === "totals" ? <>
            <div className="cpu-totals-week-navigation" aria-label="Select production week">
              <button type="button" aria-label="Previous week" onClick={() => { if (weekCommencing) chooseTotalsWeek(addOperationalDays(weekCommencing, -7)); }}>‹ Previous week</button>
              <strong>{weekCommencing ? formatProductionTotalsDateRange(operationalWeekRange(weekCommencing)) : "Loading week…"}</strong>
              <button type="button" aria-label="Next week" onClick={() => { if (weekCommencing) chooseTotalsWeek(addOperationalDays(weekCommencing, 7)); }}>Next week ›</button>
            </div>
            <div className="cpu-totals-shortcuts" role="group" aria-label="Week shortcuts">
              <button type="button" aria-pressed={!totalsCustomRange && weekCommencing === (todayKey ? weekCommencingFor(todayKey) : "")} onClick={() => { if (todayKey) chooseTotalsWeek(weekCommencingFor(todayKey)); }}>This week</button>
              <button type="button" aria-pressed={!totalsCustomRange && weekCommencing === (todayKey ? addOperationalDays(weekCommencingFor(todayKey), 7) : "")} onClick={() => { if (todayKey) chooseTotalsWeek(addOperationalDays(weekCommencingFor(todayKey), 7)); }}>Next week</button>
            </div>
            {!totalsCustomRange && <>
              <div className="cpu-totals-day-picker" role="group" aria-label="Production days">
                {totalsWeekDates.map((day, index) => {
                  const date = new Date(`${day}T12:00:00Z`);
                  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date);
                  const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date);
                  const pressed = totalsSelectedDays.includes(index);
                  return <button type="button" key={day} className={`${index < 5 ? "cpu-totals-weekday" : "cpu-totals-weekend"}${pressed ? " selected" : ""}`} aria-label={`${label}${index >= 5 ? ", weekend" : ""}`} aria-pressed={pressed} onClick={() => selectTotalsDays(pressed ? totalsSelectedDays.filter(value => value !== index) : [...totalsSelectedDays, index])}><span>{weekday}</span><strong>{date.getUTCDate()}</strong></button>;
                })}
              </div>
              <div className="cpu-totals-day-shortcuts" role="group" aria-label="Day selection shortcuts">
                <button type="button" aria-pressed={totalsSelectedDays.length === 5 && totalsSelectedDays.every((day, index) => day === index)} onClick={() => selectTotalsDays([0, 1, 2, 3, 4])}>Weekdays</button>
                <button type="button" aria-pressed={totalsSelectedDays.length === 7} onClick={() => selectTotalsDays([0, 1, 2, 3, 4, 5, 6])}>All days</button>
              </div>
            </>}
            <div className="cpu-totals-custom">
              <button type="button" aria-expanded={totalsCustomRange} onClick={() => {
                if (!totalsCustomRange && weekCommencing) {
                  const range = operationalWeekRange(weekCommencing);
                  setCustomFrom(range.from);
                  setCustomTo(range.to);
                }
                setTotalsCustomRange(value => !value);
                setOrders([]);
                setTotalsLoading(true);
                setError("");
              }}>{totalsCustomRange ? "Use selected week" : "Choose a custom date range"}</button>
              {totalsCustomRange && <div className="cpu-totals-custom-fields">
                <label>From<input aria-label="From date" type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setTotalsLoading(true); setOrders([]); setError(""); }} /></label>
                <label>To<input aria-label="To date" type="date" min={customFrom || undefined} value={customTo} onChange={(event) => { setCustomTo(event.target.value); setTotalsLoading(true); setOrders([]); setError(""); }} /></label>
              </div>}
            </div>
          </> : <label>
            Date
            <input type="date" value={date} onChange={(event) => { const patch = calendarDateInputPatch(event.target.value, view); setDate(patch.date); if (patch.dayDate !== undefined) setDayDate(patch.dayDate); if (patch.weekCommencing !== undefined) setWeekCommencing(patch.weekCommencing); }} />
          </label>}
          <label>
            Site
            <select
              value={site}
              onChange={(event) => setSite(event.target.value)}
            >
              <option value="">All sites</option>
              {sites.map((item) => {
                const order = orders.find(candidate => candidate.destinationOplocId === item);
                return <option value={item} key={item}>{order ? cpuDestinationOptionLabel(order) : item}</option>;
              })}
            </select>
          </label>
          <label>
            Origin
            <select
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            >
              <option value="">All origins</option>
              <option value="hospitality_booking">Hospitality booking</option>
              <option value="grab_and_go">Grab &amp; Go order</option>
              <option value="menu_planning">Published menu</option>
              <option value="cpu_created">CPU-created work</option>
            </select>
          </label>
          <button
            onClick={() => {
              setStatus("");
              setOrigin("");
              setSite("");
              setDate("");
              setTotalsCustomRange(false);
              setTotalsSelectedDays([0, 1, 2, 3, 4]);
              setCustomFrom("");
              setCustomTo("");
            }}
          >
            Reset filters
          </button>
        </div>}
        {error && view !== "totals" && <p role="alert">{error}</p>}
        {view === "published-menus" ? <PublishedMenuView /> : view === "grab-and-go" ? <GrabAndGoProductionView /> : view === "menu-planning" ? <DeliveredMenuPlanner /> : showCreate && (
          <CpuCreate
            onSaved={async () => {
              setShowCreate(false);
              await load();
            }}
          />
        )}
        {view === "calendar" && (
          weekCommencing ? <ProductionCalendar orders={baseVisible} open={openOrder} onCancelBooking={acknowledgeCancelledBooking} weekCommencing={weekCommencing} onWeekChange={(nextWeek) => { const patch = calendarWeekChangePatch(nextWeek); setWeekCommencing(patch.weekCommencing); setDate(patch.date); }} onDayOpen={(selectedDate) => { setDate(selectedDate); setDayDate(selectedDate); setWeekCommencing(weekCommencingFor(selectedDate)); setView("day"); }} reviewAllergens={(selectedDate) => { window.location.href = `/allergens?date=${encodeURIComponent(selectedDate)}`; }} /> : <p role="status">Loading production calendar…</p>
        )}
        {view === "day" && <ProductionDayView orders={visible} date={dayDate} open={openOrder} onChangeDate={(nextDate) => { setDate(nextDate); setDayDate(nextDate); setWeekCommencing(weekCommencingFor(nextDate)); }} reviewAllergens={(selectedDate) => { window.location.href = `/allergens?date=${encodeURIComponent(selectedDate)}`; }} />}
        {view === "queue" && <Queue orders={visible} open={openOrder} />}
        {view === "run-sheet" && <KitchenRunSheet orders={visible} productionDate={date} onProductionDateChange={nextDate => { setDate(nextDate); if (nextDate) { setDayDate(nextDate); setWeekCommencing(weekCommencingFor(nextDate)); } }} />}
        {view === "totals" && <Totals filters={[site === "all" ? "All sites" : (totalsSelectedOrders.find(o=>o.destinationOplocId===site)?.destinationLabel || site), origin === "all" ? "All origins" : origin, productionScope === "all" ? "All production scopes" : productionScope].join(" · ")} orders={totalsSelectedOrders} range={totalsRange} selectedPeriod={totalsCustomRange ? "Custom date range" : formatProductionTotalsSelection(weekCommencing, totalsSelectedDays)} hasSelection={totalsCustomRange || selectedTotalsDates.length > 0} rangeError={totalsRangeResolution.error} loadError={error} loading={totalsLoading} />}
        </section>
        {view !== "totals" && <OperationsRail orders={visible} date={date || todayKey} open={openOrder} onCancelBooking={acknowledgeCancelledBooking} />}
        </div>
      </div>
      </div>
      {detailLoading && selected && <div className="cpu-detail-state cpu-detail-loading" role="status" aria-live="polite">Loading latest order details…</div>}
      {detailError && <div className="cpu-detail-state" role="alert">{detailError}</div>}
      {selected && selected.origin === "grab_and_go" ? (
        <GrabAndGoOrderDetail
          order={selected}
          close={() => setSelected(undefined)}
        />
      ) : selected && selected.origin === "hospitality_booking" && !showHospitalityAllergens ? (
        <HospitalityProductionDetail
          order={selected}
          close={() => setSelected(undefined)}
          openAllergens={() => setShowHospitalityAllergens(true)}
        />
      ) : selected && selected.origin === "menu_planning" ? (
        <DeliveredInProductionDetail
          order={selected}
          orders={[selected]}
          close={() => setSelected(undefined)}
          onSaved={async () => { await load(); await openOrder(selected); }}
        />
      ) : selected && !showHospitalityAllergens ? (
        <ProductionOrderDetail
          order={selected}
          close={() => setSelected(undefined)}
          openPlanner={() => setShowHospitalityAllergens(true)}
        />
      ) : selected && (
        <HospitalityAllergenDetail
          order={selected}
          close={() => selected.origin === "hospitality_booking" ? setShowHospitalityAllergens(false) : setSelected(undefined)}
          onSaved={async (close = true) => { await load(); if (close) setSelected(undefined); }}
        />
      )}
    </main>
  );
}

function OperationsRail({ orders, date, open, onCancelBooking }: { orders: ProductionOrder[]; date: string; open: (order: ProductionOrder) => void; onCancelBooking: (order: ProductionOrder) => void }) {
  const todayOrders = orders
    .filter((order) => orderDate(order) === date)
    .sort((a, b) => a.requiredBy.localeCompare(b.requiredBy));
  const attention = orders.filter((order) => Boolean(cpuAttentionLabel(order)));
  const attentionByStatus = (status: string) => attention.filter((order) => cpuAttentionKey(order) === status).length;
  return <aside className="cpu-operations-rail">
    <section className="cpu-rail-panel">
      <div className="cpu-rail-heading"><div><span className="cpu-eyebrow">LIVE OPERATIONS</span><h2>Today&apos;s production</h2></div><button type="button" aria-label="More options">•••</button></div>
      <div className="cpu-booking-list">{todayOrders.length ? todayOrders.map((order) => { const lifecycle = cpuLifecycle(order); return <button type="button" className={`cpu-booking cpu-booking--${order.cancellationNotice ? "cancelled" : lifecycle}`} key={order.canonicalId} onClick={() => open(order)}><time>{cpuRequiredTime(order)}</time><div><strong>{order.clientName || cpuDestinationLabel(order)}</strong><small>{cpuSourceLabel(order)} · {cpuDestinationLabel(order)}{order.guestCount !== undefined ? `　♙ ${order.guestCount} guests` : ""}</small></div><span className={`cpu-mini-status cpu-mini-status--${order.cancellationNotice ? "cancelled" : lifecycle}`}>{order.cancellationNotice ? "Cancelled" : cpuLifecycleLabels[lifecycle]}</span><b>›</b></button>; }) : <div className="cpu-empty cpu-empty--rail"><h3>No production scheduled today</h3><p>Real CPU work for this date will appear here.</p></div>}</div>
      {todayOrders.length > 0 && <button type="button" className="cpu-rail-link">View all production <span>›</span></button>}
    </section>
    <section className="cpu-rail-panel cpu-attention-panel">
      <div className="cpu-rail-heading"><div><span className="cpu-eyebrow">INTERVENTION QUEUE</span><h2>Needs your attention</h2></div><span className="cpu-attention-count">{attention.length}</span></div>
      {["cancelled_booking", "needs_review", "needs_clarification", "blocked", "amended"].map((status) => <button type="button" className="cpu-attention-row" key={status}><span className={`cpu-attention-dot cpu-dot--${status === "cancelled_booking" ? "cancelled" : status === "needs_review" ? "review" : status === "blocked" ? "blocked" : "clarify"}`}/><span><strong>{status === "cancelled_booking" ? "Cancelled booking" : status === "needs_review" ? "Needs review" : status === "needs_clarification" ? "Needs clarification" : status === "blocked" ? "Blocked" : "Amended"}</strong><small>{attentionByStatus(status)} production record{attentionByStatus(status) === 1 ? "" : "s"}</small></span><b>›</b></button>)}
      {attention.slice(0, 5).map((order) => <div className="cpu-attention-detail" key={`detail-${order.canonicalId}`}><button type="button" className="cpu-attention-row" onClick={() => open(order)}><span className={`cpu-attention-dot cpu-dot--${order.cancellationNotice ? "cancelled" : "review"}`}/><span><strong>{order.clientName || cpuDestinationLabel(order)}</strong><small>{order.cancellationNotice || order.amendmentNotice || cpuAttentionLabel(order) || "Needs review"}</small></span><b>›</b></button>{order.cancellationNotice && <button type="button" className="cpu-attention-dismiss" aria-label={`Acknowledge cancelled booking for ${order.clientName || cpuDestinationLabel(order)}`} onClick={() => onCancelBooking(order)}>×</button>}</div>)}
    </section>
  </aside>;
}

function Queue({
  orders,
  open,
}: {
  orders: ProductionOrder[];
  open: (order: ProductionOrder) => void;
}) {
  return (
    <div className="cpu-queue">
      {!orders.length ? (
        <div className="cpu-empty">
          <h3>No production work is waiting.</h3>
          <p>
            Approved hospitality bookings and CPU-created delivered-in lunches
            will appear here.
          </p>
        </div>
      ) : (
        <table className="cpu-table">
          <thead>
            <tr>
              <th>Required ready</th>
              <th>Reference</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Lines</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Attention</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.canonicalId}>
                <td data-label="Required ready">
                  <strong>{order.requiredBy ? `${order.requiredBy.slice(0, 10)} · ${cpuRequiredTime(order)}` : "Time TBC"}</strong>
                  <small>{cpuRequiredTime(order)}</small>
                </td>
                <td data-label="Reference">
                  <strong>{order.clientName || cpuDestinationLabel(order)}</strong>
                  <small>{cpuSourceLabel(order)} · {cpuDestinationLabel(order)}</small>
                </td>
                <td data-label="Origin">
                  {cpuSourceLabel(order)}
                </td>
                <td data-label="Destination">
                  {cpuDestinationLabel(order)}
                </td>
                <td data-label="Lines">{order.lines.length}</td>
                <td data-label="Priority">{order.priority}</td>
                <td data-label="Status">
                  <span
                    className={`cpu-status cpu-status--${cpuLifecycle(order)}`}
                  >
                    {cpuLifecycleLabels[cpuLifecycle(order)]}
                  </span>
                </td>
                <td data-label="Attention">
                  {order.exceptions.length
                    ? `${order.exceptions.length} exception(s)`
                    : cpuAttentionLabel(order) || "—"}
                </td>
                <td>
                  <button onClick={() => open(order)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Totals({
  filters,
  orders,
  range,
  selectedPeriod,
  hasSelection,
  rangeError,
  loadError,
  loading,
}: {
  filters: string;
  orders: ProductionOrder[];
  range?: { from: string; to: string };
  selectedPeriod: string;
  hasSelection: boolean;
  rangeError?: string;
  loadError: string;
  loading: boolean;
}) {
  const categoryTotals = useMemo(() => aggregateProductionTotals(orders), [orders]);
  return (
    <section className="cpu-totals">
      <header>
        <small>Read-only production planning · customer ordered quantities</small>
        <button type="button" className="kitchen-button kitchen-totals-print" disabled={loading || !!rangeError || !!loadError || !hasSelection || !categoryTotals.length} onClick={()=>printKitchenDocument(totalsPrintHtml(categoryTotals, selectedPeriod + (range ? " · " + formatProductionTotalsDateRange(range) : ""), filters))}>Print Totals</button>
        <h2>{selectedPeriod === "No days selected" ? "Select production days" : selectedPeriod}</h2>
        {range && <p className="cpu-totals-range-label">{formatProductionTotalsDateRange(range)}</p>}
        {range && !loading && !rangeError && !loadError && <p>{orders.length} production order{orders.length === 1 ? "" : "s"} included · units remain grouped separately</p>}
      </header>
      {loading ? <p className="cpu-totals-state" role="status">Loading and verifying production totals…</p> : rangeError || loadError ? <><p className="cpu-totals-state" role="alert">{rangeError || loadError}</p>{!hasSelection && <div className="cpu-empty cpu-totals-empty-selection"><h3>No production days selected</h3><p>Select one or more days above to see production quantities and order counts.</p></div>}</> : !hasSelection ? <div className="cpu-empty cpu-totals-empty-selection"><h3>No production days selected</h3><p>Select one or more days above to see production quantities and order counts.</p></div> : categoryTotals.length ? categoryTotals.map(({ category, items }) => <section className="cpu-total-category" key={category}>
        <h3>{category}</h3>
        <table className="cpu-total-list"><thead><tr><th scope="col">Production item</th><th scope="col">Total quantity</th><th scope="col">Unit</th></tr></thead><tbody>{items.map((total) => <tr key={total.key}><th scope="row">{total.name}</th><td>{total.quantity.toLocaleString("en-GB")}</td><td>{total.unit}</td></tr>)}</tbody></table>
      </section>) : (
        <div className="cpu-empty">
          <h3>No production items in this range.</h3>
          <p>Current CPU production projections contain no ordered quantities for the selected dates and filters.</p>
        </div>
      )}
    </section>
  );
}

function Detail({
  order,
  close,
  onSaved,
}: {
  order: ProductionOrder;
  close: () => void;
  onSaved: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const actions: ProductionStatus[] =
    order.status === "needs_review"
      ? ["accepted", "blocked"]
      : order.status === "accepted"
        ? ["scheduled", "in_production", "blocked"]
        : order.status === "in_production"
          ? ["partially_complete", "complete", "reconciliation_required"]
          : order.status === "blocked"
            ? ["needs_review"]
            : [];
  const transition = async (next: ProductionStatus) => {
    setBusy(true);
    const response = await fetch("/api/production", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "transition",
        canonicalId: order.canonicalId,
        expectedVersion: order.version,
        status: next,
        reason,
      }),
    });
    if (!response.ok) {
      const body = await response.json();
      setReason(body.error?.message || "Command failed.");
    } else await onSaved();
    setBusy(false);
  };
  return (
    <aside className="cpu-detail">
      <header>
        <div>
          <small>
            {order.origin === "cpu_created"
              ? "CPU-created order"
              : "Hospitality hand-off"}
          </small>
          <h2>{order.sourceBookingId}</h2>
        </div>
        <button onClick={close} aria-label="Close order">
          ×
        </button>
      </header>
      <p className="cpu-technical">{order.canonicalId}</p>
      <dl>
        <dt>Required ready</dt>
        <dd>{order.requiredBy}</dd>
        <dt>Production location</dt>
        <dd>{order.productionLocationId || "Not assigned"}</dd>
        <dt>Service window</dt>
        <dd>
          {cpuServiceWindow(order)}
        </dd>
        <dt>Status</dt>
        <dd>{order.status.replaceAll("_", " ")}</dd>
      </dl>
      <h3>Production lines</h3>
      {order.lines.map((line) => (
        <article key={line.canonicalId}>
          <strong>{line.itemName}</strong>
          <p>
            {line.customerQuantity} {line.customerUnit} →{" "}
            {line.productionQuantity ?? "Not configured"}{" "}
            {line.productionUnit || ""}
          </p>
          <small>
            {Object.entries(line.dietaries || {})
              .filter(([, value]) => value && value !== 0)
              .map(([key, value]) => `${key}: ${value}`)
              .join(" · ") || "No dietary flags recorded"}
          </small>
        </article>
      ))}
      {order.exceptions.length > 0 && (
        <div>
          <h3>Exceptions</h3>
          {order.exceptions.map((exception) => (
            <p key={exception.canonicalId}>{exception.description}</p>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="cpu-command">
          <label>
            Command note / reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {actions.map((action) => (
            <button
              disabled={busy || reason.trim().length < 3}
              key={action}
              onClick={() => void transition(action)}
            >
              {action.replaceAll("_", " ")}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

type DeliveredItem = { id: string; title: string; allergens?: Record<string, string>; mayContainNotes?: string };
type OplocOption = { canonicalId: string; label: string };
type CreateLine = { id: string; itemId: string; newItemTitle: string; quantity: number; note: string; allergens: Record<string, AllergenCellState>; mayContainNotes: string };

const OTHER_OPLOC = "__other__";
const titleCaseLabel = (value: string) => value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
const emptyCreatorAllergens = (): Record<string, AllergenCellState> => Object.fromEntries(CANONICAL_ALLERGEN_COLUMNS.map(([key]) => [key, "clear" as AllergenCellState]));
const normaliseCreatorAllergens = (raw?: Record<string, string>) => {
  return { ...emptyCreatorAllergens(), ...normaliseOperationalAllergens(raw) };
};
const toggleCreatorAllergen = (current: Record<string, AllergenCellState>, key: string) => {
  return { ...emptyCreatorAllergens(), ...toggleOperationalAllergen(current, key as CanonicalAllergenKey) };
};

function CpuCreate({ onSaved }: { onSaved: () => Promise<void> }) {
  const [client, setClient] = useState("Delivered-in lunch");
  const [oplocId, setOplocId] = useState("");
  const [otherSite, setOtherSite] = useState("");
  const [oplocs, setOplocs] = useState<OplocOption[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [items, setItems] = useState<DeliveredItem[]>([]);
  const [lines, setLines] = useState<CreateLine[]>([{ id: "line-1", itemId: "", newItemTitle: "", quantity: 1, note: "", allergens: emptyCreatorAllergens(), mayContainNotes: "" }]);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/sandwiches?parentMenuItemKey=delivered-in-lunch", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { productionItems?: DeliveredItem[] }) => setItems(body.productionItems || []))
      .catch(() => setError("The Delivered-in Lunch catalogue could not be loaded."));
    void fetch("/api/oplocs", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { oplocs?: OplocOption[] }) => setOplocs(body.oplocs || []))
      .catch(() => setOplocs([]));
  }, []);
  const selectedOploc = oplocs.find((oploc) => oploc.canonicalId === oplocId);
  const site = selectedOploc?.label || (oplocId === OTHER_OPLOC ? otherSite : "");
  const totalQuantity = lines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0);
  const updateLine = (index: number, patch: Partial<CreateLine>) =>
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  const saveNewItem = async (index: number) => {
    const title = lines[index]?.newItemTitle.trim();
    if (!title) { setError("Enter a title before saving the new menu item."); return; }
    setError("");
    try {
      const response = await fetch("/api/sandwiches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          allergens: lines[index]?.allergens || emptyCreatorAllergens(),
          mayContainNotes: lines[index]?.mayContainNotes || "",
          parentMenuItemKey: "delivered-in-lunch",
          itemType: "sandwich",
          updatedBy: "production-chef",
        }),
      });
      const body = await response.json() as { productionItem?: DeliveredItem; sandwich?: DeliveredItem; error?: { message?: string } };
      const item = body.productionItem || body.sandwich;
      if (!response.ok || !item) throw new Error(body.error?.message || "Could not save the new menu item.");
      setItems((current) => [...current.filter((candidate) => candidate.id !== item.id), item].sort((a, b) => a.title.localeCompare(b.title)));
      updateLine(index, { itemId: item.id, newItemTitle: "", allergens: normaliseCreatorAllergens(item.allergens), mayContainNotes: item.mayContainNotes || "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the new menu item.");
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const selectedLines = lines
      .map((line) => ({ ...line, item: items.find((item) => item.id === line.itemId) }))
      .filter((line) => line.item && line.quantity > 0);
    if (!site.trim() || !date || !time || !selectedLines.length) {
      setError("Choose a destination, date, service time and at least one item with a quantity.");
      return;
    }
    try {
      // Persist the current checker values as library records before creating
      // the order, so a new or amended hospitality item is available next time.
      const saves = await Promise.all(selectedLines.map(async (line) => {
        const response = await fetch("/api/sandwiches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: line.item!.title,
            allergens: line.allergens,
            mayContainNotes: line.mayContainNotes,
            parentMenuItemKey: "delivered-in-lunch",
            updatedBy: "production-chef",
          }),
        });
        const body = await response.json() as { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || `Could not save ${line.item!.title}.`);
        return body;
      }));
      void saves;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the allergen checker items.");
      return;
    }
    const key = `delivered-in:${date}:${(oplocId || otherSite).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${lines.map((line) => `${line.itemId}:${line.quantity}`).join("|")}`;
    const response = await fetch("/api/production", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "cpu-create",
        idempotencyKey: key,
        clientName: client.trim() || "Delivered-in lunch",
        serviceDate: date,
        deliveryDateTime: `${date}T${time}`,
        requiredBy: `${date}T${time}`,
        serviceWindow: { startTime: time },
        deliveryLocation: site,
        ...(oplocId && oplocId !== OTHER_OPLOC ? { destinationOplocId: oplocId } : {}),
        requiresDelivery: true,
        serviceType: "Delivered-in lunch",
        pax: totalQuantity,
        lines: selectedLines.map(({ item, quantity, note, allergens, mayContainNotes }) => ({
          itemName: titleCaseLabel(item!.title),
          customerQuantity: quantity,
          customerUnit: "portion",
          dietary: allergens,
          notes: [mayContainNotes, note].filter(Boolean).join(" "),
        })),
        sourceReference: "cpu-delivered-in-lunch",
        notes: "CPU-created Delivered-in Lunch draft",
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message || "Could not create order.");
      return;
    }
    await onSaved();
  };
  return (
    <section className="cpu-create">
      <h2>Create delivered-in lunch</h2>
      <p>Create a CPU-owned delivery plan from the reusable Delivered-in Lunch catalogue. It starts as Draft and does not appear in chef views until released.</p>
      <form onSubmit={submit}>
        <label>
          Programme or client label
          <input
            required
            value={client}
            onChange={(event) => setClient(event.target.value)}
          />
        </label>
        <label>
          Operational Location
          <select required value={oplocId} onChange={(event) => { setOplocId(event.target.value); if (event.target.value !== OTHER_OPLOC) setOtherSite(""); }}>
            <option value="">Choose a site…</option>
            {oplocs.map((oploc) => <option key={oploc.canonicalId} value={oploc.canonicalId}>{oploc.label}</option>)}
            <option value={OTHER_OPLOC}>Other — one-off delivery</option>
          </select>
        </label>
        {oplocId === OTHER_OPLOC && <label>One-off delivery location<input required value={otherSite} onChange={(event) => setOtherSite(event.target.value)} placeholder="Enter the delivery location" /></label>}
        <label>
          Service date
          <input
            required
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          Service time
          <input
            required
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        <div className="cpu-create-lines">
          <div className="cpu-create-lines__header"><strong>Items and portions</strong><button type="button" onClick={() => setLines((current) => [...current, { id: `line-${Date.now()}-${current.length}`, itemId: "", newItemTitle: "", quantity: 1, note: "", allergens: emptyCreatorAllergens(), mayContainNotes: "" }])}>+ Add item</button></div>
          {lines.map((line, index) => (
            <div className="cpu-create-line" key={line.id}>
              <label>Menu item<select required={!line.newItemTitle} value={line.itemId} onChange={(event) => { const item = items.find((candidate) => candidate.id === event.target.value); updateLine(index, { itemId: event.target.value, newItemTitle: "", allergens: normaliseCreatorAllergens(item?.allergens), mayContainNotes: item?.mayContainNotes || "" }); }}><option value="">Choose a delivered-in item…</option>{items.map((item) => <option key={item.id} value={item.id}>{titleCaseLabel(item.title)}</option>)}</select><span className="cpu-create-new-item__or">or</span><input value={line.newItemTitle} onChange={(event) => updateLine(index, { newItemTitle: event.target.value, itemId: "" })} placeholder="Type a new item title" /><button type="button" className="cpu-create-new-item__save" onClick={() => void saveNewItem(index)}>Save new item</button></label>
              <label>Portions<input required min="1" type="number" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></label>
              <label>Production note <input value={line.note} onChange={(event) => updateLine(index, { note: event.target.value })} placeholder="Optional" /></label>
              <div className="cpu-create-line__matrix-wrap"><table className="cpu-create-allergen-matrix"><colgroup>{matrixColumns.map(([key]) => <col key={key} />)}</colgroup><thead><tr>{matrixColumns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody><tr>{matrixColumns.map(([key, label]) => { const state = line.allergens[key] || "unrecorded"; return <td key={key}><button type="button" aria-label={`${label} for ${titleCaseLabel(items.find((item) => item.id === line.itemId)?.title || "menu item")}: ${state}`} className={`cpu-create-allergen-cell cpu-create-allergen-cell--${state}`} onClick={() => updateLine(index, { allergens: toggleCreatorAllergen(line.allergens, key) })}>{state === "may_contain" ? "MC" : state === "unrecorded" ? "UR" : ""}</button></td>; })}</tr></tbody></table><label>Notes<input value={line.mayContainNotes} onChange={(event) => updateLine(index, { mayContainNotes: event.target.value })} placeholder="Specific gluten, tree nut or other details" /></label></div>
              {lines.length > 1 && <button type="button" className="cpu-create-line__remove" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button>}
            </div>
          ))}
          <p className="cpu-create-total">{totalQuantity} total portions · source allergens will be carried into the production plan for review.</p>
        </div>
        <button type="submit">Create draft production order</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
