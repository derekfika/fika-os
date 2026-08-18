import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildCanonicalRecord } from "../lib/canonical-editor";
import { isGovernedPublishedEdit } from "../lib/canonical-record-service";
import {
  roleAssignmentDoesNotGrantPermissions,
  validateOperationalAssignmentConnection,
} from "../lib/connection-rules";
import { parseCanonical } from "../lib/schemas";
import { permissionsForRole } from "../lib/authmod";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

const actor: Actor = {
  uid: "person:integration-admin",
  name: "Integration Admin",
  role: "integration-admin",
  synthetic: true,
};
const reason = "Reviewed through the focused Connections workspace test.";
const legend = canonical("Legend", "legend:active", {
  displayName: "Active Legend",
  active: true,
});
const terminatedLegend = canonical("Legend", "legend:terminated", {
  displayName: "Historical Legend",
  active: false,
  employmentState: "Terminated",
});

test("a Legend can be connected to an Employment record", () => {
  const record = buildCanonicalRecord(
    {
      entityType: "Employment",
      canonicalId: "employment:one",
      values: {
        legendId: legend.canonicalId,
        employmentState: "Active",
        startDate: "2026-01-05",
      },
      decisionReason: reason,
    },
    actor,
  );
  assert.equal(record.legendId, legend.canonicalId);
  assert.equal(parseCanonical("Employment", record).success, true);
});

test("a Legend can receive effective-dated roles at multiple OPLOCs", () => {
  const first = assignmentInput("operational-assignment:first", "oploc:one", "Manager");
  const second = assignmentInput("operational-assignment:second", "oploc:two", "Support");
  assert.doesNotThrow(() =>
    validateOperationalAssignmentConnection({
      command: second,
      current: null,
      legend,
      employments: [],
      assignments: [assignmentRecord(first)],
    }),
  );
  const record = buildCanonicalRecord(second, actor);
  assert.equal(record.oplocId, "oploc:two");
  assert.equal(record.effectiveFrom, "2026-07-01");
  assert.equal(parseCanonical("Operational Assignment", record).success, true);
});

test("published relationship records use the governed amendment path", () => {
  const current = assignmentRecord(
    assignmentInput("operational-assignment:published", "oploc:one", "Manager"),
  );
  current.lifecycleStatus = "published";
  current.publicationStatus = "published";
  assert.equal(
    isGovernedPublishedEdit(
      assignmentInput("operational-assignment:published", "oploc:one", "Manager"),
      current,
    ),
    true,
  );
});

test("duplicate overlapping active Legend, OPLOC and role assignments are rejected", () => {
  const current = assignmentInput("operational-assignment:first", "oploc:one", "Manager");
  const duplicate = assignmentInput("operational-assignment:duplicate", "oploc:one", " manager ");
  assert.throws(
    () =>
      validateOperationalAssignmentConnection({
        command: duplicate,
        current: null,
        legend,
        employments: [],
        assignments: [assignmentRecord(current)],
      }),
    /already has an overlapping active assignment/,
  );
});

test("terminated Legends retain history but cannot receive a new assignment", () => {
  const historical = assignmentRecord(
    assignmentInput("operational-assignment:history", "oploc:one", "Barista"),
  );
  assert.throws(
    () =>
      validateOperationalAssignmentConnection({
        command: assignmentInput("operational-assignment:new", "oploc:two", "Barista"),
        current: null,
        legend: terminatedLegend,
        employments: [],
        assignments: [historical],
      }),
    /terminated and cannot receive a new working-location assignment/,
  );
  assert.doesNotThrow(() =>
    validateOperationalAssignmentConnection({
      command: assignmentInput("operational-assignment:history", "oploc:one", "Barista"),
      current: historical,
      legend: terminatedLegend,
      employments: [],
      assignments: [historical],
    }),
  );
});

test("operational role assignments do not grant AUTHMOD permissions", () => {
  assert.equal(roleAssignmentDoesNotGrantPermissions(), true);
  assert.deepEqual(permissionsForRole("viewer"), ["canonical.view", "address.view"]);
  assert.equal(
    permissionsForRole("viewer").some((permission) =>
      permission.toLowerCase().includes("manager"),
    ),
    false,
  );
});

test("the authoritative save response refreshes both Connection views", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/ui/Connections.tsx"),
    "utf8",
  );
  assert.match(source, /setOverview\(body\)/);
  assert.match(source, /Both views now show the latest record/);
  assert.match(source, /function ByLegend/);
  assert.match(source, /function ByOploc/);
});

test("Connections opens with a record-first home and retains typed OPLOC routing", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/ui/Connections.tsx"),
    "utf8",
  );
  const service = fs.readFileSync(
    path.join(process.cwd(), "lib/connections-service.ts"),
    "utf8",
  );
  assert.match(source, /OplocDirectory/);
  assert.match(source, /useState<ConnectionsView>\(\(\) => viewFromUrl\(\)\)/);
  assert.match(source, /managementTypes/);
  assert.match(source, /ConnectionsHome/);
  assert.match(source, /Expand all/);
  assert.match(source, /Collapse all/);
  assert.match(source, /Lifecycle/);
  assert.match(source, /Client/);
  assert.match(source, /Location type/);
  assert.match(source, /Connection health/);
  assert.match(source, /Enabled capability/);
  assert.match(source, /Operational Area/);
  assert.match(source, /Staffing requirement/);
  assert.match(source, /Legend \/ site-role assignment/);
  assert.match(source, /OperationalAreasPanel/);
  assert.match(source, /supportedConnectionTypes/);
  assert.match(service, /serviceCount: serviceArrangements/);
  assert.doesNotMatch(source, /custom connection.*object/i);
});

test("the OPLOC directory preserves the governed hierarchy and external-provider boundary", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/ui/Connections.tsx"),
    "utf8",
  );
  const service = fs.readFileSync(
    path.join(process.cwd(), "lib/connections-service.ts"),
    "utf8",
  );
  assert.match(source, /Operational Areas \(\{oploc\.areaCount\}\)/);
  assert.match(source, /External provider evidence/);
  assert.match(source, /OperationalConfigurationPanel/);
  assert.match(service, /record\.entityType === "Operational Area"/);
  assert.match(service, /record\.lifecycleStatus !== "archived"/);
  assert.match(service, /mapping\.oplocId === oploc\.canonicalId/);
});

test("site role establishment remains explicitly development-only", () => {
  const catalogue = fs.readFileSync(
    path.join(process.cwd(), "lib/schema-catalogue.ts"),
    "utf8",
  );
  assert.match(catalogue, /"Staffing Role": "development-only"/);
  assert.match(catalogue, /"Site Staffing Requirement": "development-only"/);
  assert.match(catalogue, /"Site Role Assignment": "development-only"/);
});

function assignmentInput(canonicalId: string, oplocId: string, role: string) {
  return {
    entityType: "Operational Assignment" as const,
    canonicalId,
    expectedVersion: 0,
    values: {
      legendId: legend.canonicalId,
      oplocId,
      assignmentRole: role,
      designation: "secondary",
      effectiveFrom: "2026-07-01",
      lifecycleState: "active",
      evidenceReferences: [],
    },
    decisionReason: reason,
  };
}

function assignmentRecord(
  input: ReturnType<typeof assignmentInput>,
): CanonicalRecord {
  const record = buildCanonicalRecord(input, actor);
  return {
    canonicalId: input.canonicalId,
    entityType: "Operational Assignment",
    record,
    dataHash: "fixture",
    lifecycleStatus: "needs-review",
  };
}

function canonical(
  entityType: "Legend",
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
      createdBy: actor.uid,
      updatedAt: "2026-07-29T12:00:00.000Z",
      updatedBy: actor.uid,
      active: true,
      externalIdentities: [],
      provenanceIds: [],
      ownership: { providerOwned: {}, fikaOwned: {} },
      entityType,
      canonicalId,
      ...values,
    },
  };
}
