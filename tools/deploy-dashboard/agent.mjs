#!/usr/bin/env node
// Advisory agent tracking: `agent start <app> <agent>` / `agent finish <app>` / `agent status`.
// Writes the shared deploy-config.json atomically. No lease, lock, expiry or deployment effect.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, APP_IDS, configPath, readConfig, setAssignment } from './config.mjs';

const usage = `Usage:
  node tools/deploy-dashboard/agent.mjs start <app> <${AGENTS.filter(a => a !== 'free').join('|')}> [--branch <name>] [--task "<text>"]
  node tools/deploy-dashboard/agent.mjs finish <app>
  node tools/deploy-dashboard/agent.mjs status
Apps: ${APP_IDS.join(', ')}`;

export function parse(argv) {
  const [command, app, agent, ...rest] = argv;
  const flags = {};
  const positional = command === 'start' ? rest : [agent, ...rest].filter(Boolean);
  for (let i = 0; i < positional.length; i++) if (positional[i].startsWith('--')) { flags[positional[i].slice(2)] = positional[i + 1]; i++; }
  return { command, app, agent: command === 'start' ? agent : undefined, flags };
}
function currentBranch() {
  try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(); } catch { return null; }
}
export function main(argv, { file = configPath(), log = console.log, branch = currentBranch } = {}) {
  const { command, app, agent, flags } = parse(argv);
  if (command === 'status') {
    for (const a of readConfig(file).apps) log(`${a.id.padEnd(13)} ${a.agent.padEnd(7)} ${a.assignment ? `${a.assignment.branch || '-'} since ${a.assignment.since}${a.assignment.task ? ` — ${a.assignment.task}` : ''}` : ''}`);
    return 0;
  }
  if (command === 'start') {
    if (!app || !agent || agent === 'free') { log(usage); return 2; }
    const updated = setAssignment(app, { agent, branch: flags.branch || branch(), task: flags.task, source: 'cli' }, file);
    log(`${updated.name}: assigned to ${updated.agent} (advisory only; no deployment started)`);
    return 0;
  }
  if (command === 'finish') {
    if (!app) { log(usage); return 2; }
    const updated = setAssignment(app, { agent: 'free', source: 'cli' }, file);
    log(`${updated.name}: now free`);
    return 0;
  }
  log(usage); return 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
