#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { APPS, REPO, MAIN_CHECK, affected, target } from './policy.mjs';
import { git, command, ghApi, save, jsonFile } from './runtime.mjs';
import { workspaceRecords, cleanupPlan, applyCleanup } from './workspaces.mjs';
import { checkSourceWorkspace, completeSourceWorkspace, createSourceWorkspace, devSourceWorkspace, integrateSourceWorkspace, sourceWorkspaceStatus } from './source-workspaces.mjs';
import { migrateSourceHistory } from './source-migration.mjs';
import { bootstrap, deploy, reconcile, reconcileServingBaseline } from './releases.mjs';
import { hostedTrust, assertHostedContext } from './hosted.mjs';
import { assertChangelogs, assertChangelogContent } from './changelog.mjs';
import { governedReleaseOperation } from './workspace-state.mjs';
import { recoverValidationOperation, recoverDevOperation, recoverDeployOperation } from './workspace-admin.mjs';
import { installWorkspaceFences } from './workspace-fencing.mjs';

export function parse(args) {
  const positional = []; const options = {};
  const flags = new Set(['execute', 'dry-run', 'staging', 'prod', 'resume', 'archive', 'preserve-generated', 'plan', 'tools-only', 'preserve']);
  const values = new Set(['sha', 'owner', 'scope', 'base', 'head', 'file', 'approve-hash', 'record', 'timeout-ms', 'output', 'workspace', 'release-id', 'resolution', 'rollout', 'reason', 'replacement', 'confirm', 'pr', 'port', 'lease-id', 'predecessor', 'predecessor-lease-id']);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
    const key = args[i].slice(2); if (Object.hasOwn(options, key)) throw Error(`Duplicate --${key}`);
    if (flags.has(key)) options[key] = true;
    else if (values.has(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key] = args[++i];
    else throw Error(`Unknown or missing value for --${key}`);
  }
  if (options.staging && options.prod) throw Error('Choose exactly one environment');
  if (options.execute && options['dry-run']) throw Error('Choose either --dry-run or --execute');
  return { positional, options };
}
function changePaths(options) {
  const base = options.base || 'origin/main'; const head = options.head || 'HEAD';
  const committed = git('diff', '--no-renames', '--name-only', `${base}...${head}`).split(/\r?\n/).filter(Boolean);
  if (options.head) return committed;
  return [...new Set([...committed, ...git('diff', '--no-renames', '--name-only', 'HEAD').split(/\r?\n/), ...git('ls-files', '--others', '--exclude-standard').split(/\r?\n/)].filter(Boolean))];
}
function changeScope(paths, options) {
  let rootRuntimeChanged = true;
  if (paths.includes('package.json')) {
    try {
      const keys = ['dependencies','devDependencies','optionalDependencies','overrides','engines','workspaces'];
      const previous = JSON.parse(git('show', `${options.base || 'origin/main'}:package.json`));
      const next = options.head ? JSON.parse(git('show', `${options.head}:package.json`)) : JSON.parse(readFileSync('package.json','utf8'));
      rootRuntimeChanged = keys.some(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
    } catch { rootRuntimeChanged = true; }
  }
  return affected(paths, { rootRuntimeChanged });
}
function checkChangelogEntries(paths, options) {
  const result = assertChangelogs(paths);
  assertChangelogContent(paths, p => options.head ? git('show', `${options.head}:${p}`) : readFileSync(p, 'utf8'));
  return result;
}
export function protection(t) {
  return { required_status_checks: t ? null : { strict: true, contexts: [MAIN_CHECK] }, enforce_admins: true,
    required_pull_request_reviews: t ? null : { dismiss_stale_reviews: false, require_code_owner_reviews: false, require_last_push_approval:false, required_approving_review_count: 0 },
    restrictions: null, required_linear_history: false, allow_force_pushes: false, allow_deletions: false };
}
async function main() {
  const { positional: [verb, arg, name], options } = parse(process.argv.slice(2));
  let result;
  if (verb === 'affected') {
    const paths = changePaths(options); result = { ...changeScope(paths, options), paths };
    if (options.output) writeFileSync(options.output, JSON.stringify(result));
  } else if (verb === 'validate') {
    const paths = changePaths(options); const scope = changeScope(paths, options);
    checkChangelogEntries(paths, options);
    const commands = [{ program: process.execPath, args: ['--test', ...readdirSync('tools/workflow').filter(n => n.endsWith('.test.mjs')).map(n => `tools/workflow/${n}`)] }];
    if (paths.some(p => p.startsWith('tools/deploy-dashboard/'))) commands.push({ program: process.execPath, args: ['--test', 'tools/deploy-dashboard/dashboard.test.mjs'] });
    if (!options['tools-only']) for (const app of scope.apps) {
      for (const script of ['test', 'typecheck', 'build']) commands.push({ program: 'npm', args: ['--prefix', APPS[app].path, 'run', script], app });
    }
    if (options.plan) result = { scope, commands, executed: false };
    else {
      for (const item of commands) command(item.program, item.args, { env: { ...process.env, NODE_ENV: item.args.at(-1) === 'build' ? 'production' : 'test', FIREBASE_PROJECT_ID: 'demo-fika-os', FIKA_CPU_PLAN_STORE: 'memory' }, stdio: ['ignore', 'inherit', 'inherit'] });
      result = { scope, executed: true, commands: commands.length };
    }
  } else if (verb === 'changelog' && arg === 'check') {
    result = checkChangelogEntries(changePaths(options), options);
  } else if (verb === 'workspace') {
    if (arg === 'create') result = createSourceWorkspace(name, options);
    else if (arg === 'check') result = checkSourceWorkspace(name);
    else if (arg === 'complete') result = completeSourceWorkspace(name, options);
    else if (arg === 'status' || arg === 'list') result = sourceWorkspaceStatus();
    else if (arg === 'history') result = workspaceRecords();
    else if (arg === 'migrate') result = migrateSourceHistory(options);
    else if (arg === 'install-fences') result = installWorkspaceFences();
    else if (arg === 'recover-validation') result = recoverValidationOperation(name,options);
    else if (arg === 'recover-dev') result = await recoverDevOperation(name,options);
    else if (arg === 'recover-deploy') result = recoverDeployOperation(name, options);
    else throw Error('workspace create|check|complete <name>; status|list|history|migrate|install-fences; recover-validation|recover-dev|recover-deploy <operation-id>. Legacy lease mutations are retired.');
  } else if (verb === 'integrate') {
    result = integrateSourceWorkspace(options.workspace, options.pr);
  } else if (verb === 'dev') {
    if (!Object.hasOwn(APPS, arg)) throw Error('Select a supported app');
    result = devSourceWorkspace(options.workspace, APPS[arg], options.port);
  } else if (verb === 'cleanup') {
    if (options.execute) result = applyCleanup(jsonFile(options.file), options['approve-hash']);
    else { git('fetch', 'origin'); result = cleanupPlan(); if (options.output) save(options.output, result); }
  } else if (verb === 'bootstrap') {
    git('fetch', 'origin'); result = [];
    for (const app of arg ? [arg] : Object.keys(APPS)) for (const env of ['staging', 'prod']) result.push(await bootstrap(target(app, env), options));
    if (options.output) save(options.output, result);
  } else if (verb === 'deploy' || verb === 'rollback' || verb === 'reconcile') {
    if (!options.staging && !options.prod) throw Error('Specify --staging or --prod');
    result = await (verb === 'reconcile' ? reconcile : deploy)(arg, options.prod ? 'prod' : 'staging', {...options,rollback:verb === 'rollback'});
    if (options.output) save(options.output, result);
  } else if (verb === 'reconcile-serving-baseline') {
    if (!options.staging || options.prod) throw Error('Serving baseline reconciliation is restricted to --staging');
    result = await reconcileServingBaseline(arg, 'staging', options);
    if (options.output) save(options.output, result);
  } else if (verb === 'hosted-check' || verb === 'trust') {
    if (!options.staging && !options.prod) throw Error('Specify --staging or --prod');
    const environment = options.prod ? 'prod' : 'staging';
    result = verb === 'trust' ? hostedTrust(arg, environment) : assertHostedContext(process.env, target(arg, environment));
  } else if (verb === 'protect') {
    const branches = ['main', ...Object.keys(APPS).flatMap(app => ['staging', 'prod'].map(env => target(app, env).branch))];
    result = branches.map(branch => ({ branch, policy: protection(branch !== 'main') }));
    if (options.execute) {
      // Preserve reviewed source ancestry and exact-head integration evidence.
      ghApi(`repos/${REPO}`, 'PATCH', { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false, delete_branch_on_merge: false });
      for (const item of result) ghApi(`repos/${REPO}/branches/${encodeURIComponent(item.branch)}/protection`, 'PUT', item.policy);
      for (const app of Object.keys(APPS)) for (const env of ['staging', 'prod']) {
        const environment = `${env}-${app}`;
        ghApi(`repos/${REPO}/environments/${encodeURIComponent(environment)}`, 'PUT', {
          reviewers: [], prevent_self_review: false,
          deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        });
        const policies = ghApi(`repos/${REPO}/environments/${encodeURIComponent(environment)}/deployment-branch-policies`).branch_policies;
        if (policies.some(p => p.name !== 'main' || p.type !== 'branch')) throw Error(`Review existing non-main environment policies for ${environment}; never silently retain or delete them`);
        if (!policies.some(p => p.name === 'main' && p.type === 'branch')) ghApi(`repos/${REPO}/environments/${encodeURIComponent(environment)}/deployment-branch-policies`, 'POST', { name: 'main', type: 'branch' });
      }
    }
    if (options.output) save(options.output, { applied: Boolean(options.execute), protections: result });
  } else {
    result = { usage: [
      'fika workspace create <task> --owner <agent> [--scope <advisory paths>]',
      'fika workspace check <task>',
      'fika workspace complete <task> --owner <agent> [--preserve --reason <why>]',
      'fika workspace history|status|migrate',
      'fika dev cpu --workspace <task> --port <unused port>',
      'fika affected --base origin/main',
      'fika validate --base origin/main',
      'fika integrate --workspace <task> --pr <number>',
      'fika deploy cpu --staging [--sha <merged SHA>] [--execute]',
      'fika deploy cpu --prod [--sha <merged SHA>] [--execute] [--reason <note>]',
      'fika rollback cpu --prod [--execute] [--reason <note>]',
      'fika reconcile cpu --staging|--prod [--resolution abandon|complete --rollout <ID> --execute] [--reason <note>]',
      'fika reconcile-serving-baseline hub --staging --sha <exact SHA> --rollout <rollout ID> [--execute] [--reason <note>]',
      'fika cleanup --output <plan.json>',
      'fika cleanup --execute --file <plan.json> --approve-hash <hash>',
    ] };
  }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verb = process.argv[2];
  const action = ['deploy','rollback','reconcile','reconcile-serving-baseline','bootstrap'].includes(verb) ? () => governedReleaseOperation(verb, main) : main;
  action().catch(error => { console.error(`FIKA HOLD: ${error.message}`); process.exitCode = 1; });
}
