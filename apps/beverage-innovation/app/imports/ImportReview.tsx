"use client";

import { useRef, useState } from "react";
import { MAX_RECIPE_DOCUMENT_BYTES, type LocalDocumentImportPreview, type LocalImportPreview } from "../../lib/contracts";
import { initialReview, normalizeReviewedName, prepareImport, reviewCompleteness, type PendingImport, type ReviewForm, type ReviewSession } from "./review-model";

const example = "Name: Winter Citrus Cooler\nType: Mocktail\nDescription: A bright citrus drink developed for winter service.\nIngredient: 20 ml orange juice\nIngredient: mint leaves\nMethod: Shake with ice and strain.\nGlassware: Highball glass\nGarnish: Orange wheel\nEquipment: Shaker\n\nName: Garden Fizz\nType: Mocktail\nIngredient: 30 ml apple juice\nIngredient: soda water\nMethod: Stir and serve chilled.\nEquipment: Spoon";
const messageOf = (body: unknown) => {
  const error = body && typeof body === "object" && "error" in body ? (body as { error?: { message?: string } }).error : undefined;
  return error?.message || "The local command failed. Review the fields and try again.";
};

export default function ImportReview() {
  const [text, setText] = useState(example);
  const [sourceKind, setSourceKind] = useState<"text" | "document">("text");
  const [file, setFile] = useState<File>();
  const [session, setSession] = useState<ReviewSession>();
  const [selected, setSelected] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<PendingImport>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [nameChecks, setNameChecks] = useState<Record<number, { normalizedName: string; status: "checking" | "checked" | "error"; duplicate?: boolean }>>({});
  const busyRef = useRef(false);
  const checkCounter = useRef(0);
  const checkSequence = useRef<Record<number, number>>({});
  const inFlightChecks = useRef<Record<number, { normalizedName: string; sequence: number }>>({});
  const locked = busy || Boolean(pending);
  const candidate = session?.preview.candidates[selected];
  const form = session?.forms[selected];
  const saved = Boolean(candidate && session?.saved.includes(candidate.index));
  const normalizedName = form ? normalizeReviewedName(form.name) : "";
  const nameChanged = Boolean(candidate && normalizedName !== normalizeReviewedName(candidate.recipe.name));
  const nameCheck = candidate ? nameChecks[candidate.index] : undefined;
  const nameCheckReady = !nameChanged || Boolean(nameCheck?.status === "checked" && nameCheck.normalizedName === normalizedName);
  const documentInfo = session && session.source.kind === "document" && "document" in session.preview ? session.preview.document : undefined;

  function invalidateReview() {
    setSession(undefined); setNameChecks({}); checkSequence.current = {}; inFlightChecks.current = {}; setConfirmed(false); setMessage("");
  }

  function chooseFile(chosen?: File) {
    if (locked) return;
    invalidateReview();
    setFile(undefined);
    if (!chosen) return;
    if (!/\.(docx|pptx|pdf)$/i.test(chosen.name)) { setMessage("Choose a DOCX, PPTX or PDF document."); return; }
    if (!chosen.size) { setMessage("Choose a non-empty recipe document."); return; }
    if (chosen.size > MAX_RECIPE_DOCUMENT_BYTES) { setMessage("Recipe documents are limited to 4 MiB. Choose a smaller file."); return; }
    setFile(chosen);
  }

  function updateForm(patch: Partial<ReviewForm>) {
    if (locked || saved) return;
    setSession(current => current && ({ ...current, forms: current.forms.map((item, index) => index === selected ? { ...item, ...patch } : item) }));
    setConfirmed(false);
  }

  function updateName(name: string) {
    if (!candidate || locked || saved) return;
    const index = candidate.index;
    checkSequence.current[index] = ++checkCounter.current;
    delete inFlightChecks.current[index];
    setNameChecks(current => { const next = { ...current }; delete next[index]; return next; });
    updateForm({ name });
  }

  async function checkEditedName() {
    if (!candidate || !form || locked || saved || !nameChanged || !normalizedName) return;
    const index = candidate.index;
    if (inFlightChecks.current[index]?.normalizedName === normalizedName) return;
    const sequence = ++checkCounter.current;
    checkSequence.current[index] = sequence;
    inFlightChecks.current[index] = { normalizedName, sequence };
    setNameChecks(current => ({ ...current, [index]: { normalizedName, status: "checking" } }));
    try {
      const response = await fetch("/api/imports/name-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.name }) });
      const body = await response.json();
      if (!response.ok || body.normalizedName !== normalizedName || typeof body.duplicate !== "boolean") throw new Error("Name check unavailable");
      if (checkSequence.current[index] === sequence) setNameChecks(current => ({ ...current, [index]: { normalizedName, status: "checked", duplicate: body.duplicate } }));
    } catch {
      if (checkSequence.current[index] === sequence) setNameChecks(current => ({ ...current, [index]: { normalizedName, status: "error" } }));
    } finally {
      if (inFlightChecks.current[index]?.sequence === sequence) delete inFlightChecks.current[index];
    }
  }

  async function previewSource() {
    if (busyRef.current || pending || (sourceKind === "document" && !file)) return;
    const source = sourceKind === "document" && file ? { kind: "document" as const, file } : { kind: "text" as const, text };
    busyRef.current = true; setBusy(true); invalidateReview();
    try {
      let response: Response;
      if (source.kind === "document") {
        const form = new FormData(); form.set("file", source.file);
        response = await fetch("/api/imports/documents/preview", { method: "POST", body: form });
      } else {
        response = await fetch("/api/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: source.text }) });
      }
      const body = await response.json();
      if (!response.ok) { setMessage(messageOf(body)); return; }
      const result = body as LocalImportPreview | LocalDocumentImportPreview;
      if (source.kind === "document" && (!("document" in result) || result.sourceLabel !== source.file.name || result.document.byteLength !== source.file.size)) throw new Error("Document preview does not match the selected file.");
      setSession({ source, preview: result, forms: result.candidates.map(initialReview), saved: [] });
      setSelected(0);
      setMessage(result.candidates.length + " candidate" + (result.candidates.length === 1 ? "" : "s") + " found. No draft has been created.");
    } catch { setMessage("Could not preview the recipe. Check the local service and try again."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function sendImport(request: PendingImport) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setPending(request); setMessage("");
    try {
      let response: Response;
      if (request.source.kind === "document") {
        const form = new FormData(); form.set("file", request.source.file); form.set("review", request.body);
        response = await fetch("/api/imports/documents/commit", { method: "POST", headers: { "idempotency-key": request.key }, body: form });
      } else {
        response = await fetch("/api/imports/commit", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": request.key }, body: request.body });
      }
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500 && !pending) { setPending(undefined); setConfirmed(false); setMessage(messageOf(body)); }
        else setMessage("The result is unknown. Retry this same request before changing the review.");
        return;
      }
      setSession(current => current && ({ ...current, saved: [...current.saved, request.candidateIndex] }));
      setPending(undefined); setConfirmed(false);
      setMessage("Local draft created: " + body.record.name + ". Review another candidate if needed.");
    } catch { setMessage("The result is unknown. Retry this same request before changing the review."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function createDraft() {
    if (!session || busyRef.current) return;
    if (pending) { void sendImport(pending); return; }
    const verifiedName = nameCheck?.status === "checked" && typeof nameCheck.duplicate === "boolean" ? { normalizedName: nameCheck.normalizedName, duplicate: nameCheck.duplicate } : undefined;
    const result = prepareImport(session, selected, confirmed, "beverage-ui:" + crypto.randomUUID(), verifiedName);
    if (!result.pending) { setMessage(result.error || "Review the selected candidate."); return; }
    void sendImport(result.pending);
  }

  return <main className="import-review">
    <header className="ir-top"><a className="ir-brand" href="/"><img src="/fika-logo-white.png" alt="FIKA"/><span>OS</span></a><div><small>Innovation workspace</small><strong>Beverage Innovation</strong></div><span className="ir-local">LOCAL FIXTURE REVIEW</span><a className="ir-back" href="/">Back to drinks</a></header>
    <div className="ir-workspace"><div className="ir-heading"><div><h1>Review recipe import</h1><p>Use a fictional or approved source, review each candidate and explicitly create a local draft.</p></div></div>
      {message && <div className="ir-message" role="status">{message}</div>}
      <section className="ir-card ir-source" aria-labelledby="source-title"><div><h2 id="source-title">1. Add a source</h2><p>Use a Name: or Drink: label for each drink, or separate unlabelled recipes with ---. Up to 20 drinks and 20,000 extracted characters.</p></div>
        <fieldset className="ir-source-choice" disabled={locked}><legend>Source type</legend><label><input type="radio" name="source-type" checked={sourceKind === "text"} onChange={() => { setSourceKind("text"); setFile(undefined); invalidateReview(); }}/> Paste text</label><label><input type="radio" name="source-type" checked={sourceKind === "document"} onChange={() => { setSourceKind("document"); setFile(undefined); invalidateReview(); }}/> Upload document</label></fieldset>
        {sourceKind === "text" ? <label>Recipe source text<textarea rows={9} maxLength={20000} value={text} disabled={locked} onChange={event => { setText(event.target.value); invalidateReview(); }} /></label> : <><label>Recipe document<input type="file" accept=".docx,.pptx,.pdf" disabled={locked} aria-describedby="document-help" onChange={event => { const chosen = event.currentTarget.files?.[0]; chooseFile(chosen); if (chosen && (!/\.(docx|pptx|pdf)$/i.test(chosen.name) || !chosen.size || chosen.size > MAX_RECIPE_DOCUMENT_BYTES)) event.currentTarget.value = ""; }}/></label><p id="document-help">DOCX, PPTX or PDF, up to 4 MiB. Export Google Docs or Slides manually, or paste text. Selectable text only; images and OCR are not read.</p>{file && <p>Selected: <strong>{file.name}</strong> · {file.size.toLocaleString("en-GB")} bytes</p>}</>}
        <div className="ir-actions"><button className="ir-primary" disabled={locked || (sourceKind === "text" ? !text.trim() : !file)} onClick={() => void previewSource()}>{busy && !pending ? "Checking source…" : "Preview candidates"}</button><span>The source stays in this page's memory during review.</span></div>
      </section>
      {session && candidate && form && <div className="ir-review-layout">
        <aside className="ir-card ir-candidates"><h2>2. Select a drink</h2><p>{session.preview.candidates.length} candidate{session.preview.candidates.length === 1 ? "" : "s"} found</p><fieldset disabled={locked}><legend>Parsed candidates</legend>{session.preview.candidates.map((item, index) => <label className="ir-candidate" key={item.index}><input type="radio" name="candidate" aria-label={"Candidate " + (index + 1) + ": " + (session.forms[index].name || "Unnamed drink")} checked={selected === index} onChange={() => { setSelected(index); setConfirmed(false); setMessage(""); }}/><span><strong>{session.forms[index].name || "Unnamed drink " + (index + 1)}</strong><small>{session.saved.includes(item.index) ? "Draft created" : item.confidence + " extraction confidence"} · {item.warnings.length} parser warning{item.warnings.length === 1 ? "" : "s"}</small></span></label>)}</fieldset>
          <div className="ir-provenance"><h3>Source provenance</h3><p>{session.preview.sourceLabel}</p>{documentInfo && <><p>Format: {documentInfo.format.toUpperCase()} · {documentInfo.byteLength.toLocaleString("en-GB")} bytes</p><p>Adapter version: {documentInfo.adapterVersion}</p><p>Extracted text fingerprint</p><code>{documentInfo.textHash}</code></>}<p>Source fingerprint</p><code>{session.preview.sourceHash}</code><p>Selected candidate {candidate.index + 1} fingerprint</p><code>{candidate.candidateHash}</code><p>{documentInfo ? "The original file and full extracted text are not stored with the draft." : "The source text is used for this review and is not stored with the draft."}</p></div>
        </aside>
        <section className="ir-card ir-editor" aria-labelledby="review-title"><div className="ir-editor-head"><div><h2 id="review-title">3. Review and edit</h2><p>Candidate {selected + 1} of {session.preview.candidates.length} · {candidate.confidence} extraction confidence</p></div>{saved && <span className="ir-badge">Draft created</span>}</div>
          <div className="ir-warning"><strong>Parser warnings</strong><ul>{candidate.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><p>These warnings refer to the original extracted candidate.</p></div>
          <div className="ir-completeness"><strong>Review completeness</strong>{reviewCompleteness(form).length ? <ul>{reviewCompleteness(form).map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>Core fields are filled. Confirm them against the source before saving.</p>}</div>
          <fieldset className="ir-fields" disabled={locked || saved}><legend className="ir-sr-only">Editable recipe fields</legend>
            <div className="ir-two"><label>Drink name <input value={form.name} maxLength={160} onChange={event => updateName(event.target.value)} onBlur={() => void checkEditedName()}/></label><label>Drink type <input value={form.beverageType} maxLength={80} onChange={event => updateForm({ beverageType: event.target.value })}/></label></div>
            {nameChanged && <div className="ir-name-check" aria-live="polite"><p>{!normalizedName ? "Enter a drink name to check for a local duplicate." : nameCheck?.normalizedName !== normalizedName ? "Check this edited name before creating a draft." : nameCheck.status === "checking" ? "Checking the edited name…" : nameCheck.status === "error" ? "The name check is unavailable. Retry before creating a draft." : nameCheck.duplicate ? "Possible duplicate: a local Beverage record has this name. Review it before saving." : "No exact name match found in local Beverage records."}</p><button className="ir-secondary" type="button" disabled={!normalizedName || nameCheck?.status === "checking"} onClick={() => void checkEditedName()}>{nameCheck?.status === "error" ? "Retry name check" : "Check edited name"}</button></div>}
            <label>Classification<select value={form.classification} onChange={event => updateForm({ classification: event.target.value as ReviewForm["classification"] })}><option value="draft_concept">Draft concept</option><option value="classic_source">Classic source</option><option value="fika_original">FIKA original</option></select></label>
            <label>Description<textarea rows={3} maxLength={2000} value={form.description} onChange={event => updateForm({ description: event.target.value })}/></label>
            <div className="ir-section-head"><div><h3>Ingredients · per drink</h3><p>Leave an unknown amount or unit blank. Costs and allergens remain unconfirmed.</p></div><button className="ir-secondary" type="button" disabled={form.ingredients.length >= 100} onClick={() => updateForm({ ingredients: [...form.ingredients, { name: "", amount: "", unit: "" }] })}>Add ingredient</button></div>
            {form.ingredients.map((line, index) => <div className="ir-ingredient" key={index}><label>Ingredient {index + 1}<input value={line.name} maxLength={160} onChange={event => updateForm({ ingredients: form.ingredients.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })}/></label><label>Quantity<input aria-label={"Ingredient " + (index + 1) + " quantity"} inputMode="decimal" value={line.amount} onChange={event => updateForm({ ingredients: form.ingredients.map((item, i) => i === index ? { ...item, amount: event.target.value } : item) })}/></label><label>Unit<input aria-label={"Ingredient " + (index + 1) + " unit"} value={line.unit} maxLength={24} onChange={event => updateForm({ ingredients: form.ingredients.map((item, i) => i === index ? { ...item, unit: event.target.value } : item) })}/></label><button className="ir-remove" type="button" aria-label={"Remove ingredient " + (index + 1)} onClick={() => updateForm({ ingredients: form.ingredients.filter((_, i) => i !== index) })}>Remove</button></div>)}
            {!form.ingredients.length && <p>No ingredients extracted. Add a line if the source contains one.</p>}
            <label>Preparation method<textarea rows={4} maxLength={8000} value={form.method} onChange={event => updateForm({ method: event.target.value })}/></label>
            <div className="ir-two"><label>Glassware<input value={form.glassware} maxLength={160} onChange={event => updateForm({ glassware: event.target.value })}/></label><label>Garnish<input value={form.garnish} maxLength={3991} onChange={event => updateForm({ garnish: event.target.value })}/></label></div>
            <label>Equipment <span className="ir-helper">One item per line</span><textarea rows={3} value={form.equipmentText} onChange={event => updateForm({ equipmentText: event.target.value })}/></label>
            <label className="ir-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> I reviewed this candidate against the source and want to create a local draft.</label>
          </fieldset>
          {pending && <p className="ir-warning">The result is unknown. Keep this page open and retry the same request. If you leave, check local records before starting a fresh review.</p>}
          {message && <p className="ir-inline-message" aria-hidden="true">{message}</p>}
          <div className="ir-actions"><button className="ir-primary" disabled={busy || saved || (!pending && (!confirmed || !nameCheckReady))} onClick={createDraft}>{busy && pending ? "Creating draft…" : pending ? "Retry same request" : saved ? "Draft created" : "Create local draft"}</button><span>No notification or operational publication will be sent.</span></div>
        </section>
      </div>}
    </div>
  </main>;
}
