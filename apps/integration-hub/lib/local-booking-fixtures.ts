import type { CanonicalBooking, MnkBookingPayload } from "./hospitality-booking-service";

const CREATED_AT = "2026-08-13T09:00:00.000Z";

type FixtureSpec = {
  id: string;
  ref: string;
  site: string;
  siteLabel: string;
  date: string;
  time: string;
  guests: number;
  company: string;
  host: string;
  status: CanonicalBooking["lifecycleStatus"];
  items: MnkBookingPayload["order"]["items"];
  dietaries?: Record<string, unknown>;
};

const item = (itemId: string, itemName: string, quantity: number, unitPrice: number, category: string) => ({
  itemId,
  itemName,
  category,
  description: `${itemName} — local development booking fixture.`,
  servingInfo: "Per person",
  unitPrice,
  quantity,
  lineTotal: quantity * unitPrice,
  choices: [],
  comments: "",
});

const specs: FixtureSpec[] = [
  { id: "mnk-17-deli", ref: "MNK-20260817-001", site: "mnk", siteLabel: "MNK", date: "2026-08-17", time: "12:00", guests: 18, company: "MNK International", host: "Operations Coordinator", status: "Approved", items: [item("deli-style-sandwich", "Deli Style Sandwich", 18, 9, "Lunch")], dietaries: { vegetarian: 2, glutenFree: 1 } },
  { id: "angel-17-mixed", ref: "AC-20260817-001", site: "angel-court", siteLabel: "Angel Court", date: "2026-08-17", time: "12:30", guests: 12, company: "Angel Court Bank", host: "Events Coordinator", status: "Reviewed", items: [item("deli-style-sandwich", "Deli Style Sandwich", 12, 9, "Lunch"), item("exotic-fruit-box", "Exotic Fruit Box", 2, 52.5, "Lunch Boxes")], dietaries: { coeliac: 1, dairyFree: 1 } },
  { id: "cfc-18-breakfast", ref: "CFC-20260818-001", site: "cfc", siteLabel: "CFC", date: "2026-08-18", time: "08:30", guests: 30, company: "CFC", host: "Office Manager", status: "Quoted", items: [item("exotic-fruit-box", "Exotic Fruit Box", 4, 52.5, "Breakfast"), item("mini-traybake-bites", "Mini Traybake Bites", 6, 6, "Sweet Treats")], dietaries: { vegan: 1, glutenFree: 2 } },
  { id: "munich-18-lunch", ref: "MR-20260818-001", site: "munich-re", siteLabel: "Munich RE", date: "2026-08-18", time: "12:00", guests: 24, company: "Munich RE", host: "Site Coordinator", status: "New", items: [item("deli-style-sandwich", "Deli Style Sandwich", 24, 9, "Lunch")], dietaries: { vegetarian: 4, dairyFree: 1 } },
  { id: "mnk-19-addons", ref: "MNK-20260819-002", site: "mnk", siteLabel: "MNK", date: "2026-08-19", time: "12:00", guests: 10, company: "MNK International", host: "Operations Coordinator", status: "Completed", items: [item("deli-style-sandwich", "Deli Style Sandwich", 10, 9, "Lunch"), item("exotic-fruit-box", "Exotic Fruit Box", 3, 52.5, "Lunch Boxes")] },
  { id: "angel-20-event", ref: "AC-20260820-002", site: "angel-court", siteLabel: "Angel Court", date: "2026-08-20", time: "13:00", guests: 16, company: "Angel Court Bank", host: "Events Coordinator", status: "Approved", items: [item("deli-style-sandwich", "Deli Style Sandwich", 16, 9, "Lunch"), item("mini-traybake-bites", "Mini Traybake Bites", 5, 6, "Sweet Treats")], dietaries: { vegetarian: 1 } },
  { id: "cfc-21-cancelled", ref: "CFC-20260821-003", site: "cfc", siteLabel: "CFC", date: "2026-08-21", time: "09:00", guests: 20, company: "CFC", host: "Office Manager", status: "Cancelled", items: [item("exotic-fruit-box", "Exotic Fruit Box", 2, 52.5, "Breakfast")] },
  { id: "munich-24-lunch", ref: "MR-20260824-002", site: "munich-re", siteLabel: "Munich RE", date: "2026-08-24", time: "12:00", guests: 22, company: "Munich RE", host: "Site Coordinator", status: "Approved", items: [item("deli-style-sandwich", "Deli Style Sandwich", 22, 9, "Lunch"), item("mini-traybake-bites", "Mini Traybake Bites", 6, 6, "Sweet Treats")], dietaries: { halal: 2 } },
  { id: "mnk-27-ready", ref: "MNK-20260827-004", site: "mnk", siteLabel: "MNK", date: "2026-08-27", time: "11:30", guests: 32, company: "MNK International", host: "Operations Coordinator", status: "Reviewed", items: [item("deli-style-sandwich", "Deli Style Sandwich", 32, 9, "Lunch")], dietaries: { glutenFree: 4, halal: 4 } },
  { id: "angel-28-quote", ref: "AC-20260828-003", site: "angel-court", siteLabel: "Angel Court", date: "2026-08-28", time: "10:00", guests: 14, company: "Angel Court Bank", host: "Events Coordinator", status: "Quoted", items: [item("exotic-fruit-box", "Exotic Fruit Box", 3, 52.5, "Breakfast")] },
];

function makeBooking(spec: FixtureSpec): CanonicalBooking {
  const canonicalId = `booking:fixture:${spec.id}`;
  const total = spec.items.reduce((sum, line) => sum + line.lineTotal, 0);
  const originalPayload: MnkBookingPayload = {
    bookingId: spec.ref,
    submittedAt: CREATED_AT,
    status: spec.status,
    site: spec.siteLabel,
    siteId: spec.site,
    client: { name: spec.host, email: "local-fixture@example.test", phone: "02000000000", companyName: spec.company },
    event: { eventDate: spec.date, startTime: spec.time, guestCount: spec.guests, roomOrArea: "Boardroom", deliveryPoint: "Reception" },
    order: { eventType: "Hospitality", items: spec.items, netTotal: total, vatNote: "20% VAT" },
    dietaries: spec.dietaries || {},
  };
  return {
    canonicalId, entityType: "Booking", schemaVersion: "0.1.0", version: 1,
    lifecycleStatus: spec.status, createdAt: CREATED_AT, createdBy: "local-fixture", updatedAt: CREATED_AT, updatedBy: "local-fixture",
    source: { provider: "mnk-booking-platform", sourceBookingId: spec.ref, submissionTimestamp: CREATED_AT, contractVersion: "fika.booking-ingestion.mnk.v1", originalPayload },
    client: originalPayload.client,
    service: { ...originalPayload.event, portalSiteId: spec.site, portalSiteLabel: spec.siteLabel, oplocId: `oploc:${spec.site}` },
    order: { ...originalPayload.order, currency: "GBP", vatTotal: total * 0.2, grossTotal: total * 1.2, items: spec.items.map((line) => ({ ...line, menuItemId: `hospitality-menu-item:${spec.site}:${line.itemId}` })) },
    dietaries: spec.dietaries || {}, acknowledgements: { termsAccepted: true }, notes: "Local deterministic booking fixture.", attachments: [],
    statusHistory: [{ status: spec.status, changedAt: CREATED_AT, changedBy: "local-fixture", reason: "Fixture created for end-to-end local workflow testing." }],
    audit: [{ action: "fixture-created", at: CREATED_AT, by: "local-fixture", reason: "Local-only test data." }],
    quoteState: spec.status === "Quoted" || spec.status === "Approved" || spec.status === "Completed" ? {
      currentRevisionId: `quote:${canonicalId}:r1`,
      revisions: [{ id: `quote:${canonicalId}:r1`, revision: 1, createdAt: CREATED_AT, createdBy: "local-fixture", commercialVersion: 1, snapshot: { items: originalPayload.order.items, netTotal: total, vatTotal: total * 0.2, grossTotal: total * 1.2 }, documentReference: `local://quote/${spec.ref}`, stale: false }],
    } : { revisions: [] },
    ...(spec.status !== "New" ? { dashboardWorkflow: { review: { checks: { commercialIntent: true, serviceTiming: true, deliveryContext: true, dietaryRequirements: true }, reviewedAt: CREATED_AT, reviewedBy: "local-fixture", notes: "Fixture review complete." } } } : {}),
    deliveryChargeRequired: true,
  };
}

export const localBookingFixtures = specs.map(makeBooking);
