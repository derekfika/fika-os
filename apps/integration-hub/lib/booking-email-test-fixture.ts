import { bookingNotificationRecord, type BookingNotificationKind, type BookingNotificationRecord } from "./booking-notifications";
import type { CanonicalBooking } from "./hospitality-booking-service";

export const RCOA_EMAIL_TEST_OPLOC = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
export const RCOA_EMAIL_TEST_RECIPIENT = "derek@fikacatering.com";
export const RCOA_EMAIL_TEST_KINDS = ["submitted", "confirmed", "amended", "cancelled"] as const satisfies readonly BookingNotificationKind[];
export const RCOA_EMAIL_TEST_NOTIFICATION_IDS = Object.freeze(Object.fromEntries(
  RCOA_EMAIL_TEST_KINDS.map(kind => [kind, `rcoa-email-test:20261019:${kind}:v3`]),
) as Record<BookingNotificationKind, string>);
export const RCOA_EMAIL_TEST_CREATED_AT = "2026-10-19T00:00:00.000Z";

/** Fixed synthetic booking content used only by the internally authenticated delivery test. */
export function createRcoaEmailTestFixture(kind: BookingNotificationKind): BookingNotificationRecord {
  const lifecycleStatus: CanonicalBooking["lifecycleStatus"] = kind === "cancelled" ? "Cancelled" : kind === "confirmed" ? "Sent to CPU" : kind === "amended" ? "Approved" : "New";
  const booking = {
    canonicalId: "rcoa-email-delivery-test-booking",
    entityType: "Booking",
    schemaVersion: "0.1.0",
    version: 1,
    lifecycleStatus,
    createdAt: RCOA_EMAIL_TEST_CREATED_AT,
    createdBy: "test-fixture",
    updatedAt: RCOA_EMAIL_TEST_CREATED_AT,
    updatedBy: "test-fixture",
    source: { provider: "rcoa-booking-platform", sourceBookingId: "RCOA-EMAIL-TEST-2026-10-19", submissionTimestamp: RCOA_EMAIL_TEST_CREATED_AT, contractVersion: "delivery-test", originalPayload: {} },
    client: { name: "FIKA OS Test Recipient", companyName: "FIKA OS Email Delivery Test", email: RCOA_EMAIL_TEST_RECIPIENT, phone: "" },
    service: { portalSiteId: "rcoa", portalSiteLabel: "RCoA Hospitality", oplocId: RCOA_EMAIL_TEST_OPLOC, eventDate: "2026-11-19", startTime: "10:00", endTime: "11:00", guestCount: 12, floorLevel: "Test Suite", roomOrArea: "Delivery test" },
    order: { eventType: "Meeting lunch", items: [{ itemId: "test-sandwich", itemName: "Sandwich platter", servingInfo: "Assorted fillings, serves 12", unitPrice: 9.5, quantity: 12, lineTotal: 114 }, { itemId: "test-fruit", itemName: "Seasonal fruit bowl", unitPrice: 18, quantity: 2, lineTotal: 36, comments: "Synthetic test item" }], netTotal: 150, vatNote: "Synthetic test only", currency: "GBP", vatTotal: 30, grossTotal: 180 },
    dietaries: {}, acknowledgements: {}, attachments: [], statusHistory: [], audit: [], commercialVersion: 1,
  } as unknown as CanonicalBooking;
  const record = bookingNotificationRecord(booking, kind, 1, RCOA_EMAIL_TEST_CREATED_AT);
  const notificationId = RCOA_EMAIL_TEST_NOTIFICATION_IDS[kind];
  return {
    ...record,
    notificationId,
    to: [RCOA_EMAIL_TEST_RECIPIENT],
    cc: [],
    subject: `[TEST ONLY] ${record.subject}`,
    text: `TEST ONLY — no real booking has been created.\n\n${record.text}`,
    html: record.html.replace(/(<body[^>]*>)/, `$1<div style="padding:10px 12px;background:#FFF2CC;border-bottom:2px solid #9A6700;font-family:Arial,sans-serif;font-size:13px;text-align:center"><strong>TEST ONLY — no real booking has been created.</strong></div>`),
    testFixture: true,
  };
}

const immutableFields = ["notificationId", "bookingId", "kind", "siteId", "siteLabel", "templateKey", "to", "cc", "subject", "text", "html", "createdAt", "bookingVersion", "commercialVersion", "oplocId"] as const;

/** Test rows can bypass a booking read only when every immutable field matches this fixed fixture. */
export function isRcoaEmailTestFixture(message: BookingNotificationRecord) {
  if (message.testFixture !== true) return false;
  const kind = RCOA_EMAIL_TEST_KINDS.find(value => RCOA_EMAIL_TEST_NOTIFICATION_IDS[value] === message.notificationId);
  if (!kind) return false;
  const expected = createRcoaEmailTestFixture(kind);
  return immutableFields.every(field => JSON.stringify(message[field]) === JSON.stringify(expected[field]));
}
