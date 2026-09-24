import assert from "node:assert/strict";
import test from "node:test";
import { fulfilmentWorkstream } from "../../shared/fulfilment-workstream";
import { timelineEventAreaHtml, timelineEventTooltip } from "../lib/timeline-presentation";

test("explicit production classifications become stable operator workstream labels", () => {
  assert.equal(fulfilmentWorkstream({ sourceDomain: "menu-planning" }), "Delivered-In");
  assert.equal(fulfilmentWorkstream({ origin: "hospitality_booking" }), "Hospitality");
  assert.equal(fulfilmentWorkstream({ productionCategory: "grab_and_go" }), "Grab & Go");
  assert.equal(fulfilmentWorkstream({ productionCategory: "fine_dining" }), "Fine Dining");
  assert.equal(fulfilmentWorkstream({ productionCategory: "events" }), "Events");
  assert.equal(fulfilmentWorkstream({ origin: "cpu_created" }), "CPU Production");
  assert.equal(fulfilmentWorkstream({ sourceDomain: "cpu-production" }), "CPU Production");
});

test("timeline presentation keeps destination strongest and supplies a complete tooltip", () => {
  const presentation = { destination: "One Angel Court", time: "07:00", workstream: "Delivered-In" as const, quantity: "24 portions", lane: "delivery" as const };
  const area = timelineEventAreaHtml(presentation);
  assert.match(area, /One Angel Court/);
  assert.match(area, /Delivered-In · 24 portions/);
  assert.equal(timelineEventTooltip(presentation), "Destination: One Angel Court\nWorkstream: Delivered-In\nTime: 07:00\nQuantity: 24 portions\nOperation: Delivery");
  assert.doesNotMatch(area, /cpu-production/);
});

test("timeline label HTML escapes destination snapshots", () => {
  assert.match(timelineEventAreaHtml({ destination: "A < B", time: "08:00", workstream: "Events", lane: "delivery" }), /A &lt; B/);
});

