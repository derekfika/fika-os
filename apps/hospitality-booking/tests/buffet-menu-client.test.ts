import assert from "node:assert/strict";
import test from "node:test";
import { buffetChoice, buffetMenuView, buffetPackageForItem, buffetPreviewIssue, loadBuffetConfig, parseBuffetPreview, type BuffetPreview } from "../lib/buffet-menu-client";
import { createEmptyRcoaDraft } from "../lib/rcoa-portal";
import { buildRcoaClientRequest } from "../lib/rcoa-booking-request-client";
import type { PortalMenuItem } from "../lib/mnk-contract";

const preview: BuffetPreview = { menuVersion: "fixture-v1", rulesVersion: "rules-final", selection: { packageId: "gold", nonVegetarianMainId: "m", vegetarianMainId: "v", mainPortions: { m: 16, v: 14 }, saladIds: ["s1", "s2", "s3"], dessertIds: ["d1", "d2"] } };
const body = { contract: "fika.hot-fork-buffet-menu.v1", menuVersion: "fixture-v1", rulesVersion: "rules-final", readiness: { customerSubmission: false, stagingCustomerSubmission: false, status: "rules_confirmed", pendingRules: [], liveOrderingApprovalRequired: true }, packages: [
  { id: "gold", canonicalItemIds: ["gold-id", "legacy-gold-id"], rules: { mainChoices: 2, mainMinimumPortions: 12, mainPortionsMustEqualGuests: true, saladChoices: 3, dessertChoices: 2, saladAllocation: "chef-discretion", dessertAllocation: "chef-discretion", dessertMinimumPortions: null, dessertIntent: "equal-split", sides: "included-in-mains", dietaryPortions: "within-guest-count" } },
  { id: "silver", canonicalItemIds: ["silver-id"], rules: { mainChoices: 2, mainMinimumPortions: 12, mainPortionsMustEqualGuests: true, saladChoices: 3, dessertChoices: 1, saladAllocation: "chef-discretion", dessertAllocation: "chef-discretion", dessertMinimumPortions: null, dessertIntent: "one-choice", sides: "included-in-mains", dietaryPortions: "within-guest-count" } },
], dishes: [{ id: "m", category: "meat", name: "Fixture meat", allergenStatus: "unrecorded", dietaryStatus: "unrecorded", selectionStatus: "source_listed" }] };
const menu = (id: string, price: number): PortalMenuItem => ({ id, canonicalId: id, name: id, category: "Fork Buffet & Bowl Food", unitPrice: price, vatRate: null, dietaryInformation: [], allergenInformation: [] });

test("verified menu drives package IDs, prices and preview submission guard", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json(body);
  try {
    const config = await loadBuffetConfig();
    assert.equal(buffetPackageForItem(config, "legacy-gold-id")?.id, "gold");
    const view = buffetMenuView(config, [menu("gold-id", 28), menu("silver-id", 20)], ["gold-id"], "gold-id");
    assert.match(view.packages[0].label, /£28.00 per guest excluding VAT/);
    assert.equal(buffetMenuView(config, [menu("gold-id", 28), menu("silver-id", 20)], ["gold-id", "silver-id"], "gold-id").packages.length, 1);
    const line = { quantity: 30, buffetPreview: preview };
    assert.match(buffetPreviewIssue([line], 30, config)!, /preview/i);
    assert.match(buffetPreviewIssue([line], 30, undefined)!, /reviewed/i);
    const staging = { ...config, readiness: { ...config.readiness, stagingCustomerSubmission: true } };
    assert.equal(buffetPreviewIssue([line], 30, staging), undefined);
    const stillPending = { ...config, readiness: { ...config.readiness, customerSubmission: true } };
    assert.match(buffetPreviewIssue([line], 30, stillPending)!, /approval/i);
    const approved = { ...config, readiness: { ...config.readiness, customerSubmission: true, liveOrderingApprovalRequired: false } };
    assert.equal(buffetPreviewIssue([line], 30, approved), undefined);
    assert.match(buffetPreviewIssue([line], 31, approved)!, /guest count/i);
    assert.match(buffetPreviewIssue([{ quantity: 30, buffetPreview: {} as BuffetPreview }], 30, approved)!, /reviewed/i);
    assert.deepEqual(buffetChoice(preview).value.dessertIds, ["d1", "d2"]);
    assert.equal("desserts" in buffetChoice(preview).value, false);
    const legacy = { ...preview, rulesVersion: undefined, dessertPortions: { d1: 15, d2: 15 } };
    assert.deepEqual(parseBuffetPreview(legacy)?.selection, preview.selection);
    assert.match(buffetPreviewIssue([{ quantity: 30, buffetPreview: legacy }], 30, config)!, /saved again/i);
    assert.equal(buffetPreviewIssue([{ quantity: 30 }], 30, config), undefined);
    const draft = createEmptyRcoaDraft(); draft.lines = [{ itemId: "gold-id", quantity: 30, choices: {}, buffetPreview: preview }];
    const request = buildRcoaClientRequest(draft, [], { bookingId: "fixture", submittedAt: "2026-11-13T00:00:00Z" });
    assert.deepEqual(request.order.items[0].choices[0], buffetChoice(preview));
  } finally { globalThis.fetch = original; }
});

test("malformed or failed server configuration is never substituted with fixture data", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ...body, contract: "unexpected" });
    await assert.rejects(loadBuffetConfig(), /could not be verified/);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(loadBuffetConfig(), /unavailable/);
  } finally { globalThis.fetch = original; }
});
