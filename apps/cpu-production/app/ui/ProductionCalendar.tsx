"use client";

import { useMemo, useState } from "react";
import type { ProductionOrder } from "@hub/lib/production-domain";
import { cpuAttentionLabel, cpuDestinationLabel, cpuLifecycle, cpuLifecycleLabels, cpuRequiredTime, cpuSourceLabel } from "../../lib/production-presentation";
import { orderSummary, productionJobCount, sourceHeading } from "../../lib/production-day";
import "./production-calendar.css";
import "./production-card-overrides.css";

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function mondayOf(date: Date) {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Operational dates are local British calendar dates. UTC conversion moves dates
// backwards during BST and makes the queue and calendar disagree.
export function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function shortDate(date: Date) { return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
function longDate(date: Date) { return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }); }
function guestCount(order: ProductionOrder) { return order.guestCount || order.lines.reduce((sum, line) => sum + (line.customerQuantity || 0), 0); }
function dietarySummary(order: ProductionOrder) {
  const values = new Map<string, number>();
  for (const line of order.lines) for (const [key, value] of Object.entries(line.dietaries || {})) {
    const amount = typeof value === "number" ? value : value === true ? 1 : Number(value) || 0;
    if (amount > 0) values.set(key, (values.get(key) || 0) + amount);
  }
  return [...values.entries()].map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}: ${value}`).join(" · ");
}

export default function ProductionCalendar({ orders, open, weekCommencing, onWeekChange, onDayOpen, reviewAllergens }: { orders: ProductionOrder[]; open: (order: ProductionOrder) => void; weekCommencing?: string; onWeekChange?: (weekCommencing: string) => void; onDayOpen?: (date: string) => void; reviewAllergens?: (date: string) => void }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => weekCommencing ? new Date(`${weekCommencing}T00:00:00`) : (() => { const date = mondayOf(new Date()); date.setDate(date.getDate() + weekOffset * 7); return date; })(), [weekCommencing, weekOffset]);
  const shiftWeek = (delta: number) => { const next = new Date(weekStart); next.setDate(next.getDate() + delta * 7); setWeekOffset(value => value + delta); onWeekChange?.(dateKey(next)); };
  const days = dayNames.map((name, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    const key = dateKey(date);
    return { name, date, key, orders: orders
      .filter(order => order.requiredBy.slice(0, 10) === key)
      .sort((a, b) => a.requiredBy.localeCompare(b.requiredBy)) };
  });
  const weekOrders = days.flatMap(day => day.orders);
  return (
    <section className="production-calendar" aria-label="Weekly production calendar">
      <header className="calendar-header">
        <div>
          <small>Weekly production heads-up</small>
          <h2>{longDate(weekStart)} - {longDate(days[4].date)}</h2>
          <p>{productionJobCount(weekOrders)} production job{productionJobCount(weekOrders) === 1 ? "" : "s"} in this week's view.</p>
        </div>
        <nav className="calendar-nav" aria-label="Calendar week navigation">
              <button type="button" onClick={() => shiftWeek(-1)} aria-label="Previous week">←</button>
              <button type="button" onClick={() => { const today = mondayOf(new Date()); setWeekOffset(0); onWeekChange?.(dateKey(today)); }}>This week</button>
              <button type="button" onClick={() => shiftWeek(1)} aria-label="Next week">→</button>
        </nav>
      </header>
      <div className="calendar-grid">
        {days.map(day => (
          <article className={`calendar-day${day.orders.length ? " has-work" : ""}`} key={day.key}>
            <header><strong>{day.name}</strong><span>{shortDate(day.date)}{onDayOpen && <button type="button" className="calendar-day-open" onClick={() => onDayOpen(day.key)}>Day</button>}</span></header>
            {day.orders.length ? <><div className="calendar-day-summary"><strong>{productionJobCount(day.orders)} production job{productionJobCount(day.orders) === 1 ? "" : "s"}</strong><span>{day.orders.filter(order => order.origin === "menu_planning").reduce((sum, order) => sum + order.lines.reduce((total, line) => total + (line.productionQuantity || 0), 0), 0) || "—"} lunch portions</span><span>{day.orders.filter(order => Boolean(cpuAttentionLabel(order))).length} need attention</span>{reviewAllergens && day.orders.some(order => order.origin === "menu_planning") && <button type="button" className="calendar-day-open" onClick={() => reviewAllergens(day.key)}>Delivered-In allergens</button>}</div>{day.orders.map(order => {
              const customerPax = guestCount(order);
              const status = cpuLifecycle(order);
              const dietaries = dietarySummary(order);
              return (
                <button className={`production-card production-card--${status}`} type="button" key={order.canonicalId} onClick={() => open(order)}>
                  <div className="production-card-top"><strong>{cpuRequiredTime(order)}</strong><span className={`calendar-status calendar-status--${status}`}>{cpuLifecycleLabels[status]}</span></div>
                  <div className="production-card-destination"><small>{sourceHeading(order)}</small><h3>{cpuDestinationLabel(order)}</h3></div>
                  <p className="production-card-client"><b>{cpuSourceLabel(order)}:</b> {orderSummary(order)}</p>
                  {dietaries && <p className="production-card-dietaries"><b>Dietary:</b> {dietaries}</p>}
                  <div className="production-card-meta"><span>{customerPax} pax</span><span>{order.lines.length} production line{order.lines.length === 1 ? "" : "s"}</span></div>
                  {order.exceptions.length > 0 && <div className="calendar-exceptions"><small className="calendar-exception">{order.exceptions.length} exception{order.exceptions.length === 1 ? "" : "s"} needs attention</small><small className="calendar-exception-detail">{order.exceptions[0].description}</small></div>}
                </button>
              );
            })}</> : <div className="calendar-empty">No bookings</div>}
          </article>
        ))}
      </div>
    </section>
  );
}
