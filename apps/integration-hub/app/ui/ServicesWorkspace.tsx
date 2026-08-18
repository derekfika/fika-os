"use client";

import { useState } from "react";
import ServiceArrangementsPanel from "./ServiceArrangementsPanel";
import ServiceCataloguePanel from "./ServiceCataloguePanel";

export default function ServicesWorkspace({ canManage, refreshSession }: { canManage: boolean; refreshSession: () => Promise<boolean> }) {
  const [tab, setTab] = useState<"catalogue" | "arrangements">("catalogue");
  return <section className="connection-workspace focused-connection-workspace services-workspace">
    <header className="connections-page-heading"><div><p className="eyebrow">Services</p><h2>Reusable service types and location delivery</h2><p>Manage the catalogue independently, then arrange its delivery at an OPLOC or Operational Area.</p></div></header>
    <div className="connection-tabs" role="tablist" aria-label="Services workspace">
      <button role="tab" aria-selected={tab === "catalogue"} className={tab === "catalogue" ? "selected" : ""} onClick={() => setTab("catalogue")}>Service Catalogue</button>
      <button role="tab" aria-selected={tab === "arrangements"} className={tab === "arrangements" ? "selected" : ""} onClick={() => setTab("arrangements")}>Service Arrangements</button>
    </div>
    {tab === "catalogue" ? <ServiceCataloguePanel canManage={canManage} refreshSession={refreshSession} /> : <ServiceArrangementsPanel canManage={canManage} refreshSession={refreshSession} />}
  </section>;
}
