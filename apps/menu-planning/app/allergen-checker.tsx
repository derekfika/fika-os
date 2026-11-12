"use client";

import { declareNoKey, isNoKeyDeclared, readExplicitAllergens, rowReviewStatus, storedExplicitAllergens, toggleExplicitAllergen, withdrawNoKey } from "../../shared/allergen-declaration";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import MenuPlanningShell from "./menu-planning-shell";
import PlanningContextNav from "./planning-context-nav";
import { useRollingData } from "./planner-data";
import { CANONICAL_ALLERGEN_COLUMNS, type CanonicalAllergenMap, type CanonicalAllergenKey } from "@/lib/fika-contracts";
import { groupAllergenCheckerEntries, occurrenceLabels } from "@/lib/allergen-checker-order";

function displayAllergenState(allergens: CanonicalAllergenMap, key: string): string {
  if (key === "no_key_allergens") return allergens.no_key_allergens || "unrecorded";
  if (allergens[key]) return allergens[key];
  return "unrecorded";
}

const stateLabel: Record<string, string> = { unrecorded: "Not recorded", clear: "Clear", contains: "Contains", may_contain: "May contain" };
const stateMark: Record<string, string> = { unrecorded: "NR", clear: "✓", contains: "C", may_contain: "MC" };
type AllergenDraft = { allergens: CanonicalAllergenMap; mayContainNotes: string; allergenDetailNotes: string; confirmReview?: boolean };

export default function AllergenChecker() {
  const { snapshot, weeks, identity, error, message, command } = useRollingData({ loadCatalogue: false });
  const params = useSearchParams();
  const [draftsByWeek, setDraftsByWeek] = useState<Record<string, Record<string, AllergenDraft>>>({});
  const storageKey = snapshot && identity && typeof window !== "undefined" ? `fika-allergen-draft:v1:${encodeURIComponent(window.location.origin)}:${encodeURIComponent(identity)}:${encodeURIComponent(snapshot.week.id)}` : "";
  const drafts = draftsByWeek[storageKey] || {};
  const hydratedKeys = useRef(new Set<string>());
  const draftsRef = useRef(draftsByWeek);
  const recoveryBases = useRef<Record<string, Record<string, string>>>({});
  const [recoveryErrors, setRecoveryErrors] = useState<Record<string, string>>({});
  const [interactionErrors, setInteractionErrors] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState("");
  const material = (entry: NonNullable<typeof snapshot>["entries"][number]) => JSON.stringify([entry.itemId, entry.itemLabel, Object.entries(storedExplicitAllergens(entry.allergens, { review: entry.allergenReview, declaration: entry.noKeyDeclaration })).sort(([a], [b]) => a.localeCompare(b)), entry.mayContainNotes || "", entry.allergenDetailNotes || "", entry.allergenReview || null]);
  const recoveryConflictMessage = "A newer edit changed the recovered allergen rows. Saving is blocked. Copy any text you need to retain, then discard this recovered draft and re-enter against the current menu.";
  const draftMatchesEntry = (draft: AllergenDraft, entry: NonNullable<typeof snapshot>["entries"][number]) => {
    const saved = storedExplicitAllergens(entry.allergens, { review: entry.allergenReview, declaration: entry.noKeyDeclaration });
    return JSON.stringify(Object.entries(saved).sort()) === JSON.stringify(Object.entries(draft.allergens).sort()) && (entry.mayContainNotes || "") === draft.mayContainNotes && (entry.allergenDetailNotes || "") === draft.allergenDetailNotes && (!draft.confirmReview || entry.allergenReview?.semantics === 3);
  };
  useEffect(() => {
    if (!snapshot || !storageKey) return;
    if (hydratedKeys.current.has(storageKey)) {
      const active = draftsRef.current[storageKey] || {};
      if (Object.keys(active).some(id => { const entry = snapshot.entries.find(row => row.id === id); return !entry || (recoveryBases.current[storageKey]?.[id] !== material(entry) && !draftMatchesEntry(active[id], entry)); })) setRecoveryErrors(value => ({ ...value, [storageKey]: recoveryConflictMessage }));
      return;
    }
    hydratedKeys.current.add(storageKey);
    try {
      const recovered = JSON.parse(window.localStorage.getItem(storageKey) || "null") as { schema?: number; bases?: Record<string, string>; drafts?: Record<string, AllergenDraft> } | null;
      if (!recovered || recovered.schema !== 1 || !recovered.bases || !recovered.drafts) return;
      const retained: Record<string, AllergenDraft> = {};
      let conflict = false;
      for (const [id, draft] of Object.entries(recovered.drafts)) {
        const entry = snapshot.entries.find(row => row.id === id);
        if (!draft || typeof draft.allergens !== "object" || typeof draft.mayContainNotes !== "string" || typeof draft.allergenDetailNotes !== "string") throw new Error("The recovered draft is invalid.");
        const alreadySaved = entry && draftMatchesEntry(draft, entry);
        if (alreadySaved) continue;
        retained[id] = draft;
        if (!entry || recovered.bases[id] !== material(entry)) conflict = true;
      }
      recoveryBases.current[storageKey] = Object.fromEntries(Object.keys(retained).map(id => [id, recovered.bases![id]]));
      draftsRef.current = { ...draftsRef.current, [storageKey]: retained };
      setDraftsByWeek(draftsRef.current);
      if (!Object.keys(retained).length) window.localStorage.removeItem(storageKey);
      if (conflict) setRecoveryErrors(value => ({ ...value, [storageKey]: recoveryConflictMessage }));
    } catch { setStorageError("The browser could not recover this allergen draft. Keep a copy of unsaved text before leaving."); }
  }, [storageKey, snapshot]);
  const setDrafts = (update: Record<string, AllergenDraft> | ((value: Record<string, AllergenDraft>) => Record<string, AllergenDraft>)) => {
    const next = typeof update === "function" ? update(draftsRef.current[storageKey] || {}) : update;
    const bases = Object.keys(next).length ? recoveryBases.current[storageKey] || {} : {};
    for (const id of Object.keys(next)) { const entry = snapshot?.entries.find(row => row.id === id); if (!bases[id] && entry) bases[id] = material(entry); }
    recoveryBases.current[storageKey] = bases;
    try {
      if (!Object.keys(next).length) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify({ schema: 1, bases, drafts: next }));
    } catch { setStorageError("The browser could not preserve this allergen draft. Keep a copy of unsaved text before leaving."); }
    draftsRef.current = { ...draftsRef.current, [storageKey]: next };
    setDraftsByWeek(draftsRef.current);
  };
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => { if (!dirty) setSavedMessage(""); }, [snapshot?.week.id, params, dirty]);
  const anyDirty = Object.values(draftsByWeek).some(value => Object.keys(value).length > 0);
  useEffect(() => { if (!anyDirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [anyDirty]);
  const day = snapshot ? snapshot.days.find(item => item.date === params.get("day") || item.id === params.get("day")) || snapshot.days[0] : undefined;
  const entries = useMemo(() => snapshot && day ? snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim()) : [], [snapshot, day]);
  const groups = useMemo(() => groupAllergenCheckerEntries(entries), [entries]);
  const occurrences = useMemo(() => occurrenceLabels(entries), [entries]);
  const draftFor = (entryId: string, entry: typeof entries[number]): AllergenDraft => drafts[entryId] || { allergens: storedExplicitAllergens(entry.allergens, { review: entry.allergenReview, declaration: entry.noKeyDeclaration }), mayContainNotes: entry.mayContainNotes || "", allergenDetailNotes: entry.allergenDetailNotes || "" };
  const editDraft = (entryId: string, entry: typeof entries[number], next: Partial<AllergenDraft>) => { const current = draftFor(entryId, entry); setDrafts(value => ({ ...value, [entryId]: { ...current, confirmReview: false, ...next, allergens: readExplicitAllergens(next.allergens || current.allergens) } })); setSavedMessage(""); };
  const toggleAllergen = (entryId: string, entry: typeof entries[number], key: CanonicalAllergenKey) => {
    const current = draftFor(entryId, entry);
    if (key === "no_key_allergens") {
      if (isNoKeyDeclared(current.allergens)) {
        setInteractionErrors(value => ({ ...value, [entryId]: "" }));
        editDraft(entryId, entry, { allergens: withdrawNoKey(current.allergens) });
        return;
      }
      const result = declareNoKey(current.allergens);
      if (!result.ok) {
        setInteractionErrors(value => ({ ...value, [entryId]: "No Key Allergens conflicts with recorded Contains or May Contain values. Nothing was changed; resolve those named declarations before selecting No Key." }));
        return;
      }
      setInteractionErrors(value => ({ ...value, [entryId]: "" }));
      editDraft(entryId, entry, { allergens: result.allergens });
      return;
    }
    setInteractionErrors(value => ({ ...value, [entryId]: "" }));
    editDraft(entryId, entry, { allergens: toggleExplicitAllergen(current.allergens, key) });
  };
  const reviewLabel = (entry: typeof entries[number]) => {
    if (drafts[entry.id]?.confirmReview) return "Ready to save";
    const draft = draftFor(entry.id, entry);
    const status = rowReviewStatus({ allergens: draft.allergens, review: entry.allergenReview, declaration: entry.noKeyDeclaration, identity: entry.itemLabel, mayContainNotes: draft.mayContainNotes, allergenDetailNotes: draft.allergenDetailNotes });
    return status === "checked" ? "Reviewed" : status === "checked_legacy" ? "Reviewed · legacy" : status === "conflict" ? "Conflicting declarations" : "Needs review";
  };
  const isReviewed = (entry: typeof entries[number]) => reviewLabel(entry).startsWith("Reviewed") || reviewLabel(entry) === "Ready to save";
  const reviewedCount = entries.filter(isReviewed).length;
  const saveChanges = async () => { if (!snapshot || saving || !dirty || recoveryErrors[storageKey]) return; setSaving(true); const updates = Object.entries(drafts).map(([entryId, draft]) => ({ entryId, dayId: snapshot.entries.find(entry => entry.id === entryId)?.dayId, patch: { allergens: draft.allergens, mayContainNotes: draft.mayContainNotes, allergenDetailNotes: draft.allergenDetailNotes, explicitAllergenDeclaration: true, confirmAllergenReview: draft.confirmReview === true } })); const ok = await command("batch-update-entries", { weekId: snapshot.week.id, expectedWeekVersion: snapshot.week.version, updates }); setSaving(false); if (ok) { setDrafts({}); setSavedMessage("Changes saved"); window.setTimeout(() => setSavedMessage(""), 1500); } };
  if (!snapshot || !day || !identity) return <MenuPlanningShell section="Allergen Checker"><div className="menu-loading">Loading Allergen Checker…</div></MenuPlanningShell>;
  return <MenuPlanningShell section="Allergen Checker"><section className="workspace-intro planner-intro"><small>Delivered-In · {day.dayName}</small><h2>Allergen Checker</h2><p>Record the planned allergen information for CPU Production. Final review, approval and sign-off happen there. CPU performs the final independent safety check when the menu is materialised.</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} days={snapshot.days} showDay />{error && <div className="menu-error" role="alert">{error}</div>}{storageError && <div className="menu-error" role="alert">{storageError}</div>}{recoveryErrors[storageKey] && <div className="menu-error" role="alert">{recoveryErrors[storageKey]} <button type="button" className="button button-soft" onClick={() => { setDrafts({}); setRecoveryErrors(value => ({ ...value, [storageKey]: "" })); }}>Discard recovered draft</button></div>}{entries.length ? <section className="workspace-panel allergen-panel"><header className="allergen-panel-header"><div><small>Planned menu · {entries.length} dishes</small><h3>Allergen review</h3></div><div className="allergen-panel-actions">{(savedMessage || message) && <span className="allergen-save-state" role="status" aria-live="polite">{savedMessage || message}</span>}<button type="button" className="button button-purple" disabled={!dirty || saving || Boolean(recoveryErrors[storageKey])} onClick={() => void saveChanges()}>{saving ? "Saving…" : "Save allergen changes"}</button></div></header><div className="allergen-day-progress" role="status" aria-label={`${reviewedCount} of ${entries.length} dishes reviewed`}><span><strong>{reviewedCount} of {entries.length}</strong> reviewed</span><progress value={reviewedCount} max={entries.length} aria-label={`${day.dayName} allergen review progress`} /></div><div className="allergen-state-legend" aria-label="Allergen state legend"><span><b>C</b> Contains</span><span><b>MC</b> May contain</span><span><b>✓</b> Recorded clear</span><span><b>NR</b> Not recorded</span></div><p className="allergen-matrix-hint">Select No Key Allergens deliberately, or cycle named allergens. Mark a row reviewed only after checking it. Changes stay local until you save. Not recorded is never treated as clear. CPU approval and sign-off remain separate.</p>{dirty && <p className="allergen-matrix-hint" role="status">You have unsaved allergen changes. Save before leaving this page.</p>}{groups.map((group, groupIndex) => <details className="allergen-category" key={group.id} open={groupIndex === 0}><summary><span>{group.label}</span><span>{group.entries.length} {group.entries.length === 1 ? "dish" : "dishes"}</span><span>{group.entries.filter(isReviewed).length} reviewed · {group.entries.length - group.entries.filter(isReviewed).length} to review</span></summary><div className="table-wrap allergen-table-wrap" tabIndex={0} aria-label={`${group.label} allergen matrix; scroll with arrow keys and use Tab to move through controls`}><table className="operational-allergen-matrix"><caption className="sr-only">{group.label} allergen states for {day.dayName}</caption><thead><tr><th scope="col">Dish / slot</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}<th scope="col">Specific allergen details</th><th scope="col">May contain notes</th><th scope="col">Review status</th></tr></thead><tbody>{group.entries.map(entry => { const draft = draftFor(entry.id, entry); const status = reviewLabel(entry); const occurrence = occurrences.get(entry.id); return <tr key={entry.id} className={entry.isCoreSalad ? "core-salad-row" : undefined}><th id={`allergen-row-${entry.id}`} scope="row">{entry.itemLabel}{entry.isCoreSalad && <span className="core-salad-label">Core salad</span>}<small>{entry.slot}{occurrence ? ` · ${occurrence}` : ""}</small></th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => { const displayState = displayAllergenState(draft.allergens, key); return <td key={key}><button type="button" disabled={saving} aria-describedby={`allergen-row-${entry.id}`} aria-label={`${entry.itemLabel}, ${label}: ${stateLabel[displayState]}`} title={`${label}: ${stateLabel[displayState]}`} className={`allergen-cell allergen-cell--${displayState}`} onClick={() => toggleAllergen(entry.id, entry, key as CanonicalAllergenKey)}>{stateMark[displayState]}</button></td>; })}<td><input aria-label={`Specific allergen details for ${entry.itemLabel}`} aria-describedby={`allergen-row-${entry.id}`} value={draft.allergenDetailNotes} disabled={saving} onChange={event => editDraft(entry.id, entry, { allergenDetailNotes: event.target.value })} /></td><td><input aria-label={`May contain notes for ${entry.itemLabel}`} aria-describedby={`allergen-row-${entry.id}`} value={draft.mayContainNotes} disabled={saving} onChange={event => editDraft(entry.id, entry, { mayContainNotes: event.target.value })} /></td><td><span className={`allergen-review-status ${status.startsWith("Reviewed") || status === "Ready to save" ? "is-reviewed" : "needs-review"}`} role="status" aria-label={status}>{status}</span><button type="button" className="button button-soft" disabled={saving} aria-describedby={`allergen-row-${entry.id}`} onClick={() => editDraft(entry.id, entry, { confirmReview: true })}>{draft.confirmReview ? "Ready to save" : "Mark reviewed"}</button>{interactionErrors[entry.id] && <span className="allergen-row-error" role="alert">{interactionErrors[entry.id]}</span>}</td></tr>; })}</tbody></table></div></details>)}</section> : <section className="workspace-panel"><div className="empty-state"><h3>No menu planned for {day.dayName}.</h3><p>Choose dishes in Week Planner before checking allergens.</p><a className="button button-purple" href="/">Open Week Planner</a></div></section>}</MenuPlanningShell>;
}
