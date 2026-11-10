import assert from "node:assert/strict";
import { test } from "node:test";
import { isHotForkBuffetBooking } from "./hot-fork-buffet";

test("Hot Fork Buffet classification uses known canonical and exact legacy item identities", () => {
  assert.equal(isHotForkBuffetBooking({ order: { items: [{ itemId: "hospitality-menu-item:rcoa:hot_fork_buffet_gold" }] } }), true);
  assert.equal(isHotForkBuffetBooking({ order: { items: [{ itemId: "other", menuItemId: "hospitality-menu-item:mnk:hot_fork_buffet_silver" }] } }), true);
  assert.equal(isHotForkBuffetBooking({ source: { provider: "rcoa-booking-platform" }, order: { items: [{ itemId: "hot_fork_buffet_gold" }] } }), true);
  assert.equal(isHotForkBuffetBooking({ source: { provider: "other" }, order: { items: [{ itemId: "hot_fork_buffet_gold" }] } }), false);
  assert.equal(isHotForkBuffetBooking({ order: { items: [{ itemId: "hospitality-menu-item:rcoa:hot_fork_buffet_gold-extra" }] } }), false);
});