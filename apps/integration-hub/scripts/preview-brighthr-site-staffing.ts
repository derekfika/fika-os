import fs from "node:fs";
import path from "node:path";
import { buildSiteStaffingPreview, normaliseStaffingLabel, type PreviewCanonical, type StaffingSourceEmployee } from "../lib/site-staffing-preview";

type EmployeeHubExtraction = { source: string; declaredEmployees: number; extractedEmployees: number; countMismatches: unknown[]; teams: { name: string; employees: { name: string; role?: string | null; page?: number }[] }[] };

const sourcePath = process.argv[2];
const canonicalPath = process.argv[3];
const outputRoot = process.argv[4];
if (!sourcePath || !canonicalPath || !outputRoot) throw new Error("Usage: preview-brighthr-site-staffing <employee-hub.json> <canonical-records.json> <output-directory>");

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as EmployeeHubExtraction;
const canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf8")) as PreviewCanonical[];
if (source.declaredEmployees !== source.extractedEmployees || source.countMismatches.length) throw new Error("Employee Hub extraction counts do not reconcile with the displayed team totals.");

const employees: StaffingSourceEmployee[] = source.teams.flatMap(team => team.employees.map(employee => ({ team: team.name, ...employee })));
const rows = buildSiteStaffingPreview(employees, canonical);
const sourceNames = new Set(employees.map(employee => normaliseStaffingLabel(employee.name)));
const unmatchedActiveLegends = canonical.filter(item => item.entityType === "Legend" && item.record.active !== false && !/terminated|inactive|left|leaver/i.test(String(item.record.employmentState || "")) && !sourceNames.has(normaliseStaffingLabel(String(item.record.displayName || "")))).map(item => ({ legendId: item.canonicalId, displayName: String(item.record.displayName || "") })).sort((a, b) => a.displayName.localeCompare(b.displayName));
const groups = {
  safeAutomaticAssignments: rows.filter(row => row.proposedAction === "create"),
  existingAssignmentsNoChange: rows.filter(row => row.proposedAction === "no-change"),
  ambiguousOrUnmatched: rows.filter(row => row.proposedAction === "review"),
  centralReliefOrCover: rows.filter(row => row.proposedAction === "exclude"),
  unmatchedActiveLegends,
};
const summary = Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.length]));
const report = { format: "fika.site-staffing-preview.v1", generatedAt: new Date().toISOString(), source: source.source, sourceTotals: { teams: source.teams.length, employees: employees.length }, employmentStartDates: { source: "BrightHR employees/v1/query items[].employment.start", status: "Captured into governed Employment staging on the next BrightHR sync; not present in this PDF and not mutated by this preview." }, summary, groups };

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, "site-staffing-brighthr-preview.json"), `${JSON.stringify(report, null, 2)}\n`);
const mdRows = (values: typeof rows) => values.length ? values.map(row => `| ${row.sourceName} | ${row.legendName || "—"} | ${row.legendId || "—"} | ${row.oplocName || "—"} | ${row.oplocId || "—"} | ${row.sourceRole} | ${row.staffingRoleName || "—"} | ${row.existingAssignmentId || "—"} | ${row.proposedAction} | ${row.confidence} | ${row.reviewReason || "—"} |`).join("\n") : "_None._";
const heading = "| Source name | Legend | Legend ID | OPLOC | OPLOC ID | BrightHR title | Staffing role | Existing assignment | Action | Confidence | Review reason |\n|---|---|---|---|---|---|---|---|---|---|---|";
const markdown = `# BrightHR Site Staffing Preview\n\nGenerated: ${report.generatedAt}\n\nSource: ${source.source}\n\nThis is a read-only preview. It did not create or modify Employment or staffing records. BrightHR start dates are not displayed in the PDF; the connector now preserves \`items[].employment.start\` for governed Employment staging on the next sync.\n\n## Summary\n\n- Teams: ${source.teams.length}\n- Active employees in PDF: ${employees.length}\n- Safe automatic assignments: ${groups.safeAutomaticAssignments.length}\n- Existing assignments requiring no change: ${groups.existingAssignmentsNoChange.length}\n- Ambiguous or unmatched source rows: ${groups.ambiguousOrUnmatched.length}\n- Central, relief or cover review: ${groups.centralReliefOrCover.length}\n- Active canonical Legends not in the PDF: ${groups.unmatchedActiveLegends.length}\n\n## Safe automatic assignments\n\n${heading}\n${mdRows(groups.safeAutomaticAssignments)}\n\n## Existing assignments — no change\n\n${heading}\n${mdRows(groups.existingAssignmentsNoChange)}\n\n## Ambiguous or unmatched\n\n${heading}\n${mdRows(groups.ambiguousOrUnmatched)}\n\n## Central, relief or cover\n\n${heading}\n${mdRows(groups.centralReliefOrCover)}\n\n## Active canonical Legends not found in the PDF\n\n${groups.unmatchedActiveLegends.length ? groups.unmatchedActiveLegends.map(legend => `- ${legend.displayName} — ${legend.legendId}`).join("\n") : "_None._"}\n`;
fs.writeFileSync(path.join(outputRoot, "site-staffing-brighthr-preview.md"), markdown);
console.log(JSON.stringify({ outputRoot, summary }, null, 2));
