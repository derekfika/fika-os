import assert from "node:assert/strict";
import test from "node:test";
import {
  MunichReOperationalAreas,
  MunichReOperationalAreaTypes,
} from "../lib/munich-re-operational-areas";
import { permissionsForRole } from "../lib/authmod";
import { parseCanonical } from "../lib/schemas";

test("Munich RE has exactly the four approved Operational Area definitions", () => {
  assert.equal(MunichReOperationalAreas.length, 4);
  assert.deepEqual(MunichReOperationalAreas.map((area) => area.name), [
    "3rd Floor Coffee Bar",
    "5th Floor Coffee Bar",
    "2nd Floor Hot Food Servery",
    "2nd Floor Confectionery Stand",
  ]);
  assert.equal(new Set(MunichReOperationalAreas.map((area) => area.floorLevel)).size, 3);
  assert.deepEqual(MunichReOperationalAreaTypes.map((type) => type.name), ["Coffee Bar", "Hot Food Servery", "Retail / Grab-and-Go"]);
});

test("the provider-specific fifth-floor mapping is explicit while the third-floor mapping is not inferred", () => {
  const fifth = MunichReOperationalAreas.find((area) => area.name === "5th Floor Coffee Bar");
  const third = MunichReOperationalAreas.find((area) => area.name === "3rd Floor Coffee Bar");
  assert.ok(fifth?.description.includes("former Munich RE 5th Floor"));
  assert.ok(third);
  assert.equal(MunichReOperationalAreas.filter((area) => area.name.includes("Coffee Bar")).length, 2);
});

test("an Operational Area retains its immutable identity and provider mapping seam when archived", () => {
  const record = {
    schemaVersion: "0.1.0",
    version: 2,
    createdAt: "2026-07-29T20:00:00.000Z",
    createdBy: "person:test",
    updatedAt: "2026-07-29T20:01:00.000Z",
    updatedBy: "person:test",
    active: true,
    externalIdentities: [],
    provenanceIds: [],
    ownership: { providerOwned: {}, fikaOwned: {} },
    entityType: "Operational Area" as const,
    canonicalId: "operational-area:fifth-floor-coffee-bar",
    areaId: "operational-area:fifth-floor-coffee-bar",
    oplocId: "oploc:munich-re",
    name: "5th Floor Coffee Bar",
    areaTypeId: "operational-area-type:coffee-bar",
    floorLevel: 5,
    lifecycleState: "archived" as const,
    aliases: [],
  };
  assert.equal(parseCanonical("Operational Area", record).success, true);
  assert.equal(record.canonicalId, record.areaId);
  assert.equal(record.oplocId, "oploc:munich-re");
});

test("Operational Areas do not alter AUTHMOD permissions", () => {
  assert.deepEqual(permissionsForRole("integration-admin"), [
    "canonical.view", "canonical.create", "canonical.edit", "oploc.approve-identity", "oploc.approve-location-type", "oploc.link-address", "oploc.replace-address", "address.view", "address.create", "address.edit", "address.approve", "address.lifecycle", "address.lock", "address.prepare-publication", "address.publish", "legend.approve", "employment.manage", "operational-assignment.approve", "operational-capability.approve-catalogue", "operational-capability.approve-enablement", "canonical.lifecycle", "canonical.prepare-publication", "canonical.publish", "canonical.lock",
  ]);
});
