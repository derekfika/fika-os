const londonCalendar = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Converts an instant into the UK business date. */
export function hospitalityMenuDate(now = new Date()) {
  const parts = londonCalendar.formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function hospitalityCalendarDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : NaN;
}

/** Both arguments are London calendar dates, so a DST change cannot shorten a week. */
export function hospitalityRotationWeek(anchorMonday: string, eventDate: string, cycleWeeks: number) {
  const weeks = Math.floor((hospitalityCalendarDay(eventDate) - hospitalityCalendarDay(anchorMonday)) / 604_800_000);
  return ((weeks % cycleWeeks) + cycleWeeks) % cycleWeeks + 1;
}
