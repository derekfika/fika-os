import assert from "node:assert/strict";
import test from "node:test";
import { CPU_CALENDAR_ID, calendarEventPayload, makeCpuCalendarSourceKey } from "../lib/cpu-calendar-runner";

const candidate = {
  adapterVersion: "test",
  sourceKey: "event-1|booking.xlsx",
  source: { messageId: "event-1", attachmentName: "booking.xlsx", receivedAt: "2026-08-14T09:00:00.000Z" },
  location: "Munich RE",
  clientName: "Example Ltd",
  hostName: "Office Manager",
  email: "manager@example.test",
  phone: "02000000000",
  eventDate: "2026-08-20",
  serviceTime: "12:00",
  deliveryTime: "11:30",
  guestCount: 10,
  roomOrArea: "Boardroom",
  notes: "Calendar evidence",
  items: [{ name: "Deli Style Sandwich", quantity: 10, details: "Legacy brochure item" }],
  warnings: [],
} as const;

test("CPUX calendar event identity is stable across retries", () => {
  const key = makeCpuCalendarSourceKey(CPU_CALENDAR_ID, "event-1");
  assert.equal(key, "calendar:cpux@fikacatering.com:event-1");
  assert.equal(makeCpuCalendarSourceKey(CPU_CALENDAR_ID, "event-1"), key);
  assert.notEqual(makeCpuCalendarSourceKey(CPU_CALENDAR_ID, "event-2"), key);
});

test("CPU calendar candidate becomes a canonical bridge payload without Gmail identity", () => {
  const payload = calendarEventPayload({ id: "event-1", location: "Munich RE", start: { dateTime: "2026-08-20T12:00:00+01:00" }, updated: "2026-08-14T09:00:00.000Z" }, candidate as never, "2026-08-14T09:00:00.000Z");
  assert.equal(payload.bookingId, "calendar:cpux@fikacatering.com:event-1");
  assert.equal(payload.site, "Munich RE");
  assert.equal(payload.order.items[0]?.itemName, "Deli Style Sandwich");
  assert.match(payload.specialInstructions || "", /CPU calendar event: event-1/);
  assert.doesNotMatch(JSON.stringify(payload), /gmail|inbox/i);
});
