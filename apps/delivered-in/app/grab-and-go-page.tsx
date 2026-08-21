"use client";

import { useEffect, useState } from "react";
import type { Site } from "../lib/projection";
import GrabAndGoView from "./grab-and-go-view";

export default function GrabAndGoPage() {
  const [sites, setSites] = useState<Site[]>([]); const [siteId, setSiteId] = useState(""); const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/delivered-in", { cache: "no-store" }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error("Unavailable"); setSites(body.sites || []); setSiteId(body.selectedOplocId || body.sites?.[0]?.oplocId || ""); }).catch(() => setError("This ordering service is temporarily unavailable. Please check back shortly.")); }, []);
  const site = sites.find(item => item.oplocId === siteId);
  return <main className="app-shell"><header className="compact-header"><div className="brand-lockup"><strong>FIKA OS</strong><span className="brand-divider" /> <span className="leaf-mark">♧</span><b>Delivered-In</b></div><div className="header-actions">{site && <label className="site-picker"><span>Site</span><select value={siteId} onChange={event => setSiteId(event.target.value)}>{sites.map(item => <option key={item.oplocId} value={item.oplocId}>{item.label}</option>)}</select></label>}<span className="avatar">DB</span></div></header><nav className="top-nav" aria-label="Delivered-In navigation"><a className="nav-link" href="/">▣ <span>Today</span></a><a className="nav-link" href="/?view=week">▦ <span>This week</span></a><a className="nav-link" href="/?view=allergens">♧ <span>Allergens</span></a><a className="nav-link active" href="/grab-and-go">▤ <span>Grab &amp; Go</span></a></nav>{error ? <section className="empty-state"><p className="error" role="alert">{error}</p></section> : site ? <GrabAndGoView oplocId={site.oplocId} /> : <section className="content"><div className="empty-state"><p>Loading authorised sites…</p></div></section>}</main>;
}
