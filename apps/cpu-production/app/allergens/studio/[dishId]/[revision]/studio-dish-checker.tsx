"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CANONICAL_ALLERGEN_COLUMNS, type OperationalAllergenState } from "../../../../../../shared/allergen-contract";
import { namedPositives } from "../../../../../../shared/allergen-declaration";
import type { StudioDishReviewRole, StudioDishReviewView } from "../../../../../lib/studio-dish-review";
import { editableAllergens, PENDING_DECLARATION } from "../../../../lib/allergen-explicit";
import type { PlannedSubItem } from "../../../../lib/production-plan";
import { applyHospitalityBinaryClick, cellState, rowReviewBadge } from "../../../../ui/allergen-cell-state";
import { HospitalityAllergenCell } from "../../../../ui/HospitalityAllergenCell";
import { SignatureModal } from "../../../../ui/HospitalityAllergenDetail";
import "../../../../ui/hospitality-allergen-detail.css";
import "../../../../../../../shared/fika/component-atlas.css";
import "./studio-dish-checker.css";

const roles: Record<StudioDishReviewRole, string> = {
  production_chef: "Production chef",
  head_chef_site_manager: "Head chef / site manager",
};
const labels: Record<OperationalAllergenState, string> = { unrecorded: "Unrecorded", clear: "Clear", contains: "Contains", may_contain: "May contain" };
const namedColumns = CANONICAL_ALLERGEN_COLUMNS.filter(([key]) => key !== "no_key_allergens");
const primary = "fika-button fika-button--primary";
const secondary = "fika-button fika-button--secondary";

type RowEdit = {
  id: string;
  allergens: Record<string, OperationalAllergenState>;
  noKeyAllergens: boolean;
  mayContainNotes: string;
  allergenDetailNotes: string;
};

export default function StudioDishChecker({ endpoint }: { endpoint: string }) {
  const [review, setReview] = useState<StudioDishReviewView>();
  const [edit, setEdit] = useState<RowEdit>();
  const [signing, setSigning] = useState<StudioDishReviewRole>();
  const [reopen, setReopen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);

  async function load(signal?: AbortSignal) {
    setBusy(true);
    setError("");
    try {
      setReview(await readResponse(await fetch(endpoint, { cache: "no-store", signal })));
      setBlocked(false);
      setEdit(undefined);
      setReopen(false);
    } catch (cause) {
      if (!signal?.aborted) { setError(message(cause)); setBlocked(true); }
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [endpoint]);

  async function apply(command: Record<string, unknown>, complete: () => void) {
    if (!review || busy || blocked) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...command, expectedVersion: review.version, sourceHash: review.subject.sourceHash, commandId: crypto.randomUUID() }),
      });
      if (response.status === 409 || response.status >= 500) setBlocked(true);
      setReview(await readResponse(response));
      complete();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function selectRow(row: PlannedSubItem) {
    const context = { declaration: row.noKeyDeclaration, review: row.allergenReview };
    setEdit({ id: row.id, allergens: editableAllergens(row.allergens, context) as Record<string, OperationalAllergenState>,
      noKeyAllergens: row.noKeyDeclaration?.declared === true, mayContainNotes: row.mayContainNotes || "", allergenDetailNotes: row.allergenDetailNotes || "" });
    setError("");
  }

  function cycle(key: string) {
    if (!edit) return;
    const next = applyHospitalityBinaryClick(edit.allergens, key, edit.noKeyAllergens ? { declaration: PENDING_DECLARATION } : {});
    setEdit({ ...edit, allergens: next, noKeyAllergens: next.no_key_allergens === "contains" });
  }

  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    void apply({ action: "check-row", rowId: edit.id, allergens: namedPositives(edit.allergens), noKeyAllergens: edit.noKeyAllergens,
      mayContainNotes: edit.mayContainNotes, allergenDetailNotes: edit.allergenDetailNotes }, () => setEdit(undefined));
  }

  return <main className="fika-ui studio-dish-checker">
    <a href="/allergens">Back to CPU Allergen Checker</a>
    <h1>Studio dish allergen review</h1>
    {error && !signing && <p className="fika-error" role="alert">{error}</p>}
    {blocked && !signing && <button type="button" className={secondary} disabled={busy} onClick={() => void load()}>Reload saved review</button>}
    {!review && busy && <p role="status">Loading the saved dish revision…</p>}
    {review && <>
      <section className="fika-card" aria-labelledby="studio-dish-title">
        <h2 id="studio-dish-title">{review.dish.name}</h2>
        <p>Revision {review.dish.version} · {review.status === "current" ? "Verified" : review.status === "revoked" ? "Previous release revoked" : "In review"}</p>
        <h3>Kitchen description</h3>
        <p className="studio-dish-description">{review.dish.kitchenDescription}</p>
      </section>
      <section aria-labelledby="studio-matrix-title">
        <h2 id="studio-matrix-title">Allergen matrix</h2>
        <div className="fika-table-wrap" tabIndex={0} aria-label="Allergen matrix table">
          <table className="fika-table">
            <thead><tr><th scope="col">Dish or component</th><th scope="col">Allergens</th><th scope="col">Review</th><th scope="col">Action</th></tr></thead>
            <tbody>{review.menuItems.flatMap(item => item.subItems).map(row => <tr key={row.id}>
              <th scope="row">{row.name}{row.quantity !== null && ` · ${row.quantity} ${review.dish.assortment?.unit || ""} per box`}</th>
              <td>{row.noKeyDeclaration?.declared ? "No Key Allergens declared" : namedColumns.flatMap(([key, label]) => {
                const state = cellState(row.allergens, key);
                return state === "contains" || state === "may_contain" ? [`${label} (${labels[state]})`] : [];
              }).join(", ") || "Unrecorded"}
              {row.allergenDetailNotes && <p>{row.allergenDetailNotes}</p>}{row.mayContainNotes && <p>{row.mayContainNotes}</p>}</td>
              <td>{rowReviewBadge(row).text}</td>
              <td><button type="button" className={secondary} disabled={busy || blocked || Boolean(edit) || review.signatures.length > 0}
                aria-label={`Review ${row.name}`} onClick={() => selectRow(row)}>Review row</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        {edit && <form className="fika-card studio-dish-edit" onSubmit={check}>
          <h3>Check {review.menuItems[0].subItems.find(row => row.id === edit.id)?.name}</h3>
          <p>Mark checked to record unselected allergens as Clear.</p>
          <p>Use the allergen boxes to record Contains or May contain. Tick No Key Allergens only when it applies. A blank row cannot be checked.</p>
          <div className="allergen-table-wrap" tabIndex={0} role="region" aria-label="Allergen review boxes">
            <table className="allergen-checker">
              <thead><tr><th scope="col">Dish or component</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) =>
                <th scope="col" key={key}>{label}</th>)}</tr></thead>
              <tbody><tr><th scope="row">{review.menuItems[0].subItems.find(row => row.id === edit.id)?.name}</th>
                {CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <td key={key}>
                  <HospitalityAllergenCell
                    allergenKey={key}
                    label={label}
                    rowName={review.menuItems[0].subItems.find(row => row.id === edit.id)?.name || ""}
                    allergens={edit.allergens}
                    context={edit.noKeyAllergens ? { declaration: PENDING_DECLARATION } : {}}
                    locked={busy || blocked}
                    onToggle={() => { if (!busy && !blocked) cycle(key); }}
                  />
                </td>)}
              </tr></tbody>
            </table>
          </div>
          <label>Specific allergen details<textarea className="fika-textarea" maxLength={2000} value={edit.allergenDetailNotes}
            disabled={busy || blocked} onChange={event => setEdit({ ...edit, allergenDetailNotes: event.target.value })} /></label>
          <label>May-contain notes<textarea className="fika-textarea" maxLength={2000} value={edit.mayContainNotes}
            disabled={busy || blocked} onChange={event => setEdit({ ...edit, mayContainNotes: event.target.value })} /></label>
          <div className="studio-dish-actions">
            <button type="submit" className={primary} disabled={busy || blocked}>{busy ? "Saving…" : "Mark checked"}</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => setEdit(undefined)}>Cancel</button>
          </div>
        </form>}
      </section>
      <section aria-labelledby="studio-sign-title">
        <h2 id="studio-sign-title">Sign-off</h2>
        <div className="studio-dish-actions">{Object.entries(roles).map(([role, label]) => {
          const signed = review.signatures.some(signature => signature.role === role);
          return <button key={role} type="button" className={secondary} disabled={signed || !review.checked || busy || blocked || Boolean(edit) || reopen}
            onClick={() => { setError(""); setSigning(role as StudioDishReviewRole); }}>{signed ? `${label} signed` : `Sign as ${label}`}</button>;
        })}</div>
        {review.signatures.length > 0 && !reopen && <button type="button" className={secondary} disabled={busy || blocked} onClick={() => setReopen(true)}>Reopen review</button>}
        {reopen && <form className="fika-card studio-dish-edit" onSubmit={event => {
          event.preventDefault();
          void apply({ action: "reopen", reason }, () => { setReopen(false); setReason(""); });
        }}>
          <p>Reopening revokes current verification and requires a new review and both signatures.</p>
          <label>Reason<textarea className="fika-textarea" minLength={3} maxLength={1000} value={reason} required
            disabled={busy || blocked} onChange={event => setReason(event.target.value)} /></label>
          <div className="studio-dish-actions">
            <button type="submit" className="fika-button fika-button--destructive" disabled={busy || blocked}>Reopen and revoke</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => setReopen(false)}>Cancel</button>
          </div>
        </form>}
      </section>
      {signing && <SignatureModal role={signing} onCancel={() => { setSigning(undefined); setError(""); }} busy={busy} submissionError={error}
        onConfirm={(printedName, signatureDataUrl) => void apply({ action: "sign", role: signing, printedName, signatureDataUrl, attested: true,
          matrixHash: review.matrixHash }, () => setSigning(undefined))} />}
    </>}
  </main>;
}

async function readResponse(response: Response): Promise<StudioDishReviewView> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error?.message || "The dish review is unavailable.");
  return body;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : "The dish review is unavailable."; }
