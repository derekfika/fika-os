"use client";

import { readExplicitAllergens, storedExplicitAllergens, toggleExplicitAllergen } from "../../shared/allergen-declaration";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import MenuPlanningShell from "./menu-planning-shell";
import PlanningContextNav from "./planning-context-nav";
import { useRollingData } from "./planner-data";
import { CANONICAL_ALLERGEN_COLUMNS, type CanonicalAllergenMap, type CanonicalAllergenKey } from "@/lib/fika-contracts";
import { groupedSlots } from "../lib/week-planner-layout";
import { orderAllergenCheckerEntries } from "../lib/allergen-checker-order";

function displayAllergenState(allergens: CanonicalAllergenMap, key: string): string {
  if (key === "no_key_allergens") return allergens.no_key_allergens || "unrecorded";
  if (allergens[key]) return allergens[key];
  return "unrecorded";
}

const stateLabel: Record<string, string> = { unrecorded: "Not recorded", clear: "Clear", contains: "Contains", may_contain: "May contain" };
const stateMark: Record<string, string> = { may_contain: "MC" };
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
  const entries = useMemo(() => {
    if (!snapshot || !day) return [];
    const slotOrder = groupedSlots(snapshot).flatMap(([, slots]) => slots);
    return orderAllergenCheckerEntries(snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim()), slotOrder);
  }, [snapshot, day]);
  const draftFor = (entryId: string, entry: typeof entries[number]): AllergenDraft => drafts[entryId] || { allergens: storedExplicitAllergens(entry.allergens, { review: entry.allergenReview, declaration: entry.noKeyDeclaration }), mayContainNotes: entry.mayContainNotes || "", allergenDetailNotes: entry.allergenDetailNotes || "" };
  const editDraft = (entryId: string, entry: typeof entries[number], next: Partial<AllergenDraft>) => { const current = draftFor(entryId, entry); setDrafts(value => ({ ...value, [entryId]: { ...current, confirmReview: false, ...next, allergens: readExplicitAllergens(next.allergens || current.allergens) } })); setSavedMessage(""); };
  const saveChanges = async () => { if (!snapshot || saving || !dirty || recoveryErrors[storageKey]) return; setSaving(true); const updates = Object.entries(drafts).map(([entryId, draft]) => ({ entryId, dayId: snapshot.entries.find(entry => entry.id === entryId)?.dayId, patch: { allergens: draft.allergens, mayContainNotes: draft.mayContainNotes, allergenDetailNotes: draft.allergenDetailNotes, explicitAllergenDeclaration: true, confirmAllergenReview: draft.confirmReview === true } })); const ok = await command("batch-update-entries", { weekId: snapshot.week.id, expectedWeekVersion: snapshot.week.version, updates }); setSaving(false); if (ok) { setDrafts({}); setSavedMessage("Changes saved"); window.setTimeout(() => setSavedMessage(""), 1500); } };
  if (!snapshot || !day || !identity) return <MenuPlanningShell section="Allergen Checker"><div className="menu-loading">Loading Allergen Checker…</div></MenuPlanningShell>;
  return <MenuPlanningShell section="Allergen Checker"><section className="workspace-intro planner-intro"><small>Delivered-In · {day.dayName}</small><h2>Allergen Checker</h2><p>Record the planned allergen information for CPU Production. Final review, approval and sign-off happen there. CPU performs the final independent safety check when the menu is materialised.</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} days={snapshot.days} showDay />{error && <div className="menu-error" role="alert">{error}</div>}{storageError && <div className="menu-error" role="alert">{storageError}</div>}{recoveryErrors[storageKey] && <div className="menu-error" role="alert">{recoveryErrors[storageKey]} <button type="button" className="button button-soft" onClick={() => { setDrafts({}); setRecoveryErrors(value => ({ ...value, [storageKey]: "" })); }}>Discard recovered draft</button></div>}{entries.length ? <section className="workspace-panel allergen-panel"><header className="allergen-panel-header"><div><small>Safety review</small><h3>Planned allergen states</h3></div><div className="allergen-panel-actions">{(savedMessage || message) && <span className="allergen-save-state" role="status" aria-live="polite">{savedMessage || message}</span>}<button type="button" className="button button-purple" disabled={!dirty || saving || Boolean(recoveryErrors[storageKey])} onClick={() => void saveChanges()}>{saving ? "Saving…" : "Save allergen changes"}</button></div></header><div className="allergen-state-legend" aria-label="Allergen state legend"><span className="allergen-legend-item allergen-legend-item--contains"><b aria-hidden="true" /> Contains</span><span className="allergen-legend-item allergen-legend-item--may-contain"><b aria-hidden="true">MC</b> May contain</span><span className="allergen-legend-item allergen-legend-item--clear"><b aria-hidden="true" /> No declaration / clear</span><span className="allergen-legend-item allergen-legend-item--unrecorded"><b aria-hidden="true">UR</b> Not recorded</span></div><p className="allergen-matrix-hint">Select No Key Allergens deliberately, or cycle named allergens. Use Mark reviewed to confirm the row. Changes stay local until you save. Not recorded is never treated as clear.</p>{dirty && <p className="allergen-matrix-hint" role="status">You have unsaved allergen changes. Save before leaving this page.</p>}<div className="table-wrap"><table className="operational-allergen-matrix"><caption className="sr-only">Allergen states for planned dishes on {day.dayName}</caption><thead><tr><th scope="col">Dish</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}<th scope="col">Specific allergen details</th><th scope="col">May contain notes</th><th scope="col">Review</th></tr></thead><tbody>{entries.map(entry => { const draft = draftFor(entry.id, entry); return <tr key={entry.id} className={entry.isCoreSalad ? "core-salad-row" : undefined} style={entry.isCoreSalad ? { background: "var(--fika-status-success-surface)" } : undefined}><th scope="row">{entry.itemLabel}{entry.isCoreSalad && <span className="core-salad-label">CORE SALAD</span>}<small>{entry.slot}</small></th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => { const displayState = displayAllergenState(draft.allergens, key); return <td key={key}><button type="button" disabled={saving} aria-label={`${entry.itemLabel}, ${label}: ${stateLabel[displayState]}`} title={displayState === "unrecorded" ? "Not recorded yet" : displayState === "clear" ? "Recorded clear" : stateLabel[displayState]} className={`allergen-cell allergen-cell--${displayState}`} onClick={() => editDraft(entry.id, entry, { allergens: toggleExplicitAllergen(draft.allergens, key as CanonicalAllergenKey) })}>{stateMark[displayState] || null}</button></td>; })}<td><input aria-label={`Specific allergen details for ${entry.itemLabel}`} value={draft.allergenDetailNotes} disabled={saving} onChange={event => editDraft(entry.id, entry, { allergenDetailNotes: event.target.value })} /></td><td><input aria-label={`May contain notes for ${entry.itemLabel}`} value={draft.mayContainNotes} disabled={saving} onChange={event => editDraft(entry.id, entry, { mayContainNotes: event.target.value })} /></td><td><button type="button" className="button button-soft" disabled={saving} onClick={() => editDraft(entry.id, entry, { confirmReview: true })}>{draft.confirmReview ? "Review ready to save" : "Mark reviewed"}</button></td></tr>; })}</tbody></table></div></section> : <section className="workspace-panel"><div className="empty-state"><h3>No menu planned for {day.dayName}.</h3><p>Choose dishes in Week Planner before checking allergens.</p><a className="button button-purple" href="/">Open Week Planner</a></div></section>}</MenuPlanningShell>;
}
