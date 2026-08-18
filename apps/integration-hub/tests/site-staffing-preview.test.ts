import assert from "node:assert/strict";
import test from "node:test";
import { buildSiteStaffingPreview, canonicalStaffingRoleName, type PreviewCanonical } from "../lib/site-staffing-preview";

const record = (entityType: string, canonicalId: string, fields: Record<string, unknown>): PreviewCanonical => ({ entityType, canonicalId, record: { active: true, ...fields } });
const legend = record("Legend", "legend:one", { displayName: "One Legend", employmentState: "Active" });
const munich = record("OPLOC", "oploc:munich", { approvedName: "Munich RE", lifecycleState: "active", aliases: [] });
const barista = record("Staffing Role", "staffing-role:barista", { name: "Barista" });

test("stable BrightHR team evidence proposes the existing Legend, OPLOC and staffing role", () => {
  const [row] = buildSiteStaffingPreview([{ team: "Munich Re", name: "One Legend", role: "Barista" }], [legend, munich, barista]);
  assert.equal(row.proposedAction, "create");
  assert.equal(row.oplocId, munich.canonicalId);
  assert.equal(row.staffingRoleId, barista.canonicalId);
});

test("central and relief employees are not forced into a home OPLOC", () => {
  const rows = buildSiteStaffingPreview([{ team: "Central", name: "One Legend", role: "Barista" }, { team: "Munich Re", name: "One Legend", role: "Relief Barista" }], [legend, munich, barista]);
  assert.deepEqual(rows.map(row => row.proposedAction), ["exclude", "exclude"]);
});

test("multi-team employees are routed to review rather than assigned twice", () => {
  const rows = buildSiteStaffingPreview([{ team: "Munich Re", name: "One Legend", role: "Barista" }, { team: "Central", name: "One Legend", role: "Barista" }], [legend, munich, barista]);
  assert.ok(rows.every(row => row.proposedAction === "exclude"));
  assert.ok(rows.every(row => row.reviewReason?.includes("more than one")));
});

test("existing assignments are returned as no-change and never duplicated", () => {
  const assignment = record("Site Role Assignment", "site-role-assignment:one", { legendId: legend.canonicalId, oplocId: munich.canonicalId, staffingRoleId: barista.canonicalId, lifecycleState: "active" });
  const [row] = buildSiteStaffingPreview([{ team: "Munich Re", name: "One Legend", role: "Barista" }], [legend, munich, barista, assignment]);
  assert.equal(row.proposedAction, "no-change");
  assert.equal(row.existingAssignmentId, assignment.canonicalId);
});

test("ambiguous names and unsupported roles are routed to review", () => {
  const duplicate = record("Legend", "legend:two", { displayName: "One Legend", employmentState: "Active" });
  const [ambiguous] = buildSiteStaffingPreview([{ team: "Munich Re", name: "One Legend", role: "Barista" }], [legend, duplicate, munich, barista]);
  const [unsupported] = buildSiteStaffingPreview([{ team: "Munich Re", name: "One Legend", role: "Head Chef" }], [legend, munich, barista]);
  assert.equal(ambiguous.proposedAction, "review");
  assert.equal(unsupported.proposedAction, "review");
});

test("terminated duplicate histories do not block one active Legend match", () => {
  const historical = record("Legend", "legend:historical", { displayName: "One Legend", employmentState: "Terminated", active: false });
  const [row] = buildSiteStaffingPreview([{ team: "Munich Re", name: "One Legend", role: "Barista" }], [legend, historical, munich, barista]);
  assert.equal(row.legendId, legend.canonicalId);
  assert.equal(row.proposedAction, "create");
});

test("source job-title equivalents share one reusable staffing role", () => {
  const chefDePartie = record("Staffing Role", "staffing-role:chef-de-partie", { name: "Chef de Partie" });
  assert.equal(canonicalStaffingRoleName("CHEF"), "Chef");
  assert.equal(canonicalStaffingRoleName("CDP"), "Chef de Partie");
  const [row] = buildSiteStaffingPreview([{ team: "Munich Re", name: "One Legend", role: "CDP" }], [legend, munich, chefDePartie]);
  assert.equal(row.staffingRoleId, chefDePartie.canonicalId);
  assert.equal(row.proposedAction, "create");
});

test("General Manager source titles resolve to the approved Catering Manager role", () => {
  const cateringManager = record("Staffing Role", "staffing-role:catering-manager", { name: "Catering Manager" });
  const [row] = buildSiteStaffingPreview([{ team: "Munich Re", name: "One Legend", role: "General Manager" }], [legend, munich, cateringManager]);
  assert.equal(row.staffingRoleId, cateringManager.canonicalId);
});
