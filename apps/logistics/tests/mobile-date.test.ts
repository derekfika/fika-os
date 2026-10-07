import assert from "node:assert/strict";
import test from "node:test";
import { isOperationalDate, mobileServiceDate } from "../lib/date";

test("mobile date accepts only complete calendar dates and retains non-today selection", () => {
  const now = new Date("2026-10-07T23:30:00Z");
  assert.equal(mobileServiceDate("2026-10-12", now), "2026-10-12");
  assert.equal(mobileServiceDate("2028-02-29", now), "2028-02-29");
  for (const invalid of [null, "", "2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "2026-10-12T00:00:00Z", "../2026-10-12"]) {
    assert.equal(isOperationalDate(invalid), false);
    assert.equal(mobileServiceDate(invalid, now), "2026-10-08");
  }
});

test("mobile fallback follows London midnight and both DST transitions", () => {
  for (const [instant, expected] of [
    ["2026-03-28T23:30:00Z", "2026-03-28"],
    ["2026-03-29T23:30:00Z", "2026-03-30"],
    ["2026-10-24T23:30:00Z", "2026-10-25"],
    ["2026-10-25T23:30:00Z", "2026-10-25"],
  ]) assert.equal(mobileServiceDate(null, new Date(instant)), expected);
});
