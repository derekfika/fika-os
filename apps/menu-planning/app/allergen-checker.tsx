"use client";

import { useSearchParams } from "next/navigation";
import MenuPlanningShell from "./menu-planning-shell";
import PlanningContextNav from "./planning-context-nav";
import { useRollingData } from "./planner-data";
import { CANONICAL_ALLERGEN_COLUMNS, toggleOperationalAllergen, type CanonicalAllergenMap, type CanonicalAllergenKey } from "@/lib/fika-contracts";

function displayAllergenState(allergens: CanonicalAllergenMap, key: string): string {
  const state = allergens[key];
  if (state) return state;
  const namedAllergenPresent = Object.entries(allergens).some(([name, value]) => name !== "no_key_allergens" && value !== "clear");
  if (key === "no_key_allergens") return namedAllergenPresent ? "clear" : "contains";
  return "unrecorded";
}

const stateLabel: Record<string, string> = {
  unrecorded: "Not recorded",
  clear: "Clear",
  contains: "Contains",
  may_contain: "May contain",
};

const stateMark: Record<string, string> = {
  unrecorded: "?",
  clear: "✓",
  contains: "C",
  may_contain: "MC",
};

export default function AllergenChecker() {
  const { snapshot, weeks, error, message, command } = useRollingData({ loadCatalogue: false });
  const params = useSearchParams();
  if (!snapshot) return <MenuPlanningShell section="Allergen Checker"><div className="menu-loading">Loading Allergen Checker…</div></MenuPlanningShell>;
  const day = snapshot.days.find(item => item.date === params.get("day") || item.id === params.get("day")) || snapshot.days[0];
  const entries = snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim());
  const update = (entryId: string, allergens: CanonicalAllergenMap, notes?: string) => void command("update-entry", { weekId: snapshot.week.id, entryId, patch: { allergens, ...(notes !== undefined ? { mayContainNotes: notes } : {}) } });
  return <MenuPlanningShell section="Allergen Checker"><section className="workspace-intro planner-intro"><small>Delivered-In · {day.dayName}</small><h2>Allergen Checker</h2><p>Record the planned allergen information for CPU Production. Final review, approval and sign-off happen there. CPU performs the final independent safety check when the menu is materialised.</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} days={snapshot.days} showDay />{error && <div className="menu-error" role="alert">{error}</div>}{entries.length ? <section className="workspace-panel allergen-panel"><header className="allergen-panel-header"><div><small>Safety review</small><h3>Planned allergen states</h3></div>{message && <span className="allergen-save-state" role="status" aria-live="polite">{message}</span>}</header><div className="allergen-state-legend" aria-label="Allergen state legend"><span className="allergen-legend-item allergen-legend-item--unrecorded"><b aria-hidden="true">?</b> Not recorded</span><span className="allergen-legend-item allergen-legend-item--clear"><b aria-hidden="true">✓</b> Clear</span><span className="allergen-legend-item allergen-legend-item--contains"><b aria-hidden="true">C</b> Contains</span><span className="allergen-legend-item allergen-legend-item--may-contain"><b aria-hidden="true">MC</b> May contain</span></div><p className="allergen-matrix-hint">Select a cell to cycle its state. Not recorded is never treated as clear.</p><div className="table-wrap"><table className="operational-allergen-matrix"><caption className="sr-only">Allergen states for planned dishes on {day.dayName}</caption><thead><tr><th scope="col">Dish</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}<th scope="col">May contain notes</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><th scope="row">{entry.itemLabel}<small>{entry.slot}</small></th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => { const displayState = displayAllergenState(entry.allergens, key); return <td key={key}><button type="button" disabled={key === "no_key_allergens"} aria-label={`${entry.itemLabel}, ${label}: ${stateLabel[displayState]}`} title={displayState === "unrecorded" ? "Not recorded yet" : displayState === "clear" ? "Recorded clear" : stateLabel[displayState]} className={`allergen-cell allergen-cell--${displayState}`} onClick={() => void update(entry.id, toggleOperationalAllergen(entry.allergens, key as CanonicalAllergenKey))}>{stateMark[displayState]}</button></td>; })}<td><input aria-label={`May contain notes for ${entry.itemLabel}`} defaultValue={entry.mayContainNotes || ""} onBlur={event => void update(entry.id, entry.allergens, event.target.value)} /></td></tr>)}</tbody></table></div></section> : <section className="workspace-panel"><div className="empty-state"><h3>No menu planned for {day.dayName}.</h3><p>Choose dishes in Week Planner before checking allergens.</p><a className="button button-purple" href="/">Open Week Planner</a></div></section>}</MenuPlanningShell>;
}
