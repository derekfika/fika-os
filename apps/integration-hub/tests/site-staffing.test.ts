import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { permissionsForRole } from "../lib/authmod";
import { SchemaCatalogue } from "../lib/schema-catalogue";
import { parseCanonical, type CanonicalEntityType } from "../lib/schemas";
import {
  staffingCoverage,
  validateSiteRoleAssignment,
  validateStaffingRequirement,
} from "../lib/site-staffing-development";
import type { CanonicalRecord } from "../lib/types";

const today = "2026-07-29";
const role = record("Staffing Role", "staffing-role:barista", {
  name: "Barista",
  description: "Prepares and serves coffee.",
  active: true,
});
const oplocOne = record("OPLOC", "oploc:munich-re", {
  approvedName: "Munich RE",
});
const oplocTwo = record("OPLOC", "oploc:angel-court", {
  approvedName: "One Angel Court",
});
const activeLegend = record("Legend", "legend:active", {
  displayName: "Active Legend",
  active: true,
});
const terminatedLegend = record("Legend", "legend:terminated", {
  displayName: "Historical Legend",
  active: false,
  employmentState: "Terminated",
});
const requirement = record(
  "Site Staffing Requirement",
  "site-staffing-requirement:munich-barista",
  {
    oplocId: oplocOne.canonicalId,
    staffingRoleId: role.canonicalId,
    requiredHeadcount: 2,
    effectiveFrom: today,
  },
);

test("the existing development Staffing Role model is reused once", () => {
  assert.equal(
    SchemaCatalogue.filter((item) => item.entityType === "Staffing Role").length,
    1,
  );
  assert.equal(
    SchemaCatalogue.find((item) => item.entityType === "Staffing Role")
      ?.definitionStatus,
    "development-only",
  );
  assert.equal(parseCanonical("Staffing Role", role.record).success, true);
});

test("a Site Staffing Requirement can be created for an OPLOC", () => {
  assert.doesNotThrow(() =>
    validateStaffingRequirement({
      values: requirement.record as never,
      oplocs: [oplocOne],
      roles: [role],
      requirements: [],
    }),
  );
  assert.equal(
    parseCanonical("Site Staffing Requirement", requirement.record).success,
    true,
  );
});

test("a Legend can fill a required role and hold roles at multiple OPLOCs", () => {
  const first = siteAssignment(
    "site-role-assignment:first",
    activeLegend.canonicalId,
    oplocOne.canonicalId,
    true,
  );
  const secondValues = assignmentValues(
    activeLegend.canonicalId,
    oplocTwo.canonicalId,
    false,
  );
  assert.deepEqual(
    validateSiteRoleAssignment({
      values: first.record as never,
      legends: [activeLegend],
      employments: [],
      oplocs: [oplocOne, oplocTwo],
      roles: [role],
      assignments: [],
      requirements: [requirement],
    }),
    [],
  );
  assert.doesNotThrow(() =>
    validateSiteRoleAssignment({
      values: secondValues,
      legends: [activeLegend],
      employments: [],
      oplocs: [oplocOne, oplocTwo],
      roles: [role],
      assignments: [first],
      requirements: [],
    }),
  );
  assert.equal(parseCanonical("Site Role Assignment", first.record).success, true);
});

test("vacancy and surplus counts are calculated rather than stored", () => {
  const assignments = [
    siteAssignment("site-role-assignment:one", "legend:one", oplocOne.canonicalId),
    siteAssignment("site-role-assignment:two", "legend:two", oplocOne.canonicalId),
    siteAssignment("site-role-assignment:three", "legend:three", oplocOne.canonicalId),
  ];
  assert.deepEqual(staffingCoverage(requirement, assignments.slice(0, 1), today), {
    assigned: 1,
    vacancies: 1,
    surplus: 0,
    assignmentIds: ["site-role-assignment:one"],
  });
  const surplus = staffingCoverage(requirement, assignments, today);
  assert.equal(surplus.vacancies, 0);
  assert.equal(surplus.surplus, 1);
  assert.equal("vacancies" in requirement.record, false);
});

test("overlapping requirements and identical assignments are rejected", () => {
  assert.throws(
    () =>
      validateStaffingRequirement({
        values: {
          oplocId: oplocOne.canonicalId,
          staffingRoleId: role.canonicalId,
          requiredHeadcount: 0,
          effectiveFrom: today,
        },
        oplocs: [oplocOne],
        roles: [role],
        requirements: [],
      }),
    /positive whole number/,
  );
  assert.throws(
    () =>
      validateStaffingRequirement({
        values: requirement.record as never,
        oplocs: [oplocOne],
        roles: [role],
        requirements: [requirement],
      }),
    /overlapping staffing requirement/,
  );
  const existing = siteAssignment(
    "site-role-assignment:existing",
    activeLegend.canonicalId,
    oplocOne.canonicalId,
  );
  assert.throws(
    () =>
      validateSiteRoleAssignment({
        values: assignmentValues(
          activeLegend.canonicalId,
          oplocOne.canonicalId,
        ),
        legends: [activeLegend],
        employments: [],
        oplocs: [oplocOne],
        roles: [role],
        assignments: [existing],
        requirements: [requirement],
      }),
    /already has an overlapping assignment/,
  );
});

test("inactive Staffing Roles cannot receive new requirements or assignments", () => {
  const inactiveRole = record("Staffing Role", "staffing-role:inactive", {
    name: "Retired Role",
    active: false,
  });
  assert.throws(
    () =>
      validateStaffingRequirement({
        values: {
          oplocId: oplocOne.canonicalId,
          staffingRoleId: inactiveRole.canonicalId,
          requiredHeadcount: 1,
          effectiveFrom: today,
        },
        oplocs: [oplocOne],
        roles: [inactiveRole],
        requirements: [],
      }),
    /inactive Staffing Role/,
  );
  assert.throws(
    () =>
      validateSiteRoleAssignment({
        values: {
          ...assignmentValues(activeLegend.canonicalId, oplocOne.canonicalId),
          staffingRoleId: inactiveRole.canonicalId,
        },
        legends: [activeLegend],
        employments: [],
        oplocs: [oplocOne],
        roles: [inactiveRole],
        assignments: [],
        requirements: [],
      }),
    /inactive Staffing Role/,
  );
});

test("terminated Legends cannot receive new assignments", () => {
  assert.throws(
    () =>
      validateSiteRoleAssignment({
        values: assignmentValues(
          terminatedLegend.canonicalId,
          oplocOne.canonicalId,
        ),
        legends: [terminatedLegend],
        employments: [],
        oplocs: [oplocOne],
        roles: [role],
        assignments: [],
        requirements: [requirement],
      }),
    /terminated and cannot receive a new site-role assignment/,
  );
});

test("only one overlapping active primary location is allowed", () => {
  const existing = siteAssignment(
    "site-role-assignment:primary",
    activeLegend.canonicalId,
    oplocOne.canonicalId,
    true,
  );
  assert.throws(
    () =>
      validateSiteRoleAssignment({
        values: assignmentValues(
          activeLegend.canonicalId,
          oplocTwo.canonicalId,
          true,
        ),
        legends: [activeLegend],
        employments: [],
        oplocs: [oplocOne, oplocTwo],
        roles: [role],
        assignments: [existing],
        requirements: [],
      }),
    /already has an overlapping active primary location/,
  );
});

test("operational roles do not create AUTHMOD permissions", () => {
  for (const permission of permissionsForRole("viewer"))
    assert.doesNotMatch(permission, /barista|manager|staffing/i);
  assert.equal(
    parseCanonical("Site Role Assignment", siteAssignment("site-role-assignment:permission", activeLegend.canonicalId, oplocOne.canonicalId).record).success,
    true,
  );
});

test("cancel creates no mutation and saves refresh both views", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/ui/Connections.tsx"),
    "utf8",
  );
  assert.match(source, /type="button" onClick=\{close\}>Cancel/);
  assert.doesNotMatch(source, /\bprompt\s*\(|\bconfirm\s*\(/);
  assert.match(source, /setOverview\(body\)/);
  assert.match(source, /By OPLOC and By Legend now show the same saved relationships/);
});

function assignmentValues(
  legendId: string,
  oplocId: string,
  primaryLocation = false,
) {
  return {
    legendId,
    oplocId,
    staffingRoleId: role.canonicalId,
    effectiveFrom: today,
    primaryLocation,
    lifecycleState: "active" as const,
  };
}

function siteAssignment(
  canonicalId: string,
  legendId: string,
  oplocId: string,
  primaryLocation = false,
) {
  return record(
    "Site Role Assignment",
    canonicalId,
    assignmentValues(legendId, oplocId, primaryLocation),
  );
}

function record(
  entityType: CanonicalEntityType,
  canonicalId: string,
  values: Record<string, unknown>,
): CanonicalRecord {
  return {
    canonicalId,
    entityType,
    dataHash: "fixture",
    lifecycleStatus: "needs-review",
    record: {
      schemaVersion: "0.1.0",
      version: 1,
      createdAt: "2026-07-29T12:00:00.000Z",
      createdBy: "person:integration-admin",
      updatedAt: "2026-07-29T12:00:00.000Z",
      updatedBy: "person:integration-admin",
      active: true,
      externalIdentities: [],
      provenanceIds: [],
      ownership: { providerOwned: {}, fikaOwned: { developmentModel: true } },
      entityType,
      canonicalId,
      ...values,
    },
  };
}
