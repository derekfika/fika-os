import fs from "node:fs";
import path from "node:path";
import { getState } from "../lib/repository";
import { dataRoot } from "../lib/safety";
import { buildOplocAlignmentReport } from "../lib/oploc-alignment";

const state = await getState();
const report = { ...buildOplocAlignmentReport(state.canonical), generatedAt: new Date().toISOString(), executionStatus: "blocked-before-id-change", blocker: "All 18 stored IDs encode the rejected Site entity type. A mapping plan is prepared; no IDs or records are changed without explicit candidate review." };
const target = path.join(dataRoot(), "generated-reports", "oploc-alignment-readiness.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: target, ...report, proposals: `[${report.proposals.length} private proposals omitted from console]` }, null, 2));
process.exit();
