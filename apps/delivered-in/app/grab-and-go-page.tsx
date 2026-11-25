"use client";

import { useEffect, useState } from "react";
import { deliveredInHref, readDeliveredInLocation, type DeliveredInLocation } from "../lib/navigation";
import GrabAndGoView from "./grab-and-go-view";
import { readGrabAndGoAccess, selectGrabAndGoSite, type GrabAndGoAccess } from "./lib/grab-and-go-access";

export default function GrabAndGoPage() {
  const [access, setAccess] = useState<GrabAndGoAccess>();
  const [requested, setRequested] = useState<DeliveredInLocation>({ view: "today" });

  useEffect(() => {
    const request = new AbortController();
    const readLocation = () => setRequested(readDeliveredInLocation(window.location.search));
    readLocation();
    window.addEventListener("popstate", readLocation);
    void readGrabAndGoAccess(request.signal, true).then(result => {
      if (!request.signal.aborted) setAccess(result);
    });
    return () => {
      request.abort();
      window.removeEventListener("popstate", readLocation);
    };
  }, []);

  const sites = access?.status === "ready" ? access.sites : [];
  const site = selectGrabAndGoSite(sites, requested.oplocId);
  const dashboardHref = (view: "today" | "week", oplocId?: string) =>
    deliveredInHref({ ...requested, view, oplocId });

  function chooseSite(oplocId: string) {
    if (!sites.some(candidate => candidate.oplocId === oplocId)) return;
    const next = { ...requested, view: "today" as const, oplocId };
    setRequested(next);
    window.history.replaceState(null, "", deliveredInHref(next, "/grab-and-go"));
  }

  return (
    <main className="app-shell">
      <header className="compact-header">
        <div className="brand-lockup">
          <strong>FIKA OS</strong>
          <span className="brand-divider" />
          <b>Delivered-In</b>
        </div>
        <div className="header-actions">
          {sites.length > 0 && (
            <label className="site-picker">
              <span>Site</span>
              <select value={site?.oplocId || ""} onChange={event => chooseSite(event.target.value)}>
                {!site && <option value="" disabled>Choose an authorised site</option>}
                {sites.map(item => <option key={item.oplocId} value={item.oplocId}>{item.label}</option>)}
              </select>
            </label>
          )}
          <span className="avatar">OS</span>
        </div>
      </header>
      <nav className="top-nav" aria-label="Delivered-In navigation">
        {site?.services?.deliveredIn ? (
          <>
            <a className="nav-link service-nav-link" href={dashboardHref("today", site.oplocId)}><span aria-hidden="true">▣</span> <span>Today</span></a>
            <a className="nav-link service-nav-link" href={dashboardHref("week", site.oplocId)}><span aria-hidden="true">▦</span> <span>This week</span></a>
          </>
        ) : (
          <a className="nav-link service-nav-link" href={dashboardHref("today")}>Dashboard</a>
        )}
        <a className="nav-link service-nav-link active" aria-current="page"
          href={deliveredInHref({ ...requested, view: "today", oplocId: site?.oplocId || requested.oplocId }, "/grab-and-go")}>
          <span aria-hidden="true">▤</span> <span>Grab &amp; Go</span>
        </a>
      </nav>
      {site && access?.status === "ready" ? (
        <GrabAndGoView key={`${access.accountScope}:${site.oplocId}`} oplocId={site.oplocId} accountScope={access.accountScope} />
      ) : (
        <section className="service-access-panel" aria-labelledby="service-access-title">
          <h1 id="service-access-title">Grab &amp; Go ordering</h1>
          {!access && <p role="status">Checking Grab &amp; Go site access…</p>}
          {access?.status === "unavailable" && (
            <p role="alert">Grab &amp; Go access could not be checked. Refresh the page to try again.</p>
          )}
          {access?.status === "sign-in" && (
            <p role="alert">Sign in again to check your Grab &amp; Go site access.</p>
          )}
          {(access?.status === "denied" || (access?.status === "ready" && !sites.length)) && (
            <p>Your account has no sites authorised for Grab &amp; Go ordering.</p>
          )}
          {sites.length > 0 && (
            <p>Grab &amp; Go is unavailable for the requested site. Choose an authorised site above.</p>
          )}
        </section>
      )}
    </main>
  );
}
