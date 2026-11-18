import test from "node:test";
import assert from "node:assert/strict";
import { menuExportCsv } from "../lib/menu-export";
import type { RollingEntry, RollingSnapshot, RollingWeekStatus } from "../lib/rolling-menu-types";

const day = (id: string, date: string, dayName: string) => ({ id, date, dayName, entryIds: [] });
const entry = (id: string, date: string, slot: string, name: string, portions = 7): RollingEntry => ({
  id, dayId: date === "2026-11-16" ? "m" : "t", date, slot, itemLabel: name,
  portions, allocations: [{ destinationLabel: "FIKA X", quantity: 7 }],
  allergens: {} as RollingEntry["allergens"], audit: [],
});
function snapshot(status: RollingWeekStatus = "draft", entries: RollingEntry[] = []): RollingSnapshot {
  return {
    week: {
      id: "wc-2026-11-16", weekCommencing: "2026-11-16", weekEnding: "2026-11-20",
      status, version: 5, dayIds: ["m", "t"], entryIds: entries.map(item => item.id),
      sourceFiles: [], templateSlots: ["SALAD 1", "HOT MAIN", "HOT FISH"], audit: [],
    },
    days: [day("m", "2026-11-16", "Monday"), day("t", "2026-11-17", "Tuesday")],
    entries,
  };
}

test("any unpublished day exports in canonical slot order and includes allocations", () => {
  const menu = snapshot("draft", [
    entry("hot", "2026-11-17", "HOT FISH", "Sea bass"),
    entry("salad", "2026-11-17", "SALAD 1", "Leaf salad"),
  ]);
  const csv = menuExportCsv([{ snapshot: menu, dates: ["2026-11-17"] }]);
  assert.ok(csv.indexOf("Leaf salad") < csv.indexOf("Sea bass"));
  assert.match(csv, /"draft","2026-11-17","Tuesday"/);
  assert.match(csv, /"FIKA X \(7\)"/);
  assert.doesNotMatch(csv, /"2026-11-16","Monday"/);
});

test("published and partially published weeks, empty days, and unsaved drafts are distinguished", () => {
  const published = snapshot("published");
  const partial = snapshot("partially_published", [entry("one", "2026-11-17", "HOT MAIN", "Curry")]);
  partial.week.id = "partial";
  partial.week.weekCommencing = "2026-11-23";
  const csv = menuExportCsv([
    { snapshot: published, dates: ["2026-11-16"] },
    { snapshot: partial, dates: ["2026-11-17"], unsavedBrowserDraft: true },
  ]);
  assert.match(csv, /"published","2026-11-16","Monday"/);
  assert.match(csv, /"partially_published","2026-11-17","Tuesday"/);
  assert.match(csv, /"Unsaved browser draft"/);
});

test("CSV retains accents, quoted/multiline dishes and neutralises spreadsheet formulas", () => {
  const menu = snapshot("ready", [
    entry("quote", "2026-11-17", "SALAD 1", 'Crème, "brûlée"\nchilled'),
    entry("formula", "2026-11-17", "HOT MAIN", "=HYPERLINK(\"https://malicious.example\")"),
  ]);
  const csv = menuExportCsv([{ snapshot: menu, dates: ["2026-11-17"] }]);
  assert.match(csv, /Crème, ""brûlée""\nchilled/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/malicious\.example""\)"/);
});

test("fails closed rather than inventing a selected date absent from snapshot", () => {
  assert.throws(() => menuExportCsv([{ snapshot: snapshot(), dates: ["2026-11-20"] }]), /missing from week/);
});
