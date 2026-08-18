import assert from "node:assert/strict";
import test from "node:test";
import { acceptedPublishedCanonicalPage, acceptedPublishedOplocPage } from "../lib/canonical-boundary";
import type { CanonicalRecord } from "../lib/types";

const record = (canonicalId: string, entityType: CanonicalRecord["entityType"], lifecycleStatus: CanonicalRecord["lifecycleStatus"], primaryLocationType?: "Site" | "Venue") => ({ canonicalId, entityType, lifecycleStatus, dataHash: "hash", record: { schemaVersion: "0.1.0", primaryLocationType, raw: "must-not-shape-selection" } }) as CanonicalRecord;

test("canonical boundary exposes published OPLOCs only with type filters and deterministic pagination", () => {
  const input = [record("oploc:c", "OPLOC", "published", "Venue"), record("site:legacy", "Site", "published"), record("oploc:b", "OPLOC", "needs-review", "Site"), record("oploc:a", "OPLOC", "published", "Site")];
  const first = acceptedPublishedOplocPage(input, { entityType: "OPLOC", limit: 1 });
  assert.deepEqual(first.records.map(value => value.canonicalId), ["oploc:a"]); assert.equal(first.nextCursor, "oploc:a");
  assert.deepEqual(acceptedPublishedOplocPage(input, { locationType: "Venue", limit: 20 }).records.map(value => value.canonicalId), ["oploc:c"]);
  assert.deepEqual(acceptedPublishedOplocPage(input, { limit: 20, after: "oploc:a" }).records.map(value => value.canonicalId), ["oploc:c"]);
  assert.deepEqual(acceptedPublishedCanonicalPage([...input, record("legend:published", "Legend", "published")], { entityType: "Legend", limit: 20 }).records.map(value => value.canonicalId), ["legend:published"]);
  assert.throws(() => acceptedPublishedCanonicalPage(input, { entityType: "Site", limit: 20 }), /not an Accepted Canon/);
  assert.throws(() => acceptedPublishedCanonicalPage(input, { entityType: "Legend", locationType: "Site", limit: 20 }), /applies only to OPLOC/);
});
