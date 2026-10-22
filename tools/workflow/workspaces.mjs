import path from 'node:path';
import { existsSync, readdirSync, mkdirSync, lstatSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { git, common, stateDir, save, jsonFile, lock, ancestor, inside, command, ref, ghApi } from './runtime.mjs';
import { safeScope, partialPathOverlap, digest, REPO, APPS } from './policy.mjs';

const leases = () => { const p = path.join(stateDir(), 'workspaces'); mkdirSync(p, { recursive: true }); return p; };
const managedRoot = () => path.resolve(common(), '..', '..', 'agent-workspaces', 'fika-os');
const validateName = name => { if (!/^[a-z][a-z0-9-]{2,60}$/.test(name || '')) throw Error('Use a 3–61 character lowercase workspace name'); return name; };
export function workspaceRecords() { return readdirSync(leases()).filter(x => x.endsWith('.json')).map(x => jsonFile(path.join(leases(), x))); }
export function worktrees() {
  return git('worktree', 'list', '--porcelain').split(/\r?\n\r?\n/).filter(Boolean).map(block => Object.fromEntries(block.split(/\r?\n/).map(line => { const i = line.indexOf(' '); return i < 0 ? [line, true] : [line.slice(0, i), line.slice(i + 1)]; })));
}
export function createWorkspace(name, options) {
  validateName(name); if (!options.owner) throw Error('--owner is required');
  const scopes = String(options.scope || '').split(',').map(safeScope);
  return lock('workspaces', () => {
    git('fetch', 'origin'); const baseline = git('rev-parse', 'origin/main');
    if (existsSync(path.join(leases(), `${name}.json`))) throw Error('Workspace name already registered; never reuse another task lease');
    for (const lease of workspaceRecords().filter(x => x.state === 'active')) for (const a of scopes) for (const b of lease.scopes) if (partialPathOverlap(a, b)) throw Error(`Scope ${a} is owned by ${lease.name}/${lease.owner}`);
    mkdirSync(managedRoot(), { recursive: true });
    const directory = path.join(managedRoot(), name); const branch = `codex/${name}`;
    if (existsSync(directory) || ref(`refs/heads/${branch}`)) throw Error('Workspace path/branch exists; refusing overwrite');
    const portBase = 13000 + workspaceRecords().length * 10;
    if (portBase > 65000) throw Error('Workspace port allocation exhausted');
    const ports = Object.fromEntries(Object.keys(APPS).map((app,i)=>[app,portBase+i]));
    const record = { schema: 'fika.workspace.v1', name, owner: options.owner, scopes, baseline, directory, branch, ports, state: 'creating', createdAt: new Date().toISOString() };
    save(path.join(leases(), `${name}.json`), record);
    try { git('worktree', 'add', '-b', branch, directory, baseline); record.state = 'active'; save(path.join(leases(), `${name}.json`), record); }
    catch (error) { record.state = 'attention'; save(path.join(leases(), `${name}.json`), record); throw error; }
    return record;
  });
}
export function finishWorkspace(name, options) {
  validateName(name); return lock('workspaces', () => {
    const file = path.join(leases(), `${name}.json`); const record = jsonFile(file);
    if (record.owner !== options.owner || record.state !== 'active') throw Error('Only the task owner can finish an active workspace');
    if (command('git', ['status', '--porcelain'], { cwd: record.directory })) throw Error('Dirty work must be committed/preserved; finish refuses it');
    record.state = 'finished'; record.finishedAt = new Date().toISOString(); record.finalSha = command('git', ['rev-parse', 'HEAD'], { cwd: record.directory }); save(file, record); return record;
  });
}
export function checkWorkspace(name, options) {
  validateName(name);
  const record = jsonFile(path.join(leases(), `${name}.json`));
  if (record.owner !== options.owner || record.state !== 'active') throw Error('Scope check requires the active task owner');
  const run = (...args) => command('git', args, { cwd: record.directory });
  const paths = [...new Set([run('diff', '--name-only', '--no-renames', `${record.baseline}...HEAD`), run('diff', '--name-only', '--no-renames', 'HEAD'), run('ls-files', '--others', '--exclude-standard')].flatMap(s => s.split(/\r?\n/)).filter(Boolean))];
  const outside = paths.filter(p => p !== 'CHANGELOG.md' && !record.scopes.some(s => p === s || p.startsWith(`${s}/`)));
  if (outside.length) throw Error(`Changes exceed owned scope: ${outside.join(', ')}`);
  return { name, baseline: record.baseline, paths, withinScope: true };
}
export function retireWorkspace(name, options) {
  validateName(name); return lock('workspaces', () => {
    const file = path.join(leases(), `${name}.json`); const record = jsonFile(file);
    if (record.owner !== options.owner || record.state !== 'finished') throw Error('Retirement requires the owner and a finished lease');
    inside(managedRoot(), record.directory);
    if (path.resolve(record.directory) === path.resolve(git('rev-parse', '--show-toplevel'))) throw Error('Cannot retire the calling workspace');
    if (command('git', ['status', '--porcelain'], { cwd: record.directory })) throw Error('Dirty/untracked files must be preserved before retirement');
    const head = command('git', ['rev-parse', 'HEAD'], { cwd: record.directory });
    if (head !== record.finalSha) throw Error('Workspace changed after finish');
    git('fetch', 'origin');
    const unique = !ancestor(head, 'origin/main');
    if (unique && !options.archive) throw Error('Unique commits: integrate first or explicitly --archive the finished clean workspace');
    const generated = generatedPlan(record, options);
    if (unique) {
      const archive = path.join(stateDir(), 'archives'); mkdirSync(archive, { recursive: true });
      record.preservationRef = `refs/preserve/workspace/${name}`;
      git('update-ref', record.preservationRef, head, '0000000000000000000000000000000000000000');
      record.bundle = path.join(archive, `${name}.bundle`); git('bundle', 'create', record.bundle, record.preservationRef); git('bundle', 'verify', record.bundle);
    }
    if (generated.length) {
      const archive = path.join(stateDir(), 'archives', `${name}-generated-${randomUUID()}`);
      mkdirSync(path.dirname(archive), { recursive: true }); mkdirSync(archive);
      const manifest = { name, owner: record.owner, head, source: record.directory, archive, createdAt: new Date().toISOString(), items: generated.map(item => ({ path: item, moved: false })) };
      record.generatedArchive = archive; record.generatedArchives = [...(record.generatedArchives || []), archive]; save(file, record); save(path.join(archive, 'manifest.json'), manifest);
      for (const item of manifest.items) {
        const from = inside(record.directory, path.join(record.directory, item.path));
        const to = path.join(archive, item.path); mkdirSync(path.dirname(to), { recursive: true });
        renameSync(from, to); item.moved = true; save(path.join(archive, 'manifest.json'), manifest);
      }
    }
    if (command('git', ['status', '--porcelain', '--ignored'], { cwd: record.directory })) throw Error('Workspace changed or ignored files remain; preserve it and inspect generated archive manifest');
    git('worktree', 'remove', record.directory); // no --force and no recursive shell deletion
    if (ancestor(head, 'origin/main')) git('branch', '-d', record.branch);
    record.state = 'retired'; record.retiredAt = new Date().toISOString(); save(file, record); return record;
  });
}
function generatedPlan(record, options) {
  const ignored = command('git', ['status', '--porcelain', '-z', '--ignored'], { cwd: record.directory }).split('\0').filter(Boolean);
  if (!ignored.length) return [];
  if (!options['preserve-generated']) throw Error('Ignored files remain; --preserve-generated archives only allowlisted ignored dependencies/build outputs, never deletes them');
  const allowed = ['node_modules', ...Object.values(APPS).flatMap(app => [`${app.path}/node_modules`, `${app.path}/.next`, `${app.path}/tsconfig.tsbuildinfo`])];
  for (const entry of ignored) {
    const name = entry.slice(3).replace(/\/$/, '');
    if (!entry.startsWith('!! ') || !allowed.some(a => name === a || name.startsWith(`${a}/`))) throw Error(`Non-disposable ignored file must be preserved separately: ${name}`);
  }
  return allowed.filter(a => existsSync(path.join(record.directory, a))).map(a => {
    const p = inside(record.directory, path.join(record.directory, a));
    if (lstatSync(p).isSymbolicLink()) throw Error(`Generated root is a link; inspect instead of retiring: ${a}`);
    command('git', ['check-ignore', '-q', '--', a], { cwd: record.directory });
    if (command('git', ['ls-files', '--', a], { cwd: record.directory })) throw Error(`Generated path contains tracked files: ${a}`);
    return a;
  });
}
export function cleanupPlan() {
  const occupied = new Set(worktrees().map(x => x.branch));
  const openPulls = /github\.com[:/]derekfika\/fika-os(?:\.git)?$/.test(git('remote', 'get-url', 'origin')) ? ghApi(`repos/${REPO}/pulls?state=open&per_page=100`) : [];
  if (openPulls.length === 100) throw Error('Open-PR inventory needs pagination before cleanup');
  const activeBranches = new Set(openPulls.map(p => `refs/heads/${p.head.ref}`));
  const branches = git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').split(/\r?\n/).filter(Boolean).map(line => {
    const [name, sha] = line.split(' '); const candidate = /^refs\/heads\/(codex|claude|feature|fix)\//.test(name);
    const eligible = candidate && !occupied.has(name) && !activeBranches.has(name) && ancestor(sha, 'origin/main');
    return { name, sha, eligible, reason: occupied.has(name) ? 'worktree attached; activity ambiguous/protected' : activeBranches.has(name) ? 'open PR head protected' : !candidate ? 'integration/release/recovery namespace protected' : !eligible ? 'unique or unmerged commits protected' : 'fully integrated, no attached worktree; preservation ref required' };
  });
  const body = { schema: 'fika.cleanup.v1', baseline: git('rev-parse', 'origin/main'), branches, worktrees: worktrees(), stashes: git('stash', 'list', '--format=%H').split(/\r?\n/).filter(Boolean), limit: 8 };
  return { ...body, planHash: digest(body) };
}
export function applyCleanup(plan, approvedHash) {
  return lock('cleanup', () => {
    const { planHash, ...body } = plan;
    if (planHash !== approvedHash || digest(body) !== planHash) throw Error('Cleanup plan/hash mismatch');
    const fresh = cleanupPlan(); if (fresh.planHash !== planHash) throw Error('Repository changed since cleanup plan');
    // Never remove any worktree/stash/archive here. Only a bounded set of fully integrated unattached refs.
    const retired = [];
    for (const item of body.branches.filter(x => x.eligible).slice(0, body.limit)) {
      git('update-ref', `refs/preserve/workflow-cleanup/${item.name.slice('refs/heads/'.length)}`, item.sha, '0000000000000000000000000000000000000000');
      git('update-ref', '-d', item.name, item.sha); retired.push(item);
    }
    return { planHash, retired, protectedWorktrees: body.worktrees.length, stashesPreserved: body.stashes.length };
  });
}
