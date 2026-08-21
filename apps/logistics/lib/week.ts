const dateKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function addOperationalDays(dateKey: string, days: number) {
  const match = dateKey.match(dateKeyPattern);
  if (!match) throw new Error(`Invalid operational date: ${dateKey}`);
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

export function mondayOf(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const weekday = date.getUTCDay();
  return addOperationalDays(dateKey, weekday === 0 ? -6 : 1 - weekday);
}

export function operationalWeek(dateKey: string) {
  const monday = mondayOf(dateKey);
  return Array.from({ length: 5 }, (_, index) =>
    addOperationalDays(monday, index),
  );
}

export function formatOperationalDate(
  dateKey: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    ...options,
  }).format(date);
}

export function formatWeekRange(weekCommencing: string) {
  const days = operationalWeek(weekCommencing);
  return `${formatOperationalDate(days[0], { day: "numeric", month: "short" })} — ${formatOperationalDate(days[4], { day: "numeric", month: "short" })}`;
}
