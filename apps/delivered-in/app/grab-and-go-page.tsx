"use client";

import { useEffect, useState } from "react";
import type { Site } from "../lib/projection";
import GrabAndGoView from "./grab-and-go-view";

export default function GrabAndGoPage() {
  const [sites, setSites] = useState<Site[]>([]); const [siteId, setSiteId] = useState(""); const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/delivered-in", { cache: "no-store" }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Delivered-In access could not be loaded."); setSites(body.sites || []); setSiteId(body.selectedOplocId || body.sites?.[0]?.oplocId || ""); }).catch(cause => setError(cause instanceof Error ? cause.message : "Delivered-In access could not be loaded.")); }, []);
  const site = sites.find(item => item.oplocId === siteId);
  return <main className="app-shell"><header className="app-header"><div><p className="eyebrow mint">FIKA OS</p><h1>Delivered-In</h1><p>Site-facing published menu and ordering</p></div>{site && <div className="site-heading"><span>Authorised site</span><strong>{site.label}</strong></div>}</header><nav className="top-nav" aria-label="Delivered-In navigation"><a className="nav-link" href="/">Today</a><a className="nav-link" href="/?view=week">This week</a><a className="nav-link" href="/?view=allergens">Allergens</a><a className="nav-link active" href="/grab-and-go">Grab &amp; Go</a>{sites.length > 1 && <label className="site-picker"><span>Site</span><select value={siteId} onChange={event => setSiteId(event.target.value)}>{sites.map(item => <option key={item.oplocId} value={item.oplocId}>{item.label}</option>)}</select></label>}</nav>{error ? <section className="empty-state"><p className="error" role="alert">{error}</p></section> : site ? <GrabAndGoView oplocId={site.oplocId} /> : <section className="content"><div className="empty-state"><p>Loading authorised sites…</p></div></section>}</main>;
}
