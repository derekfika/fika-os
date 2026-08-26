import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthmodReason } from "../lib/authmod-reasons";

test("routine access accepts a predefined reason without free text", () => {
  assert.equal(resolveAuthmodReason({ action: "site", reasonCode: "site_responsibility" }), "Site responsibility");
  assert.equal(resolveAuthmodReason({ action: "app", reasonCode: "new_starter", reasonNote: "Kitchen induction" }), "New starter — Kitchen induction");
  assert.equal(resolveAuthmodReason({ action: "legend", reasonCode: "access_correction" }), "Access correction");
});

test("Other routine access requires an explanation", () => {
  assert.throws(() => resolveAuthmodReason({ action: "app", reasonCode: "other" }), /short explanation/);
  assert.equal(resolveAuthmodReason({ action: "app", reasonCode: "other", reasonNote: "Reviewed exception" }), "Other — Reviewed exception");
});

test("sensitive changes retain meaningful free-text confirmation", () => {
  assert.throws(() => resolveAuthmodReason({ action: "full-access", reasonCode: "operational_requirement" }), /specific explanation/);
  assert.equal(resolveAuthmodReason({ action: "full-access", reasonCode: "operational_requirement", reasonNote: "Approved by operations lead" }), "Operational requirement — Approved by operations lead");
  assert.equal(resolveAuthmodReason({ action: "authority-grant", reason: "Reviewed special authority." }), "Reviewed special authority.");
});

test("arbitrary reason codes are rejected server-side", () => {
  assert.throws(() => resolveAuthmodReason({ action: "site", reasonCode: "give_everything" }), /valid AUTHMOD access-change reason/);
  assert.throws(() => resolveAuthmodReason({ action: "site" }), /Choose a reason/);
});
