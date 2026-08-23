"use client";

import { useEffect, useState } from "react";
import MenuPlanningShell from "../menu-planning-shell";
import { resolveAllergenSnapshot } from "@/lib/allergen-resolution";
import type { RollingSnapshot } from "@/lib/rolling-menu-types";

type EvidenceValue = "contains" | "free_from" | "may_contain" | "unknown";
type CatalogueItem = { id: string; name: string; allergenEvidence?: Array<{ allergen: string; value: EvidenceValue }>; mayContainReviewed?: boolean };

export default function ReviewPage() {
  const [snapshot, setSnapshot] = useState<RollingSnapshot>();
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  useEffect(() => { void Promise.all([fetch("/api/rolling-menu", { cache: "no-store" }), fetch("/api/catalogue", { cache: "no-store" })]).then(async ([menu, dishes]) => { if (menu.ok) setSnapshot((await menu.json()).snapshot); if (dishes.ok) setCatalogue((await dishes.json()).entries || []); }); }, []);
  const issues = snapshot ? snapshot.entries.map(entry => { const dish = catalogue.find(item => item.id === entry.itemId); const unresolved = resolveAllergenSnapshot(entry, dish ? { canonicalId: dish.id, displayName: dish.name, allergenEvidence: dish.allergenEvidence || [], mayContainReviewed: dish.mayContainReviewed === true } : undefined).unresolved; return { entry, unresolved }; }).filter(item => item.unresolved.length || !item.entry.itemId) : [];
  return <MenuPlanningShell section="Review"><section className="workspace-intro"><small>Items requiring attention</small><h2>Review</h2><p>Resolve the decisions that must be made before the current menu is ready.</p></section><section className="workspace-panel review-panel"><header className="panel-header"><div><small>Current Planner scope · Delivered-In</small><h3>Needs a human decision</h3></div><span>{issues.length} open</span></header>{!snapshot ? <div className="empty-state"><span className="loader" /><p>Loading review items…</p></div> : issues.length ? <div className="exception-list">{issues.map(({ entry, unresolved }) => <article key={entry.id}><div><span className="severity severity--warning">Allergen review</span><strong>{entry.itemLabel || "Unassigned menu row"}</strong><small>{unresolved.length ? `${unresolved.length} allergen decision(s) unresolved` : "Dish selection required"} · {entry.dayId} · {entry.slot}</small></div><a className="button button-soft" href="/">Open Planner</a></article>)}</div> : <div className="empty-state"><h3>Nothing needs attention.</h3><p>No unresolved allergen review items are recorded for the current menu.</p></div>}</section></MenuPlanningShell>;
}
