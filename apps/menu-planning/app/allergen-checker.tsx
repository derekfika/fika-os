"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import MenuPlanningShell from "./menu-planning-shell";
import PlanningContextNav from "./planning-context-nav";
import { useRollingData } from "./planner-data";
import { CANONICAL_ALLERGEN_COLUMNS, deriveNoKeyAllergens, normaliseOperationalAllergens, toggleOperationalAllergen, type CanonicalAllergenMap, type CanonicalAllergenKey } from "@/lib/fika-contracts";

function displayAllergenState(allergens: CanonicalAllergenMap, key: string): string {
  if (key === "no_key_allergens") return deriveNoKeyAllergens(allergens).no_key_allergens;
  if (allergens[key]) return allergens[key];
  return "unrecorded";
}

const stateLabel: Record<string, string> = { unrecorded: "Not recorded", clear: "Clear", contains: "Contains", may_contain: "May contain" };
const stateMark: Record<string, string> = { may_contain: "MC", unrecorded: "UR" };
type AllergenDraft = { allergens: CanonicalAllergenMap; mayContainNotes: string };

export default function AllergenChecker() {
  const { snapshot, weeks, error, message, command } = useRollingData({ loadCatalogue: false });
  const params = useSearchParams();
  const [drafts, setDrafts] = useState<Record<string, AllergenDraft>>({});
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => { if (!dirty) setSavedMessage(""); }, [snapshot?.week.id, params, dirty]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const day = snapshot ? snapshot.days.find(item => item.date === params.get("day") || item.id === params.get("day")) || snapshot.days[0] : undefined;
  const entries = useMemo(() => snapshot && day ? snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim()) : [], [snapshot, day]);
  const draftFor = (entryId: string, entry: typeof entries[number]): AllergenDraft => drafts[entryId] || { allergens: entry.allergens, mayContainNotes: entry.mayContainNotes || "" };
  const editDraft = (entryId: string, entry: typeof entries[number], next: Partial<AllergenDraft>) => { const current = draftFor(entryId, entry); setDrafts(value => ({ ...value, [entryId]: { ...current, ...next, allergens: deriveNoKeyAllergens(normaliseOperationalAllergens(next.allergens || current.allergens)) } })); setSavedMessage(""); };
  const saveChanges = async () => { if (!snapshot || saving || !dirty) return; setSaving(true); const updates = Object.entries(drafts).map(([entryId, draft]) => ({ entryId, dayId: entries.find(entry => entry.id === entryId)?.dayId, patch: { allergens: draft.allergens, mayContainNotes: draft.mayContainNotes, allergenReviewInvalidated: false } })); const ok = await command("batch-update-entries", { weekId: snapshot.week.id, expectedWeekVersion: snapshot.week.version, updates }); setSaving(false); if (ok) { setDrafts({}); setSavedMessage("Changes saved"); window.setTimeout(() => setSavedMessage(""), 1500); } };
  if (!snapshot || !day) return <MenuPlanningShell section="Allergen Checker"><div className="menu-loading">Loading Allergen Checker…</div></MenuPlanningShell>;
  return <MenuPlanningShell section="Allergen Checker"><section className="workspace-intro planner-intro"><small>Delivered-In · {day.dayName}</small><h2>Allergen Checker</h2><p>Record the planned allergen information for CPU Production. Final review, approval and sign-off happen there. CPU performs the final independent safety check when the menu is materialised.</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} days={snapshot.days} showDay />{error && <div className="menu-error" role="alert">{error}</div>}{entries.length ? <section className="workspace-panel allergen-panel"><header className="allergen-panel-header"><div><small>Safety review</small><h3>Planned allergen states</h3></div><div className="allergen-panel-actions">{(savedMessage || message) && <span className="allergen-save-state" role="status" aria-live="polite">{savedMessage || message}</span>}<button type="button" className="button button-purple" disabled={!dirty || saving} onClick={() => void saveChanges()}>{saving ? "Saving…" : "Save allergen changes"}</button></div></header><div className="allergen-state-legend" aria-label="Allergen state legend"><span className="allergen-legend-item allergen-legend-item--contains"><b aria-hidden="true" /> Contains</span><span className="allergen-legend-item allergen-legend-item--may-contain"><b aria-hidden="true">MC</b> May contain</span><span className="allergen-legend-item allergen-legend-item--clear"><b aria-hidden="true" /> No declaration / clear</span><span className="allergen-legend-item allergen-legend-item--unrecorded"><b aria-hidden="true">UR</b> Not recorded</span></div><p className="allergen-matrix-hint">Select a cell to cycle its state. Changes stay local until you save. Not recorded is never treated as clear.</p>{dirty && <p className="allergen-matrix-hint" role="status">You have unsaved allergen changes. Save before leaving this page.</p>}<div className="table-wrap"><table className="operational-allergen-matrix"><caption className="sr-only">Allergen states for planned dishes on {day.dayName}</caption><thead><tr><th scope="col">Dish</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}<th scope="col">May contain notes</th></tr></thead><tbody>{entries.map(entry => { const draft = draftFor(entry.id, entry); return <tr key={entry.id}><th scope="row">{entry.itemLabel}<small>{entry.slot}</small></th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => { const displayState = displayAllergenState(draft.allergens, key); return <td key={key}><button type="button" disabled={saving || key === "no_key_allergens"} aria-label={`${entry.itemLabel}, ${label}: ${stateLabel[displayState]}`} title={displayState === "unrecorded" ? "Not recorded yet" : displayState === "clear" ? "Recorded clear" : stateLabel[displayState]} className={`allergen-cell allergen-cell--${displayState}`} onClick={() => editDraft(entry.id, entry, { allergens: toggleOperationalAllergen(draft.allergens, key as CanonicalAllergenKey) })}>{stateMark[displayState] || null}</button></td>; })}<td><input aria-label={`May contain notes for ${entry.itemLabel}`} value={draft.mayContainNotes} disabled={saving} onChange={event => editDraft(entry.id, entry, { mayContainNotes: event.target.value })} /></td></tr>; })}</tbody></table></div></section> : <section className="workspace-panel"><div className="empty-state"><h3>No menu planned for {day.dayName}.</h3><p>Choose dishes in Week Planner before checking allergens.</p><a className="button button-purple" href="/">Open Week Planner</a></div></section>}</MenuPlanningShell>;
}
