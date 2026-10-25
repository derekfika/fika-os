#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { APPS, REPO, MAIN_CHECK, affected, risk, target, digest } from './policy.mjs';
import { git, root, command, ghApi, save, stateDir, jsonFile } from './runtime.mjs';
import { createWorkspace, checkWorkspace, finishWorkspace, retireWorkspace, workspaceRecords, cleanupPlan, applyCleanup } from './workspaces.mjs';
import { bootstrap, deploy, reconcile, reconcileServingBaseline, planRelease } from './releases.mjs';
import { hostedTrust, assertHostedContext } from './hosted.mjs';

export function parse(args) {
  const positional = []; const options = {};
  const flags = new Set(['execute', 'staging', 'prod', 'resume', 'archive', 'preserve-generated', 'plan', 'tools-only', 'owner-approved', 'cosmetic-only', 'standard']);
  const values = new Set(['sha', 'owner', 'scope', 'base', 'head', 'file', 'approve-hash', 'record', 'timeout-ms', 'output', 'workspace', 'release-id', 'resolution', 'rollout', 'reason']);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
    const key = args[i].slice(2); if (Object.hasOwn(options, key)) throw Error(`Duplicate --${key}`);
    if (flags.has(key)) options[key] = true;
    else if (values.has(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key] = args[++i];
    else throw Error(`Unknown or missing value for --${key}`);
  }
  if (options.staging && options.prod) throw Error('Choose exactly one environment');
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
export function protection(t) {
  return { required_status_checks: t ? null : { strict: true, contexts: [MAIN_CHECK] }, enforce_admins: true,
    required_pull_request_reviews: t ? null : { dismiss_stale_reviews: false, require_code_owner_reviews: false, require_last_push_approval:false, required_approving_review_count: 0 },
    restrictions: null, required_linear_history: false, allow_force_pushes: false, allow_deletions: false };
}
async function main() {
  const { positional: [verb, arg, name], options } = parse(process.argv.slice(2));
  let result;
  if (verb === 'affected') {
    const paths = changePaths(options); result = { ...changeScope(paths, options), lane: risk(paths), paths };
    if (options.output) writeFileSync(options.output, JSON.stringify(result));
  } else if (verb === 'validate') {
    const paths = changePaths(options); const scope = changeScope(paths, options);
    const commands = [{ program: process.execPath, args: ['--test', ...['policy', 'workspaces', 'releases', 'recovery', 'hosted'].map(n => `tools/workflow/${n}.test.mjs`)] }];
    if (!options['tools-only']) for (const app of scope.apps) {
      for (const script of ['test', 'typecheck', 'build']) commands.push({ program: 'npm', args: ['--prefix', APPS[app].path, 'run', script], app });
    }
    if (options.plan) result = { scope, commands, executed: false };
    else {
      for (const item of commands) command(item.program, item.args, { env: { ...process.env, NODE_ENV: item.args.at(-1) === 'build' ? 'production' : 'test', FIREBASE_PROJECT_ID: 'demo-fika-os', FIKA_CPU_PLAN_STORE: 'memory' }, stdio: ['ignore', 'inherit', 'inherit'] });
      result = { scope, executed: true, commands: commands.length };
    }
  } else if (verb === 'workspace') {
    if (arg === 'create') result = createWorkspace(name, options);
    else if (arg === 'check') result = checkWorkspace(name, options);
    else if (arg === 'finish') result = finishWorkspace(name, options);
    else if (arg === 'retire') result = retireWorkspace(name, options);
    else if (arg === 'list') result = workspaceRecords();
    else throw Error('workspace create|check|finish|retire <name> --owner <task>; create also needs --scope <paths>');
  } else if (verb === 'dev') {
    const lease = workspaceRecords().find(x=>x.name===options.workspace && x.owner===options.owner && x.state==='active');
    if (!lease || !APPS[arg] || !lease.scopes.some(s=>s===APPS[arg].path || s.startsWith(`${APPS[arg].path}/`))) throw Error('dev requires the active workspace owner and app scope');
    command('npm',['--prefix',APPS[arg].path,'run','dev','--','--port',String(lease.ports[arg])],{cwd:lease.directory,env:{...process.env,FIKA_RUNTIME_MODE:'local'},stdio:['inherit','inherit','inherit']});
    result={stopped:true};
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
      // Preserve reviewed/staged source ancestry; squash/rebase would invalidate exact-source promotion evidence.
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
    result = { usage: ['fika workspace create <task> --owner <agent> --scope apps/cpu-production', 'fika workspace retire <task> --owner <agent> [--preserve-generated] [--archive]', 'fika affected --base origin/main', 'fika validate --base origin/main', 'fika deploy cpu --staging [--execute]', 'fika deploy cpu --prod [--execute --owner-approved --reason <owner release instruction>]', 'fika rollback cpu --prod [--execute --owner-approved --reason <owner rollback instruction>]', 'fika reconcile cpu --staging|--prod [--resolution abandon|complete --rollout <ID> --reason <text> --execute]', 'fika reconcile-serving-baseline hub --staging --sha <exact SHA> --rollout <build ID> --reason <owner instruction> [--execute]', 'fika cleanup --output <plan.json>', 'fika cleanup --execute --file <plan.json> --approve-hash <hash>'], safety: 'Owner gives ordinary language instructions; agent pins the exact source, records authorisation and preserves append-only history. CI, staging for operational changes, exact-SHA/backend and recovery gates remain mandatory. Hosted WIF is optional for local operation.' };
  }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`FIKA HOLD: ${error.message}`); process.exitCode = 1; });
