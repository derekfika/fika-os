"use client";

import { useEffect, useState } from "react";
import type { Site } from "../lib/projection";
import GrabAndGoView from "./grab-and-go-view";
import { deliveredInHref, readDeliveredInLocation } from "../lib/navigation";

export default function GrabAndGoPage() {
  const [sites, setSites] = useState<Site[]>([]); const [siteId, setSiteId] = useState(""); const [error, setError] = useState("");
  useEffect(() => { const requested = readDeliveredInLocation(window.location.search); void fetch("/api/delivered-in/access?service=grab-and-go", { cache: "no-store" }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error("Unavailable"); const authorisedSites = body.sites || []; setSites(authorisedSites); setSiteId(authorisedSites.some((item: Site) => item.oplocId === requested.oplocId) ? requested.oplocId : authorisedSites[0]?.oplocId || ""); }).catch(() => setError("This ordering service is temporarily unavailable. Please check back shortly.")); }, []);
  const currentLocation = readDeliveredInLocation(typeof window === "undefined" ? "" : window.location.search);
  const siteHref = (path: string, view: "today" | "week" = "today") => deliveredInHref({ view, oplocId: siteId || undefined, week: currentLocation.week, day: currentLocation.day }, path);
  const site = sites.find(item => item.oplocId === siteId);
  return <main className="app-shell"><header className="compact-header"><div className="brand-lockup"><strong>FIKA OS</strong><span className="brand-divider" /> <span className="leaf-mark">♧</span><b>Delivered-In</b></div><div className="header-actions">{site && <label className="site-picker"><span>Site</span><select value={siteId} onChange={event => { setSiteId(event.target.value); window.history.replaceState(null, "", siteHref("/grab-and-go")); }}>{sites.map(item => <option key={item.oplocId} value={item.oplocId}>{item.label}</option>)}</select></label>}<span className="avatar">DB</span></div></header><nav className="top-nav" aria-label="Delivered-In navigation"><a className="nav-link" href={siteHref("/")}>▣ <span>Today</span></a><a className="nav-link" href={siteHref("/", "week")}>▦ <span>This week</span></a><a className="nav-link active" aria-current="page" href={siteHref("/grab-and-go")}>▤ <span>Grab &amp; Go</span></a></nav>{error ? <section className="empty-state"><p className="error" role="alert">{error}</p></section> : site ? <GrabAndGoView oplocId={site.oplocId} /> : <section className="content"><div className="empty-state"><p>Loading authorised sites…</p></div></section>}</main>;
}
