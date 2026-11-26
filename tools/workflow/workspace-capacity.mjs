import path from 'node:path';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { common, git, jsonFile, root, stateDir } from './runtime.mjs';

export const workspaceLimit = 10;
const bootstrapIssue = 687;
const bootstrapName = 'workspace-build-artifact-retirement';
const bootstrapOwner = 'codex-workspace-build-artifact-retirement';
export const managedRoot = () => path.resolve(realpathSync(common()), '..', '..', 'agent-workspaces', 'fika-os');
export const sourceTaskFile = name => path.join(stateDir(), 'source-tasks', `${name}.json`);
export const completionFile = name => path.join(stateDir(), 'source-completions', `${name}.json`);
export const optionalJson = file => {
  try { return jsonFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
};
export const split = value => value.split('\0').filter(Boolean);
export const workspaceName = name => /^[a-z][a-z0-9-]{2,60}$/.test(name || '');
export const pathKey = value => {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};
export const samePath = (a, b) => pathKey(a) === pathKey(b);
export const canonical = () => path.resolve(common(), '..');
function authorizedBootstrap(task, management) {
  const exception = task?.bootstrapException;
  const ownerBootstrap = exception?.authorization === 'explicit-owner-directive' &&
    exception.capacityExempt === true && exception.authorizedAt &&
    exception.scope === 'workspace-governance-and-studio-preflight' &&
    task?.name === 'governance-simplification' && task?.owner === 'codex-governance-simplification' &&
    task?.branch === 'codex/governance-simplification';
  if (ownerBootstrap && task?.state === 'active' && samePath(task.directory, path.join(management, task.name))) return true;
  const infrastructureRecovery = exception?.authorization === 'owner-authorized-infrastructure-recovery' &&
    exception.capacityExempt === true && exception.taskName === task?.name && exception.owner === task?.owner &&
    /^infra-recovery-[a-z0-9-]{3,40}$/.test(task?.name || '') && exception.reason?.trim().length >= 20 &&
    Array.isArray(exception.scope) && exception.scope.length > 0 && exception.scope.every(item =>
      ['tools/workflow', 'AGENTS.md', 'overnight.md', 'docs/deployment/workspace-management.md',
        'docs/deployment/workflow.md', 'docs/deployment/hospitality-menu-studio-staging.md'].includes(item));
  if (infrastructureRecovery && ['creating', 'active'].includes(task?.state) && samePath(task.directory, path.join(management, task.name))) return true;
  return task?.name === bootstrapName && task?.owner === bootstrapOwner && task?.branch === `codex/${bootstrapName}` &&
    task?.state === 'active' && samePath(task.directory, path.join(management, bootstrapName)) &&
    exception?.authorization === 'explicit-owner-directive' && exception.issue === bootstrapIssue &&
    exception.scope === 'workspace-retirement-repair' && exception.capacityExempt === true &&
    exception.authorizedAt === '2026-11-25';
}
export function requireCanonical() {
  if (!samePath(root(), canonical())) throw Error('Run this workspace command from the canonical checkout');
}

export function localEntry(file) {
  try { return lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

export function stateRecords(area) {
  const dir = path.join(common(), 'fika-workflow', area);
  let files;
  try { files = readdirSync(dir); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return files.filter(file => file.endsWith('.json')).map(file => optionalJson(path.join(dir, file))).filter(Boolean);
}

export function registrations() {
  return git('worktree', 'list', '--porcelain', '-z').split('\0\0').filter(Boolean).map(row =>
    Object.fromEntries(split(row).map(field => {
      const [key] = field.split(' ', 1);
      return [key, field === key ? true : field.slice(key.length + 1)];
    })));
}

export function withCapacityLock(action) {
  const { DatabaseSync } = process.getBuiltinModule?.('node:sqlite') || {};
  if (!DatabaseSync) throw Error('Workspace lifecycle requires Node 22.13 or later');
  const db = new DatabaseSync(path.join(stateDir(), 'source-capacity.sqlite'));
  try {
    // Use the OS-owned SQLite file lock as a mutex. SQLite busy_timeout does not
    // retry SQLITE_LOCKED on every Windows/VFS path, so retry only lock acquisition
    // with a bounded deadline. Lifecycle intents remain durable across interruption.
    db.exec('PRAGMA busy_timeout = 250');
    const deadline = Date.now() + 30000;
    const waitCell = new Int32Array(new SharedArrayBuffer(4));
    while (true) {
      try { db.exec('BEGIN IMMEDIATE'); break; }
      catch (error) {
        const locked = /database is (?:locked|busy)/i.test(error.message) ||
          error.code === 'ERR_SQLITE_BUSY' || error.code === 'ERR_SQLITE_LOCKED';
        if (!locked || Date.now() >= deadline) {
          if (locked) throw Error('Workspace capacity reservation stayed locked for 30 seconds; retry after the active lifecycle operation finishes', { cause: error });
          throw error;
        }
        Atomics.wait(waitCell, 0, 0, Math.min(50, deadline - Date.now()));
      }
    }
    try { return action(); } finally { db.exec('ROLLBACK'); }
  } finally { db.close(); }
}

export function workspaceInventory({ observedRegistrations } = {}) {
  const management = managedRoot();
  const primary = canonical();
  const activeTasks = stateRecords('source-tasks');
  const archivedTasks = stateRecords('source-archive');
  const known = [...activeTasks, ...archivedTasks.filter(archived => !activeTasks.some(task => task.name === archived.name))];
  const historical = stateRecords('workspaces');
  const completions = new Map([...archivedTasks, ...stateRecords('source-completions')].map(record => [record.name, record]));
  const tasks = new Map(known.filter(task => typeof task.directory === 'string').map(task => [pathKey(task.directory), task]));
  const historyByPath = new Map(historical.filter(task => typeof task.directory === 'string').map(task => [pathKey(task.directory), task]));
  const occupied = new Map();
  const staleRegistrations = [];
  for (const tree of observedRegistrations || registrations()) {
    if (samePath(tree.worktree, primary)) continue;
    if (tree.prunable && !tree.locked && !localEntry(tree.worktree)) {
      staleRegistrations.push(tree);
      continue;
    }
    const task = tasks.get(pathKey(tree.worktree));
    const branch = tree.branch?.slice('refs/heads/'.length) || null;
    const managed = task && task.branch === branch && workspaceName(task.name) && samePath(tree.worktree, path.join(management, task.name));
    const completion = managed ? completions.get(task.name) : null;
    let state = 'unmanaged';
    if (managed) {
      state = task.state || 'active';
      if (completion?.finalSha === tree.HEAD && completion.owner === task.owner) {
        state = completion.outcome === 'completed' ? 'awaiting-cleanup' : 'preserved';
      }
    }
    const history = historyByPath.get(pathKey(tree.worktree));
    const legacy = !managed && history?.branch === branch ? history : null;
    if (legacy) {
      state = legacy.state === 'finished' && legacy.finalSha === tree.HEAD ? 'awaiting-cleanup' : 'protected-history';
    }
    occupied.set(pathKey(tree.worktree), { name: managed ? task.name : legacy?.name || null, directory: tree.worktree, branch, head: tree.HEAD,
      owner: managed ? task.owner : legacy?.owner || null, state,
      ...(managed && task.bootstrapException ? { bootstrapException: task.bootstrapException } : {}), locked: Boolean(tree.locked), prunable: Boolean(tree.prunable) });
  }
  if (localEntry(management)) {
    if (!samePath(realpathSync(management), management)) throw Error('Managed workspace root resolves through a link');
    for (const item of readdirSync(management, { withFileTypes: true })) {
      if (!item.isDirectory() && !item.isSymbolicLink()) continue;
      const directory = path.join(management, item.name), key = pathKey(directory);
      if (occupied.has(key)) continue;
      const task = tasks.get(key);
      const completion = task && completions.get(task.name);
      const residue = completion?.outcome === 'completed' && completion.owner === task.owner &&
        completion.branch === task.branch && samePath(completion.directory, directory) &&
        ['removing', 'removed', 'retired'].includes(completion.retirement);
      occupied.set(key, { name: task?.name || null, directory, owner: task?.owner || null,
        state: residue ? 'retirement-residue' : 'unregistered-directory' });
    }
  }
  for (const task of known.filter(item => item.state === 'creating')) {
    const key = pathKey(task.directory);
    if (!occupied.has(key)) occupied.set(key, { name: task.name, owner: task.owner, directory: task.directory, state: 'interrupted-reservation' });
  }
  for (const task of known) {
    const completion = completions.get(task.name);
    if (!completion || !['removing', 'removed'].includes(completion.retirement) || localEntry(task.directory)) continue;
    const key = pathKey(task.directory);
    if (!occupied.has(key)) occupied.set(key, { name: task.name, owner: task.owner, directory: task.directory,
      state: 'retirement-in-progress', retirement: completion.retirement });
  }
  const entries = [...occupied.values()];
  const bootstrap = entries.filter(entry => {
    const task = known.find(candidate => candidate.name === entry.name);
    return task && authorizedBootstrap(task, management) && samePath(entry.directory, task.directory);
  });
  const ordinaryOccupied = entries.length - bootstrap.length;
  const queue = stateRecords('source-queue').filter(entry => !known.some(task => task.name === entry.name && task.owner === entry.owner &&
    task.queuedAt === entry.queuedAt && ['creating', 'active'].includes(task.state))).sort((a, b) => a.position - b.position);
  return { limit: workspaceLimit, occupied: entries.length, physicalOccupied: entries.length,
    governedOccupied: ordinaryOccupied, bootstrapExceptions: bootstrap.length,
    available: Math.max(0, workspaceLimit - ordinaryOccupied),
    entries, staleRegistrations, queue, violations: [
      ...(ordinaryOccupied > workspaceLimit ? [`${ordinaryOccupied} governed task workspaces exceed the limit of ${workspaceLimit}`] : []),
      ...(bootstrap.length > 1 ? [`${bootstrap.length} owner bootstrap exceptions exceed the one-time limit`] : []),
      ...entries.filter(entry => entry.bootstrapException && !bootstrap.some(item => samePath(item.directory, entry.directory)))
        .map(entry => `unauthorized bootstrap exception: ${entry.directory}`),
      ...entries.filter(entry => ['unmanaged', 'unregistered-directory', 'retirement-residue', 'interrupted-reservation'].includes(entry.state))
        .map(entry => `${entry.state}: ${entry.directory}`),
    ] };
}
