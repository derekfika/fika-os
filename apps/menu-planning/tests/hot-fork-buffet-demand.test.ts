import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingMenuDetails } from "../app/hot-fork-buffet-demand";

test("selected buffet menu shows quantities and manual confirmation without allocation controls", () => {
  const booking = {
    bookingId: "booking:test", bookingReference: "TEST", serviceDate: "2026-12-03", serviceTime: "12:00",
    oplocId: "oploc:test", siteName: "Test", clientName: "Customer", guestCount: 60,
    bookingStatus: "Reviewed", cancelled: false, alreadyHandedToCpu: false, portionAllocationStatus: "manual-review-required" as const,
    selectedMenuDetails: {
      menuVersion: "sam-2026-11-12", menuStatus: "current" as const,
      mains: [{ dishId: "main:1", name: "Main A", portions: 36 }, { dishId: "main:2", name: "Main B", portions: 24 }],
      salads: [{ dishId: "salad:1", name: "Salad A", portionStatus: "manual-confirmation-required" as const }],
      desserts: [{ dishId: "dessert:1", name: "Dessert A", portions: 30 }, { dishId: "dessert:2", name: "Dessert B", portions: null }],
    },
  };
  const html = renderToStaticMarkup(createElement(BookingMenuDetails, { booking }));
  assert.match(html, /36 × Main A/);
  assert.match(html, /Salad A · portions to confirm manually/);
  assert.match(html, /Dessert A · 30 portions/);
  assert.match(html, /Dessert B · portions to confirm/);
  assert.doesNotMatch(html, /Confirm|Save portions/);
});
