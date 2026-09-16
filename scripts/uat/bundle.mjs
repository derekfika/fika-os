import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getLocalGitSha, redact } from "./common.mjs";
import { readCloudLogs, formatLogRecord } from "./logs.mjs";
import { captureState, formatState } from "./state.mjs";
import { evaluateInvariants, invariantSummary } from "./invariants.mjs";

export function potentialCausalChains(records) {
  const highlighted = records.filter((record) => record.highlighted).slice(0, 20);
  const groups = [];
  for (const record of highlighted) {
    const match = groups.find((group) => (record.requestId && group.key === `request:${record.requestId}`) || (record.eventId && group.key === `event:${record.eventId}`) || (record.serviceDate && record.oplocId && group.key === `target:${record.serviceDate}:${record.oplocId}`));
    const key = record.requestId ? `request:${record.requestId}` : record.eventId ? `event:${record.eventId}` : record.serviceDate && record.oplocId ? `target:${record.serviceDate}:${record.oplocId}` : `record:${groups.length}`;
    if (match) match.records.push(record); else groups.push({ key, records: [record] });
  }
  return groups.filter((group) => group.records.length > 1 || group.records.some((record) => record.severity === "ERROR" || record.status >= 409)).slice(0, 5).map((group) => ({ basis: group.key.startsWith("target:") ? "same service date + OPLOC" : group.key, records: group.records }));
}

export function renderMarkdown(bundle) {
  const lines = [`# FIKA OS UAT evidence bundle`, ``, `Generated: ${bundle.generatedAt}`, `Local git SHA: ${bundle.localGitSha || "unavailable"}`, ``, `## Summary`, ``, bundle.summary, ``, `## Target`, ``, `- Service date: ${bundle.state.target.serviceDate}`, `- OPLOC: ${bundle.state.target.oplocId}`, ``, `## Builds`, ``];
  for (const build of bundle.builds?.apps || []) lines.push(`- ${build.label}: LIVE ${build.liveSha || "unavailable"} — ${build.status}${build.expectedSha ? ` (expected ${build.expectedSha})` : ""}`);
  lines.push("", "## Normalized state", "", "```text", formatState(bundle.state), "```", "", "## Cloud Logging", "", bundle.logs.available ? `Collected ${bundle.logs.records.length} bounded record(s).` : `Unavailable: ${bundle.logs.warning || "no records"}`, "");
  if (bundle.logs.records.length) lines.push(...bundle.logs.records.map((record) => `### ${record.severity} ${record.event || record.operation || "record"}\n\n\`\`\`text\n${formatLogRecord(record)}\n\`\`\``), "");
  lines.push("## Invariants", "", ...bundle.invariants.map((item) => `- **${item.status}** ${item.id}: ${item.detail}`), "", "## Potential causal chain", "", "These records appear related by shared identifiers or target proximity; this is not an automatic root-cause claim.");
  if (!bundle.causalChains.length) lines.push("", "No potential chain identified from the collected records.");
  for (const chain of bundle.causalChains) lines.push("", `- Basis: ${chain.basis}`, ...chain.records.map((record) => `  - ${record.timestamp || "unknown time"} ${record.severity} ${record.event || record.operation || record.code || "record"}`));
  lines.push("", "## Collection", "", `- Cloud Logging filter: \`${bundle.logs.filter}\``, "- Read-only state endpoints were used; no staging mutations were performed.", "- Secrets and credential-bearing fields are redacted.");
  return redact(lines.join("\n"));
}

export async function collectBundle({ serviceDate, oplocId, app = "all", minutes = 15, project, env = process.env, fetchImpl = globalThis.fetch, runGcloud, exec } = {}) {
  const [state, logs, localGitSha] = await Promise.all([
    captureState({ serviceDate, oplocId, env, fetchImpl }),
    readCloudLogs({ app, minutes, project, serviceDate, oploc: oplocId, tailErrors: true }, { run: runGcloud }),
    getLocalGitSha({ exec }),
  ]);
  const invariants = evaluateInvariants(state);
  const bundle = { generatedAt: new Date().toISOString(), localGitSha: localGitSha || null, target: state.target, state, builds: state.builds, logs, invariants, invariantSummary: invariantSummary(invariants), causalChains: potentialCausalChains(logs.records || []) };
  bundle.summary = `${bundle.invariantSummary.status}: ${bundle.invariantSummary.pass} PASS, ${bundle.invariantSummary.fail} FAIL, ${bundle.invariantSummary.unknown} UNKNOWN; ${logs.records?.length || 0} bounded log records; build/state availability captured for ${serviceDate} / ${oplocId}.`;
  return bundle;
}

export async function writeBundleFiles(bundle, { outputDir = join(process.cwd(), "artifacts", "uat") } = {}) {
  await mkdir(outputDir, { recursive: true });
  const stamp = bundle.generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const date = bundle.target.serviceDate;
  const shortOploc = bundle.target.oplocId.replace(/^oploc:/, "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || "target";
  const stem = `${stamp}-${date}-${shortOploc}`;
  const jsonPath = join(outputDir, `${stem}.json`);
  const markdownPath = join(outputDir, `${stem}.md`);
  await writeFile(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderMarkdown(bundle)}\n`, "utf8");
  return { jsonPath, markdownPath };
}
