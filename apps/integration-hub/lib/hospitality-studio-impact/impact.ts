import { deliveryWeekday, ukBookingClock } from "@fika/server-shared/hospitality-effective-offering";
import { z } from "zod";

const businessDate = z.string().refine(value => {
  try { deliveryWeekday(value); return true; }
  catch { return false; }
});
const itemId = z.string().regex(/^hospitality-menu-item:[a-z0-9][a-z0-9:._-]{0,180}$/i);
const confirmedStatuses = new Set(["Approved", "Sent to CPU", "Completed"]);
const excludedStatuses = new Set(["New", "Reviewed", "Quoted", "Cancelled"]);
export const bookingLimit = 250;

export const impactRequest = z.object({
  firstEventDate: businessDate,
  lastEventDate: businessDate,
  catalogueItemIds: z.array(itemId).min(1).max(50),
  scope: z.enum(["catalogue-item", "dish-selection"]),
}).strict().refine(({ firstEventDate, lastEventDate }) => {
  const duration = Date.parse(lastEventDate) - Date.parse(firstEventDate);
  return duration >= 0 && duration <= 366 * 86_400_000;
}, "Choose an impact window covering at most 367 calendar dates.");

export type ImpactRequest = z.infer<typeof impactRequest>;
export type ImpactReason = "BOOKING_WINDOW_TRUNCATED" | "BOOKING_IDENTITY_UNAVAILABLE" | "DISH_SELECTION_EVIDENCE_UNAVAILABLE" | "SITE_UNAVAILABLE";
export type ImpactResult = {
  scope: ImpactRequest["scope"];
  coverage: "complete" | "partial";
  reasons: ImpactReason[];
  bookings: { id: string; eventDate: string; site: string; selectionIds: string[]; selections: string[] }[];
};

const storedBooking = z.object({
  entityType: z.literal("Booking"),
  canonicalId: z.string().min(1),
  service: z.object({ eventDate: businessDate, oplocId: z.string().min(1).optional() }),
  order: z.object({ items: z.array(z.object({ menuItemId: z.string().optional() })) }),
});

type ImpactReader = {
  bookings(from: string, through: string): Promise<{ rows: unknown[]; truncated: boolean }>;
  resolveItems(ids: string[], priorityCount: number): Promise<Map<string, string>>;
  itemLabels(ids: string[]): Promise<Map<string, string>>;
  siteLabels(ids: string[]): Promise<Map<string, string>>;
};

export async function futureBookingImpact(reader: ImpactReader, input: ImpactRequest, now = new Date()): Promise<ImpactResult> {
  const today = ukBookingClock(now.toISOString()).date;
  const from = input.firstEventDate < today ? today : input.firstEventDate;
  const result: ImpactResult = { scope: input.scope, coverage: "complete", reasons: [], bookings: [] };
  if (from > input.lastEventDate) return result;

  const { rows, truncated } = await reader.bookings(from, input.lastEventDate);
  const reasons = new Set<ImpactReason>();
  if (truncated) reasons.add("BOOKING_WINDOW_TRUNCATED");
  const candidates = rows.flatMap(row => {
    const status = typeof row === "object" && row !== null && "lifecycleStatus" in row ? row.lifecycleStatus : undefined;
    if (typeof status === "string" && excludedStatuses.has(status)) return [];
    const stored = storedBooking.safeParse(row);
    if (typeof status !== "string" || !confirmedStatuses.has(status) || !stored.success
        || stored.data.service.eventDate < from || stored.data.service.eventDate > input.lastEventDate) {
      reasons.add("BOOKING_IDENTITY_UNAVAILABLE");
      return [];
    }
    const ids = stored.data.order.items.map(line => {
      const parsed = itemId.safeParse(line.menuItemId);
      if (!parsed.success) reasons.add("BOOKING_IDENTITY_UNAVAILABLE");
      return parsed.success ? parsed.data : undefined;
    }).filter((id): id is string => Boolean(id));
    return [{ booking: stored.data, ids }];
  });

  const requested = [...new Set(input.catalogueItemIds)];
  const resolved = await reader.resolveItems([...new Set([...requested, ...candidates.flatMap(row => row.ids)])], requested.length);
  const affected = new Set(input.catalogueItemIds.map(id => resolved.get(id)));
  if (affected.has(undefined)) throw unavailable();
  const affectedIds = [...affected] as string[];
  const itemLabels = await reader.itemLabels([...new Set(resolved.values())]);
  if (affectedIds.some(id => !itemLabels.has(id))) throw unavailable();

  const matching = candidates.flatMap(row => {
    const selected = new Set<string>();
    for (const id of row.ids) {
      const canonicalId = resolved.get(id);
      if (!canonicalId || !itemLabels.has(canonicalId)) reasons.add("BOOKING_IDENTITY_UNAVAILABLE");
      else if (affected.has(canonicalId)) selected.add(canonicalId);
    }
    if (!selected.size) return [];
    if (input.scope === "dish-selection") {
      // Legacy Booking lines do not contain an authoritative Studio dish
      // revision. A parent match can establish a candidate, never an exact dish.
      reasons.add("DISH_SELECTION_EVIDENCE_UNAVAILABLE");
    }
    return [{ booking: row.booking, selected }];
  });

  const sites = await reader.siteLabels([...new Set(matching.flatMap(row => row.booking.service.oplocId ? [row.booking.service.oplocId] : []))]);
  for (const { booking, selected } of matching) {
    const site = booking.service.oplocId && sites.get(booking.service.oplocId);
    if (!site) reasons.add("SITE_UNAVAILABLE");
    result.bookings.push({
      id: booking.canonicalId,
      eventDate: booking.service.eventDate,
      site: site || "Site unavailable",
      selectionIds: [...selected],
      selections: [...selected].map(id => itemLabels.get(id)!),
    });
  }
  result.coverage = reasons.size ? "partial" : "complete";
  result.reasons = [...reasons];
  return result;
}

export function unavailable() {
  return Object.assign(new Error("Current Hospitality booking impact could not be verified."), {
    status: 503, code: "HOSPITALITY_STUDIO_IMPACT_UNAVAILABLE",
  });
}

export function isCanonicalItemId(value: unknown): value is string {
  return itemId.safeParse(value).success;
}
