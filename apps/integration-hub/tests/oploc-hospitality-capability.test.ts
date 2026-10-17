import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "../lib/auth";
import { buildCanonicalRecord } from "../lib/canonical-editor";
import { CanonicalFormFields } from "../lib/canonical-form";
import { isHospitalitySite } from "../lib/hospitality-catalogue-loader";
import { parseCanonical } from "../lib/schemas";
import { selectableSites } from "../lib/hospitality-catalogue-view";
import type { CanonicalRecord } from "../lib/types";

const actor: Actor = { uid: "person:approver", name: "Approver", role: "integration-admin", synthetic: true };
const history = [{ assignmentId: "location-type:00000001", locationType: "Site", effectiveFrom: "2026-01-01T00:00:00.000Z", approvedBy: "person:approver", approvedAt: "2026-01-01T00:00:00.000Z", reason: "Initial approved location type." }];
const oplocRecord = (extra: Record<string, unknown> = {}) => ({ schemaVersion: "0.1.0", version: 3, createdAt: "2026-01-01T00:00:00.000Z", createdBy: "person:approver", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "person:approver", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType: "OPLOC", canonicalId: "oploc:00000000-0000-0000-0000-000000000001", approvedName: "Test Site", primaryLocationType: "Site", locationTypeHistory: history, lifecycleState: "active", aliases: [], ...extra });
const wrap = (record: Record<string, unknown>, status = "published"): CanonicalRecord => ({ canonicalId: String(record.canonicalId), entityType: "OPLOC", record, dataHash: "x", lifecycleStatus: status } as unknown as CanonicalRecord);
const edit = (values: Record<string, unknown>, previous: Record<string, unknown>) => buildCanonicalRecord({ entityType: "OPLOC", canonicalId: String(previous.canonicalId), expectedVersion: Number(previous.version), values: { approvedName: "Test Site", primaryLocationType: "Site", locationTypeEffectiveFrom: "2026-01-01", lifecycleState: "active", ...values }, decisionReason: "Mark as a Hospitality catering site." }, actor, previous);

test("the OPLOC schema accepts only a boolean hospitalityEnabled marker; absent means not enabled", () => {
  assert.equal(parseCanonical("OPLOC", oplocRecord()).success, true);
  assert.equal(parseCanonical("OPLOC", oplocRecord({ hospitalityEnabled: true })).success, true);
  assert.equal(parseCanonical("OPLOC", oplocRecord({ hospitalityEnabled: false })).success, true);
  assert.equal(parseCanonical("OPLOC", oplocRecord({ hospitalityEnabled: "yes" })).success, false);
});

test("the governed OPLOC edit sets, clears and carries the marker forward; unrelated edits never drop it", () => {
  const plain = oplocRecord();
  assert.equal(edit({ hospitalityEnabled: "true" }, plain).hospitalityEnabled, true);
  assert.equal(edit({ hospitalityEnabled: true }, plain).hospitalityEnabled, true);
  const enabled = oplocRecord({ hospitalityEnabled: true });
  assert.equal(edit({ approvedName: "Renamed Site" }, enabled).hospitalityEnabled, true, "a rename keeps the capability");
  assert.equal(edit({ hospitalityEnabled: "false" }, enabled).hospitalityEnabled, false, "explicitly switched off");
  assert.equal("hospitalityEnabled" in edit({}, plain), false, "never invented");
  const next = edit({ hospitalityEnabled: "true" }, plain);
  assert.equal(next.version, 4); assert.equal(next.updatedBy, actor.uid);
  const decisions = (next.ownership as { fikaOwned: { humanDecisions: Array<{ actorId: string; reason: string }> } }).fikaOwned.humanDecisions;
  assert.equal(decisions.at(-1)?.actorId, actor.uid); assert.match(decisions.at(-1)!.reason, /Hospitality catering site/, "audit/governance metadata is recorded with the edit");
  assert.ok(CanonicalFormFields.OPLOC.some(field => field.name === "hospitalityEnabled"), "operators can set it through the existing OPLOC editor");
});

test("isHospitalitySite requires the governed marker AND an active, non-archived OPLOC; nothing is inferred", () => {
  assert.equal(isHospitalitySite(wrap(oplocRecord({ hospitalityEnabled: true }))), true);
  assert.equal(isHospitalitySite(wrap(oplocRecord())), false, "no marker");
  assert.equal(isHospitalitySite(wrap(oplocRecord({ hospitalityEnabled: false }))), false);
  assert.equal(isHospitalitySite(wrap(oplocRecord({ hospitalityEnabled: true, lifecycleState: "decommissioned" }))), false, "inactive");
  assert.equal(isHospitalitySite(wrap(oplocRecord({ hospitalityEnabled: true, lifecycleState: "merged", mergedIntoOplocId: "oploc:00000000-0000-0000-0000-000000000009" }))), false);
  assert.equal(isHospitalitySite(wrap(oplocRecord({ hospitalityEnabled: true }), "archived")), false, "archived");
  assert.equal(isHospitalitySite(wrap(oplocRecord({ approvedName: "MNK", aliases: [{ alias: "Hospitality", recordedAt: "2026-01-01T00:00:00.000Z" }] }))), false, "name and aliases never imply capability");
  assert.equal(isHospitalitySite({ ...wrap(oplocRecord({ hospitalityEnabled: true })), entityType: "Address" } as CanonicalRecord), false);
});

test("Select all sites follows the marker: exactly the enabled, active locations", () => {
  const views = [{ oplocId: "oploc:mnk", label: "MNK", active: true, hospitality: true }, { oplocId: "oploc:rcoa", label: "RCoA", active: true, hospitality: true }, { oplocId: "oploc:ac", label: "One Angel Court", active: true, hospitality: true }, { oplocId: "oploc:wise", label: "Wise", active: true, hospitality: false }, { oplocId: "oploc:old", label: "Old", active: false, hospitality: true }];
  assert.deepEqual(selectableSites(views).map(site => site.label), ["MNK", "RCoA", "One Angel Court"]);
  assert.equal(`${selectableSites(views).length} of ${selectableSites(views).length} Hospitality sites selected`, "3 of 3 Hospitality sites selected");
});
