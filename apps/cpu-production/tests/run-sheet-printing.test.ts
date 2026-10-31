import test from "node:test";
import assert from "node:assert/strict";
import type { ProductionOrder } from "../lib/production-types";
import {
  MAX_RUN_SHEET_PRINT_DAYS,
  eligibleRunSheetDayOrders,
  loadRunSheetPrintDays,
  runSheetDestinationKey,
  runSheetPrintDates,
  runSheetPrintSiteOptions,
  selectedRunSheetPrintOrders,
} from "../app/ui/run-sheet-printing";
import { paginateDayProduction, runSheetProductionPrintHtml } from "../app/ui/day-production-print";

const order = (id: string, day: string, siteId: string, label: string, version = 1) => ({
  canonicalId: id,
  version,
  status: "planned",
  serviceDate: day,
  requiredBy: day + "T12:00:00Z",
  serviceWindow: { startTime: "12:00" },
  destinationOplocId: siteId,
  destinationLabel: label,
  lines: [{ canonicalId: id + ":line", itemName: "Soup", customerQuantity: 4, customerUnit: "portions", productionQuantity: 12, productionUnit: "pieces" }],
} as unknown as ProductionOrder);

test("print date presets use Europe/London across the autumn DST transition and year boundaries", () => {
  const afterDst = new Date("2026-11-01T00:30:00.000Z");
  assert.deepEqual(runSheetPrintDates("today", afterDst), ["2026-11-01"]);
  assert.deepEqual(runSheetPrintDates("tomorrow", afterDst), ["2026-11-02"]);
  assert.deepEqual(runSheetPrintDates("custom", afterDst, "2026-12-31", "2027-01-02"), [
    "2026-12-31", "2027-01-01", "2027-01-02",
  ]);
  assert.deepEqual(runSheetPrintDates("custom", afterDst, "2026-12-01", "2027-01-01"), []);
  assert.equal(MAX_RUN_SHEET_PRINT_DAYS, 31);
});

test("destination selection uses canonical identities and keeps duplicate labels separate", () => {
  const first = order("order:first", "2026-10-30", "oploc:first", "Same site name");
  const second = order("order:second", "2026-10-30", "oploc:second", "Same site name");
  const snapshot = { ...order("order:snapshot", "2026-10-31", "", "Same site name"), destinationAddress: { identity: "request:three", label: "Same site name", address: "" } } as ProductionOrder;
  assert.equal(runSheetDestinationKey(first), "oploc:oploc:first");
  assert.equal(runSheetDestinationKey(snapshot), "snapshot:request:three");
  const days = ["2026-10-30", "2026-10-31"];
  const options = runSheetPrintSiteOptions(new Map([[days[0], [first, second]], [days[1], [snapshot]]]), days);
  assert.equal(options.length, 3);
  assert.equal(new Set(options.map((site) => site.key)).size, 3);
  assert.ok(options.every((site) => site.displayLabel.startsWith("Same site name · ")));
});

test("latest inactive versions are excluded and selected sites remain distinct across dates", () => {
  const day1 = "2026-10-30";
  const day2 = "2026-10-31";
  const siteA = order("order:a", day1, "oploc:a", "Site A");
  const cancelledA = { ...siteA, version: 2, status: "cancelled" as const };
  const activeA2 = order("order:a2", day2, "oploc:a", "Site A");
  const siteB = order("order:b", day1, "oploc:b", "Site B");
  const loaded = new Map([[day1, [siteA, cancelledA, siteB]], [day2, [activeA2]]]);
  assert.deepEqual(eligibleRunSheetDayOrders(loaded.get(day1)!, day1).map((row) => row.canonicalId), ["order:b"]);
  const selected = selectedRunSheetPrintOrders(loaded, [day1, day2], ["oploc:oploc:a"]);
  assert.deepEqual([...selected.values()].flat().map((row) => row.canonicalId), ["order:a2"]);
});

test("each requested day is verified and any partial projection rejects the whole print set", async () => {
  const days = ["2026-10-30", "2026-10-31"];
  const progress: string[] = [];
  let calls = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const day = new URL(String(input), "https://fika.invalid").searchParams.get("serviceDate")!;
    calls++;
    return Response.json({
      projection: { serviceDate: day, summary: { orders: 0 }, orders: [] },
      ...(day === days[1] ? { partial: true } : {}),
    });
  }) as typeof fetch;
  await assert.rejects(
    loadRunSheetPrintDays(days, fetcher, (_done, _total, day) => progress.push(day)),
    /incomplete|verified/i,
  );
  assert.equal(calls, 2);
  assert.deepEqual(progress, [days[0]]);
});

test("printed HTML keeps separate site identities and contains the paper handover fields", () => {
  const day = "2026-10-30";
  const first = order("order:first", day, "oploc:first", "Same site");
  const second = order("order:second", day, "oploc:second", "Same site");
  const map = new Map([[day, [first, second]]]);
  const html = runSheetProductionPrintHtml(map, [day], ["oploc:oploc:first", "oploc:oploc:second"], new Date("2026-10-30T09:00:00Z"));
  assert.match(html, /Same site · oploc:first/);
  assert.match(html, /Same site · oploc:second/);
  assert.match(html, /<strong>4 portions<\/strong><small>Prep: 12 pieces<\/small>/);
  assert.match(html, /Ordered quantity/);
  assert.match(html, /data-site-key="oploc:oploc:first"/);
  assert.match(html, /data-site-key="oploc:oploc:second"/);
  for (const field of ["Packed by", "Checked by", "Driver / collected by", "Departure time", "Delivered time", "Received by / signature", "Notes / issues"]) {
    assert.match(html + paginateDayProduction.toString(), new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(paginateDayProduction.toString(), /Printed /);
  assert.match(paginateDayProduction.toString(), /Paper-only checkboxes/);
});
