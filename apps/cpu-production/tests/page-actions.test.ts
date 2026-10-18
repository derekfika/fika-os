import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("CPU header no longer links Ad-hoc production to localhost and keeps its date action", () => {
  assert.doesNotMatch(page, /Ad-hoc production|localhost:4000/);
  assert.match(page, /<div className="cpu-header-tools"><button type="button">/);
  assert.match(page, /Loading date…/);
  assert.match(page, /Operational application/);
});
