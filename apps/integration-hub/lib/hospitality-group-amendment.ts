import { z } from "zod";
import { bookingAdditionalChargesSchema } from "./hospitality-additional-charges-schema";
export const bookingAmendmentPatch = z.object({ client: z.object({ name: z.string().trim().min(1), email: z.string().trim().email(), phone: z.string().trim().max(80).optional(), companyName: z.string().trim().min(1), requester: z.object({ name: z.string().trim().min(1), email: z.string().trim().email(), phone: z.string().trim().max(80).optional(), companyName: z.string().trim().min(1) }).optional(), clientName: z.string().trim().min(1).optional(), clientCompany: z.string().trim().min(1).optional(), invoiceReference: z.string().trim().max(200).optional() }).strict(), service: z.object({ eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]).optional(), guestCount: z.number().int().positive(), floorLevel: z.string().trim().max(200).optional(), roomOrArea: z.string().trim().max(200).optional(), deliveryPoint: z.string().trim().max(200).optional(), onsiteContactName: z.string().trim().max(200).optional(), onsiteContactPhone: z.string().trim().max(80).optional() }).strict(), order: z.object({ eventType: z.string().trim().max(120).optional(), items: z.array(z.object({ itemId: z.string().trim().min(1), itemName: z.string().trim().max(300).optional(), category: z.string().trim().max(120).optional(), description: z.string().trim().max(4000).optional(), servingInfo: z.string().trim().max(500).optional(), unitPrice: z.number().min(0), quantity: z.number().int().min(0), choices: z.array(z.unknown()).optional(), comments: z.string().trim().max(2000).optional() }).strict()).min(1) }).strict(), notes: z.string().trim().max(4000).optional(), dietaries: z.record(z.string(), z.unknown()).optional(), deliveryChargeRequired: z.boolean().optional() }).strict();
export function validLondonServiceTime(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const stamp = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) return false;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return [stamp, stamp - 3_600_000].some(candidate => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time;
  });
}
const groupPatch = bookingAmendmentPatch.extend({ order: bookingAmendmentPatch.shape.order.extend({ items: bookingAmendmentPatch.shape.order.shape.items.min(0).max(100) }) });
export const groupAmendmentCommand = z.object({
  bookingGroupId: z.string().trim().min(1).max(160),
  expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(3).max(1000),
  services: z.array(z.object({ bookingId: z.string().min(8), expectedVersion: z.number().int().positive(), patch: groupPatch }).strict()).min(1).max(12),
}).strict().superRefine((command, context) => {
  command.services.forEach((entry, index) => {
    const service = entry.patch.service;
    if (!validLondonServiceTime(service.eventDate, service.startTime) || service.endTime && (!validLondonServiceTime(service.eventDate, service.endTime) || service.endTime <= service.startTime)) context.addIssue({ code: "custom", path: ["services", index, "patch", "service"], message: "Enter a valid London date and service window; end time must follow start time." });
    const items = entry.patch.order.items.filter(i => i.quantity > 0);
    if (new Set(items.map(i => i.itemId)).size !== items.length) context.addIssue({ code: "custom", path: ["services", index, "patch", "order"], message: "Each requested menu item may appear only once in a service." });
  });
});
export type GroupAmendmentCommand = z.infer<typeof groupAmendmentCommand>;
/** Replaces ONE service's additional charges. Sibling services are never written; the group source hash guards the whole group. */
export const groupChargesCommand = z.object({
  bookingGroupId: z.string().trim().min(1).max(160),
  bookingId: z.string().min(8),
  expectedVersion: z.number().int().positive(),
  expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  charges: bookingAdditionalChargesSchema,
}).strict();
export type GroupChargesCommand = z.infer<typeof groupChargesCommand>;
