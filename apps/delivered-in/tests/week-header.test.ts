import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("operational week selector keeps its date range and navigation without the redundant label", () => {
  assert.doesNotMatch(page, /No published data/);
  assert.match(page, /aria-label="Previous operational week"/);
  assert.match(page, /aria-label="Next operational week"/);
  assert.match(page, /formatDate\(selectedWeekCommencing[\s\S]*?formatDate\(addDays\(selectedWeekCommencing, 6\)/);
  assert.match(page, /No published menu for the selected operational week\./);
});
