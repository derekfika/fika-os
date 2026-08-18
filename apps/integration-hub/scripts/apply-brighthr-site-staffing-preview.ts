import fs from "node:fs";
import { db } from "../lib/firebase-admin";
import { saveConnectionCommand } from "../lib/connections-service";
import type { CanonicalRecord } from "../lib/types";

type PreviewRow = {
  sourceName: string;
  legendId?: string;
  oplocId?: string;
  staffingRoleId?: string;
  proposedAction: string;
  confidence: string;
};
type Preview = { groups: { safeAutomaticAssignments: PreviewRow[] } };

const previewPath = process.argv[2];
const effectiveFrom = process.argv[3];
const apply = process.argv.includes("--apply");
if (!previewPath || !effectiveFrom) throw new Error("Usage: apply-brighthr-site-staffing-preview <preview.json> <effective-from> --apply");
if (!apply) throw new Error("This command is intentionally dry-run only until --apply is supplied.");

const actor = { uid: "codex:local-approved-staffing-import", name: "Codex local approved staffing import", role: "integration-admin" as const, synthetic: true as const };
const preview = JSON.parse(fs.readFileSync(previewPath, "utf8")) as Preview;
const rows = preview.groups.safeAutomaticAssignments;
const result = { created: [] as string[], alreadyPresent: [] as string[], blocked: [] as { sourceName: string; reason: string }[] };

for (const row of rows) {
  if (!row.legendId || !row.oplocId || !row.staffingRoleId || row.confidence !== "high") {
    result.blocked.push({ sourceName: row.sourceName, reason: "Preview row is incomplete or not high confidence." });
    continue;
  }
  const snapshot = await db.collection("integrationHubCanonical").get();
  const records = snapshot.docs.map(document => document.data() as CanonicalRecord);
  const duplicate = records.find(record => record.entityType === "Site Role Assignment" && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active" && String(record.record.legendId) === row.legendId && String(record.record.oplocId) === row.oplocId && String(record.record.staffingRoleId) === row.staffingRoleId && String(record.record.effectiveFrom || "") <= effectiveFrom && (!record.record.effectiveTo || String(record.record.effectiveTo) >= effectiveFrom));
  if (duplicate) {
    result.alreadyPresent.push(row.sourceName);
    continue;
  }
  try {
    await saveConnectionCommand(actor, { action: "save-site-role-assignment", legendId: row.legendId, oplocId: row.oplocId, staffingRoleId: row.staffingRoleId, effectiveFrom, primaryLocation: true, lifecycleState: "active" });
    result.created.push(row.sourceName);
  } catch (error) {
    result.blocked.push({ sourceName: row.sourceName, reason: error instanceof Error ? error.message : "Unknown connection error." });
  }
}

console.log(JSON.stringify({ previewPath, effectiveFrom, ...result }, null, 2));
if (result.blocked.length) process.exitCode = 1;
