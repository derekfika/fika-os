import assert from "node:assert/strict";
import test from "node:test";
import { productMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";
import { menuChoiceReferences, removeProductMenuGroup } from "../components/product-menu-editor-model";

test("removing a group keeps dish revisions in every rotation week, including weeks without the destination group", () => {
  const retained = { dishId: "retained", revision: 1 };
  const oldRevision = { dishId: "moved", revision: 2 };
  const recentRevision = { dishId: "moved", revision: 4 };
  const source = productMenuConfiguration.parse({
    presentation: "quantities",
    groups: [{ id: "keep", name: "Keep" }, { id: "remove", name: "Remove" }],
    schedule: { kind: "rotation", anchorMonday: "2026-11-30", weeks: [
      { dishes: [], groups: [{ groupId: "remove", dishes: [oldRevision] }] },
      { dishes: [], groups: [{ groupId: "keep", dishes: [retained] }, { groupId: "remove", dishes: [recentRevision] }] },
      { dishes: [], groups: [] },
    ] },
  });
  const result = productMenuConfiguration.parse(removeProductMenuGroup(source, "remove"));
  assert.deepEqual(result.groups, [{ id: "keep", name: "Keep" }]);
  assert.equal(result.schedule.kind, "rotation");
  assert.deepEqual(result.schedule.weeks.map(slot => slot.groups), [
    [{ groupId: "keep", dishes: [oldRevision] }],
    [{ groupId: "keep", dishes: [retained, recentRevision] }],
    [],
  ]);
  const ungrouped = productMenuConfiguration.parse(removeProductMenuGroup(result, "keep"));
  assert.equal(ungrouped.schedule.kind, "rotation");
  assert.deepEqual(ungrouped.schedule.weeks.map(menuChoiceReferences), [[oldRevision], [retained, recentRevision], []]);
  assert.ok(ungrouped.schedule.weeks.every(slot => !slot.groups.length));
});
