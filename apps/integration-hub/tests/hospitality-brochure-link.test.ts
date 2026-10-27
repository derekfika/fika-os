import assert from "node:assert/strict";
import test from "node:test";
import { planBrochureLink } from "../lib/hospitality-catalogue-admin";

const item = { canonicalId: "hospitality-menu-item:mnk:deli_sandwich_lunch", name: "Deli Style Sandwich Lunch", providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: "deli_sandwich_lunch" }] };
const cfcRow = { provider: "cfc-hospitality-brochure", sourceItemId: "deli-sandwich-lunch" };
const mrRow = { provider: "munich-re-generic-brochure", sourceItemId: "deli-sandwich-lunch" };

test("links the CFC and Munich RE sandwich rows to the company Item, keeping the existing MNK mapping", () => {
  assert.deepEqual(planBrochureLink(item, [], [cfcRow]), [cfcRow]);
  assert.deepEqual(planBrochureLink(item, [], [cfcRow, mrRow]), [cfcRow, mrRow]);
});

test("only the rows that are new to the Item are returned", () => {
  const linked = { ...item, providerMappings: [...item.providerMappings, cfcRow] };
  assert.deepEqual(planBrochureLink(linked, [], [cfcRow, mrRow]), [mrRow]);
});

test("refuses an empty request, a blank row, a duplicate row, and a provider outside the brochure allowlist", () => {
  assert.throws(() => planBrochureLink(item, [], []), /at least one brochure row/);
  assert.throws(() => planBrochureLink(item, [], [{ provider: "cfc-hospitality-brochure", sourceItemId: "  " }]), /source item id/);
  assert.throws(() => planBrochureLink(item, [], [cfcRow, cfcRow]), /listed twice/);
  assert.throws(() => planBrochureLink(item, [], [{ provider: "mnk-booking-platform", sourceItemId: "x" }]), /cannot be linked/);
  assert.throws(() => planBrochureLink(item, [], [{ provider: "rcoa-booking-platform", sourceItemId: "x" }]), /cannot be linked/);
});

test("refuses when every requested row is already linked to this Item", () => {
  const linked = { ...item, providerMappings: [...item.providerMappings, cfcRow] };
  assert.throws(() => planBrochureLink(linked, [], [cfcRow]), /already linked/);
});

test("refuses a row held by another ACTIVE Item, so a brochure row can never point at two Items", () => {
  const other = { canonicalId: "hospitality-menu-item:mnk:other", archived: false, providerMappings: [cfcRow] };
  assert.throws(() => planBrochureLink(item, [other], [cfcRow]), /already linked to another active item/);
});

test("an ARCHIVED holder does not block the link", () => {
  const archived = { canonicalId: "hospitality-menu-item:mnk:old", archived: true, providerMappings: [cfcRow] };
  assert.deepEqual(planBrochureLink(item, [archived], [cfcRow]), [cfcRow]);
});

test("the Item itself never blocks its own link", () => {
  const self = { canonicalId: item.canonicalId, archived: false, providerMappings: [cfcRow] };
  assert.deepEqual(planBrochureLink(item, [self], [mrRow]), [mrRow]);
});

test("the same source id on a different brochure stays separate", () => {
  const cfcHolder = { canonicalId: "hospitality-menu-item:mnk:other", archived: false, providerMappings: [cfcRow] };
  assert.deepEqual(planBrochureLink(item, [cfcHolder], [mrRow]), [mrRow]);
});
