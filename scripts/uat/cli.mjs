#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertDate, assertOploc, assertPositiveInteger, assertSha, DEFAULT_LOG_MINUTES, DEFAULT_PROJECT, parseIsoTimestamp } from "./common.mjs";
import { discoverBuilds, formatBuilds } from "./builds.mjs";
import { buildLoggingFilter, formatLogs, readCloudLogs } from "./logs.mjs";
import { captureState, formatState } from "./state.mjs";
import { collectBundle, writeBundleFiles } from "./bundle.mjs";

export function parseArgs(argv) {
  const args = { command: ["--help", "-h"].includes(argv[0]) ? "help" : argv[0] || "help", app: "all", minutes: DEFAULT_LOG_MINUTES, limit: 500, project: DEFAULT_PROJECT };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    const needsValue = ["--app", "--minutes", "--since", "--service-date", "--oploc", "--build-sha", "--request-id", "--event", "--severity", "--limit", "--project", "--expected", "--output"].includes(flag);
    if (flag === "--json") args.json = true;
    else if (flag === "--tail-errors") args.tailErrors = true;
    else if (needsValue) { if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value.`); args[flag.slice(2).replaceAll("-", "_")] = next; index += 1; }
    else if (flag === "--help" || flag === "-h") args.command = "help";
    else throw new Error(`Unknown option '${flag}'.`);
  }
  if (!["builds", "logs", "state", "bundle", "help"].includes(args.command)) throw new Error(`Unknown command '${args.command}'. Choose builds, logs, state, bundle, or help.`);
  if (args.app === "all" || args.app) { const valid = ["all", "delivered-in", "cpu-production", "menu-planning", "integration-hub"]; if (!valid.includes(args.app)) throw new Error(`Invalid app '${args.app}'.`); }
  if (args.minutes !== undefined) args.minutes = assertPositiveInteger(args.minutes, "--minutes", { max: 1440 });
  if (args.limit !== undefined) args.limit = assertPositiveInteger(args.limit, "--limit", { max: 500 });
  if (args.service_date) args.service_date = assertDate(args.service_date);
  if (args.oploc) args.oploc = assertOploc(args.oploc);
  if (args.since) args.since = parseIsoTimestamp(args.since);
  if (args.build_sha) args.build_sha = assertSha(args.build_sha, "--build-sha");
  if (args.expected) args.expected = assertSha(args.expected, "--expected");
  if (args.severity && !["DEFAULT", "DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(args.severity.toUpperCase())) throw new Error("--severity must be one of: DEFAULT, DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL, ALERT, EMERGENCY.");
  if (args.command === "logs" && args.tailErrors) { args.app = "all"; args.minutes = DEFAULT_LOG_MINUTES; args.severity = "WARNING"; }
  return args;
}

function help() { return `FIKA OS UAT toolkit (read-only)\n\n  npm run uat -- builds [--expected <sha>] [--json]\n  npm run uat -- logs [--app <app|all>] [--minutes N|--since ISO] [filters] [--tail-errors] [--json]\n  npm run uat -- state --service-date YYYY-MM-DD --oploc oploc:<id> [--output path] [--json]\n  npm run uat -- bundle --service-date YYYY-MM-DD --oploc oploc:<id> [--app <app|all>] [--minutes N]\n\nOptional staging browser-session forwarding: set FIKA_UAT_COOKIE in the environment. It is never printed or persisted.\n`; }

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.command === "help") { console.log(help()); return 0; }
  if (["state", "bundle"].includes(args.command) && (!args.service_date || !args.oploc)) throw new Error(`${args.command} requires --service-date YYYY-MM-DD and --oploc oploc:<id>.`);
  if (args.command === "builds") { const result = await discoverBuilds({ expected: args.expected, app: args.app, ...deps }); if (args.json) console.log(JSON.stringify(result, null, 2)); else console.log(formatBuilds(result)); return 0; }
  if (args.command === "logs") {
    const result = await readCloudLogs({ ...args, serviceDate: args.service_date, oploc: args.oploc, buildSha: args.build_sha, requestId: args.request_id, run: deps.runGcloud });
    if (args.json) console.log(JSON.stringify(result, null, 2)); else console.log(formatLogs(result)); return 0;
  }
  if (args.command === "state") {
    const result = await captureState({ serviceDate: args.service_date, oplocId: args.oploc, ...deps });
    if (args.output) await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    if (args.json) console.log(JSON.stringify(result, null, 2)); else console.log(formatState(result)); return 0;
  }
  const result = await collectBundle({ serviceDate: args.service_date, oplocId: args.oploc, ...args, ...deps });
  const paths = await writeBundleFiles(result, { outputDir: deps.outputDir });
  console.log(`Evidence bundle written:\n  ${paths.markdownPath}\n  ${paths.jsonPath}`);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((error) => { console.error(`UAT toolkit error: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
