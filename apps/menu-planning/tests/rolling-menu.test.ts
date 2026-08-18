import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { emptyWeek, importWorkbook, validateWeek, ROLLING_SLOTS } from "../lib/rolling-menu";

test("rolling menu importer preserves slots, destination quantities and source evidence", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["PRODUCT", "DISH", "Angel Court", "MNK", "Total"],
    ["SALAD 1", "Green salad", 3, 2, 5],
    ["HOT MEAT", "Roast chicken", 1, 0, 1],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "mon");
  const workbook = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const result = importWorkbook(workbook, "WC 17_08_2026.xlsx");
  assert.equal(result.recognisedEntries, 2);
  assert.equal(result.snapshot.week.weekCommencing, "2026-08-17");
  assert.deepEqual(result.snapshot.entries[0].allocations.map(a => [a.destinationLabel, a.quantity]), [["Angel Court", 3], ["MNK", 2]]);
  assert.equal(result.snapshot.entries[0].portions, 5);
  assert.deepEqual(result.snapshot.entries[0].allergens, {});
  assert.equal(result.snapshot.entries[0].source?.workbook, "WC 17_08_2026.xlsx");
  assert.equal(result.snapshot.entries[0].slot, "SALAD 1");
});

test("blank rolling week has seven days and the governed slot catalogue", () => {
  const week = emptyWeek("2026-08-17");
  assert.equal(week.days.length, 7);
  assert.ok(ROLLING_SLOTS.includes("SALAD 6"));
  assert.equal(validateWeek(week).length, 1);
});
