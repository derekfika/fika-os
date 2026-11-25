import type { RollingDay, RollingWeek } from "@/lib/rolling-menu-types";

type MenuWeek = Pick<RollingWeek, "id" | "weekCommencing" | "supplementaryMenu">;

export function DayMenuSelect({ weeks, current, day, onSelect }: {
  weeks: MenuWeek[];
  current: MenuWeek;
  day: Pick<RollingDay, "dayName" | "date">;
  onSelect: (id: string) => void;
}) {
  const sameWeek = weeks.filter(week => week.weekCommencing === current.weekCommencing);
  const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7;
  const additional = sameWeek.filter(({ supplementaryMenu: menu }) =>
    menu && (menu.serviceDate ? menu.serviceDate === day.date : menu.recurrenceWeekdays?.includes(weekday)),
  );
  if (!additional.length) return null;
  const main = current.supplementaryMenu ? sameWeek.find(week => !week.supplementaryMenu) : current;
  // A week can have supplementary services before the main draft is first saved.
  const mainId = main?.id ?? `rolling-week:${current.weekCommencing}`;
  const selected = !current.supplementaryMenu || additional.some(week => week.id === current.id) ? current.id : "";

  return <label className="supplementary-menu-select">
    <span className="sr-only">Menu for {day.dayName}</span>
    <select aria-label={`Menu for ${day.dayName}`} value={selected} onChange={event => onSelect(event.target.value)}>
      {!selected && <option value="" disabled>Choose menu</option>}
      <option value={mainId}>Main menu</option>
      {additional.map(week => <option key={week.id} value={week.id}>{week.supplementaryMenu!.name} · {week.supplementaryMenu!.serviceType}</option>)}
    </select>
  </label>;
}
