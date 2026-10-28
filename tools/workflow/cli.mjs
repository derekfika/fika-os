#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { APPS, REPO, MAIN_CHECK, affected, risk, target, digest } from './policy.mjs';
import { git, root, command, ghApi, save, stateDir, jsonFile } from './runtime.mjs';
import { createWorkspace, checkWorkspace, finishWorkspace, retireWorkspace, reconcileWorkspace, workspaceRecords, cleanupPlan, applyCleanup } from './workspaces.mjs';
import { bootstrap, deploy, reconcile, reconcileServingBaseline, planRelease, successfulValidation } from './releases.mjs';
import { hostedTrust, assertHostedContext } from './hosted.mjs';
import { assertChangelogs, assertChangelogContent } from './changelog.mjs';
import { governedOperation } from './workspace-state.mjs';
import { completeWorkspace, previewReleaseAll, releaseAllWorkspaces, previewSweep, sweepWorkspaces, workspaceStatus, publishWorkspaceStatus, recoverValidationOperation } from './workspace-admin.mjs';
import { installWorkspaceFences } from './workspace-fencing.mjs';

export function parse(args) {
  const positional = []; const options = {};
  const flags = new Set(['execute', 'dry-run', 'staging', 'prod', 'resume', 'archive', 'preserve-generated', 'plan', 'tools-only', 'owner-approved', 'cosmetic-only', 'standard', 'preserve']);
  const values = new Set(['sha', 'owner', 'scope', 'base', 'head', 'file', 'approve-hash', 'record', 'timeout-ms', 'output', 'workspace', 'release-id', 'resolution', 'rollout', 'reason', 'replacement', 'confirm', 'pr']);
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
    const paths = changePaths(options); result = { ...changeScope(paths, options), lane: risk(paths), paths };
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
    if (arg === 'create') result = createWorkspace(name, options);
    else if (arg === 'check') result = checkWorkspace(name, options);
    else if (arg === 'finish') result = finishWorkspace(name, options);
    else if (arg === 'reconcile') result = reconcileWorkspace(name, options);
    else if (arg === 'retire') result = retireWorkspace(name, options);
    else if (arg === 'complete') {
      result = completeWorkspace(name, options);
      try { result.publication = publishWorkspaceStatus({ execute: true }); }
      catch (error) { result.publication = { outcome: 'pending', reason: error.message.split('\n')[0], retry: 'fika workspace publish --execute' }; }
    }
    else if (arg === 'release-all') result = options.execute ? releaseAllWorkspaces(options) : previewReleaseAll();
    else if (arg === 'sweep') result = options.execute ? sweepWorkspaces(options) : previewSweep();
    else if (arg === 'status') result = workspaceStatus();
    else if (arg === 'publish') result = publishWorkspaceStatus(options);
    else if (arg === 'install-fences') result = installWorkspaceFences();
    else if (arg === 'recover-validation') result = recoverValidationOperation(name,options);
    else if (arg === 'list') result = workspaceRecords();
    else throw Error('workspace create|check|reconcile|finish|retire|complete <name> --owner <task>; status|publish|release-all|sweep. Bulk execution requires a fresh preview hash; release-all also requires exact --confirm and --reason.');
  } else if (verb === 'integrate') {
    const lease = workspaceRecords().find(r => r.name === options.workspace && r.owner === options.owner && r.state === 'active');
    if (!lease || !/^\d+$/.test(options.pr || '')) throw Error('Integration requires an active --workspace, --owner and --pr');
    checkWorkspace(lease.name, options);
    const sha = command('git', ['rev-parse', 'HEAD'], { cwd: lease.directory });
    const pr = ghApi(`repos/${REPO}/pulls/${options.pr}`);
    if (pr.head.sha !== sha || pr.head.ref !== lease.branch || pr.base.ref !== 'main' || pr.state !== 'open') throw Error('PR does not match the active workspace branch and exact final SHA');
    const validation=successfulValidation(sha);
    if (command('git', ['status', '--porcelain'], { cwd: lease.directory }) || command('git', ['rev-parse','HEAD'], {cwd:lease.directory})!==sha) throw Error('Workspace changed during integration checks');
    command('gh', ['pr', 'merge', options.pr, '--repo', REPO, '--merge', '--match-head-commit', sha]);
    result = { pr: pr.html_url, sourceSha: sha, validation, merged: true, branchPreserved: true };
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
    result = { usage: ['fika workspace create <task> --owner <agent> --scope apps/cpu-production', 'fika workspace reconcile <old> --owner <agent> --replacement <new> [--dry-run|--execute]', 'fika workspace retire <task> --owner <agent> [--preserve-generated] [--archive]', 'fika affected --base origin/main', 'fika validate --base origin/main', 'fika deploy cpu --staging [--execute]', 'fika deploy cpu --prod [--execute --owner-approved --reason <owner release instruction>]', 'fika rollback cpu --prod [--execute --owner-approved --reason <owner rollback instruction>]', 'fika reconcile cpu --staging|--prod [--resolution abandon|complete --rollout <ID> --reason <text> --execute]', 'fika reconcile-serving-baseline hub --staging --sha <exact SHA> --rollout <build ID> --reason <owner instruction> [--execute]', 'fika cleanup --output <plan.json>', 'fika cleanup --execute --file <plan.json> --approve-hash <hash>'], safety: 'Workspace reconciliation preserves the original checkout and checksummed recovery journal, transfers only leased dirty changes to current origin/main, and commits the ownership transition under the workspace lock. Dry run is default; --execute applies. Owner gives ordinary language instructions; agent pins exact source, CI and deployment safeguards remain mandatory.' };
  }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verb = process.argv[2];
  const { options } = parse(process.argv.slice(2));
  const action = ['validate','integrate','dev','deploy','rollback','reconcile','reconcile-serving-baseline','bootstrap'].includes(verb) ? () => governedOperation(verb, main, options) : main;
  action().catch(error => { console.error(`FIKA HOLD: ${error.message}`); process.exitCode = 1; });
}
