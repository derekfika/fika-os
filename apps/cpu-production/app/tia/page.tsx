"use client";
import { useEffect, useState } from "react";
import "./page.css";

type Menu = {
  planId: string;
  orderId: string;
  clientSite: string;
  items: Array<{
    menuItem: string;
    name: string;
    quantity: number | null;
    allergens: string[];
    mayContain: string[];
  }>;
};
export default function TiaMenuView() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [notifications, setNotifications] = useState<
    Array<{ title: string; orderId: string }>
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
      const serviceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    void fetch(`/api/production-plan?serviceDate=${encodeURIComponent(serviceDate)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        setMenus(body.menus || []);
        setNotifications(body.notifications || []);
      })
      .catch(() => setError("Could not load production plans."));
  }, []);
  return (
    <main className="tia-view">
      <header>
        <small>FIKA OS · CPU production</small>
        <h1>MNK site manager menu.</h1>
        <p>
          Turn completed production plans into a clear customer-facing menu
          without retyping the food or allergen evidence.
        </p>
      </header>
      <section className="tia-panel">
        <h2>Notifications</h2>
        {notifications.length ? (
          notifications.map((note) => (
            <div className="tia-notification" key={note.orderId}>
              <strong>{note.title}</strong>
              <span>{note.orderId}</span>
            </div>
          ))
        ) : (
          <p className="tia-empty">No production plans are ready yet.</p>
        )}
      </section>
      <section className="tia-panel">
        <h2>Menu-ready plans</h2>
        {menus.length ? (
          menus.map((menu) => (
            <article className="tia-menu" key={menu.planId}>
              <header>
                <div>
                  <small>{menu.orderId}</small>
                  <h3>{menu.clientSite}</h3>
                </div>
                <button type="button" onClick={() => window.print()}>
                  Save / share menu
                </button>
              </header>
              {menu.items.map((item, index) => (
                <div className="tia-item" key={`${menu.planId}:${index}`}>
                  <small>{item.menuItem}</small>
                  <strong>
                    {item.quantity ?? ""} × {item.name}
                  </strong>
                  <span>
                    {item.allergens.length
                      ? `Allergens: ${item.allergens.join(", ")}`
                      : "Allergen evidence recorded"}
                    {item.mayContain.length
                      ? ` · May contain: ${item.mayContain.join(", ")}`
                      : ""}
                  </span>
                </div>
              ))}
            </article>
          ))
        ) : (
          <p className="tia-empty">
            When the production team marks a plan Planned, it will appear here.
          </p>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
