import test from "node:test";
import assert from "node:assert/strict";
import { assignWeeks, copyWeeks } from "../components/rotation-workspace-model";

test("bulk rotation edits preserve order, scope and independent arrays", () => {
  const initial = Array.from({ length: 6 }, () => [] as string[]);
  const ids = Array.from({ length: 15 }, (_, i) => `dish-${i}`);
  const all = assignWeeks(initial, ids, [0, 1, 2, 3, 4, 5]);
  const twice = assignWeeks(all, ids, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(
    twice,
    Array.from({ length: 6 }, () => ids),
  );
  assert.notEqual(all[0], all[1]);
  assert.deepEqual(
    initial,
    Array.from({ length: 6 }, () => []),
  );
  const removed = assignWeeks(twice, ids.slice(0, 2), [1], true);
  const added = assignWeeks(removed, ["new"], [2, 4]);
  assert.deepEqual(added[1], ids.slice(2));
  assert.deepEqual(added[2], [...ids, "new"]);
  assert.deepEqual(added[4], [...ids, "new"]);
  assert.deepEqual(added[3], ids);
  assert.equal(copyWeeks(added, 0, [5], null), null);
  const copied = copyWeeks(added, 0, [5], JSON.stringify(added))!;
  assert.deepEqual(copied[5], ids);
  assert.notEqual(copied[0], copied[5]);
  assert.deepEqual(added[5], ids);
});

test("copy permits empty weeks and rejects stale confirmation", () => {
  const weeks = [["a"], [], ["b"], [], [], []];
  assert.deepEqual(copyWeeks(weeks, 0, [1, 3], null)?.[1], ["a"]);
  assert.equal(copyWeeks(weeks, 0, [2], JSON.stringify([["old"]])), null);
  assert.equal(copyWeeks(weeks, 0, [0], null), null);
});
