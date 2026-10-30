import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CANONICAL_DISH_CATEGORIES } from "../lib/dish-categories";
import { DISH_TAG_SEED } from "../lib/dish-tag-seed";
import { emptyDishTagRegistry, mergeSeedTags, tagKey } from "../lib/dish-tags";

const AT = "2026-10-30T12:00:00.000Z";

test("the approved seed is 28 tags: 8 type, 12 cuisine, 8 style, no occasion", () => {
  assert.equal(DISH_TAG_SEED.length, 28);
  const count = (group: string) => DISH_TAG_SEED.filter((tag) => tag.group === group).length;
  assert.deepEqual([count("type"), count("cuisine"), count("style"), count("occasion"), count("ingredient")], [8, 12, 8, 0, 0]);
});

test("no seed tag restates a governed primary category", () => {
  const categories = new Set([...CANONICAL_DISH_CATEGORIES, "Side", "Vegetarian Main"].map(tagKey));
  assert.deepEqual(DISH_TAG_SEED.filter((tag) => categories.has(tagKey(tag.label))).map((tag) => tag.label), []);
});

test("seeding creates every tag once, with stable IDs, and re-running adds nothing", () => {
  const first = mergeSeedTags(emptyDishTagRegistry(), DISH_TAG_SEED, "seed", AT);
  assert.equal(first.added.length, 28);
  assert.equal(new Set(first.registry.tags.map((tag) => tag.id)).size, 28);
  assert.ok(first.registry.tags.some((tag) => tag.id === "dish-tag:type:grain-pulse"));
  assert.ok(first.registry.tags.some((tag) => tag.id === "dish-tag:cuisine:middle-eastern-inspired"));
  const again = mergeSeedTags(first.registry, DISH_TAG_SEED, "seed", AT);
  assert.equal(again.added.length, 0);
  assert.equal(again.registry, first.registry);
});

test("the seed script is staging-only, dry-run by default and assigns nothing to dishes", () => {
  const script = readFileSync(new URL("../scripts/seed-dish-tags.ts", import.meta.url), "utf8");
  assert.match(script, /const STAGING_PROJECT = "fika-os-dev"/);
  assert.match(script, /project !== STAGING_PROJECT/);
  assert.match(script, /dryRun: !execute/);
  assert.doesNotMatch(script, /tagIds|createCanonicalMenuItem|updateCanonicalMenuItem|fikaMenuPlanningWeeks/);
});
