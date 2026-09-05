import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { importWorkbook } from "../lib/rolling-menu";

function workbook(sheets: Record<string, unknown[][]>) {
  const value = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(value, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(value, { type: "buffer", bookType: "xlsx" });
}

test("historic full-name sheets are parsed semantically and helper sheets are ignored", () => {
  const buffer = workbook({
    Friday: [["notes"], ["PRODUCT", "Dish", "Wise"], ["SALAD 1", "Friday dish", 4]],
    fikamon: [["PRODUCT", "Dish", "Wise"], ["SALAD 1", "Helper sheet must not import", 9]],
    Monday: [["PRODUCT", "Dish", "Wise"], ["SALAD 1", "Monday dish", 3]],
    "Weekly Total": [["PRODUCT", "Dish", "Wise"], ["SALAD 1", "Total sheet must not import", 8]],
    Wednesday: [["PRODUCT", "Dish", "Wise"], ["SALAD 1", "Wednesday dish", 2]],
  });
  const result = importWorkbook(buffer, "WC 11.05.26.xlsx");
  assert.equal(result.recognisedEntries, 3);
  assert.deepEqual(result.snapshot.entries.map(entry => entry.date).sort(), ["2026-05-11", "2026-05-13", "2026-05-15"]);
  assert.doesNotMatch(result.snapshot.entries.map(entry => entry.itemLabel).join(" "), /Helper|Total sheet/);
});

test("abbreviated aliases and mixed historic destination layouts remain readable", () => {
  const buffer = workbook({
    thurs: [["PRODUCT", "Dish", "Site A", "Site B"], ["HOT MEAT", "Thursday dish", 2, 1]],
    tue: [["PRODUCT", "Dish", "Site A"], ["SOUP", "Tuesday dish", 5]],
    fri: [["PRODUCT", "Dish", "Site B"], ["EXTRAS 1", "Friday dish", 2]],
    wed: [["PRODUCT", "Dish", "Site A"], ["SALAD 1", "Wednesday dish", 3]],
    mon: [["PRODUCT", "Dish", "Site A"], ["SALAD 1", "Monday dish", 4]],
  });
  const result = importWorkbook(buffer, "WC 08_06_2026.xlsx");
  assert.equal(result.recognisedEntries, 5);
  assert.equal(result.snapshot.entries.find(entry => entry.itemLabel === "Thursday Dish")?.portions, 3);
});
