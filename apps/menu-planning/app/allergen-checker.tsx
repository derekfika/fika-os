"use client";

import { useSearchParams } from "next/navigation";
import MenuPlanningShell from "./menu-planning-shell";
import PlanningContextNav from "./planning-context-nav";
import { useRollingData } from "./planner-data";
import { CANONICAL_ALLERGEN_COLUMNS, toggleOperationalAllergen, type CanonicalAllergenMap, type CanonicalAllergenKey } from "@/lib/fika-contracts";

export default function AllergenChecker() {
  const { snapshot, weeks, error, command } = useRollingData({ loadCatalogue: false });
  const params = useSearchParams();
  if (!snapshot) return <MenuPlanningShell section="Allergen Checker"><div className="menu-loading">Loading Allergen Checker…</div></MenuPlanningShell>;
  const day = snapshot.days.find(item => item.date === params.get("day") || item.id === params.get("day")) || snapshot.days[0];
  const entries = snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim());
  const update = (entryId: string, allergens: CanonicalAllergenMap, notes?: string) => void command("update-entry", { weekId: snapshot.week.id, entryId, patch: { allergens, ...(notes !== undefined ? { mayContainNotes: notes } : {}) } });
  return <MenuPlanningShell section="Allergen Checker"><section className="workspace-intro planner-intro"><small>Delivered-In · {day.dayName}</small><h2>Allergen Checker</h2><p>Mark and sign off the planned allergen information here for CPU Production. CPU performs the final independent safety check when the menu is materialised.</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} days={snapshot.days} showDay />{error && <div className="menu-error" role="alert">{error}</div>}{entries.length ? <section className="workspace-panel allergen-panel"><div className="table-wrap"><table className="operational-allergen-matrix"><thead><tr><th>Dish</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}<th>May contain notes</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><th>{entry.itemLabel}<small>{entry.slot}</small></th>{CANONICAL_ALLERGEN_COLUMNS.map(([key]) => { const recorded = Object.prototype.hasOwnProperty.call(entry.allergens, key); const state = entry.allergens[key]; const displayState = recorded ? state : "unrecorded" as const; return <td key={key}><button aria-label={`${entry.itemLabel}, ${key}: ${displayState}`} title={displayState === "unrecorded" ? "Not recorded yet" : displayState === "clear" ? "Recorded clear" : displayState} className={`allergen-cell allergen-cell--${displayState}`} onClick={() => update(entry.id, toggleOperationalAllergen(entry.allergens, key as CanonicalAllergenKey))}>{displayState === "may_contain" ? "MC" : ""}</button></td>; })}<td><input aria-label={`May contain notes for ${entry.itemLabel}`} defaultValue={entry.mayContainNotes || ""} onBlur={event => update(entry.id, entry.allergens, event.target.value)} /></td></tr>)}</tbody></table></div></section> : <section className="workspace-panel"><div className="empty-state"><h3>No menu planned for {day.dayName}.</h3><p>Choose dishes in Week Planner before checking allergens.</p><a className="button button-purple" href="/">Open Week Planner</a></div></section>}</MenuPlanningShell>;
}
