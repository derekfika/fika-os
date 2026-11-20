import assert from "node:assert/strict";
import test from "node:test";
import {
  copyRotationChoices,
  rotationSource,
} from "../components/rotation-copy";

test("every destination has a different valid source, including week one and the previous week", () => {
  for (let destination = 0; destination < 6; destination++) {
    const source = rotationSource(destination, destination);
    assert.notEqual(source, destination);
    assert.ok(source >= 0 && source < 6);
    assert.equal(source, destination === 0 ? 1 : destination - 1);
  }
  assert.equal(rotationSource(4, 1), 4);
});

test("copy guards replacement and keeps every other week independent", () => {
  const weeks = [["a"], [], ["c"], ["d"], ["e"], ["f"]];
  assert.equal(copyRotationChoices(weeks, 0, 0, true), null);
  assert.equal(copyRotationChoices(weeks, -1, 1, true), null);
  assert.equal(copyRotationChoices(weeks, 0, 2, false), null);
  assert.deepEqual(copyRotationChoices(weeks, 0, 1, false), ["a"]);
  const copied = copyRotationChoices(weeks, 0, 2, true)!;
  const updated = weeks.map((choices, index) =>
    index === 2 ? copied : choices,
  );
  copied.push("new");
  assert.deepEqual(weeks, [["a"], [], ["c"], ["d"], ["e"], ["f"]]);
  assert.deepEqual(updated[0], ["a"]);
  assert.deepEqual(updated[2], ["a", "new"]);
  assert.deepEqual(updated.slice(3), [["d"], ["e"], ["f"]]);
  assert.deepEqual(copyRotationChoices(weeks, 1, 2, true), []);
});
