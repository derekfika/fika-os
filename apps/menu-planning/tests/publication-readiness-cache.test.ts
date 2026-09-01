import assert from "node:assert/strict";
import test from "node:test";
import { clearPublicationReadinessCache, loadPublicationReadiness } from "../lib/publication-readiness-cache";

test.beforeEach(() => clearPublicationReadinessCache());

test("reuses a successful readiness result for the same key", async () => {
  let loads = 0;
  const load = async () => { loads += 1; return ["blocked"]; };
  assert.deepEqual(await loadPublicationReadiness("week:v1:day1", load), ["blocked"]);
  assert.deepEqual(await loadPublicationReadiness("week:v1:day1", load), ["blocked"]);
  assert.equal(loads, 1);
});

test("joins concurrent readiness checks and does not cache failures", async () => {
  let loads = 0;
  let fail = true;
  const load = async () => { loads += 1; if (fail) throw new Error("temporary"); return []; };
  await assert.rejects(() => loadPublicationReadiness("week:v1:day1", load), /temporary/);
  fail = false;
  assert.deepEqual(await loadPublicationReadiness("week:v1:day1", load), []);
  assert.equal(loads, 2);
});
