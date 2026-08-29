import type { ProductionOrder } from "../../lib/production-types";

/**
 * Deterministic local-only data for exercising the CPU dashboard.  Keeping the
 * dates fixed makes the two-week heads-up useful in screenshots and repeatable
 * in tests; it is never written to Firebase or any external system.
 */
const FIXTURE_CREATED_AT = "2026-08-13T09:00:00.000Z";

function requiredAt(date: string, time = "09:30") { return `${date}T${time}:00`; }

function line(
  id: string,
  sourceMenuItemId: "deli-style-sandwich" | "exotic-fruit-box" | "mini-traybake-bites",
  name: string,
  quantity: number,
  dietaries: Record<string, unknown> = {},
  unit = sourceMenuItemId === "deli-style-sandwich" ? "sandwich" : "box",
): ProductionOrder["lines"][number] {
  return {
    canonicalId: `fixture-line:${id}`,
    sourceBookingLineId: `fixture-source:${id}`,
    sourceMenuItemId,
    itemName: name,
    customerQuantity: quantity,
    customerUnit: unit,
    dietaries,
    allergenEvidenceStatus: Object.keys(dietaries).length ? "confirmed" : "missing",
    status: "ready",
    sortOrder: 0,
  };
}

function exception(id: string, description: string, severity: "warning" | "blocking" = "warning"): ProductionOrder["exceptions"][number] {
  return { canonicalId: `fixture-exception:${id}`, severity, status: "open", description, createdAt: FIXTURE_CREATED_AT, createdBy: "local-fixture", audit: [] };
}

function order(
  id: string,
  date: string,
  status: ProductionOrder["status"],
  portal: string,
  clientName: string,
  destinationLabel: string,
  lines: ProductionOrder["lines"],
  exceptions: ProductionOrder["exceptions"] = [],
  requiredTime = "09:30",
): ProductionOrder {
  const requiredBy = requiredAt(date, requiredTime);
  return {
    canonicalId: `production-order:v1:fixture:${id}`,
    entityType: "Production Order",
    schemaVersion: "0.1.0",
    version: 1,
    requirementIds: [],
    // Matches the canonical local Booking fixture ID so manager, hospitality
    // and CPU dashboards exercise one end-to-end source record.
    sourceBookingId: `booking:fixture:${id}`,
    sourceQuoteRevisionId: `fixture-quote:${id}`,
    productionLocationId: "oploc:cpux",
    destinationLabel,
    clientName,
    serviceType: "Hospitality",
    serviceDate: date,
    guestCount: lines.reduce((sum, item) => sum + item.customerQuantity, 0),
    requiredBy,
    serviceWindow: { startTime: "12:00", endTime: "14:00" },
    status,
    priority: status === "blocked" ? "urgent" : status === "needs_review" ? "high" : "normal",
    lines,
    exceptions,
    operationalNotes: `Local ${portal} booking fixture for the CPU production workflow.`,
    origin: "hospitality_booking",
    currentRevision: 1,
    createdAt: FIXTURE_CREATED_AT,
    createdBy: "local-fixture",
    idempotencyKey: `fixture:${id}`,
    externalReferences: [`portal:${portal.toLowerCase().replaceAll(" ", "-")}`, `fixture-date:${date}`],
    audit: [{ action: "local-fixture-created", at: FIXTURE_CREATED_AT, by: "local-fixture", newState: status }],
  };
}

const bookings: ProductionOrder[] = [
  order("mnk-17-deli", "2026-08-17", "received", "MNK", "MNK Hospitality", "MNK · Boardroom", [line("mnk-17-deli", "deli-style-sandwich", "Deli style sandwich", 18, { vegetarian: 2, glutenFree: 1 })]),
  order("angel-17-mixed", "2026-08-17", "needs_review", "ANGEL", "Angel Court", "One Angel Court · 7th Floor", [line("angel-17-sandwich", "deli-style-sandwich", "Deli style sandwich", 12, { coeliac: 1, milk: 1 }), line("angel-17-fruit", "exotic-fruit-box", "Exotic fruit box", 2)], [exception("angel-17", "Dietary evidence needs manager review.")]),
  order("cfc-18-breakfast", "2026-08-18", "accepted", "CFC", "CFC", "CFC · 10th Floor", [line("cfc-18-fruit", "exotic-fruit-box", "Exotic fruit box", 4, { vegan: 1 }), line("cfc-18-traybake", "mini-traybake-bites", "Mini traybake bites", 6, { glutenFree: 2 })], [], "08:30"),
  order("munich-18-lunch", "2026-08-18", "planning", "MUNICH-RE", "Munich RE", "Munich RE · 3rd Floor", [line("munich-18-deli", "deli-style-sandwich", "Deli style sandwich", 24, { vegetarian: 4, dairyFree: 1 })]),
  order("rcoa-19-catering", "2026-08-19", "planned", "RCOA", "RCOA", "Royal College of Art · Hospitality", [line("rcoa-19-sandwich", "deli-style-sandwich", "Working lunch sandwiches", 30, { glutenFree: 3, halal: 2 }), line("rcoa-19-traybake", "mini-traybake-bites", "Traybake bites", 8)]),
  order("mnk-19-addons", "2026-08-19", "in_production", "MNK", "MNK Hospitality", "MNK · Meeting rooms", [line("mnk-19-deli", "deli-style-sandwich", "Deli style sandwich", 10), line("mnk-19-fruit", "exotic-fruit-box", "Seasonal fruit box", 3, { vegan: 1 })]),
  order("angel-20-event", "2026-08-20", "partially_complete", "ANGEL", "Angel Court", "One Angel Court · Auditorium", [line("angel-20-deli", "deli-style-sandwich", "Deli style sandwich", 16, { vegetarian: 1 }), line("angel-20-traybake", "mini-traybake-bites", "Mini traybake bites", 5)]),
  order("cfc-20-review", "2026-08-20", "blocked", "CFC", "CFC", "CFC · Dining area", [line("cfc-20-deli", "deli-style-sandwich", "Deli style sandwich", 20, { severeAllergyAcknowledged: true, allergyDetails: "Peanut-free preparation requested" })], [exception("cfc-20", "Allergen separation confirmation is required before production.", "blocking")]),
  order("munich-21-complete", "2026-08-21", "complete", "MUNICH-RE", "Munich RE", "Munich RE · 5th Floor Coffee Bar", [line("munich-21-deli", "deli-style-sandwich", "Deli style sandwich", 14, { gluten: 1 })]),
  order("rcoa-21-cancelled", "2026-08-21", "cancelled", "RCOA", "RCOA", "Royal College of Art · Studio", [line("rcoa-21-fruit", "exotic-fruit-box", "Exotic fruit box", 2)]),
  order("mnk-22-weekend", "2026-08-22", "accepted", "MNK", "MNK Hospitality", "MNK · Private dining", [line("mnk-22-deli", "deli-style-sandwich", "Deli style sandwich", 8, { vegan: 1 })]),
  order("angel-24-new", "2026-08-24", "draft", "ANGEL", "Angel Court", "One Angel Court · 7th Floor", [line("angel-24-fruit", "exotic-fruit-box", "Exotic fruit box", 5)]),
  order("cfc-24-amended", "2026-08-24", "amended", "CFC", "CFC", "CFC · 10th Floor", [line("cfc-24-deli", "deli-style-sandwich", "Deli style sandwich", 26, { vegetarian: 3, coeliac: 1 }), line("cfc-24-traybake", "mini-traybake-bites", "Mini traybake bites", 4)]),
  order("munich-25-scheduled", "2026-08-25", "scheduled", "MUNICH-RE", "Munich RE", "Munich RE · 3rd Floor", [line("munich-25-deli", "deli-style-sandwich", "Deli style sandwich", 22), line("munich-25-fruit", "exotic-fruit-box", "Exotic fruit box", 2, { vegan: 2 })]),
  order("rcoa-26-clarification", "2026-08-26", "needs_clarification", "RCOA", "RCOA", "Royal College of Art · Hospitality", [line("rcoa-26-traybake", "mini-traybake-bites", "Mini traybake bites", 10, { milk: 2 })], [exception("rcoa-26", "Delivery point still needs confirming.")]),
  order("mnk-27-ready", "2026-08-27", "ready", "MNK", "MNK Hospitality", "MNK · Boardroom", [line("mnk-27-deli", "deli-style-sandwich", "Deli style sandwich", 32, { glutenFree: 4, halal: 4 })]),
  order("angel-27-menu", "2026-08-27", "menu_available", "ANGEL", "Angel Court", "One Angel Court · 7th Floor", [line("angel-27-deli", "deli-style-sandwich", "Deli style sandwich", 18, { vegetarian: 2 }), line("angel-27-fruit", "exotic-fruit-box", "Exotic fruit box", 3)]),
  order("cfc-28-reconcile", "2026-08-28", "reconciliation_required", "CFC", "CFC", "CFC · Dining area", [line("cfc-28-deli", "deli-style-sandwich", "Deli style sandwich", 12, { dairyFree: 1 })], [exception("cfc-28", "Provider confirmation differs from the latest booking revision.")]),
  order("munich-28-production", "2026-08-28", "in_production", "MUNICH-RE", "Munich RE", "Munich RE · 5th Floor Coffee Bar", [line("munich-28-deli", "deli-style-sandwich", "Deli style sandwich", 20), line("munich-28-traybake", "mini-traybake-bites", "Mini traybake bites", 6)]),
  order("rcoa-29-weekend", "2026-08-29", "accepted", "RCOA", "RCOA", "Royal College of Art · Hospitality", [line("rcoa-29-fruit", "exotic-fruit-box", "Exotic fruit box", 7, { vegan: 1 })]),
  order("mnk-30-complete", "2026-08-30", "complete", "MNK", "MNK Hospitality", "MNK · Boardroom", [line("mnk-30-deli", "deli-style-sandwich", "Deli style sandwich", 10, { gluten: 1 })]),
];

// The fixture catalogue remains available to focused tests and explicit
// fixture endpoints. The dashboard route opts it in only when requested, so
// a clean local workspace never displays stale demo bookings.
let localOrders: ProductionOrder[] = bookings;

export function localFixtureOrders() { return localOrders; }
export function updateLocalFixture(id: string, updater: (order: ProductionOrder) => ProductionOrder) {
  localOrders = localOrders.map(order => order.canonicalId === id ? updater(order) : order);
  return localOrders.find(order => order.canonicalId === id);
}
