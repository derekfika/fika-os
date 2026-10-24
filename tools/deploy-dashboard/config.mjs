import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENTS = ['free', 'luna', 'sol', 'sonnet', 'haiku'];
export const ENVIRONMENTS = ['staging', 'production'];
/** Each environment may only ever target its own Firebase project, whatever the config file says. */
export const ENV_PROJECTS = { staging: 'fika-os-dev', production: 'fika-os' };
export const REGION = 'europe-west4';
export const APP_IDS = ['hub', 'cpu', 'logistics', 'delivered-in', 'hospitality', 'menu', 'adhoc'];

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = /^[a-z][a-z0-9-]{2,62}$/;

/** The canonical checkout is the parent of the shared git dir, so every worktree reads and writes the same files. */
export function canonicalRoot(cwd = here) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', windowsHide: true }).trim();
    return path.dirname(common);
  } catch { return path.resolve(here, '..', '..'); }
}
export function configPath() {
  if (process.env.FIKA_DEPLOY_CONFIG) return path.resolve(process.env.FIKA_DEPLOY_CONFIG);
  const canonical = path.join(canonicalRoot(), 'tools', 'deploy-dashboard', 'deploy-config.json');
  return existsSync(canonical) ? canonical : path.join(here, 'deploy-config.json');
}
export function historyPath() {
  if (process.env.FIKA_DEPLOY_HISTORY) return path.resolve(process.env.FIKA_DEPLOY_HISTORY);
  return path.join(canonicalRoot(), 'tools', 'deploy-dashboard', 'data', 'deployments.jsonl');
}

export function validateConfig(cfg) {
  const fail = message => { throw Error(`Invalid deploy config: ${message}`); };
  if (!cfg || cfg.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (cfg.region !== REGION) fail(`region must be ${REGION}`);
  if (!Array.isArray(cfg.apps) || cfg.apps.length !== APP_IDS.length) fail(`exactly ${APP_IDS.length} apps are required`);
  const seen = new Set();
  for (const app of cfg.apps) {
    if (!APP_IDS.includes(app.id) || seen.has(app.id)) fail(`unknown or duplicate app id ${app.id}`);
    seen.add(app.id);
    if (!app.name || !app.path) fail(`${app.id} needs name and path`);
    if (!AGENTS.includes(app.agent)) fail(`${app.id} agent must be one of ${AGENTS.join(', ')}`);
    for (const env of ENVIRONMENTS) {
      const t = app[env];
      if (!t || t.project !== ENV_PROJECTS[env]) fail(`${app.id} ${env} project must be ${ENV_PROJECTS[env]}`);
      if (!BACKEND.test(t.backend || '')) fail(`${app.id} ${env} backend is missing or malformed`);
    }
    if (app.staging.backend === app.production.backend) fail(`${app.id} staging and production backends must differ`);
  }
  return cfg;
}
export function readConfig(file = configPath()) {
  return validateConfig(JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')));
}
function writeAtomic(file, cfg) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`);
  renameSync(tmp, file);
}
/**
 * Advisory assignment only: re-reads the file, changes one app, replaces atomically.
 * No lease, lock file, expiry or ownership check; it never touches deployments.
 */
export function setAssignment(appId, { agent, branch, task, source = 'manual' }, file = configPath(), now = () => new Date().toISOString()) {
  if (!AGENTS.includes(agent)) throw Error(`agent must be one of ${AGENTS.join(', ')}`);
  const cfg = readConfig(file);
  const app = cfg.apps.find(a => a.id === appId);
  if (!app) throw Error(`Unknown app ${appId}`);
  const clean = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
  app.agent = agent;
  app.assignment = agent === 'free' ? null : { branch: clean(branch), task: clean(task), since: now(), source };
  writeAtomic(file, validateConfig(cfg));
  return app;
}
export function targetFor(cfg, appId, environment) {
  const app = cfg.apps.find(a => a.id === appId);
  if (!app || !ENVIRONMENTS.includes(environment)) throw Error('Unknown application or environment');
  const t = app[environment];
  if (t.project !== ENV_PROJECTS[environment]) throw Error(`${environment} must target ${ENV_PROJECTS[environment]}`);
  return { app: app.id, name: app.name, path: app.path, environment, project: t.project, backend: t.backend, region: cfg.region };
}
