import assert from "node:assert/strict";
import test from "node:test";
import { suggestionsFromRecords } from "../lib/event-staffing-service";
import { permissionsForRole } from "../lib/authmod";
import type { CanonicalRecord } from "../lib/types";

const now = "2026-07-30T10:00:00.000Z";
const record = (entityType: CanonicalRecord["entityType"], canonicalId: string, values: Record<string, unknown>): CanonicalRecord => ({ canonicalId, entityType, lifecycleStatus: "needs-review", dataHash: canonicalId, record: { entityType, canonicalId, schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: "person:test", updatedAt: now, updatedBy: "person:test", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, ...values } });
const legend = (id: string, name: string, active = true) => record("Legend", id, { displayName: name, active });
const role = record("Event Role", "event-role:lead", { roleName: "Events Lead", lifecycleState: "active" });
const team = record("Operational Team", "operational-team:central", { teamName: "Central Events", lifecycleState: "active" });
const preference = (id: string, legendId: string, eligibility: "primary" | "secondary" | "fallback", rank: number, lifecycleState: "active" | "archived" = "active") => record("Event Staffing Preference", id, { legendId, eventRoleId: role.canonicalId, eligibility, suggestionRank: rank, lifecycleState, effectiveFrom: "2026-01-01" });
const membership = record("Team Membership", "team-membership:one", { legendId: "legend:dwayne", teamId: team.canonicalId, lifecycleState: "active", effectiveFrom: "2026-01-01" });

test("suggestions use explicit eligibility tier then rank and show team reason", () => {
  const result = suggestionsFromRecords([legend("legend:dwayne", "Dwayne"), legend("legend:isaias", "Isaias"), role, team, membership, preference("event-staffing-preference:isaias", "legend:isaias", "primary", 2), preference("event-staffing-preference:dwayne", "legend:dwayne", "primary", 1), preference("event-staffing-preference:fallback", "legend:isaias", "fallback", 1)], "Events Lead");
  assert.deepEqual(result.map(item => item.legendId), ["legend:dwayne", "legend:isaias"]);
  assert.match(result[0].reason, /Primary eligibility.*rank 1.*Central Events/);
});

test("inactive preferences and terminated Legends are excluded", () => {
  const result = suggestionsFromRecords([legend("legend:active", "Active"), legend("legend:terminated", "Terminated", false), role, preference("event-staffing-preference:active", "legend:active", "primary", 1), preference("event-staffing-preference:archived", "legend:active", "secondary", 1, "archived"), preference("event-staffing-preference:terminated", "legend:terminated", "primary", 1)], "Events Lead");
  assert.deepEqual(result.map(item => item.legendId), ["legend:active"]);
});

test("fallback eligibility exists only through an explicit preference", () => {
  const result = suggestionsFromRecords([legend("legend:relief", "Relief FOH"), role], "Events Lead");
  assert.equal(result.length, 0);
});

test("event staffing records do not alter AUTHMOD permissions or rota data", () => {
  const before = permissionsForRole("integration-admin");
  const records = [legend("legend:dwayne", "Dwayne"), role, preference("event-staffing-preference:dwayne", "legend:dwayne", "primary", 1)];
  suggestionsFromRecords(records, "Events Lead");
  assert.deepEqual(permissionsForRole("integration-admin"), before);
  assert.equal(records.some(item => JSON.stringify(item.record).includes("rota")), false);
});
