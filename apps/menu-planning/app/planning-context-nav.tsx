"use client";
import { usePathname, useSearchParams } from "next/navigation";
import type { RollingDay, SupplementaryMenuContext } from "@/lib/rolling-menu-types";
type Week = { id: string; weekCommencing: string; entryIds?: readonly string[]; supplementaryMenu?: SupplementaryMenuContext };
const humanDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const shortDay = (day: RollingDay) => <><strong>{day.dayName.slice(0, 3).toUpperCase()}</strong><span>{new Date(`${day.date}T12:00:00Z`).getUTCDate()}</span></>;
export function menuWeeksForPlanner(weeks: Week[], currentWeek: string) {
  const current = weeks.find(week => week.id === currentWeek);
  if (!current) return [];
  return weeks.filter(week => week.weekCommencing === current.weekCommencing).sort((left, right) => {
    if (!left.supplementaryMenu) return right.supplementaryMenu ? -1 : 0;
    if (!right.supplementaryMenu) return 1;
    return left.supplementaryMenu.name.localeCompare(right.supplementaryMenu.name)
      || left.supplementaryMenu.id.localeCompare(right.supplementaryMenu.id);
  });
}
export function preserveMenuSelectionForWeekNavigation(weeks: Week[], currentWeekId: string, targetWeekId: string) {
  const current = weeks.find(week => week.id === currentWeekId);
  const target = weeks.find(week => week.id === targetWeekId);
  if (!current?.supplementaryMenu || !target) return target || current;
  return weeks.find(week => week.weekCommencing === target.weekCommencing && week.supplementaryMenu?.id === current.supplementaryMenu?.id) || target;
}
export default function PlanningContextNav({ weeks, currentWeek, days, showDay = false, showMenuSelector = false, onSelectWeek }: { weeks: Week[]; currentWeek: string; days?: RollingDay[]; showDay?: boolean; showMenuSelector?: boolean; onSelectWeek?: (weekId: string) => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = weeks.find(week => week.id === currentWeek);
  const navigationWeeks = weeks.filter(week => !week.supplementaryMenu).sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing));
  if (current && !navigationWeeks.some(week => week.id === current.id)) {
    navigationWeeks.push(current);
    navigationWeeks.sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing));
  }
  const index = navigationWeeks.findIndex(week => week.id === currentWeek);
  const week = current || navigationWeeks[index];
  const selectedDayIndex = days?.length ? Math.max(0, days.findIndex(day => day.date === params.get("day") || day.id === params.get("day"))) : 0;
  const navigate = (weekId: string, day?: string) => {
    if (!showDay) {
      const selectedWeekId = preserveMenuSelectionForWeekNavigation(weeks, currentWeek, weekId)?.id || weekId;
      if (onSelectWeek) onSelectWeek(selectedWeekId);
      else window.dispatchEvent(new CustomEvent("menu-week-select", { detail: selectedWeekId }));
      return;
    }
    const next = new URLSearchParams(params.toString());
    const target = preserveMenuSelectionForWeekNavigation(weeks, currentWeek, weekId);
    if (target) next.set("week", target.supplementaryMenu ? target.id : target.weekCommencing);
    else next.delete("week");
    if (days?.length) {
      const targetDate = new Date(`${target?.weekCommencing || days[0].date}T00:00:00Z`);
      targetDate.setUTCDate(targetDate.getUTCDate() + selectedDayIndex);
      next.set("day", day || targetDate.toISOString().slice(0, 10));
    }
    window.history.pushState({}, "", `${pathname}${next.toString() ? `?${next}` : ""}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const changeDay = (day: string) => { const next = new URLSearchParams(params.toString()); next.set("day", day); if (week) next.set("week", week.supplementaryMenu ? week.id : week.weekCommencing); window.history.pushState({}, "", `${pathname}?${next}`); window.dispatchEvent(new PopStateEvent("popstate")); };
  const menuOptions = showMenuSelector && week ? menuWeeksForPlanner(weeks, week.id) : [];
  return <section className="planning-context" aria-label="Planning context">
    <div className="planning-week-nav">
      <button className="context-arrow" aria-label="Previous week" disabled={index <= 0} onClick={() => index > 0 && navigate(navigationWeeks[index - 1].id)}>←</button>
      <strong>WC {week ? humanDate(week.weekCommencing) : "—"}</strong>
      <button className="context-arrow" aria-label="Next week" disabled={index < 0 || index >= navigationWeeks.length - 1} onClick={() => index >= 0 && index < navigationWeeks.length - 1 && navigate(navigationWeeks[index + 1].id)}>→</button>
    </div>
    {showMenuSelector && menuOptions.length > 1 && <label className="planning-menu-select"><span>Menu</span><select aria-label="Menu" value={currentWeek} onChange={event => navigate(event.target.value)}>{menuOptions.map(item => <option key={item.id} value={item.id}>{item.supplementaryMenu ? `${item.supplementaryMenu.name} · ${item.supplementaryMenu.serviceType}` : "Main Lunch"}</option>)}</select></label>}
    {showMenuSelector && <button className="button button-purple" type="button" onClick={() => window.dispatchEvent(new CustomEvent("menu-create-supplementary"))}>Create menu</button>}
    {showDay && days?.length ? <nav className="planning-days" aria-label="Planning days">{days.slice(0, 5).map(day => <button key={day.id} className={params.get("day") === day.date || (!params.get("day") && day.id === days[0].id) ? "active" : ""} onClick={() => changeDay(day.date)}>{shortDay(day)}</button>)}</nav> : null}
  </section>;
}
