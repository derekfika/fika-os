"use client";

import { useState } from "react";
import type { AllergenReleaseDelta, ProjectedDay, Site } from "../lib/projection";

type Props = { day: ProjectedDay; site: Site };
const label = (value: AllergenReleaseDelta["current"]) => ({ clear: "Not present", contains: "CONTAINS", may_contain: "May contain", unrecorded: "Not recorded" }[value]);
const when = (value?: string) => value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Not available";

export default function AllergenSafetyNotice({ day, site }: Props) {
  const safety = day.allergenSafety;
  const [acknowledged, setAcknowledged] = useState(Boolean(safety?.acknowledgement && safety.acknowledgement.siteId === site.oplocId && safety.acknowledgement.serviceDate === day.date && safety.acknowledgement.releaseVersion === safety.releaseVersion));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!safety || safety.status === "current") return null;
  if (safety.status === "revoked_pending") return <section className="allergen-safety-blocker" role="alertdialog" aria-modal="true"><div className="allergen-safety-modal"><p className="ops-eyebrow">Safety action required</p><h2>ALLERGEN INFORMATION HAS CHANGED</h2><p>The previous menu is no longer current.</p><p>CPU is reviewing updated allergen information.</p><strong>DO NOT USE OR PRINT THE PREVIOUS MENU.</strong><p>Await the new signed release.</p></div></section>;
  const acknowledge = async () => { setBusy(true); setError(""); try { const response = await fetch("/api/delivered-in/allergen-acknowledgement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: site.oplocId, serviceDate: day.date, releaseVersion: safety.releaseVersion }) }); if (!response.ok) throw new Error("The acknowledgement could not be saved."); setAcknowledged(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "The acknowledgement could not be saved."); } finally { setBusy(false); } };
  const delta = safety.delta || [];
  if (acknowledged) return <section className="allergen-safety-banner" role="status"><div><strong>ALLERGEN CHANGE — MENU REPRINT REQUIRED</strong><span>{delta.length} allergen change{delta.length === 1 ? "" : "s"} · Release {safety.releaseVersion}</span><span>Signed {when(safety.signedAt)} · Menu regenerated {when(safety.regeneratedAt)}</span></div><a className="ops-link" href={day.siteMenu?.artifact?.driveUrl} target="_blank" rel="noopener noreferrer">View latest menu ↗</a></section>;
  return <section className="allergen-safety-blocker" role="alertdialog" aria-modal="true"><div className="allergen-safety-modal"><p className="ops-eyebrow">Safety action required</p><h2>ALLERGEN CHANGE — MENU REPRINT REQUIRED</h2><p>The CPU allergen matrix changed after the previous menu was released.</p><p>This site's menu has been automatically regenerated using the latest signed allergen information.</p><strong>DESTROY ANY PREVIOUSLY PRINTED COPIES AND REPRINT THE MENU NOW.</strong>{delta.length > 0 && <><h3>What changed</h3><div className="allergen-safety-delta" aria-label="Allergen changes">{delta.map((change, index) => <div className="allergen-safety-delta-row" key={`${change.dishName}-${change.allergen}-${index}`}><strong>{change.dishName}</strong><span>{change.allergen}</span><span>Previously: {label(change.previous)}</span><span>Now: <b>{label(change.current)}</b></span></div>)}</div></>}<p className="allergen-safety-release">Release {safety.releaseVersion} · Signed {when(safety.signedAt)}</p><button className="ops-button allergen-safety-ack" type="button" onClick={() => void acknowledge()} disabled={busy}>{busy ? "Saving acknowledgement…" : "I understand — previous menus must be replaced"}</button>{error && <p className="ops-error" role="alert">{error}</p>}</div></section>;
}
