"use client";

import { useSearchParams } from "next/navigation";
import MenuPlanningShell from "./menu-planning-shell";
import PlanningContextNav from "./planning-context-nav";
import { useRollingData } from "./planner-data";
import { CANONICAL_ALLERGEN_COLUMNS, toggleOperationalAllergen, type CanonicalAllergenMap, type CanonicalAllergenKey } from "../../shared/allergen-contract";

export default function AllergenChecker() {
  const { snapshot, weeks, message, error, command } = useRollingData();
  const params = useSearchParams();
  if (!snapshot) return <MenuPlanningShell section="Allergen Checker"><div className="menu-loading">Loading Allergen Checker…</div></MenuPlanningShell>;
  const day = snapshot.days.find(item => item.date === params.get("day") || item.id === params.get("day")) || snapshot.days[0];
  const entries = snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemLabel.trim());
  const complete = (entry: typeof entries[number]) => CANONICAL_ALLERGEN_COLUMNS.every(([key]) => entry.allergens[key] === "clear" || entry.allergens[key] === "contains" || entry.allergens[key] === "may_contain");
  const update = (entryId: string, allergens: CanonicalAllergenMap, notes?: string) => void command("update-entry", { weekId: snapshot.week.id, entryId, patch: { allergens, ...(notes !== undefined ? { mayContainNotes: notes } : {}) } });
  const completedCount = entries.filter(complete).length;
  return <MenuPlanningShell section="Allergen Checker"><section className="workspace-intro planner-intro"><small>Delivered-In · {day.dayName}</small><h2>Allergen Checker</h2><p>{completedCount} / {entries.length} planned dishes complete. No Menu Planning signatures are required.</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} days={snapshot.days} showDay /><div className="planner-toolbar">{message && <span role="status">{message}</span>}</div>{error && <div className="menu-error" role="alert">{error}</div>}{entries.length ? <section className="workspace-panel allergen-panel"><div className="table-wrap"><table className="operational-allergen-matrix"><thead><tr><th>Dish</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}<th>Status</th><th>May contain notes</th></tr></thead><tbody>{entries.map(entry => <tr className={complete(entry) ? "" : "allergen-row--needs-review"} key={entry.id}><th>{entry.itemLabel}<small>{entry.slot}</small></th>{CANONICAL_ALLERGEN_COLUMNS.map(([key]) => { const state = entry.allergens[key] || "clear"; return <td key={key}><button aria-label={`${entry.itemLabel}, ${key}: ${state}`} className={`allergen-cell allergen-cell--${state}`} onClick={() => update(entry.id, toggleOperationalAllergen(entry.allergens, key as CanonicalAllergenKey))}>{state === "may_contain" ? "MC" : ""}</button></td>; })}<td className="allergen-status">{complete(entry) ? "Complete" : "Needs review"}</td><td><input aria-label={`May contain notes for ${entry.itemLabel}`} defaultValue={entry.mayContainNotes || ""} onBlur={event => update(entry.id, entry.allergens, event.target.value)} /></td></tr>)}</tbody></table></div></section> : <section className="workspace-panel"><div className="empty-state"><h3>No menu planned for {day.dayName}.</h3><p>Choose dishes in Week Planner before checking allergens.</p><a className="button button-purple" href="/">Open Week Planner</a></div></section>}</MenuPlanningShell>;
}
