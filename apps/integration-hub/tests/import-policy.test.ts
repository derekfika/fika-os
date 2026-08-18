import assert from "node:assert/strict";
import test from "node:test";
import { DeferredImportEntityTypes, isImportDeferred } from "../lib/import-policy";
import { CanonicalEntityNames } from "../lib/schemas";

test("Till Item imports are deliberately deferred without removing their schemas", () => {
  assert.deepEqual([...DeferredImportEntityTypes].sort(), ["Till Item", "Till Item Variation"]);
  assert.equal(isImportDeferred("Till Item"), true);
  assert.equal(isImportDeferred("Till Item Variation"), true);
  for (const entityType of CanonicalEntityNames.filter(entityType => !DeferredImportEntityTypes.includes(entityType))) assert.equal(isImportDeferred(entityType), false);
});
