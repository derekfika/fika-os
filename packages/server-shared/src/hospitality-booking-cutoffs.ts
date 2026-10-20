/** Canonical booking-date policy. Pure: callers supply trusted catalogue metadata and a clock. */
export const BOOKING_NOTICE = "Orders require two preparation days before 12 noon, or three from 12 noon (Europe/London). Saturday is excluded from preparation; Sunday counts. Deliveries are Monday to Friday. Some items require longer notice.";
/** Compatibility for existing consumers; the minimum now applies to every booking. */
export const SANDWICH_NOTICE = BOOKING_NOTICE;
export type BookingPolicy = { sandwich?: boolean; fridayUnavailable?: boolean };
export type CutoffItem = { id: string; bookingPolicy?: BookingPolicy; routing?: string; noticeRequiredDays?: number; rules?: { noticeHours?: number }; configuration?: { rules?: { noticeHours?: number } } };
export type CutoffContext = { site?: string; occasion?: string; startTime?: string; allowedDeliveryDays?: readonly number[] };
export type CutoffIssue = { code: string; message: string; earliestDate?: string };

// Stable source IDs, including verified legacy aliases. No product-name matching.
const sandwichIds = new Set(["deli_sandwich_lunch", "deli_working_lunch", "deli-style-sandwich", "deli-sandwich-lunch", "individual_boxed_lunch", "individual-boxed-lunch", "afternoon_tea", "afternoon-tea", "bagel_box", "bagel-box", "filled_savoury_croissant", "filled-savoury-croissant", "vegan_savoury_croissant", "vegan-savoury-croissant", "classic_working_lunch"]);
const rollIds = new Set(["rice_paper_rolls", "rice-paper-rolls", "summer_rolls", "summer-rolls"]);
export function bookingPolicyFor(id: string, routing?: string, aliases: readonly string[] = []): BookingPolicy {
  const sources = [id, ...aliases].map(value => value.split(":").pop()!);
  return { sandwich: routing === "cpu_sandwiches" || routing === "sandwiches" || sources.some(source => sandwichIds.has(source)), fridayUnavailable: sources.some(source => rollIds.has(source)) };
}
function day(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid delivery date.");
  const result = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error("Choose a valid delivery date.");
  return result;
}
export function addBusinessDate(value: string, count = 1): string { const result = day(value); result.setUTCDate(result.getUTCDate() + count); return result.toISOString().slice(0, 10); }
export function deliveryWeekday(value: string): number { return day(value).getUTCDay(); }
export function ukBookingClock(now: string) {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(now) || !Number.isFinite(Date.parse(now))) throw new Error("The booking clock is unavailable. Try again.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
/** UK wall-clock conversion shared with catalogue elapsed-hour validation. */
export function bookingServiceInstant(date: string, time: string): number {
  day(date);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Choose a valid service time.");
  const target = Date.parse(`${date}T${time}:00Z`);
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (value: number) => { const p = Object.fromEntries(format.formatToParts(value).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`; };
  let result = target;
  for (let i = 0; i < 3; i++) result += target - Date.parse(parts(result));
  if (parts(result) !== `${date}T${time}:00Z`) throw new Error("This UK service time does not exist because the clocks change. Choose another time.");
  if (parts(result - 3600000) === `${date}T${time}:00Z` || parts(result + 3600000) === `${date}T${time}:00Z`) throw new Error("This UK service time is ambiguous because the clocks change. Choose another time.");
  return result;
}
export function earliestBookingDelivery(now: string): string {
  const clock = ukBookingClock(now);
  let date = clock.date, remaining = clock.hour < 12 ? 2 : 3;
  while (remaining) { date = addBusinessDate(date); if (deliveryWeekday(date) !== 6) remaining--; }
  while ([0, 6].includes(deliveryWeekday(date))) date = addBusinessDate(date);
  return date;
}
/** Compatibility for existing callers of the former sandwich-only minimum. */
export const earliestSandwichDelivery = earliestBookingDelivery;
function workingDate(date: string, count: number) {
  while (count > 0) { date = addBusinessDate(date); if (![0, 6].includes(deliveryWeekday(date))) count--; }
  return date;
}
export function bookingDateIssue(items: readonly CutoffItem[], deliveryDate: string, now: string, context: CutoffContext = {}): CutoffIssue | undefined {
  const clock = ukBookingClock(now);
  let weekday: number;
  try { weekday = deliveryWeekday(deliveryDate); } catch (error) { return { code: "INVALID_BOOKING_DATE", message: (error as Error).message }; }
  const policies = items.map(item => { const derived = bookingPolicyFor(item.id, item.routing); return { sandwich: derived.sandwich || item.bookingPolicy?.sandwich, fridayUnavailable: derived.fridayUnavailable || item.bookingPolicy?.fridayUnavailable }; });
  // The calendar must enforce this floor before any dishes have been chosen.
  let earliest = earliestBookingDelivery(now);
  const largeEvent = ["event_catering", "drinks_reception", "bbq", "bespoke", "dining"].includes(context.occasion || "");
  const workingDays = Math.max(largeEvent ? context.site === "angel-court" ? 10 : 7 : 0, ...items.map(item => (item.noticeRequiredDays || 0) >= 10 ? item.noticeRequiredDays! : 0), 0);
  if (workingDays) earliest = [earliest, workingDate(clock.date, workingDays)].sort().pop()!;
  const noticeHours = Math.max(0, ...items.map((item, index) => {
    const hours = item.rules?.noticeHours ?? item.configuration?.rules?.noticeHours ?? 0;
    if (!Number.isFinite(hours) || hours < 0) throw new Error("The product notice configuration is invalid. Contact the hospitality team.");
    return policies[index].sandwich && hours <= 72 ? 0 : hours;
  }));
  if (noticeHours) {
    const threshold = Date.parse(now) + noticeHours * 3600000;
    let date = ukBookingClock(new Date(threshold).toISOString()).date;
    while ([0, 6].includes(deliveryWeekday(date))) date = addBusinessDate(date);
    if (bookingServiceInstant(date, context.startTime || "00:00") < threshold) date = addBusinessDate(date);
    if (date > earliest) earliest = date;
  }
  const allowed = context.allowedDeliveryDays || [1, 2, 3, 4, 5];
  // A contradictory site configuration must fail closed rather than search forever.
  if (!allowed.some(d => d >= 1 && d <= 5)) return { code: "SITE_UNAVAILABLE", message: "This site has no available weekday deliveries. Contact the hospitality team." };
  while (!allowed.includes(deliveryWeekday(earliest)) || [0, 6].includes(deliveryWeekday(earliest)) || (deliveryWeekday(earliest) === 5 && policies.some(p => p.fridayUnavailable))) earliest = addBusinessDate(earliest);
  if ([0, 6].includes(weekday)) return { code: "DELIVERY_WEEKEND", message: "No deliveries on Saturdays or Sundays.", earliestDate: earliest };
  if (!allowed.includes(weekday)) return { code: "SITE_DELIVERY_DAY", message: "This site does not deliver on the selected day.", earliestDate: earliest };
  if (weekday === 5 && policies.some(p => p.fridayUnavailable)) return { code: "SUMMER_ROLL_FRIDAY", message: "Summer Roll Platters are unavailable for Friday delivery. Amend the basket or choose another date.", earliestDate: earliest };
  if (deliveryDate < clock.date) return { code: "PAST_DELIVERY_DATE", message: "Choose a current or future delivery date.", earliestDate: earliest };
  if (noticeHours && bookingServiceInstant(deliveryDate, context.startTime || "00:00") < Date.parse(now) + noticeHours * 3600000) return { code: "PRODUCT_NOTICE", message: `This selection requires ${noticeHours} hours notice. Earliest available delivery: ${earliest}.`, earliestDate: earliest };
  if (deliveryDate < earliest) return { code: workingDays && deliveryDate < workingDate(clock.date, workingDays) ? "PRODUCT_NOTICE" : "BOOKING_NOTICE", message: workingDays && deliveryDate < workingDate(clock.date, workingDays) ? `This selection requires ${workingDays} working days' notice. Earliest available delivery: ${earliest}.` : `Too soon for this booking. Earliest available delivery: ${earliest}.`, earliestDate: earliest };
}
export function assertBookingDate(items: readonly CutoffItem[], date: string, now: string, context: CutoffContext = {}) {
  let issue: CutoffIssue | undefined;
  try { issue = bookingDateIssue(items, date, now, context); } catch (error) { issue = { code: "INVALID_BOOKING_DATE", message: (error as Error).message }; }
  if (issue) throw Object.assign(new Error(issue.message), { status: 422, code: issue.code, earliestDate: issue.earliestDate });
}
