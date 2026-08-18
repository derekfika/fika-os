import { db } from "../lib/firebase-admin";
import { connectionsOverview, saveConnectionCommand } from "../lib/connections-service";
import type { CanonicalRecord } from "../lib/types";

const apply = process.argv.includes("--apply");
if (!apply) throw new Error("This command is intentionally dry-run only until --apply is supplied.");

const actor = { uid: "codex:local-approved-staffing-import", name: "Codex local approved staffing import", role: "integration-admin" as const, synthetic: true as const };
const snapshot = await db.collection("integrationHubCanonical").get();
const records = snapshot.docs.map(document => document.data() as CanonicalRecord);
const source = records.find(record => record.entityType === "Staffing Role" && String(record.record.name) === "General Manager");
const target = records.find(record => record.entityType === "Staffing Role" && String(record.record.name) === "Catering Manager");
if (!source || !target) throw new Error("Both General Manager and Catering Manager staffing roles must exist.");

const sourceAssignments = records.filter(record => record.entityType === "Site Role Assignment" && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active" && String(record.record.staffingRoleId) === source.canonicalId);
const sourceRequirements = records.filter(record => record.entityType === "Site Staffing Requirement" && record.lifecycleStatus !== "archived" && String(record.record.staffingRoleId) === source.canonicalId);
const result = { migratedAssignments: [] as string[], migratedRequirements: [] as string[], alreadyMerged: source.record.active === false && !sourceAssignments.length && !sourceRequirements.length };

for (const requirement of sourceRequirements) {
  const duplicate = records.find(record => record.entityType === "Site Staffing Requirement" && record.canonicalId !== requirement.canonicalId && record.lifecycleStatus !== "archived" && String(record.record.oplocId) === String(requirement.record.oplocId) && String(record.record.staffingRoleId) === target.canonicalId && String(record.record.effectiveFrom) === String(requirement.record.effectiveFrom) && String(record.record.effectiveTo || "") === String(requirement.record.effectiveTo || ""));
  if (duplicate) throw new Error(`Cannot merge requirement ${requirement.canonicalId}: an equivalent Catering Manager requirement already exists.`);
  await saveConnectionCommand(actor, { action: "save-site-staffing-requirement", canonicalId: requirement.canonicalId, expectedVersion: Number(requirement.record.version), oplocId: String(requirement.record.oplocId), staffingRoleId: target.canonicalId, requiredHeadcount: Number(requirement.record.requiredHeadcount), effectiveFrom: String(requirement.record.effectiveFrom), ...(requirement.record.effectiveTo ? { effectiveTo: String(requirement.record.effectiveTo) } : {}), ...(requirement.record.notes ? { notes: String(requirement.record.notes) } : {}) });
  result.migratedRequirements.push(requirement.canonicalId);
}

for (const assignment of sourceAssignments) {
  const duplicate = records.find(record => record.entityType === "Site Role Assignment" && record.canonicalId !== assignment.canonicalId && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active" && String(record.record.legendId) === String(assignment.record.legendId) && String(record.record.oplocId) === String(assignment.record.oplocId) && String(record.record.staffingRoleId) === target.canonicalId && String(record.record.effectiveFrom) === String(assignment.record.effectiveFrom) && String(record.record.effectiveTo || "") === String(assignment.record.effectiveTo || ""));
  if (duplicate) throw new Error(`Cannot merge assignment ${assignment.canonicalId}: an equivalent Catering Manager assignment already exists.`);
  await saveConnectionCommand(actor, { action: "save-site-role-assignment", canonicalId: assignment.canonicalId, expectedVersion: Number(assignment.record.version), legendId: String(assignment.record.legendId), oplocId: String(assignment.record.oplocId), staffingRoleId: target.canonicalId, effectiveFrom: String(assignment.record.effectiveFrom), ...(assignment.record.effectiveTo ? { effectiveTo: String(assignment.record.effectiveTo) } : {}), primaryLocation: assignment.record.primaryLocation === true, lifecycleState: "active" });
  result.migratedAssignments.push(assignment.canonicalId);
}

if (source.record.active !== false) await saveConnectionCommand(actor, { action: "save-staffing-role", canonicalId: source.canonicalId, expectedVersion: Number(source.record.version), name: "General Manager", description: "Merged into Catering Manager; retained as an inactive historical staffing role.", active: false });
const overview = await connectionsOverview();
console.log(JSON.stringify({ sourceRoleId: source.canonicalId, targetRoleId: target.canonicalId, ...result, activeGeneralManagerRole: overview.staffingRoles.find(role => role.canonicalId === source.canonicalId)?.active, activeCateringManagerRole: overview.staffingRoles.find(role => role.canonicalId === target.canonicalId)?.active }, null, 2));
