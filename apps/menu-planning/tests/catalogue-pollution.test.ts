import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syntheticCatalogueCandidate } from "../lib/synthetic-catalogue";
import type { MenuItem } from "../lib/domain";

const item = (patch: Partial<MenuItem> = {}) => ({ canonicalId: "menu-item:local:example", sourceName: "Example", displayName: "Example dish", category: "Salad", weekId: "menu-week:canonical", dayId: "", sourceReference: { workbook: "Menu Planning", sheet: "Local dish creation" }, revision: 1, reviewStatus: "unreviewed" as const, allergenEvidence: [], mayContainReviewed: false, audit: [{ action: "locally-created-in-menu-planning", at: "2026-01-01", by: "local-menu-planner" }], ...patch });

test("synthetic candidate detection needs provenance, not a name alone", () => {
  assert.equal(syntheticCatalogueCandidate(item({ displayName: "Test" })), undefined);
  assert.ok(syntheticCatalogueCandidate(item({ displayName: "Durable Test Dish 123", allergenEvidence: [{ allergen: "sesame", value: "contains", source: "test" }] })));
  assert.equal(syntheticCatalogueCandidate(item({ displayName: "Matrix Dish" })), undefined);
  assert.equal(syntheticCatalogueCandidate(item({ displayName: "Monday Dish" })), undefined);
});

test("cleanup script is dry-run by default and guarded to staging project", () => {
  const source = readFileSync(new URL("../scripts/cleanup-synthetic-catalogue.ts", import.meta.url), "utf8");
  assert.match(source, /FIKA_RUNTIME_MODE !== "staging"/);
  assert.match(source, /projectId !== "fika-os-dev"/);
  assert.match(source, /--confirm-staging-cleanup/);
  assert.match(source, /fikaMenuPlanningCatalogueCleanup/);
});
