import test from "node:test";
import assert from "node:assert/strict";
import { earliestSandwichDelivery, bookingDateIssue, assertBookingDate, bookingPolicyFor, validateCatalogueRules, resolveHospitalityOffering } from "@fika/server-shared/hospitality-effective-offering";
const vectors = [
  ["2026-10-19T09:00:00+01:00", "2026-10-21"], ["2026-10-19T13:00:00+01:00", "2026-10-22"],
  ["2026-10-20T09:00:00+01:00", "2026-10-22"], ["2026-10-20T13:00:00+01:00", "2026-10-23"],
  ["2026-10-21T09:00:00+01:00", "2026-10-23"], ["2026-10-21T13:00:00+01:00", "2026-10-26"],
  ["2026-10-22T09:00:00+01:00", "2026-10-26"], ["2026-10-22T13:00:00+01:00", "2026-10-26"],
  ["2026-10-23T09:00:00+01:00", "2026-10-26"], ["2026-10-23T13:00:00+01:00", "2026-10-27"],
  ["2026-10-25T09:00:00Z", "2026-10-27"], ["2026-10-25T13:00:00Z", "2026-10-28"],
  ["2026-07-06T10:59:59Z", "2026-07-08"], ["2026-07-06T11:00:00Z", "2026-07-09"],
  ["2026-11-02T11:59:59Z", "2026-11-04"], ["2026-11-02T12:00:00Z", "2026-11-05"],
  ["2026-03-27T13:00:00Z", "2026-03-31"], ["2026-03-29T11:00:00Z", "2026-04-01"],
  ["2026-10-25T00:30:00Z", "2026-10-27"], ["2026-10-25T01:30:00Z", "2026-10-27"],
  ["2026-10-24T09:00:00+01:00", "2026-10-26"], ["2026-10-24T13:00:00+01:00", "2026-10-27"],
];
const sandwich = [{ id: "hospitality-menu-item:mnk:deli_sandwich_lunch" }];
for (const [now, expected] of vectors) test(`shared date vector ${now}`, () => assert.equal(earliestSandwichDelivery(now), expected));
for (const site of ["angel-court", "mnk", "cfc", "munich-re", "rcoa"]) test(`${site} uses the shared date vectors`, () => {
  for (const [now, expected] of vectors) assert.equal(bookingDateIssue(sandwich, expected, now, { site }), undefined);
});
test("weekends, working-day notice, mixed baskets, site availability and Friday rolls fail closed", () => {
  const now = "2026-10-19T09:00:00+01:00";
  assert.equal(bookingDateIssue(sandwich, "2026-11-07", now)?.code, "DELIVERY_WEEKEND");
  assert.equal(bookingDateIssue(sandwich, "2026-11-08", now)?.code, "DELIVERY_WEEKEND");
  assert.equal(bookingDateIssue([...sandwich, { id: "event", noticeRequiredDays: 10 }], "2026-10-29", now)?.earliestDate, "2026-11-02");
  assert.equal(bookingDateIssue([{ id: "event", noticeRequiredDays: 10 }], "2026-11-02", now), undefined);
  assert.equal(bookingDateIssue([{ id: "summer_rolls" }], "2026-11-13", now)?.code, "SUMMER_ROLL_FRIDAY");
  assert.equal(bookingDateIssue([{ id: "summer_rolls" }], "2026-11-12", now), undefined);
  assert.equal(bookingDateIssue(sandwich, "2026-10-21", now, { allowedDeliveryDays: [1, 2, 4] })?.code, "SITE_DELIVERY_DAY");
  assert.equal(bookingDateIssue([{ id: "coffee" }], "2026-10-19", now), undefined, "unrelated products have no blanket sandwich notice");
  assert.throws(() => assertBookingDate(sandwich, "2026-10-20", now), (e: any) => e.status === 422 && e.earliestDate === "2026-10-21");
  assert.throws(() => assertBookingDate(sandwich, "2026-02-30", now));
});
test("routing-derived public metadata carries policy for opaque canonical IDs without exposing routing", () => {
  assert.equal(bookingPolicyFor("opaque-id", "cpu_sandwiches").sandwich, true);
  assert.equal(bookingPolicyFor("not-a-sandwich-name").sandwich, false);
  const item = { id: "opaque", name: "Product", category: "Food", defaultPrices: [{ amount: 1, vatRate: 0, from: "2026-01-01" }], dietaryInformation: [], allergenInformation: [], bookingPolicy: { sandwich: true } };
  const result = resolveHospitalityOffering({ schemaVersion: 2, contract: "test", items: [item], exceptions: [], oplocs: [{ id: "site", label: "Site" }] }, "opaque", "site", { serviceDate: "2026-10-21" });
  assert.ok(result.available && result.offering.bookingPolicy?.sandwich);
});

test("independent hours stay strict, while obsolete 48/72-hour sandwich notice cannot reject an eligible delivery time", () => {
  const now = "2026-10-19T10:00:00+01:00";
  assert.equal(bookingDateIssue([{ ...sandwich[0], rules: { noticeHours: 48 } }], "2026-10-21", now, { startTime: "07:00" }), undefined);
  assert.equal(bookingDateIssue([{ ...sandwich[0], rules: { noticeHours: 72 } }], "2026-10-21", now, { startTime: "07:00" }), undefined);
  assert.equal(bookingDateIssue([{ id: "cake", rules: { noticeHours: 72 } }], "2026-10-21", now, { startTime: "12:00" })?.code, "PRODUCT_NOTICE");
  assert.equal(bookingDateIssue([{ id: "event", noticeRequiredDays: 10, rules: { noticeHours: 480 } }], "2026-11-02", now, { startTime: "12:00" })?.earliestDate, "2026-11-09");
});

test("stable historical/provider aliases retain Friday exclusion after canonical identity merges", () => {
  assert.equal(bookingPolicyFor("opaque-survivor", undefined, ["hospitality-menu-item:old:rice_paper_rolls"]).fridayUnavailable, true);
  assert.equal(bookingDateIssue([{ id: "rice_paper_rolls", bookingPolicy: { fridayUnavailable: false } }], "2026-11-13", "2026-10-19T09:00:00Z")?.code, "SUMMER_ROLL_FRIDAY");
});

test("routing-classified opaque sandwich IDs supersede short-hour floors; independent cake floors remain strict", () => {
  const context = { gallagher: false, guestCount: 10, eventDate: "2026-10-21", startTime: "07:00", now: "2026-10-19T10:00:00+01:00" };
  const item = { id: "opaque-canonical-id", name: "Product", bookingPolicy: { sandwich: true }, rules: { noticeHours: 72 } };
  assert.doesNotThrow(() => validateCatalogueRules([item], [{ itemId: item.id, quantity: 1 }], context));
  assert.throws(() => validateCatalogueRules([{ ...item, bookingPolicy: { sandwich: false } }], [{ itemId: item.id, quantity: 1 }], context), /72 hours/);
});
