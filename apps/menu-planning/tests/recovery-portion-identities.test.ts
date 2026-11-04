import assert from "node:assert/strict";
import test from "node:test";
import { allocationMatchesPortionDestination, draftValueMatchesPersisted, persistedPortionValue, reconcilePortionDraft } from "../lib/portion-draft";

const governed = { id: "oploc:synthetic", label: "Same name" };
const oneOff = { id: "oneoff:day:synthetic:one-off:1", label: "Same name", address: "10 Test Street", oneOff: true };
const allocations = [{ destinationId: governed.id, destinationLabel: governed.label, quantity: 4 }, { oneOffDestinationId: "day:synthetic:one-off:1", destinationLabel: oneOff.label, destinationAddress: oneOff.address, quantity: 7 }];

test("portion draft reconciliation keeps governed and one-off identities separate even with equal names", () => {
  const entry = { id: "entry:synthetic", allocations };
  assert.equal(persistedPortionValue(entry, governed), 4);
  assert.equal(persistedPortionValue(entry, oneOff), 7);
  assert.equal(draftValueMatchesPersisted("4", entry, oneOff), false);
  assert.deepEqual(reconcilePortionDraft({ [`${entry.id}|${oneOff.id}`]: "4", [`${entry.id}|${governed.id}`]: "4" }, [entry], [governed, oneOff]), { [`${entry.id}|${oneOff.id}`]: "4" });
  assert.equal(allocationMatchesPortionDestination(allocations[1], governed), false);
});

test("one-off scoped IDs survive renames and two same-name one-offs never steal each other's portions", () => {
  const other = { ...oneOff, id: "oneoff:day:synthetic:one-off:2" };
  const allocation = { ...allocations[1], destination: { kind: "one-off" as const, id: "day:synthetic:one-off:1" } };
  assert.equal(allocationMatchesPortionDestination(allocation, { ...oneOff, label: "Updated name" }), true);
  assert.equal(allocationMatchesPortionDestination(allocation, other), false);
  assert.equal(persistedPortionValue({ id: "entry", allocations: [allocation] }, other), 0);
});

test("historical unscoped allocation display stays compatible and ordinary zero/blank draft handling remains intact", () => {
  const entry = { id: "legacy", allocations: [{ destinationLabel: "Same name", destinationAddress: "10 Test Street", quantity: 7 }] };
  assert.equal(persistedPortionValue(entry, oneOff), 7);
  assert.equal(persistedPortionValue(entry, { ...oneOff, address: "Other address" }), 0);
  assert.equal(draftValueMatchesPersisted("", { id: "blank", allocations: [] }, oneOff), true);
  assert.equal(draftValueMatchesPersisted("NaN", entry, oneOff), false);
  assert.equal(draftValueMatchesPersisted("-1", entry, oneOff), false);
});
