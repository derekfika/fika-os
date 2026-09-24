import assert from "node:assert/strict";
import test from "node:test";
import { fulfilmentWorkstream } from "../../shared/fulfilment-workstream";
import { formatLoadCount, timelineEventAreaHtml, timelineEventInlineHtml, timelineEventTooltip } from "../lib/timeline-presentation";

test("explicit production classifications become stable operator workstream labels", () => {
  assert.equal(fulfilmentWorkstream({ sourceDomain: "menu-planning" }), "Delivered-In");
  assert.equal(fulfilmentWorkstream({ origin: "hospitality_booking" }), "Hospitality");
  assert.equal(fulfilmentWorkstream({ productionCategory: "grab_and_go" }), "Grab & Go");
  assert.equal(fulfilmentWorkstream({ productionCategory: "fine_dining" }), "Fine Dining");
  assert.equal(fulfilmentWorkstream({ productionCategory: "events" }), "Events");
  assert.equal(fulfilmentWorkstream({ origin: "cpu_created" }), "CPU Production");
  assert.equal(fulfilmentWorkstream({ sourceDomain: "cpu-production" }), "CPU Production");
});

test("timeline presentation shows only time, destination and canonical load count", () => {
  const presentation = { destination: "One Angel Court", time: "07:00", loadCount: 1, vehicle: "Van 2", lane: "delivery" as const };
  const area = timelineEventAreaHtml(presentation);
  assert.match(area, /One Angel Court/);
  assert.match(area, /1 load/);
  assert.match(timelineEventInlineHtml(presentation), /07:00/);
  assert.doesNotMatch(area, /Delivered-In|CPU Production|quantity|portion/);
  assert.equal(timelineEventTooltip(presentation), "Destination: One Angel Court\nTime: 07:00\n1 load\nVehicle: Van 2\nOperation: Delivery");
  assert.doesNotMatch(area, /cpu-production/);
});

test("timeline load count pluralises without using displayed quantity", () => {
  assert.equal(formatLoadCount(1), "1 load");
  assert.equal(formatLoadCount(2), "2 loads");
  assert.equal(formatLoadCount(0), "1 load");
});

test("timeline label HTML escapes destination snapshots", () => {
  assert.match(timelineEventAreaHtml({ destination: "A < B", time: "08:00", loadCount: 2, lane: "delivery" }), /A &lt; B/);
});
