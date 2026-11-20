import assert from "node:assert/strict";
import test from "node:test";
import { loadStudioPortalMenu } from "../lib/hospitality-portal-catalogue";
import { studioPortalPilot } from "../lib/studio-portal-pilot";
import { studioDishChoiceId } from "../../shared/hospitality-menu-studio-selection";

const options = {
  FIKA_STUDIO_HOSPITALITY_PILOT_ENABLED: "true", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev",
  FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com", FIKA_STUDIO_HOSPITALITY_PILOT_OPLOC: "oploc:fixture",
  FIKA_STUDIO_HOSPITALITY_PILOT_SOURCE_BOOKING_ID: "STUDIO-UAT-FIXTURE",
  FIKA_STUDIO_HOSPITALITY_PILOT_FIRST_DATE: "2026-12-01", FIKA_STUDIO_HOSPITALITY_PILOT_LAST_DATE: "2027-01-15",
};

test("Studio customer pilot requires the exact staging origin, synthetic booking ID and valid date scope", () => {
  assert.equal(studioPortalPilot(options)?.bookingId, "STUDIO-UAT-FIXTURE");
  for (const patch of [
    { FIKA_RUNTIME_MODE: "production" }, { FIREBASE_PROJECT_ID: "fika-os" },
    { FIKA_HUB_BASE_URL: "https://os.fikacatering.com" },
    { FIKA_STUDIO_HOSPITALITY_PILOT_SOURCE_BOOKING_ID: "real-booking" },
    { FIKA_STUDIO_HOSPITALITY_PILOT_LAST_DATE: "2026-11-20" },
    { FIKA_STUDIO_HOSPITALITY_PILOT_ENABLED: "false" },
  ]) assert.equal(studioPortalPilot({ ...options, ...patch }), undefined);
});

test("the portal keeps Hub pricing, VAT and ordinary options with its event-date Studio choices", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "/api/hospitality-catalogue/studio?eventDate=2026-12-07");
    return Response.json({ offerings: [{
      itemId: "hospitality-menu-item:fixture", offeringMode: "standard", name: "Fictional pastry box", category: "Bakery",
      price: { amount: 18, vatRate: 0.2 }, constraints: { minimumQuantity: 2 },
      dietaryInformation: [], allergenInformation: [],
      configuration: { choices: [{ id: "portion", label: "Portions", controlType: "select", options: [{ id: "default", label: "Standard" }] }] },
      studioChoices: { publicationHash: "b".repeat(64), dishes: [{ id: "dish:pastry", name: "Fictional pastry", description: "Public description" }] },
    }] });
  };
  try {
    const [item] = await loadStudioPortalMenu("2026-12-07");
    assert.equal(item.unitPrice, 18);
    assert.equal(item.vatRate, 0.2);
    assert.equal(item.minimumQuantity, 2);
    assert.deepEqual(item.optionGroups?.map(group => group.id), ["portion", studioDishChoiceId]);
    assert.equal(item.studioChoices?.dishes[0].description, "Public description");
  } finally { globalThis.fetch = original; }
});
