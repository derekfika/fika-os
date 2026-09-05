import assert from "node:assert/strict";
import test from "node:test";
import { buildOplocRedirects, legacyOplocIds } from "../lib/oploc-redirects";

const oploc = (canonicalId: string, lifecycleState: "active" | "merged", mergedIntoOplocId?: string) => ({ entityType: "OPLOC" as const, canonicalId, record: { lifecycleState, ...(mergedIntoOplocId ? { mergedIntoOplocId } : {}) } });

test("Hub publishes transitive OPLOC redirects and legacy IDs", () => {
  const redirects = buildOplocRedirects([oploc("oploc:current", "active"), oploc("oploc:old", "merged", "oploc:current"), oploc("oploc:older", "merged", "oploc:old")]);
  assert.deepEqual(redirects, { "oploc:old": "oploc:current", "oploc:older": "oploc:current" });
  assert.deepEqual(legacyOplocIds(redirects, "oploc:current"), ["oploc:old", "oploc:older"]);
});

test("Hub publishes source-reference aliases attached to the surviving OPLOC", () => {
  const redirects = buildOplocRedirects([
    { entityType: "OPLOC", canonicalId: "oploc:current", record: { lifecycleState: "active", aliases: [{ sourceReference: "oploc:old" }] } },
  ] as never[]);
  assert.deepEqual(redirects, { "oploc:old": "oploc:current" });
  assert.deepEqual(legacyOplocIds(redirects, "oploc:current"), ["oploc:old"]);
});

test("Hub rejects cyclic OPLOC redirects", () => {
  assert.throws(() => buildOplocRedirects([oploc("oploc:a", "merged", "oploc:b"), oploc("oploc:b", "merged", "oploc:a")]), /cycle/i);
});

test("Haleon historical assignment resolves to one current OPLOC", () => {
  const historical = "oploc:46701265-15af-48f4-a230-1d27ca21bc59";
  const current = "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b";
  const redirects = buildOplocRedirects([oploc(current, "active"), oploc(historical, "merged", current)]);
  const resolved = [...new Set([historical, current].map(id => redirects[id] || id))];
  assert.deepEqual(resolved, [current]);
});
