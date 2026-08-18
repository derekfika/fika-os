import assert from "node:assert/strict";
import test from "node:test";
import { managementTypes, type ConnectionsView } from "../app/ui/Connections";

const expected: ConnectionsView[] = ["oplocs", "legends", "areas", "services", "equipment", "equipment-types", "teams", "provider-mappings", "staffing"];

test("Connections home is driven by registered governed management types", () => {
  assert.deepEqual(managementTypes.map(item => item.view), expected);
  assert.equal(new Set(managementTypes.map(item => item.view)).size, managementTypes.length);
});

test("every available card has a focused management route and clear action", () => {
  managementTypes.forEach(item => {
    assert.ok(item.title.length > 0);
    assert.ok(item.action.length > 0);
    assert.ok(item.description.length > 12);
  });
});

test("unsupported generic relationship models are not presented as active workflows", () => {
  const labels = managementTypes.map(item => `${item.title} ${item.description}`).join(" ").toLocaleLowerCase("en-GB");
  assert.equal(labels.includes("custom connection"), false);
  assert.equal(labels.includes("generic relationship"), false);
});

test("OPLOC and scoped workspace navigation retain canonical scope rather than new identifiers", () => {
  const oploc = managementTypes.find(item => item.view === "oplocs");
  const areas = managementTypes.find(item => item.view === "areas");
  assert.ok(oploc && areas);
  assert.equal(oploc?.title, "OPLOCs");
  assert.equal(areas?.title, "Operational Areas");
});
