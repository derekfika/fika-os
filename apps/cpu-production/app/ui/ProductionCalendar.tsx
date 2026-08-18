"use client";

import { useMemo, useState } from "react";
import type { ProductionOrder } from "@hub/lib/production-domain";
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
function workflowStatus(order: ProductionOrder) { return !order.workflowStatus || order.workflowStatus === "draft" ? order.status : order.workflowStatus; }
function dietarySummary(order: ProductionOrder) {
  const values = new Map<string, number>();
  for (const line of order.lines) for (const [key, value] of Object.entries(line.dietaries || {})) {
    const amount = typeof value === "number" ? value : value === true ? 1 : Number(value) || 0;
    if (amount > 0) values.set(key, (values.get(key) || 0) + amount);
  }
  return [...values.entries()].map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}: ${value}`).join(" · ");
}

export default function ProductionCalendar({ orders, open }: { orders: ProductionOrder[]; open: (order: ProductionOrder) => void }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => {
    const date = mondayOf(new Date());
    date.setDate(date.getDate() + weekOffset * 7);
    return date;
  }, [weekOffset]);
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
          <p>{weekOrders.length} booking{weekOrders.length === 1 ? "" : "s"} in this week's production view.</p>
        </div>
        <nav className="calendar-nav" aria-label="Calendar week navigation">
          <button type="button" onClick={() => setWeekOffset(value => value - 1)} aria-label="Previous week">←</button>
          <button type="button" onClick={() => setWeekOffset(0)}>This week</button>
          <button type="button" onClick={() => setWeekOffset(value => value + 1)} aria-label="Next week">→</button>
        </nav>
      </header>
      <div className="calendar-grid">
        {days.map(day => (
          <article className={`calendar-day${day.orders.length ? " has-work" : ""}`} key={day.key}>
            <header><strong>{day.name}</strong><span>{shortDate(day.date)}</span></header>
            {day.orders.length ? <><div className="calendar-day-summary"><strong>{day.orders.length} booking{day.orders.length === 1 ? "" : "s"}</strong><span>{day.orders.reduce((sum, order) => sum + guestCount(order), 0)} guests</span><span>{day.orders.reduce((sum, order) => sum + order.lines.reduce((total, line) => total + (line.productionQuantity || 0), 0), 0) || "—"} planned</span><span>{day.orders.filter(order => !["planned", "menu_available", "complete"].includes(workflowStatus(order))).length} need attention</span></div>{day.orders.map(order => {
              const customerPax = guestCount(order);
              const itemSummary = order.lines.map(line => `${line.customerQuantity} × ${line.itemName}`).join(", ");
              const status = workflowStatus(order);
              const dietaries = dietarySummary(order);
              return (
                <button className={`production-card production-card--${status}`} type="button" key={order.canonicalId} onClick={() => open(order)}>
                  <div className="production-card-top"><strong>{order.requiredBy.slice(11, 16)}</strong><span className={`calendar-status calendar-status--${status}`}>{status.replaceAll("_", " ")}</span></div>
                  <div className="production-card-destination"><small>Going to:</small><h3>{order.destinationLabel || "Destination not assigned"}</h3></div>
                  <p className="production-card-client"><b>Booked by:</b> {order.clientName || "Client not assigned"}</p>
                  <p className="production-card-items">{itemSummary || "No production lines"}</p>
                  {dietaries && <p className="production-card-dietaries"><b>Dietary:</b> {dietaries}</p>}
                  <div className="production-card-meta"><span>{customerPax} pax</span><span>Chef sets quantities</span></div>
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
