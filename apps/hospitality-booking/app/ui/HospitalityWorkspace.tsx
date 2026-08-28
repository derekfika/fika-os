"use client";

import { useEffect, useMemo, useState } from "react";
import HospitalityDashboard from "./HospitalityDashboard";
import { portalSite, type PortalSiteKey } from "@/lib/portal-sites";

type Site = { id: string; label: string; active: boolean; portalSiteKey: PortalSiteKey };
const rememberedKey = "fika-hospitality-active-oploc";

export default function HospitalityWorkspace() {
  const [sites, setSites] = useState<Site[]>([]);
  const [activeId, setActiveId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/access", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Hospitality access could not be resolved.");
      const available = (body.sites || []) as Site[];
      setSites(available);
      const params = new URLSearchParams(window.location.search);
      const explicit = params.get("oploc");
      const requestedSite = params.get("site");
      const remembered = window.localStorage.getItem(rememberedKey);
      const chosen = available.find(site => site.id === explicit)?.id
        || available.find(site => site.portalSiteKey === requestedSite && portalSite(site.portalSiteKey).canonicalOplocId === site.id)?.id
        || available.find(site => site.portalSiteKey === requestedSite)?.id
        || available.find(site => site.id === remembered)?.id
        || available[0]?.id || "";
      setActiveId(chosen);
      if (chosen) {
        window.localStorage.setItem(rememberedKey, chosen);
        window.history.replaceState({}, "", `/hospitality/manage?oploc=${encodeURIComponent(chosen)}`);
      }
    }).catch(cause => setError((cause as Error).message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const onPopState = () => {
      const requested = new URLSearchParams(window.location.search).get("oploc");
      if (requested && sites.some(site => site.id === requested)) {
        setActiveId(requested);
        window.localStorage.setItem(rememberedKey, requested);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [sites]);
  const active = useMemo(() => sites.find(site => site.id === activeId), [sites, activeId]);
  if (loading) return <main className="mnk"><section className="success-screen"><p>Resolving Hospitality access…</p></section></main>;
  if (error) return <main className="mnk"><section className="success-screen"><h1>Hospitality access unavailable</h1><p>{error}</p><a href={`${process.env.NEXT_PUBLIC_FIKA_HUB_URL || "/"}?returnTo=${encodeURIComponent(typeof window === "undefined" ? "/workspace" : window.location.href)}`}>Return to FIKA OS sign-in</a></section></main>;
  if (!sites.length) return <main className="mnk"><section className="success-screen"><h1>Hospitality access unavailable</h1><p>Your account does not currently have access to a Hospitality location.</p><a href={`${process.env.NEXT_PUBLIC_FIKA_HUB_URL || "/"}?returnTo=${encodeURIComponent(typeof window === "undefined" ? "/workspace" : window.location.href)}`}>Return to FIKA OS</a></section></main>;
  if (!active) return <main className="mnk"><section className="success-screen"><h1>Hospitality access unavailable</h1><p>That Hospitality location is not authorised for your account.</p><a href={`${process.env.NEXT_PUBLIC_FIKA_HUB_URL || "/"}?returnTo=${encodeURIComponent(typeof window === "undefined" ? "/workspace" : window.location.href)}`}>Return to FIKA OS</a></section></main>;
  return <HospitalityDashboard key={active.id} siteKey={active.portalSiteKey} oplocId={active.id} availableSites={sites} onSiteChange={next => { const selected = sites.find(site => site.id === next); if (!selected) return; setActiveId(selected.id); window.localStorage.setItem(rememberedKey, selected.id); window.history.pushState({}, "", `/hospitality/manage?oploc=${encodeURIComponent(selected.id)}`); }} />;
}
