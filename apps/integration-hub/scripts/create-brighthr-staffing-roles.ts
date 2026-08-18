import fs from "node:fs";
import { connectionsOverview, saveConnectionCommand } from "../lib/connections-service";
import { canonicalStaffingRoleName } from "../lib/site-staffing-preview";

type PreviewRow = { sourceRole: string; reviewReason?: string };
type Preview = { groups: { ambiguousOrUnmatched: PreviewRow[] } };

const previewPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!previewPath) throw new Error("Usage: create-brighthr-staffing-roles <preview.json> --apply");
if (!apply) throw new Error("This command is intentionally dry-run only until --apply is supplied.");

const actor = { uid: "codex:local-approved-staffing-import", name: "Codex local approved staffing import", role: "integration-admin" as const, synthetic: true as const };
const preview = JSON.parse(fs.readFileSync(previewPath, "utf8")) as Preview;
const titles = [...new Set(preview.groups.ambiguousOrUnmatched.filter(row => row.reviewReason === "The BrightHR job title does not map unambiguously to the current staffing-role catalogue.").map(row => canonicalStaffingRoleName(row.sourceRole)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
const result = { created: [] as string[], alreadyPresent: [] as string[] };
for (const name of titles) {
  const overview = await connectionsOverview();
  if (overview.staffingRoles.some(role => role.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())) {
    result.alreadyPresent.push(name);
    continue;
  }
  await saveConnectionCommand(actor, { action: "save-staffing-role", name, active: true });
  result.created.push(name);
}
console.log(JSON.stringify({ previewPath, titles, ...result }, null, 2));
