"use client";
import { useState } from "react";
import type { LocalImportCandidate, LocalImportPreview } from "@/lib/contracts";
import type { BeverageClassification } from "@/lib/domain";
const messageOf = (body: any) => body?.error?.message || "The local command failed.";
export default function ImportPage() {
  const [text, setText] = useState("Name: Winter Citrus Cooler\nType: Mocktail\nDescription: A bright citrus drink developed for winter service.\nIngredient: 20 ml orange juice\nIngredient: 15 ml lemon juice\nIngredient: mint leaves\nMethod: Shake with ice and strain over fresh ice.\nGlassware: Highball glass\nGarnish: Orange wheel");
  const [classification, setClassification] = useState<BeverageClassification>("draft_concept");
  const [previewed, setCandidate] = useState<{ text: string; sourceHash: string; candidate: LocalImportCandidate; key: string }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const current = previewed?.text === text ? previewed : undefined;
  const candidate = current && { ...current.candidate.recipe, warnings: current.candidate.warnings };
  const sourceHash = current?.sourceHash || "";
  const preview = async () => {
    setBusy(true);
    setCandidate(undefined);
    try {
      const response = await fetch("/api/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await response.json();
      if (!response.ok) return setMessage(messageOf(body));
      const result = body as LocalImportPreview;
      if (result.candidates.length !== 1) return setMessage("Multiple drinks found. Paste one drink at a time in this view.");
      setCandidate({ text, sourceHash: result.sourceHash, candidate: result.candidates[0], key: `beverage-ui:${crypto.randomUUID()}` });
      setMessage("Preview ready. No record has been created.");
    } catch {
      setMessage("Could not preview the recipe. Check the local service and try again.");
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const response = await fetch("/api/imports/commit", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": current.key },
        body: JSON.stringify({
          text: current.text, sourceHash: current.sourceHash, candidateIndex: current.candidate.index,
          candidateHash: current.candidate.candidateHash, classification, reviewed: true,
          reviewedCandidate: current.candidate.recipe,
        }),
      });
      const body = await response.json();
      if (!response.ok) return setMessage(messageOf(body));
      setCandidate(undefined);
      setMessage(`Local draft created: ${body.record.name}. Source fingerprint ${body.sourceHash.slice(0, 12)}…`);
    } catch {
      setMessage("Could not confirm the draft was created. Try the same request again.");
    } finally {
      setBusy(false);
    }
  };
  return <main className="app"><header className="topbar"><a className="brand" href="/"><img src="/fika-logo-white.png" alt="FIKA"/><span>OS</span></a><div className="top-title"><small>Beverage Innovation · Stage B</small><strong>Recipe import preview</strong></div><a className="mint" href="/">Back to drinks</a></header><section className="workspace tool-page"><div className="toolbar"><div><small>LOCAL PARSER</small><h2>Review a recipe source</h2><p>Paste recipe text, inspect parsed fields, then choose whether to create a fictional local draft.</p></div></div>{message && <p className="message" role="status">{message}</p>}<section className="panel import-panel"><label>Classification<select value={classification} onChange={event => setClassification(event.target.value as BeverageClassification)}><option value="draft_concept">Draft concept</option><option value="classic_source">Classic source</option><option value="fika_original">FIKA original</option></select></label><label>Recipe source text<textarea rows={14} value={text} onChange={event => { setText(event.target.value); setCandidate(undefined); }} /></label><button className="purple" onClick={() => void preview()} disabled={busy}>Preview recipe</button></section>
    {candidate && <section className="panel"><h3>Parsed preview</h3><div className="preview-grid"><div><b>Name</b><p>{candidate.name || "Needs review"}</p><b>Type</b><p>{candidate.beverageType}</p><b>Description</b><p>{candidate.description || "Not supplied"}</p></div><div><b>Ingredients · per drink</b>{candidate.ingredients.map((ingredient, index) => <p className="list-row" key={index}>{ingredient.amount ?? "Quantity needed"} {ingredient.unit || ""} {ingredient.name}</p>)}<b>Method</b><p>{candidate.method || "Needs review"}</p><b>Glassware / garnish</b><p>{candidate.glassware || "Not supplied"} · {candidate.garnish || "Not supplied"}</p></div></div>{candidate.warnings.map((warning, index) => <p className="notice" key={index}>{warning}</p>)}<p className="muted">Source hash: {sourceHash}</p><p className="help">Allergens and ingredient costs are not inferred. Created ingredient lines remain unconfirmed and allergen status remains awaiting canonical source.</p><button className="purple" disabled={busy || !candidate.name.trim()} onClick={() => void create()}>Create local draft from source</button></section>}
    </section></main>;
}
