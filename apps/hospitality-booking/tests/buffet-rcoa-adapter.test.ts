import assert from "node:assert/strict";
import test from "node:test";
import { HOT_FORK_BUFFET_MENU_VERSION } from "@fika/server-shared/hospitality-buffet-selection";
import { RcoaBookingRequestSchema, buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import type { PortalMenuItem } from "../lib/mnk-contract";
import { seedVisibility } from "./support/rcoa-service-visibility";

const item: PortalMenuItem = { id: "hospitality-menu-item:rcoa:hot_fork_buffet_gold", canonicalId: "hospitality-menu-item:rcoa:hot_fork_buffet_gold", name: "Fixture Gold", category: "Fork Buffet & Bowl Food", unitPrice: 28, vatRate: null, minimumQuantity: 12, dietaryInformation: [], allergenInformation: [] };
const choice = { id: "hot-fork-buffet-selection", value: { contract: "fika.hot-fork-buffet-selection.v1", menuVersion: HOT_FORK_BUFFET_MENU_VERSION, packageId: "gold", mains: [{ dishId: "m", portions: 16 }, { dishId: "v", portions: 14 }], saladIds: ["s1", "s2", "s3"], desserts: [{ dishId: "d1", portions: 15 }, { dishId: "d2", portions: 15 }] } };
const request = { bookingId: "RCOA-20261005103000-AB12", submittedAt: "2026-10-05T10:30:00.000Z", client: { name: "Fixture", email: "fixture@example.test", phone: "1", companyName: "Fixture" }, event: { eventDate: "2026-10-20", startTime: "10:00", guestCount: 30, floorLevel: "First Floor", roomOrArea: "Boardroom 1" }, order: { eventType: "event_catering", items: [{ itemId: item.id, quantity: 30, choices: [choice] }] }, dietaries: { hasDietaries: false, vegetarian: 0, vegan: 0, glutenFree: 0, coeliac: 0, dairyFree: 0, halal: 0, otherCount: 0, allergyDetails: "", severeAllergyAcknowledged: false, freeText: "" }, acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } };

test("RCoA validates and preserves the structured buffet choice to Hub", () => {
  assert.equal(RcoaBookingRequestSchema.safeParse(request).success, true);
  const payload = buildTrustedRcoaHubPayload(request, [item], seedVisibility);
  assert.deepEqual(payload.order.items[0].choices, [choice]);
  const malformed = structuredClone(request); (malformed.order.items[0].choices[0] as { value: unknown }).value = "forged";
  assert.equal(RcoaBookingRequestSchema.safeParse(malformed).success, false, "a buffet ID cannot use the ordinary string choice path");
});

test("RCoA preserves the final v2 buffet choice without dessert quantities", () => {
  const v2 = { id: "hot-fork-buffet-selection", value: { contract: "fika.hot-fork-buffet-selection.v2", menuVersion: HOT_FORK_BUFFET_MENU_VERSION, rulesVersion: "sam-2026-11-13-final", packageId: "gold", mains: [{ dishId: "m", portions: 16 }, { dishId: "v", portions: 15 }], saladIds: ["s1", "s2", "s3"], dessertIds: ["d1", "d2"] } };
  const v2Request = { ...request, event: { ...request.event, guestCount: 31 }, order: { ...request.order, items: [{ itemId: item.id, quantity: 31, choices: [v2] }] } };
  assert.equal(RcoaBookingRequestSchema.safeParse(v2Request).success, true);
  assert.deepEqual(buildTrustedRcoaHubPayload(v2Request, [item], seedVisibility).order.items[0].choices, [v2]);
});
