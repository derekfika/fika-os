"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const primary = [
  { href: "/", label: "Week Planner", icon: "▣" },
  { href: "/portions", label: "Portion Planner", icon: "▤" },
  { href: "/allergens", label: "Allergen Checker", icon: "◇" },
  { href: "/catalogue", label: "Dish Library", icon: "▧" },
  { href: "/history", label: "History & Imports", icon: "◌" },
  { href: "/import-menu-week", label: "Import Menu Week", icon: "↑" },
];

export default function MenuPlanningShell({ children, section, actions }: { children: ReactNode; section?: string; actions?: ReactNode }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  useEffect(() => { setQuery(window.location.search); }, [pathname]);
  const hrefFor = (href: string) => { const current = new URLSearchParams(query); const next = new URLSearchParams(); const week = current.get("week"); const day = current.get("day"); if (week && ["/", "/portions", "/allergens"].includes(href)) next.set("week", week); if (day && ["/portions", "/allergens"].includes(href)) next.set("day", day); return next.toString() ? `${href}?${next}` : href; };
  const active = (href: string) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`) || (href === "/history" && pathname === "/sources");
  return <main className="menu-shell">
    <aside className="menu-sidebar">
      <Link href="/" className="menu-sidebar-brand" aria-label="FIKA OS Menu Planning"><strong>FIKA</strong><span>OS</span></Link>
      <div className="menu-sidebar-kicker">MENU PLANNING</div>
      <nav className="menu-sidebar-nav" aria-label="Menu Planning workspaces">
        {primary.map(item => <Link key={item.href} href={hrefFor(item.href)} className={active(item.href) ? "menu-sidebar-link menu-sidebar-link--active" : "menu-sidebar-link"} aria-current={active(item.href) ? "page" : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>)}
      </nav>
      <div className="menu-sidebar-footer">
        <Link href="/settings" className={active("/settings") ? "menu-sidebar-link menu-sidebar-link--active" : "menu-sidebar-link"} aria-current={active("/settings") ? "page" : undefined}><span aria-hidden="true">⚙</span>Settings</Link>
      </div>
    </aside>
    <div className="menu-shell-content">
      <header className="menu-shell-header"><div><div className="menu-shell-breadcrumb">FIKA OS <span>/</span> Menu Planning <span>/</span> <b>{section || "Planner"}</b></div><h1>{section || "Planner"}</h1></div><div className="menu-shell-actions">{actions}</div></header>
      {children}
    </div>
  </main>;
}
