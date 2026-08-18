import fs from "node:fs";
import path from "node:path";
import { getState } from "../lib/repository";
import { dataRoot } from "../lib/safety";
import { lifecycleOf } from "../lib/data-governance";

const state = await getState();
const legends = state.canonical.filter(record => record.entityType === "Legend");
const sites = state.canonical.filter(record => record.entityType === "Site");
const report = {
  format: "fika.integration-hub-core-migration-readiness.v1",
  generatedAt: new Date().toISOString(),
  dryRun: true,
  writesPerformed: 0,
  source: { canonicalRecords: state.canonical.length, legends: legends.length, sourceSiteCandidates: sites.length },
  employmentProjectionCandidates: {
    total: legends.length,
    withEmploymentState: legends.filter(record => record.record.employmentState).length,
    withJobTitle: legends.filter(record => record.record.jobTitle).length,
    withTerminationDate: legends.filter(record => record.record.terminationDate || ((record.record.ownership as Record<string, unknown> | undefined)?.providerOwned as Record<string, unknown> | undefined)?.terminationDate).length,
    withStartDate: legends.filter(record => record.record.startDate).length,
    note: "A candidate count is not migration authority. No Employment records were created.",
  },
  lifecycle: Object.fromEntries(["draft", "needs-review", "published", "archived"].map(status => [status, state.canonical.filter(record => lifecycleOf(record) === status).length])),
  publicationEligibility: { automaticallyEligible: 0, reason: "Existing approval manifests are absent and staging approval is not canonical publication." },
  blocked: ["Legend is still a Future Candidate in the canonical Domain Dictionary.", "The application Site aggregate conflicts with accepted Canon, where Site is an OPLOC Location Type.", "Existing provider runs do not retain complete immutable raw BrightHR payload snapshots."],
};
const target = path.join(dataRoot(), "generated-reports", "core-data-migration-readiness.json"); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ report: target, ...report }, null, 2)); process.exit();
