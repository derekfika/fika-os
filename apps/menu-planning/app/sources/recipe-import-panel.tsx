"use client";
import { useEffect, useMemo, useState } from "react";

type Candidate = { canonicalId: string; displayName: string; description?: string; subcategory?: string; ingredients?: Array<{ name: string }>; methodSteps?: string[]; yieldDescription?: string; sourceEvidence?: { document: string }; review?: { state: "unreviewed" | "ignored" | "promoted"; reason?: string } };

export default function RecipeImportPanel() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/menu/source-candidates", { cache: "no-store" }).then(response => response.json()).then(body => setCandidates(body.candidates || [])).catch(() => setMessage("Source candidates could not be loaded."));
  useEffect(() => { void load(); }, []);
  const categories = useMemo(() => Array.from(new Set(candidates.map(item => item.subcategory).filter(Boolean))).sort() as string[], [candidates]);
  const visible = candidates.filter(item => (!search || `${item.displayName} ${item.description || ""}`.toLowerCase().includes(search.toLowerCase())) && (category === "all" || item.subcategory === category));
  const reviewCandidate = async (action: "promote" | "ignore", candidateId: string) => {
    setBusy(true); setMessage("");
    const response = await fetch("/api/menu/source-candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, candidateId, reason: action === "ignore" ? "Not a canonical MenuItem" : undefined }) });
    const body = await response.json();
    setMessage(response.ok ? (action === "promote" ? "Candidate promoted to the canonical repository as an unreviewed MenuItem." : "Candidate ignored and retained as source evidence.") : body.error || "Review action failed.");
    await load(); setBusy(false);
  };
  return <section className="workspace-panel recipe-import-panel">
    <header className="panel-header"><div><small>Brian recipe documents · source evidence</small><h3>Source candidate review</h3></div><span className="status status--unreviewed">Nothing auto-approved</span></header>
    <p className="form-help">Candidates are parsed, cleaned and classified from Brian's source material. Review each one deliberately: promote it to the canonical MenuItem repository or ignore it with a reason.</p>
    <div className="library-filters"><label>Search candidates<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search dish title or description" /></label><label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
    {message && <p className="form-help" role="status">{message}</p>}
    <div className="library-list">{visible.map(candidate => { const state = candidate.review?.state || "unreviewed"; return <article className="library-row" key={candidate.canonicalId}><div><strong>{candidate.displayName}</strong><span>{candidate.subcategory || "Unclassified"} · {candidate.ingredients?.length || 0} ingredients · {candidate.methodSteps?.length || 0} method steps</span><small>{candidate.yieldDescription || "Yield not stated"} · {candidate.sourceEvidence?.document || "source retained"}</small></div><span className={`status status--${state}`}>{state === "promoted" ? "Promoted" : state === "ignored" ? "Ignored" : "Needs review"}</span>{state === "unreviewed" ? <><button className="button button-purple" disabled={busy} onClick={() => void reviewCandidate("promote", candidate.canonicalId)}>Promote MenuItem</button><button className="button button-soft" disabled={busy} onClick={() => void reviewCandidate("ignore", candidate.canonicalId)}>Ignore</button></> : <small>{candidate.review?.reason || "Decision recorded"}</small>}</article>; })}{!visible.length && <div className="empty-state"><h3>No source candidates match.</h3><p>Try a different search or category.</p></div>}</div>
  </section>;
}
