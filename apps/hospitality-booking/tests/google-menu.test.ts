import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleMenuRequests } from "../lib/google-menu";

test("Google menu generation creates content without a visible placeholder", () => {
  const requests = buildGoogleMenuRequests({
    id: "menu-1", fileName: "menu", bookingId: "booking-1", planId: "plan-1",
    planUpdatedAt: "2026-08-05T00:00:00Z", generatedAt: "2026-08-05T00:00:00Z",
    generatedBy: "test", templateVersion: "mnk-hospitality-menu-v1",
    booking: { companyName: "Fika", destination: "MNK", date: "2026-08-05", time: "12:00", guestCount: 4 },
    items: [{ menuItem: "item-1", name: "Deli Style Sandwich Lunch", allergens: ["gluten"], mayContain: [] }],
  }, { pageSize: { width: { magnitude: 10_000_000 }, height: { magnitude: 5_625_000 } }, slides: [{ objectId: "slide-1", pageElements: [] }] });
  assert.ok(requests.some((request) => "createShape" in request));
  assert.ok(requests.some((request) => "insertText" in request));
  assert.equal(requests.some((request) => "deleteObject" in request), false);
});

test("Angel Court menu layout stays inside the white panel and uses its typography", () => {
  const requests = buildGoogleMenuRequests({
    id: "menu-2", fileName: "menu", bookingId: "booking-2", planId: "plan-2",
    planUpdatedAt: "2026-08-05T00:00:00Z", generatedAt: "2026-08-05T00:00:00Z",
    generatedBy: "test", templateVersion: "mnk-hospitality-menu-v1",
    booking: { companyName: "Angel Court", destination: "Angel Court", date: "2026-08-05", time: "12:00", guestCount: 4 },
    items: [{ menuItem: "item-1", name: "Classic Working Lunch", allergens: ["gluten"], mayContain: [] }],
  }, { pageSize: { width: { magnitude: 6_858_000 }, height: { magnitude: 10_000_000 } }, slides: [{ objectId: "slide-1", pageElements: [] }] }, {
    contentLeft: 1_750_000,
    contentRight: 350_000,
    contentTop: 1_700_000,
    contentBottom: 900_000,
    itemFontSize: 17,
    allergenFontSize: 17,
    itemColor: { red: 0.54, green: 0.3, blue: 0.13 },
  });
  const itemShape = requests.find((request) => "createShape" in request && String((request as { createShape?: { objectId?: string } }).createShape?.objectId).includes("menu-item")) as { createShape: { elementProperties: { transform: { translateX: number } } } };
  assert.equal(itemShape.createShape.elementProperties.transform.translateX, 1_750_000);
  const styles = requests.filter((request) => "updateTextStyle" in request) as Array<{ updateTextStyle: { style: { fontSize: { magnitude: number }; foregroundColor?: { opaqueColor?: { rgbColor?: { red?: number } } } } } }>;
  assert.deepEqual(styles.map((entry) => entry.updateTextStyle.style.fontSize.magnitude), [17, 17]);
  assert.equal(styles[0].updateTextStyle.style.foregroundColor?.opaqueColor?.rgbColor?.red, 0.54);
  assert.equal(styles[1].updateTextStyle.style.foregroundColor?.opaqueColor?.rgbColor?.red, 1);
});
