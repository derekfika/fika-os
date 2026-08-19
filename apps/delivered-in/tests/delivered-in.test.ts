import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDeliveredInAccess } from "../../integration-hub/lib/delivered-in-access";
import { assertAuthorisedOploc, projectPublishedWeeks, siteDayTotal, type SourcePublication } from "../lib/projection";
import { groupSiteMenuEntries, siteMenuSectionForSlot, siteMenuState, type SiteMenuArtifact } from "../lib/site-menu";
import { buildDeliveredInMenuRequests, weekFolderName } from "../lib/google-site-menu";
import { titleCase } from "../../menu-planning/lib/text";
import { applyOrderAction, isBeforeOrderCutoff, orderIdFor, productsForDeliveryDate, rotationWeekForDate, type GrabAndGoProduct } from "../lib/grab-and-go";

const haleon = "oploc:46701265-15af-48f4-a230-1d27ca21bc59";
const xchange = "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d";
const source = (days: SourcePublication["days"]): SourcePublication => ({ publicationId: "publication:week", sourceWeekId: "week:1", weekCommencing: "2026-08-24", weekEnding: "2026-08-30", days });
const day = (overrides: Partial<SourcePublication["days"][number]> = {}): SourcePublication["days"][number] => ({ publicationDayId: "publication:day:v1", sourceDayId: "day:mon", date: "2026-08-24", dayName: "Monday", version: 1, status: "published", contentHash: "hash-v1", entries: [{ sourceEntryId: "entry:1", slot: "SALAD 1", dishName: "Mixed Baby Leaf", portions: 20, allocations: [{ destinationId: haleon, destinationLabel: "Haleon", quantity: 10 }, { destinationId: xchange, destinationLabel: "FIKA Xchange", quantity: 10 }], allergens: { milk: "clear" } }], allergenSignoff: { productionChef: { printedName: "Production Chef", signedAt: "2026-08-24T08:00:00Z" }, headChefSiteManager: { printedName: "Head Chef", signedAt: "2026-08-24T08:01:00Z" } }, ...overrides });

test("Delivered-In access resolves zero, one and multiple authorised OPLOCs", () => {
  assert.equal(resolveDeliveredInAccess({ email: "unknown@local.fika", role: "viewer" }).access.oplocIds.length, 0);
  assert.deepEqual(resolveDeliveredInAccess({ email: "viewer@local.fika", role: "viewer" }).access.oplocIds, [haleon]);
  assert.deepEqual(resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }).access.oplocIds, [haleon, xchange]);
});

test("Delivered-In projection filters by canonical destination ID and quantity", () => {
  const weeks = projectPublishedWeeks([source([day()])], haleon);
  assert.equal(weeks[0].days[0].entries.length, 1);
  assert.equal(weeks[0].days[0].entries[0].quantity, 10);
  assert.equal(weeks[0].days[0].entries[0].dishName, "Mixed Baby Leaf");
  assert.equal(siteDayTotal(weeks[0].days[0]), 10);
  assertAuthorisedOploc({ email: "viewer@local.fika", oplocIds: [haleon], permissions: ["delivered_in.view"] }, haleon);
  assert.throws(() => assertAuthorisedOploc({ email: "viewer@local.fika", oplocIds: [haleon], permissions: [] }, xchange), (error: any) => error.status === 403);
});

test("superseded and withdrawn days are excluded while latest current version is used", () => {
  const weeks = projectPublishedWeeks([source([day(), day({ publicationDayId: "publication:day:v2", version: 2, contentHash: "hash-v2" }), day({ publicationDayId: "publication:day:withdrawn", version: 3, status: "withdrawn" })])], haleon);
  assert.equal(weeks[0].days.length, 1);
  assert.equal(weeks[0].days[0].version, 2);
  assert.equal(weeks[0].days[0].contentHash, "hash-v2");
});

test("site allergen projection retains source provenance and original signatories", () => {
  const projected = projectPublishedWeeks([source([day()])], haleon)[0].days[0];
  assert.equal(projected.publicationDayId, "publication:day:v1");
  assert.equal(projected.version, 1);
  assert.equal(projected.contentHash, "hash-v1");
  assert.equal(projected.allergenSignoff.productionChef?.printedName, "Production Chef");
  assert.equal(projected.allergenSignoff.headChefSiteManager?.signedAt, "2026-08-24T08:01:00Z");
});

test("site allergen projection exposes the archived signed PDF URL for the exact published day", () => {
  const projected = projectPublishedWeeks([source([day({ driveArchive: { pdfDriveUrl: "https://drive.google.com/file/d/pdf-v1/view", pdfFileName: "Monday-v1.pdf", pdfStatus: "saved" } })])], haleon)[0].days[0];
  assert.equal(projected.publicationDayId, "publication:day:v1");
  assert.equal(projected.drivePdfUrl, "https://drive.google.com/file/d/pdf-v1/view");
  assert.equal(projected.drivePdfFileName, "Monday-v1.pdf");
});

test("site menu grouping keeps site dishes in explicit non-empty sections", () => {
  const entries = projectPublishedWeeks([source([day()])], haleon)[0].days[0].entries;
  const grouped = groupSiteMenuEntries([...entries, { ...entries[0], sourceEntryId: "soup", slot: "Soup", dishName: "Country Vegetable Soup" }, { ...entries[0], sourceEntryId: "hot", slot: "Hot Meat", dishName: "Jerk Chicken" }]);
  assert.deepEqual(grouped.map(section => section.key), ["salads", "hot_mains", "sides_extras"]);
  assert.equal(grouped.find(section => section.key === "salads")?.entries[0].dishName, "Mixed Baby Leaf");
  assert.equal(siteMenuSectionForSlot("Hot Veg / Vegan"), "hot_mains");
});

test("site menu generation state becomes stale when the immutable source hash changes", () => {
  const artifact: SiteMenuArtifact = { artifactId: "artifact:1", oplocId: haleon, sourceDayId: "day:mon", sourcePublicationDayId: "publication:day:v1", sourceVersion: 1, sourceContentHash: "hash-v1", generatedAt: "2026-08-24T10:00:00Z", generatedBy: "admin@local.fika", driveFileId: "file:1", driveUrl: "https://drive.google.com/file/d/file1/view", fileName: "menu" };
  assert.equal(siteMenuState({ sourceDayId: "day:mon", contentHash: "hash-v1" }, artifact).status, "current");
  assert.equal(siteMenuState({ sourceDayId: "day:mon", contentHash: "hash-v2" }, artifact).status, "stale");
});

test("Delivered-In Drive output uses a deterministic week-commencing folder", () => {
  assert.equal(weekFolderName("2026-08-24"), "WC_2026-08-24");
  assert.equal(weekFolderName(undefined), undefined);
});

test("lowercase Menu Planning names render as title case with attached governed allergen styling", () => {
  assert.equal(titleCase("fika house salad leaf"), "Fika House Salad Leaf");
  const projected = projectPublishedWeeks([source([day()])], haleon)[0].days[0];
  const menuDay = { ...projected, entries: [
    { ...projected.entries[0], slot: "SALAD 1", dishName: "fika house salad leaf", allergens: { gluten: "contains", milk: "contains" } },
    { ...projected.entries[0], sourceEntryId: "entry:2", slot: "Hot Meat", dishName: "mac & cheese", allergens: {} },
  ] as typeof projected.entries };
  const requests = buildDeliveredInMenuRequests(menuDay, { oplocId: haleon, label: "Haleon" }, { pageSize: { width: { magnitude: 10_000_000 }, height: { magnitude: 5_625_000 } }, slides: [
    { objectId: "salad-slide", pageElements: [{ objectId: "salad-anchor", size: { width: { magnitude: 8_800_000 }, height: { magnitude: 4_100_000 } }, transform: { translateX: 600_000, translateY: 900_000 }, shape: { text: { textElements: [{ textRun: { content: "{{SALADS}}" } }] } } }] },
    { objectId: "hot-slide", pageElements: [{ objectId: "hot-anchor", size: { width: { magnitude: 8_800_000 }, height: { magnitude: 4_100_000 } }, transform: { translateX: 600_000, translateY: 900_000 }, shape: { text: { textElements: [{ textRun: { content: "{{HOT_MAINS}}" } }] } } }] },
    { objectId: "empty-sides-slide", pageElements: [{ objectId: "sides-anchor", shape: { text: { textElements: [{ textRun: { content: "{{SIDES_EXTRAS}}" } }] } } }] },
  ] });
  const inserts = requests.filter(request => "insertText" in request).map(request => (request.insertText as { text: string }).text);
  assert.deepEqual(inserts, ["Fika House Salad Leaf", "(Gluten, Milk)", "Mac & Cheese"]);
  const firstShape = requests.find(request => "createShape" in request) as { createShape: { elementProperties: { size: { width: { magnitude: number } } } } };
  assert.ok(firstShape.createShape.elementProperties.size.width.magnitude >= 8_000_000);
  const styles = requests.filter(request => "updateTextStyle" in request).map(request => (request.updateTextStyle as { style: { fontFamily: string; fontSize: { magnitude: number }; bold?: boolean; foregroundColor: { opaqueColor: { rgbColor: { red: number; green: number; blue: number } } } } }).style);
  assert.equal(styles[0].fontFamily, "Montserrat");
  assert.ok(styles[0].fontSize.magnitude >= 18);
  assert.equal(styles[1].fontFamily, "Montserrat");
  assert.equal(styles[1].bold, true);
  assert.deepEqual(styles[1].foregroundColor.opaqueColor.rgbColor, { red: 1, green: 0, blue: 0 });
  assert.equal(requests.some(request => "updateShapeProperties" in request && (request.updateShapeProperties as { shapeProperties: { contentAlignment: string } }).shapeProperties.contentAlignment === "MIDDLE"), true);
  assert.equal(requests.some(request => "deleteObject" in request && (request.deleteObject as { objectId: string }).objectId === "empty-sides-slide"), true);
  assert.equal(requests.some(request => "insertText" in request && (request.insertText as { text: string }).text.includes("Mac & cheese")), false);
});

const grabProducts: GrabAndGoProduct[] = [
  { productId: "grab:week1", name: "Week One Pot", category: "grab_250ml", rotationWeeks: [1], allowedDeliveryWeekdays: ["Monday"], price: 1.85, active: true, sortOrder: 1 },
  { productId: "grab:week2", name: "Week Two Pot", category: "grab_250ml", rotationWeeks: [2], allowedDeliveryWeekdays: ["Monday"], price: 1.95, active: true, sortOrder: 2 },
];

test("Grab & Go rotation repeats from week 4 to week 1 and filters products by delivery date", () => {
  assert.equal(rotationWeekForDate("2026-08-24"), 1);
  assert.equal(rotationWeekForDate("2026-09-14"), 4);
  assert.equal(rotationWeekForDate("2026-09-21"), 1);
  assert.deepEqual(productsForDeliveryDate(grabProducts, "2026-08-24").map(product => product.productId), ["grab:week1"]);
});

test("Grab & Go orders are OPLOC-scoped, snapshot products, and preserve audit history on amendment", () => {
  const created = applyOrderAction(undefined, { action: "submit", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 4 }], actor: "site@local.fika", at: "2026-08-23T11:59:00" }, grabProducts);
  assert.equal(created.orderId, orderIdFor(haleon, "2026-08-24"));
  assert.equal(created.lines[0].productName, "Week One Pot");
  assert.equal(created.lines[0].price, 1.85);
  assert.throws(() => applyOrderAction(created, { action: "amend", oplocId: xchange, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 2 }], actor: "other@local.fika", at: "2026-08-23T11:00:00" }, grabProducts), (error: any) => error.status === 403);
  const amended = applyOrderAction(created, { action: "amend", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 7 }], actor: "site@local.fika", at: "2026-08-23T11:59:30" }, grabProducts);
  assert.equal(amended.version, 2);
  assert.equal(amended.lines[0].quantity, 7);
  assert.equal(amended.history.length, 2);
  assert.equal(amended.history[0].lines[0].quantity, 4);
});

test("Grab & Go submit, amend and cancel are blocked at the next-day noon cutoff", () => {
  assert.equal(isBeforeOrderCutoff("2026-08-24", new Date("2026-08-23T11:59:59")), true);
  assert.equal(isBeforeOrderCutoff("2026-08-24", new Date("2026-08-23T12:00:00")), false);
  const created = applyOrderAction(undefined, { action: "submit", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 1 }], actor: "site@local.fika", at: "2026-08-23T11:00:00" }, grabProducts);
  assert.throws(() => applyOrderAction(created, { action: "amend", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 2 }], actor: "site@local.fika", at: "2026-08-23T12:00:00" }, grabProducts), (error: any) => error.status === 409);
  const cancelled = applyOrderAction(created, { action: "cancel", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, actor: "site@local.fika", at: "2026-08-23T11:30:00" }, grabProducts);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.history[1].action, "cancelled");
});
