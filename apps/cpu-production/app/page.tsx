"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  ProductionOrder,
  ProductionStatus,
} from "@hub/lib/production-domain";
import type { AllergenCellState } from "./lib/production-plan";
import { matrixColumns } from "./ui/allergen-matrix";
import LianaOrderDetail from "./ui/LianaOrderDetail";
import ProductionCalendar from "./ui/ProductionCalendar";
import DeliveredMenuPlanner from "./ui/DeliveredMenuPlanner";
import PublishedMenuView from "./ui/PublishedMenuView";
import GrabAndGoProductionView from "./ui/GrabAndGoProductionView";
import { CANONICAL_ALLERGEN_COLUMNS, normaliseOperationalAllergens, toggleOperationalAllergen, type CanonicalAllergenKey } from "../../shared/allergen-contract";
import { productionScopes, type ProductionScope } from "../lib/production-scope";

const statuses: ProductionStatus[] = [
  "needs_review",
  "accepted",
  "planning",
  "planned",
  "ready",
  "in_production",
  "blocked",
  "needs_clarification",
  "complete",
];
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
type View = "calendar" | "queue" | "run-sheet" | "totals" | "menu-planning" | "published-menus" | "grab-and-go";
type ProductionDashboardView = "production" | "hospitality" | "site_manager" | "grab_and_go";
const dashboardViewLabels: Record<string, string> = {
  liana: "Production chef · sandwiches",
  craig: "Hospitality chef",
  site_manager: "Delivered-In production",
  grab_and_go: "Grab & Go production",
};
dashboardViewLabels.production = "Production chef · sandwiches";
dashboardViewLabels.hospitality = "Hospitality chef";
function initialDashboardView(): ProductionDashboardView {
  if (typeof window === "undefined") return "production";
  const value = new URLSearchParams(window.location.search).get("view");
  if (value === "hospitality" || value === "craig") return "hospitality";
  if (value === "site_manager") return "site_manager";
  if (value === "grab_and_go") return "grab_and_go";
  return "production";
}

export default function CpuProduction() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("");
  const [site, setSite] = useState("");
  const [date, setDate] = useState("");
  const [productionScope, setProductionScope] = useState<ProductionScope>("all");
  const [view, setView] = useState<View>("calendar");
  // Keep the server and first client render identical. The URL-backed role
  // view is applied after hydration so the navigation cannot mismatch.
  const [dashboardView, setDashboardView] =
    useState<ProductionDashboardView>("production");
  const [selected, setSelected] = useState<ProductionOrder>();
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const next = initialDashboardView();
    if (next !== "production") {
      setDashboardView(next);
      if (next === "site_manager") setView("published-menus");
      if (next === "grab_and_go") setView("grab-and-go");
    }
  }, []);
  const load = async (): Promise<ProductionOrder[]> => {
    const response = await fetch(`/api/production?view=${dashboardView}&scope=${productionScope}&allProduction=${dashboardView === "production"}`, {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message || "Could not load production.");
      return [];
    }
    const nextOrders: ProductionOrder[] = body.orders || [];
    let planStatuses: Record<string, ProductionStatus> = {};
    try {
      const planResponse = await fetch("/api/production-plan", {
        cache: "no-store",
      });
      const planBody = (await planResponse.json()) as {
        plans?: Array<{ orderId: string; status: ProductionStatus }>;
      };
      planStatuses = Object.fromEntries(
        (planBody.plans || []).map((plan) => [plan.orderId, plan.status]),
      );
    } catch {
      /* Production remains usable if the planning projection is unavailable. */
    }
    const projectedOrders = nextOrders.map((order) => ({
      ...order,
      workflowStatus: planStatuses[order.canonicalId] || order.workflowStatus,
    }));
    setOrders(projectedOrders);
    return projectedOrders;
  };
  useEffect(() => {
    void load();
  }, [dashboardView, productionScope]);
  useEffect(() => {
    // A selected order belongs to the role-specific projection that opened it.
    // Do not carry a stale detail panel across dashboard views.
    setSelected(undefined);
  }, [dashboardView]);
  const sites = [
    ...new Set(
      orders.map((order) => order.productionLocationId).filter(Boolean),
    ),
  ] as string[];
  const baseVisible = orders.filter(
    (order) =>
      (!status || visibleStatus(order) === status) &&
      (!origin || order.origin === origin) &&
      (!site || order.productionLocationId === site),
  );
  const visible = baseVisible.filter(
    (order) => !date || order.requiredBy.startsWith(date),
  );
  const todayKey = new Date().toLocaleDateString("en-CA");
  const totals = useMemo(
    () =>
      visible
        .flatMap((order) => order.lines)
        .reduce<Record<string, number>>((sum, line) => {
          if (line.productionQuantity !== undefined && line.productionUnit) {
            const key = `${line.itemName} · ${line.productionUnit}`;
            sum[key] = (sum[key] || 0) + line.productionQuantity;
          }
          return sum;
        }, {}),
    [visible],
  );
  return (
    <main className="cpu-app-shell">
      <aside className="cpu-sidebar">
        <div className="cpu-brand">FIKA OS</div>
        <div className="cpu-sidebar-label">CPU PRODUCTION</div>
        <nav aria-label="CPU Production navigation" className="cpu-sidebar-nav">
          {[
            ["▦", "Overview", "calendar"], ["☷", "Queue", "queue"],
            ["▤", "Run sheet", "run-sheet"], ["▥", "Totals", "totals"],
            ["□", "Calendar", "calendar"],
          ].map(([icon, label, target]) => (
            <button type="button" key={label} className={view === target ? "selected" : ""} onClick={() => setView(target as View)}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </nav>
        <div className="cpu-sidebar-rule" />
        <nav aria-label="Utility navigation" className="cpu-sidebar-nav cpu-sidebar-nav--utility">
          <button type="button"><span>⚙</span>Settings</button>
          <button type="button"><span>?</span>Help &amp; support</button>
        </nav>
        <div className="cpu-user-card"><div className="cpu-avatar">DB</div><div><strong>Derek Buckley</strong><small>CPU Manager</small></div><span>⌄</span></div>
      </aside>
      <div className="cpu-workspace">
        <header className="cpu-header">
          <div>
            <p className="cpu-kicker">FIKA OS · CPU</p>
            <h1>Production, <em>in hand.</em></h1>
            <p>See what needs preparing, when it is required and where intervention is needed.</p>
          </div>
          <div className="cpu-header-tools"><button type="button">▣ &nbsp; {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} &nbsp;⌄</button></div>
          <small>Operational application&nbsp; · &nbsp;governed Production domain</small>
        </header>
        <div className="cpu-main">
        <nav className="cpu-production-scope" aria-label="Production type scope">
          <span>Scope</span>
          {productionScopes.map((scope) => (
            <button type="button" key={scope.id} className={productionScope === scope.id ? "selected" : ""} onClick={() => { setProductionScope(scope.id); setStatus(""); }}>
              {scope.label}
            </button>
          ))}
        </nav>
        <nav
          className="cpu-dashboard-switcher"
          aria-label="Production dashboard view"
        >
          <span>Production view</span>
          {(
            [
              "production",
              "hospitality",
              "site_manager",
              "grab_and_go",
            ] as ProductionDashboardView[]
          ).map((item) => (
            <button
              type="button"
              className={dashboardView === item ? "selected" : ""}
              key={item}
              onClick={() => {
                setDashboardView(item);
                setView(item === "site_manager" ? "published-menus" : item === "grab_and_go" ? "grab-and-go" : "calendar");
                setShowCreate(false);
                window.history.replaceState({}, "", `/?view=${item}`);
              }}
            >
              {dashboardViewLabels[item]}
            </button>
          ))}
        </nav>
        <section className="cpu-summary" aria-label="Production status overview">
          {statuses.map((item) => (
            <button
              className={`status-${item} ${status === item ? "active" : ""}`}
              key={item}
              onClick={() => setStatus(status === item ? "" : item)}
            >
              <strong>
                {visible.filter((order) => visibleStatus(order) === item).length}
              </strong>
              <span>{item.replaceAll("_", " ")}</span>
            </button>
          ))}
        </section>
        <div className="cpu-dashboard-columns">
        <section className="cpu-production-panel">
        <div className="cpu-toolbar">
          <div>
            <h2>
              {view === "calendar"
                ? "Production week"
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
                : "Required-ready times, locations, quantities and exceptions in one operational view."}
            </p>
          </div>
          <div className="cpu-toolbar-actions">
            <button
              className={view === "calendar" ? "selected" : ""}
              onClick={() => setView("calendar")}
            >
              Week
            </button>
            <button
              className={view === "queue" ? "selected" : ""}
              onClick={() => setView("queue")}
            >
              Queue
            </button>
            <button
              className={view === "run-sheet" ? "selected" : ""}
              onClick={() => setView("run-sheet")}
            >
              Run sheet
            </button>
            <button
              className={view === "totals" ? "selected" : ""}
              onClick={() => setView("totals")}
            >
              Totals
            </button>
            <button onClick={() => void load()} aria-label="Refresh production">
              ↻
            </button>
          </div>
        </div>
        {view !== "menu-planning" && view !== "published-menus" && view !== "grab-and-go" && <div className="cpu-filters">
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Site
            <select
              value={site}
              onChange={(event) => setSite(event.target.value)}
            >
              <option value="">All sites</option>
              {sites.map((item) => (
                <option key={item}>{item}</option>
              ))}
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
              <option value="cpu_created">CPU created</option>
            </select>
          </label>
          <button
            onClick={() => {
              setStatus("");
              setOrigin("");
              setSite("");
              setDate("");
            }}
          >
            Reset filters
          </button>
        </div>}
        {error && <p role="alert">{error}</p>}
        {view === "published-menus" ? <PublishedMenuView /> : view === "grab-and-go" ? <GrabAndGoProductionView /> : view === "menu-planning" ? <DeliveredMenuPlanner /> : showCreate && (
          <CpuCreate
            onSaved={async () => {
              setShowCreate(false);
              await load();
            }}
          />
        )}
        {view === "calendar" && (
          <ProductionCalendar orders={baseVisible} open={setSelected} />
        )}
        {view === "queue" && <Queue orders={visible} open={setSelected} />}
        {view === "run-sheet" && <RunSheet orders={visible} />}
        {view === "totals" && <Totals totals={totals} orders={visible} />}
        </section>
        <OperationsRail orders={visible} date={date || todayKey} />
        </div>
      </div>
      </div>
      {selected && (
        <LianaOrderDetail
          order={selected}
          close={() => setSelected(undefined)}
          onSaved={async (close = true) => {
            const nextOrders = await load();
            if (close) setSelected(undefined);
            else {
              const refreshed = nextOrders.find(
                (order) => order.canonicalId === selected.canonicalId,
              );
              if (refreshed) setSelected(refreshed);
            }
          }}
        />
      )}
    </main>
  );
}

function OperationsRail({ orders, date }: { orders: ProductionOrder[]; date: string }) {
  const todayOrders = orders
    .filter((order) => order.requiredBy.startsWith(date))
    .sort((a, b) => a.requiredBy.localeCompare(b.requiredBy));
  const attention = orders.filter((order) => ["needs_review", "needs_clarification", "blocked"].includes(visibleStatus(order)));
  const attentionByStatus = (status: ProductionStatus) => attention.filter((order) => visibleStatus(order) === status).length;
  return <aside className="cpu-operations-rail">
    <section className="cpu-rail-panel">
      <div className="cpu-rail-heading"><div><span className="cpu-eyebrow">LIVE OPERATIONS</span><h2>Today&apos;s production</h2></div><button type="button" aria-label="More options">•••</button></div>
      <div className="cpu-booking-list">{todayOrders.length ? todayOrders.map((order) => { const status = visibleStatus(order); return <button type="button" className={`cpu-booking cpu-booking--${status}`} key={order.canonicalId}><time>{order.requiredBy.slice(11, 16)}</time><div><strong>{order.clientName || order.destinationLabel || "Production"}</strong><small>{order.destinationLabel ? `Site: ${order.destinationLabel}` : "Site not assigned"}{order.guestCount !== undefined ? `　♙ ${order.guestCount} guests` : ""}</small></div><span className={`cpu-mini-status cpu-mini-status--${status}`}>{status.replaceAll("_", " ")}</span><b>›</b></button>; }) : <div className="cpu-empty cpu-empty--rail"><h3>No production scheduled today</h3><p>Real CPU work for this date will appear here.</p></div>}</div>
      {todayOrders.length > 0 && <button type="button" className="cpu-rail-link">View all production <span>›</span></button>}
    </section>
    <section className="cpu-rail-panel cpu-attention-panel">
      <div className="cpu-rail-heading"><div><span className="cpu-eyebrow">INTERVENTION QUEUE</span><h2>Needs your attention</h2></div><span className="cpu-attention-count">{attention.length}</span></div>
      {(["needs_review", "needs_clarification", "blocked"] as ProductionStatus[]).map((status) => <button type="button" className="cpu-attention-row" key={status}><span className={`cpu-attention-dot cpu-dot--${status === "needs_review" ? "review" : status === "blocked" ? "blocked" : "clarify"}`}/><span><strong>{status.replaceAll("_", " ")}</strong><small>{attentionByStatus(status)} production record{attentionByStatus(status) === 1 ? "" : "s"}</small></span><b>›</b></button>)}
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
              <th>Location</th>
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
                  <strong>{order.requiredBy.replace("T", " ")}</strong>
                  <small>{order.serviceWindow.startTime}</small>
                </td>
                <td data-label="Reference">
                  <strong>{order.sourceBookingId}</strong>
                  <small>{order.canonicalId}</small>
                </td>
                <td data-label="Origin">
                  {order.origin === "cpu_created"
                    ? "CPU created"
                    : "Hospitality"}
                </td>
                <td data-label="Location">
                  {order.productionLocationId || "Not assigned"}
                </td>
                <td data-label="Lines">{order.lines.length}</td>
                <td data-label="Priority">{order.priority}</td>
                <td data-label="Status">
                  <span
                    className={`cpu-status cpu-status--${visibleStatus(order)}`}
                  >
                    {visibleStatus(order).replaceAll("_", " ")}
                  </span>
                </td>
                <td data-label="Attention">
                  {order.exceptions.length
                    ? `${order.exceptions.length} exception(s)`
                    : order.version > 1
                      ? "Amended"
                      : "—"}
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

function RunSheet({ orders }: { orders: ProductionOrder[] }) {
  return (
    <section className="cpu-run-sheet">
      {!orders.length ? (
        <div className="cpu-empty">
          <h3>No production work is waiting.</h3>
          <p>Set a date or clear filters to see the run sheet.</p>
        </div>
      ) : (
        orders
          .sort((a, b) => a.requiredBy.localeCompare(b.requiredBy))
          .map((order) => (
            <article key={order.canonicalId}>
              <header>
                <strong>{order.requiredBy.replace("T", " · ")}</strong>
                <span>
                  {order.sourceBookingId} ·{" "}
                  {order.productionLocationId || "Unassigned"}
                </span>
              </header>
              {order.lines.map((line) => (
                <div className="cpu-run-line" key={line.canonicalId}>
                  <strong>
                    {line.customerQuantity} {line.customerUnit}
                  </strong>
                  <span>{line.itemName}</span>
                  <small>
                    {Object.entries(line.dietaries || {})
                      .filter(([, value]) => value && value !== 0)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" · ") || "No dietary flags"}
                    {line.productionInstructions
                      ? ` · ${line.productionInstructions}`
                      : ""}
                  </small>
                </div>
              ))}
            </article>
          ))
      )}
    </section>
  );
}

function Totals({
  totals,
  orders,
}: {
  totals: Record<string, number>;
  orders: ProductionOrder[];
}) {
  return (
    <section className="cpu-totals">
      <p>
        {orders.length} order{orders.length === 1 ? "" : "s"} in the selected
        view.
      </p>
      {Object.keys(totals).length ? (
        Object.entries(totals).map(([key, value]) => (
          <div key={key}>
            <strong>{value}</strong>
            <span>{key}</span>
          </div>
        ))
      ) : (
        <div className="cpu-empty">
          <h3>No recorded production totals.</h3>
          <p>
            Production quantities are optional and remain at the chef’s
            discretion.
          </p>
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
          {order.serviceWindow.startTime}
          {order.serviceWindow.endTime ? `–${order.serviceWindow.endTime}` : ""}
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
        body: JSON.stringify({ title, parentMenuItemKey: "delivered-in-lunch", updatedBy: "production-chef" }),
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
            <option value="">Choose an OPLOC…</option>
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
              <div className="cpu-create-line__matrix-wrap"><table className="cpu-create-allergen-matrix"><colgroup>{matrixColumns.map(([key]) => <col key={key} />)}</colgroup><thead><tr>{matrixColumns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody><tr>{matrixColumns.map(([key, label]) => { const state = line.allergens[key] || "clear"; return <td key={key}><button type="button" aria-label={`${label} for ${titleCaseLabel(items.find((item) => item.id === line.itemId)?.title || "menu item")}: ${state}`} className={`cpu-create-allergen-cell cpu-create-allergen-cell--${state}`} onClick={() => updateLine(index, { allergens: toggleCreatorAllergen(line.allergens, key) })}>{state === "contains" ? "✓" : state === "may_contain" ? "MC" : ""}</button></td>; })}</tr></tbody></table><label>May contain notes (gluten / tree nuts)<input value={line.mayContainNotes} onChange={(event) => updateLine(index, { mayContainNotes: event.target.value })} placeholder="Optional" /></label></div>
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
