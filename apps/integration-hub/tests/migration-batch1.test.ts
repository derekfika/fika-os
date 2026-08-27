import test from "node:test";
import assert from "node:assert/strict";
import { assertDestinationSafety, documentHash, findEnvironmentWarnings, isProtectedCollection, selectBatch1, stableSerialize } from "../scripts/migrate-batch1";

function fake(id: string, data: Record<string, unknown>) { return { id, data: () => data } as never; }

test("destination safety rejects non-staging project and emulator configuration", () => {
  assert.throws(() => assertDestinationSafety({ FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "other-project" }), /fika-os-dev/);
  assert.throws(() => assertDestinationSafety({ FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085" }), /emulator/);
});

test("AUTHMOD collections are always protected", () => {
  assert.equal(isProtectedCollection("authmodIdentities"), true);
  assert.equal(isProtectedCollection("authmodApplications"), true);
  assert.equal(isProtectedCollection("integrationHubCanonical"), false);
});

test("selection excludes unallowlisted entities and selects directly related provenance", () => {
  const selectedCanonical = fake("oploc-doc", { canonicalId: "oploc:one", entityType: "OPLOC", publicationStatus: "published", lifecycleStatus: "published", record: { addressReference: "address:one" } });
  const address = fake("address-doc", { canonicalId: "address:one", entityType: "Address", publicationStatus: "published", lifecycleStatus: "published", record: { approvalState: "approved" } });
  const legend = fake("legend-doc", { canonicalId: "legend:one", entityType: "Legend", publicationStatus: "published", lifecycleStatus: "published" });
  const revision = fake("revision-doc", { canonicalId: "oploc:one", entityType: "OPLOC" });
  const unrelated = fake("unrelated-doc", { canonicalId: "oploc:other", entityType: "OPLOC" });
  const result = selectBatch1([selectedCanonical, address, legend, unrelated], { integrationHubCanonicalRevisions: [revision], integrationHubSourceMappings: [], integrationHubGovernanceAudit: [] });
  assert.deepEqual(result.core.map(item => item.canonicalId), ["oploc:one", "address:one"]);
  assert.deepEqual(result.provenance.map(item => item.id), ["revision-doc"]);
});

test("published OPLOCs use lifecycle status when legacy publicationStatus is absent", () => {
  const oploc = fake("oploc-legacy-publication", { canonicalId: "oploc:legacy-publication", entityType: "OPLOC", lifecycleStatus: "published" });
  const selected = selectBatch1([oploc], { integrationHubCanonicalRevisions: [], integrationHubSourceMappings: [], integrationHubGovernanceAudit: [] });
  assert.deepEqual(selected.core.map(record => record.canonicalId), ["oploc:legacy-publication"]);
});

test("hash is deterministic and preserves document identity separately", () => {
  assert.equal(stableSerialize({ b: 2, a: 1 }), stableSerialize({ a: 1, b: 2 }));
  assert.equal(documentHash({ b: 2, a: 1 }), documentHash({ a: 1, b: 2 }));
});

test("environment-specific values are reported without printing their contents", () => {
  const record = { collection: "integrationHubCanonical" as const, id: "x", data: { canonicalId: "oploc:x", localUrl: "http://localhost:3200", actorId: "local-cpu" }, hash: "x" };
  const warnings = findEnvironmentWarnings([record]);
  assert.ok(warnings.some(warning => warning.kind === "local/emulator value"));
  assert.ok(warnings.some(warning => warning.field === "localUrl"));
});
