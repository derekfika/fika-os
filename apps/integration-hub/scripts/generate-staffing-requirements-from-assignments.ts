import { db } from "../lib/firebase-admin";
import { saveConnectionCommand } from "../lib/connections-service";
import type { CanonicalRecord } from "../lib/types";

const effectiveFrom = process.argv[2];
const apply = process.argv.includes("--apply");
if (!effectiveFrom) throw new Error("Usage: generate-staffing-requirements-from-assignments <effective-from> --apply");
if (!apply) throw new Error("This command is intentionally dry-run only until --apply is supplied.");

const actor = { uid: "codex:local-approved-staffing-import", name: "Codex local approved staffing import", role: "integration-admin" as const, synthetic: true as const };
const snapshot = await db.collection("integrationHubCanonical").get();
const records = snapshot.docs.map(document => document.data() as CanonicalRecord);
const assignments = records.filter(record => record.entityType === "Site Role Assignment" && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active" && String(record.record.effectiveFrom || "") <= effectiveFrom && (!record.record.effectiveTo || String(record.record.effectiveTo) >= effectiveFrom));
const grouped = new Map<string, { oplocId: string; staffingRoleId: string; requiredHeadcount: number }>();
for (const assignment of assignments) {
  const oplocId = String(assignment.record.oplocId || "");
  const staffingRoleId = String(assignment.record.staffingRoleId || "");
  if (!oplocId || !staffingRoleId) continue;
  const key = `${oplocId}\u0000${staffingRoleId}`;
  const current = grouped.get(key) || { oplocId, staffingRoleId, requiredHeadcount: 0 };
  current.requiredHeadcount += 1;
  grouped.set(key, current);
}
const requirements = records.filter(record => record.entityType === "Site Staffing Requirement" && record.lifecycleStatus !== "archived");
const result = { created: [] as { oplocId: string; staffingRoleId: string; requiredHeadcount: number }[], alreadyPresent: [] as { oplocId: string; staffingRoleId: string; requiredHeadcount: number }[] };
for (const group of [...grouped.values()].sort((left, right) => `${left.oplocId}:${left.staffingRoleId}`.localeCompare(`${right.oplocId}:${right.staffingRoleId}`))) {
  const existing = requirements.find(requirement => String(requirement.record.oplocId) === group.oplocId && String(requirement.record.staffingRoleId) === group.staffingRoleId && String(requirement.record.effectiveFrom || "") <= effectiveFrom && (!requirement.record.effectiveTo || String(requirement.record.effectiveTo) >= effectiveFrom));
  if (existing) {
    result.alreadyPresent.push(group);
    continue;
  }
  await saveConnectionCommand(actor, { action: "save-site-staffing-requirement", oplocId: group.oplocId, staffingRoleId: group.staffingRoleId, requiredHeadcount: group.requiredHeadcount, effectiveFrom, notes: "Initial baseline generated from the active assigned Legends in the BrightHR staffing snapshot." });
  result.created.push(group);
}
console.log(JSON.stringify({ effectiveFrom, sourceAssignments: assignments.length, distinctRequirements: grouped.size, ...result }, null, 2));
