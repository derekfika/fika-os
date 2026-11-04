import assert from "node:assert/strict";
import test from "node:test";
import { fulfilmentFromProductionOrder, type ProductionOrderFulfilmentSource } from "../../shared/fulfilment-requirement";
import { logisticsJobForRequirement, reconcileRequirementJob } from "../lib/logistics-materialisation";
import { createLoad, compatibleLoad } from "../lib/delivery-loads";
import { combineStop } from "../lib/planning";
import { sameMenuDestination } from "@fika/server-shared/menu-destination";

const destination = { kind: "one-off" as const, id: "day:fixture:one-off:1", sourceDayId: "day:fixture", label: "Synthetic event", address: "10 Test Street", contact: "Synthetic receiving team", deliveryInstructions: "Use reception" };
const order: ProductionOrderFulfilmentSource = { canonicalId: "order:synthetic", version: 1, sourceEntityId: destination.sourceDayId, origin: "menu_planning", productionLocationId: "oploc:cpu", destinationOplocId: destination.id, destination, destinationLabel: destination.label, serviceDate: "2098-11-03", requiredBy: "2098-11-03T00:00", status: "menu_available", lines: [{ canonicalId: "line:synthetic", itemName: "Synthetic dish", customerQuantity: 7, customerUnit: "portion", productionQuantity: 7, productionUnit: "portion", sortOrder: 0 }] };
const at = "2098-11-03T09:00:00Z";
const requirement = fulfilmentFromProductionOrder(order, "isolated-planner", at);

test("one-off fulfilment is stable on replay and preserves quantities, routing and unscheduled time", () => {
  assert.equal(fulfilmentFromProductionOrder(order, "isolated-planner", at, requirement), requirement);
  assert.deepEqual(requirement.destination, destination);
  assert.equal(requirement.lines[0].quantity, 7);
  assert.equal(requirement.readyAt, undefined);
  assert.throws(() => fulfilmentFromProductionOrder({ ...order, sourceEntityId: "another-day" }, "isolated-planner", at), /does not belong/);
  assert.throws(() => fulfilmentFromProductionOrder({ ...order, destinationOplocId: "oploc:unrelated" }, "isolated-planner", at), /does not match/);
});

test("one-off loads retain exact snapshots, tolerate Firestore map order and reject changed routing", () => {
  const job = logisticsJobForRequirement(requirement, undefined, "isolated-dispatcher", at);
  const load = createLoad({ serviceDate: job.serviceDate, originOplocId: job.originOplocId!, destinationOplocId: destination.id, destination, scheduledTime: "11:30", by: "isolated-dispatcher", now: at });
  assert.ok(compatibleLoad(job, load));
  assert.ok(sameMenuDestination(destination, { deliveryInstructions: destination.deliveryInstructions, contact: destination.contact, address: destination.address, label: destination.label, sourceDayId: destination.sourceDayId, id: destination.id, kind: "one-off" }));
  for (const changed of [{ ...destination, address: "99 Amended Test Street" }, { ...destination, contact: "Other receiving team" }, { ...destination, deliveryInstructions: "Use loading bay" }]) assert.equal(compatibleLoad({ ...job, destination: changed }, load), false);
  assert.equal(compatibleLoad(job, { ...load, destination: undefined }), false);
});

test("native one-off stops carry addresses and never merge distinct scoped identities by name", () => {
  const first = combineStop([], { runId: "run:synthetic", locationOplocId: destination.id, locationLabel: destination.label, requirement, by: "isolated-dispatcher", now: at });
  assert.equal(first.locationOplocId, "");
  assert.equal(first.oneOffEndpointId, destination.id);
  assert.equal(first.locationAddressSnapshot, destination.address);
  const other = fulfilmentFromProductionOrder({ ...order, canonicalId: "order:other", destination: { ...destination, id: "day:fixture:one-off:2" }, destinationOplocId: "day:fixture:one-off:2" }, "isolated-planner", at);
  const second = combineStop([first], { runId: "run:synthetic", locationOplocId: other.destinationOplocId, locationLabel: destination.label, requirement: other, by: "isolated-dispatcher", now: at });
  assert.notEqual(second.canonicalId, first.canonicalId);
  assert.equal(second.requirementRefs.length, 1);
  assert.notEqual(second.oneOffEndpointId, first.oneOffEndpointId);
});

test("emulator: one-off routing amendment retains completed native movement evidence", { skip: process.env.FIKA_RECOVERY_EMULATOR_TEST !== "1" }, async () => {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-fika-os");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const stores = await import("../lib/store");
  const prefix = `recovery:${Date.now()}:${process.pid}`;
  const job = logisticsJobForRequirement(requirement, undefined, "isolated-dispatcher", at);
  job.id = prefix;
  const stop = { ...combineStop([], { runId: `${prefix}:run`, locationOplocId: destination.id, locationLabel: destination.label, requirement, by: "isolated-dispatcher", now: at }), status: "completed" as const };
  const run = { canonicalId: stop.runId, serviceDate: order.serviceDate!, status: "completed" as const, orderedStopIds: [stop.canonicalId], version: 1, createdAt: at, updatedAt: at, audit: [] };
  await stores.logisticsJobs().doc(job.id).set(job);
  await stores.stops().doc(stop.canonicalId).set(stop);
  await stores.runs().doc(run.canonicalId).set(run);
  const amended = fulfilmentFromProductionOrder({ ...order, version: 2, destination: { ...destination, address: "99 Amended Test Street" } }, "isolated-planner", at, requirement);
  await reconcileRequirementJob(job.id, amended, "isolated-dispatcher", at, { stops: [stop], runs: [run] });
  const persisted = (await stores.stops().doc(stop.canonicalId).get()).data();
  assert.equal(persisted?.status, "completed");
  assert.equal(persisted?.locationAddressSnapshot, destination.address);
  assert.equal(persisted?.requirementRefs[0].sourceVersion, 1);
  assert.equal((await stores.logisticsJobs().doc(job.id).get()).data()?.productionReadiness, "attention");
  assert.equal((await stores.runs().doc(run.canonicalId).get()).exists, true);
});
