import test from "node:test";
import assert from "node:assert/strict";
import { mnkMenuHtml } from "../lib/mnk-menu-output";
import type { MenuOutput } from "../lib/mnk-menu-output";

test("MNK menu output preserves planned line names and red allergen evidence", () => {
  const output: MenuOutput = {
    id: "menu-output:test", fileName: "2026-08-07-12-00-Gallagher-MNK", bookingId: "booking:test", planId: "production-plan:test", planUpdatedAt: "2026-08-03T10:00:00Z", generatedAt: "2026-08-03T10:01:00Z", generatedBy: "Tia", templateVersion: "mnk-hospitality-menu-v1",
    booking: { companyName: "Gallagher", destination: "MNK", date: "2026-08-07", time: "12:00", guestCount: 12 },
    items: [{ menuItem: "Lunch", name: "Vegan cheddar salad", allergens: ["Gluten", "Milk"], mayContain: ["Nuts"] }],
  };
  const html = mnkMenuHtml(output);
  assert.match(html, /Vegan cheddar salad/);
  assert.match(html, /class="allergens"/);
  assert.match(html, /#f00000/);
  assert.doesNotMatch(html, /May contain: Nuts/);
  assert.match(html, /MNK/);
});
