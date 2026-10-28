/**
 * Advisory theme-day contract for Menu Planning.
 *
 * Pure data rules only: date parsing, Europe/London day keys, annual recurrence,
 * duplicate suppression and local dismissal. Live Google Sheet synchronisation is
 * deliberately absent until Karol's Sheet, schema and credentials are supplied.
 * Nothing here creates dishes, changes menus, portions or publication state.
 */

export type ThemeDayScope = "uk" | "international" | "unspecified";

export type ThemeDayEvent = {
  id: string;
  occasion: string;
  /** Exact date for a one-off occasion, as YYYY-MM-DD. */
  date?: string;
  /** Annual occasions recur on this month and day, as MM-DD. */
  annualMonthDay?: string;
  scope: ThemeDayScope;
  notes?: string;
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accepts YYYY-MM-DD, and UK DD/MM/YYYY or DD-MM-YYYY. Rejects anything impossible or ambiguous. */
export function parseThemeDate(value: string): string | undefined {
  const trimmed = value.trim();
  const iso = DATE_KEY.exec(trimmed);
  const uk = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : uk ? [uk[3], uk[2], uk[1]] : [];
  if (!year || !month || !day) return undefined;
  const key = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key ? undefined : key;
}

/** The Europe/London calendar day for an instant, as YYYY-MM-DD. */
export function londonDateKey(at: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Whether a sync is due: at most one successful import per Europe/London day. */
export function syncDue(lastSyncedDateKey: string | undefined, at: Date = new Date()): boolean {
  return lastSyncedDateKey !== londonDateKey(at);
}

/** Occasions on one date, including annual recurrences, without duplicates and without dismissed items. */
export function occasionsForDate(events: readonly ThemeDayEvent[], dateKey: string, dismissed: ReadonlySet<string> = new Set()): ThemeDayEvent[] {
  const monthDay = dateKey.slice(5);
  const seen = new Set<string>();
  const matches: ThemeDayEvent[] = [];
  for (const event of events) {
    const matchesDate = event.date === dateKey || (event.annualMonthDay !== undefined && event.annualMonthDay === monthDay);
    if (!matchesDate || dismissed.has(event.id)) continue;
    const duplicateKey = `${event.occasion.trim().toLocaleLowerCase("en-GB")}|${event.scope}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    matches.push(event);
  }
  return matches.sort((a, b) => a.occasion.localeCompare(b.occasion, "en-GB"));
}

/** Dismissal is local advice only: it never changes the source Sheet. */
export function dismissOccasion(dismissed: ReadonlySet<string>, eventId: string): Set<string> {
  return new Set([...dismissed, eventId]);
}
