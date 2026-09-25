import assert from "node:assert/strict";
import test from "node:test";
import { fulfilmentWorkstream } from "../../shared/fulfilment-workstream";
import { formatLoadCount, timelineEventCardWidth, timelineEventHtml, timelineEventTooltip } from "../lib/timeline-presentation";

test("explicit production classifications become stable operator workstream labels", () => {
  assert.equal(fulfilmentWorkstream({ sourceDomain: "menu-planning" }), "Delivered-In");
  assert.equal(fulfilmentWorkstream({ origin: "hospitality_booking" }), "Hospitality");
  assert.equal(fulfilmentWorkstream({ productionCategory: "grab_and_go" }), "Grab & Go");
  assert.equal(fulfilmentWorkstream({ productionCategory: "fine_dining" }), "Fine Dining");
  assert.equal(fulfilmentWorkstream({ productionCategory: "events" }), "Events");
  assert.equal(fulfilmentWorkstream({ origin: "cpu_created" }), "CPU Production");
  assert.equal(fulfilmentWorkstream({ sourceDomain: "cpu-production" }), "CPU Production");
});

test("timeline presentation is one start-anchored card with canonical load count", () => {
  const presentation = { destination: "One Angel Court", time: "07:00", loadCount: 1, vehicle: "Van 2", lane: "delivery" as const };
  const card = timelineEventHtml(presentation);
  assert.match(card, /class="fika-event-card"/);
  assert.match(card, /07:00/);
  assert.match(card, /One Angel Court/);
  assert.match(card, /1 load/);
  assert.match(card, /--fika-event-card-width:124px/);
  assert.doesNotMatch(card, /Delivered-In|CPU Production|quantity|portion/);
  assert.equal(timelineEventTooltip(presentation), "Destination: One Angel Court\nTime: 07:00\n1 load\nVehicle: Van 2\nOperation: Delivery");
  assert.doesNotMatch(card, /cpu-production/);
});

test("timeline load count pluralises without using displayed quantity", () => {
  assert.equal(formatLoadCount(1), "1 load");
  assert.equal(formatLoadCount(2), "2 loads");
  assert.equal(formatLoadCount(0), "1 load");
});

test("timeline label HTML escapes destination snapshots", () => {
  assert.match(timelineEventHtml({ destination: "A < B", time: "08:00", loadCount: 2, lane: "delivery" }), /A &lt; B/);
});

test("nearby starts use a compact card width without shifting the true anchor", () => {
  assert.equal(timelineEventCardWidth(undefined, 36), 124);
  assert.equal(timelineEventCardWidth(30, 36), 68);
  assert.equal(timelineEventCardWidth(15, 36), 36);
  assert.match(timelineEventHtml({ destination: "MNK", time: "07:30", loadCount: 1, lane: "delivery", visualWidth: 68 }), /compact/);
});
