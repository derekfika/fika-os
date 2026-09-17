"use client";

import { useEffect, useMemo, useState } from "react";
import BookingPortal from "./BookingPortal";
import HospitalityDashboard from "./HospitalityDashboard";
import styles from "./HospitalityWorkspace.module.css";
import {
  hospitalityWorkspacePath,
  resolveWorkspaceEntry,
  type HospitalitySurface,
  type HospitalitySurfaceAccess,
  type HospitalityWorkspaceSite,
} from "@/lib/hospitality-workspace";

type Site = HospitalityWorkspaceSite;
const rememberedKey = "fika-hospitality-active-oploc";
const defaultSurfaces: HospitalitySurfaceAccess = { bookingPlatform: true, operationsDashboard: true };

function returnToHub() {
  return `${process.env.NEXT_PUBLIC_FIKA_HUB_URL || "/"}?returnTo=${encodeURIComponent(typeof window === "undefined" ? "/workspace" : window.location.href)}`;
}

function Notice({ title, copy, action = "Return to FIKA OS" }: { title: string; copy: string; action?: string }) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.notice} role="alert">
          <p className={styles.eyebrow}>Hospitality</p>
          <h1>{title}</h1>
          <p>{copy}</p>
          <a href={returnToHub()}>{action}</a>
        </section>
      </div>
    </main>
  );
}

export default function HospitalityWorkspace() {
  const [sites, setSites] = useState<Site[]>([]);
  const [surfaces, setSurfaces] = useState(defaultSurfaces);
  const [selectedOplocId, setSelectedOplocId] = useState("");
  const [surface, setSurface] = useState<HospitalitySurface>();
  const [unauthorisedOplocId, setUnauthorisedOplocId] = useState<string>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/access", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Hospitality access could not be resolved.");
      const available = (body.sites || []) as Site[];
      const access = (body.surfaces || defaultSurfaces) as HospitalitySurfaceAccess;
      const params = new URLSearchParams(window.location.search);
      const entry = resolveWorkspaceEntry({
        sites: available,
        explicitOplocId: params.get("oploc"),
        requestedSiteKey: params.get("site"),
        rememberedOplocId: window.localStorage.getItem(rememberedKey),
        requestedSurface: params.get("surface"),
        surfaces: access,
      });
      setSites(available);
      setSurfaces(access);
      if (entry.kind === "unauthorised-oploc") setUnauthorisedOplocId(entry.oplocId);
      if (entry.kind === "unauthorised-surface") setError(`The ${entry.surface === "booking" ? "Booking platform" : "Operations dashboard"} is not authorised for this Hospitality access.`);
      if (entry.kind === "choose") setSelectedOplocId(entry.selectedOplocId || "");
      if (entry.kind === "destination-choice") setSelectedOplocId(entry.selectedOplocId);
      if (entry.kind === "surface") {
        setSelectedOplocId(entry.oplocId);
        setSurface(entry.surface);
        window.localStorage.setItem(rememberedKey, entry.oplocId);
      }
    }).catch((cause) => setError((cause as Error).message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!sites.length) return;
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const entry = resolveWorkspaceEntry({
        sites,
        explicitOplocId: params.get("oploc"),
        requestedSiteKey: params.get("site"),
        rememberedOplocId: window.localStorage.getItem(rememberedKey),
        requestedSurface: params.get("surface"),
        surfaces,
      });
      setUnauthorisedOplocId(entry.kind === "unauthorised-oploc" ? entry.oplocId : undefined);
      setError(entry.kind === "unauthorised-surface" ? `The ${entry.surface === "booking" ? "Booking platform" : "Operations dashboard"} is not authorised for this Hospitality access.` : "");
      setSelectedOplocId(entry.kind === "surface" ? entry.oplocId : entry.kind === "destination-choice" ? entry.selectedOplocId : entry.kind === "choose" ? entry.selectedOplocId || "" : "");
      setSurface(entry.kind === "surface" ? entry.surface : undefined);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [sites, surfaces]);

  const active = useMemo(() => sites.find((site) => site.id === selectedOplocId), [sites, selectedOplocId]);
  const canBook = surfaces.bookingPlatform && Boolean(active);
  const canOperate = surfaces.operationsDashboard && Boolean(active);

  const updateRoute = (nextOplocId: string, nextSurface?: HospitalitySurface) => {
    const selected = sites.find((site) => site.id === nextOplocId);
    if (!selected) return;
    setSelectedOplocId(selected.id);
    setSurface(nextSurface);
    window.localStorage.setItem(rememberedKey, selected.id);
    window.history.pushState({}, "", nextSurface ? hospitalityWorkspacePath(selected.id, nextSurface) : "/workspace");
  };

  const selectSurface = (nextSurface: HospitalitySurface) => {
    if (active) updateRoute(active.id, nextSurface);
  };

  if (loading) return <main className={styles.page}><section className={styles.notice}><p>Resolving Hospitality access…</p></section></main>;
  if (error) return <Notice title="Hospitality access unavailable" copy={error} action="Return to FIKA OS sign-in" />;
  if (unauthorisedOplocId) return <Notice title="Hospitality location not authorised" copy={`Your account is not authorised for ${unauthorisedOplocId}. Choose an authorised Hospitality workspace instead.`} />;
  if (!sites.length) return <Notice title="Hospitality access unavailable" copy="Your account does not currently have access to a Hospitality location." />;
  if (surface === "booking" && active && canBook) {
    return <BookingPortal siteKey={active.portalSiteKey} oplocId={active.id} siteLabel={active.label} availableSites={sites} onSiteChange={(next) => updateRoute(next, "booking")} />;
  }
  if (surface === "operations" && active && canOperate) {
    return <HospitalityDashboard key={active.id} siteKey={active.portalSiteKey} oplocId={active.id} availableSites={sites} onSiteChange={(next) => updateRoute(next, "operations")} />;
  }

  const showDestinationChoice = sites.length === 1;
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <a className={styles.brand} href="/workspace" aria-label="FIKA OS Hospitality workspace"><strong>FIKA</strong><span>OS</span><i>·</i><b>Hospitality</b></a>
        </header>
        <section className={styles.intro} aria-labelledby="workspace-title">
          <p className={styles.eyebrow}>Hospitality</p>
          <h1 id="workspace-title">{showDestinationChoice ? "Choose your destination" : "Choose your workspace"}</h1>
          <p>Select an authorised site, then choose the Hospitality surface you need. Your last site may be preselected for convenience, but you always choose where to go.</p>
        </section>
        {showDestinationChoice ? (
          <div className={styles.selectionSummary} aria-label="Selected Hospitality site">
            <strong>Selected site</strong><span>{active?.label}</span>
          </div>
        ) : (
          <label className={styles.selector}>
            Site
            <select aria-label="Choose an authorised Hospitality site" value={selectedOplocId} onChange={(event) => { setSelectedOplocId(event.target.value); setSurface(undefined); }}>
              <option value="">Choose an authorised site</option>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}
            </select>
          </label>
        )}
        <section className={styles.cards} aria-label="Hospitality destinations">
          <button type="button" className={styles.card} disabled={!canBook} onClick={() => selectSurface("booking")}>
            <span className={styles.eyebrow}>Create and manage</span>
            <h2>Booking platform</h2>
            <p>Create and manage hospitality bookings, service details and customer requests for the selected site.</p>
            <span className={styles.cardAction}>{canBook ? "Open Booking platform →" : "Choose a site first"}</span>
          </button>
          <button type="button" className={styles.card} disabled={!canOperate} onClick={() => selectSurface("operations")}>
            <span className={styles.eyebrow}>Review and coordinate</span>
            <h2>Operations dashboard</h2>
            <p>Review bookings, approvals, run sheets and operational activity for the selected site.</p>
            <span className={styles.cardAction}>{canOperate ? "Open Operations dashboard →" : "Choose a site first"}</span>
          </button>
        </section>
      </div>
    </main>
  );
}
