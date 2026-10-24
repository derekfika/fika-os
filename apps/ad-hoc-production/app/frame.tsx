"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { addDays, londonBusinessDate, weekStart } from "../lib/ad-hoc-domain";
import { Icon, type IconName } from "./icons";

type DateWindow = { from: string; days: number; shift: (direction: -1 | 1) => void; reset: () => void; setDays: (days: number) => void };
const WindowContext = createContext<DateWindow | null>(null);
export const useDateWindow = () => { const value = useContext(WindowContext); if (!value) throw new Error("Date window context is missing."); return value; };

const NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Overview", icon: "home" },
  { href: "/requests", label: "Requests", icon: "doc" },
  { href: "/sent", label: "Sent to CPU", icon: "truck" },
];
const formatDay = (date: string, withYear = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

export function AppFrame({ environment, children }: { environment: string; children: ReactNode }) {
  const pathname = usePathname();
  const [from, setFrom] = useState(() => weekStart(londonBusinessDate()));
  const [days, setDays] = useState(7);
  const [user, setUser] = useState("");
  useEffect(() => { void fetch("/api/me", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(body => setUser(body?.name || "")).catch(() => setUser("")); }, []);
  const dateWindow = useMemo<DateWindow>(() => ({ from, days, setDays, shift: direction => setFrom(current => addDays(current, direction * days)), reset: () => setFrom(weekStart(londonBusinessDate())) }), [from, days]);
  const onOrder = pathname.startsWith("/orders");
  const initials = (user || "Signed in").split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  return <WindowContext.Provider value={dateWindow}>
    <div className="frame">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="FIKA OS home"><img src="/fika-logo-white.png" alt="FIKA" /><span>OS</span></Link>
        <div className="product"><small>Operations workspace</small><strong>Ad-Hoc Production</strong></div>
        <span className="spacer" />
        {!onOrder && <div className="range" role="group" aria-label="Service date window">
          <button type="button" className="range-nav" onClick={() => dateWindow.shift(-1)} aria-label="Previous window"><Icon name="arrowLeft" size={16} /></button>
          <span className="range-label"><Icon name="calendar" size={18} />{formatDay(from)} – {formatDay(addDays(from, days - 1), true)}</span>
          <button type="button" className="range-nav" onClick={() => dateWindow.shift(1)} aria-label="Next window"><Icon name="chevronRight" size={16} /></button>
          <button type="button" className="range-today" onClick={dateWindow.reset}>This week</button>
          <label className="visually-hidden" htmlFor="range-days">Window length</label>
          <select id="range-days" className="range-select" value={days} onChange={event => dateWindow.setDays(Number(event.target.value))}><option value={7}>1 week</option><option value={14}>2 weeks</option><option value={28}>4 weeks</option></select>
        </div>}
        <span className="env"><i aria-hidden="true" />{environment}</span>
        <div className="user"><span className="avatar" aria-hidden="true">{initials}</span><div><strong>{user || "Signed in"}</strong><small>Signed in</small></div></div>
      </header>
      <aside className="sidebar"><nav aria-label="Ad-Hoc Production">
        {NAV.map(item => <Link key={item.href} href={item.href} className={isActive(item.href) ? "nav active" : "nav"} aria-current={isActive(item.href) ? "page" : undefined}><Icon name={item.icon} />{item.label}</Link>)}
      </nav></aside>
      <main className="content">{children}</main>
    </div>
  </WindowContext.Provider>;
}
