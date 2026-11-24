import path from 'node:path';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { common, git, jsonFile, root, stateDir } from './runtime.mjs';

export const workspaceLimit = 5;
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
export function requireCanonical() {
  if (!samePath(root(), canonical())) throw Error('Run this workspace command from the canonical checkout');
}

export function localEntry(file) {
  try { return lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

export function stateRecords(area) {
  const dir = path.join(stateDir(), area);
  try { return readdirSync(dir).filter(file => file.endsWith('.json')).map(file => jsonFile(path.join(dir, file))); }
  catch (error) {
    if (error.code === 'ENOENT' && !localEntry(dir)) return [];
    throw error;
  }
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
    // Use the OS-owned SQLite file lock as a mutex. Lifecycle intents are durable JSON so
    // the next holder can reconcile external Git operations after an interrupted process.
    db.exec('PRAGMA busy_timeout = 30000; BEGIN IMMEDIATE');
    try { return action(); } finally { db.exec('ROLLBACK'); }
  } finally { db.close(); }
}

export function workspaceInventory() {
  const management = managedRoot();
  const primary = canonical();
  const known = stateRecords('source-tasks');
  const historical = stateRecords('workspaces');
  const completions = new Map(stateRecords('source-completions').map(record => [record.name, record]));
  const tasks = new Map(known.filter(task => typeof task.directory === 'string').map(task => [pathKey(task.directory), task]));
  const historyByPath = new Map(historical.filter(task => typeof task.directory === 'string').map(task => [pathKey(task.directory), task]));
  const occupied = new Map();
  const staleRegistrations = [];
  for (const tree of registrations()) {
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
      owner: managed ? task.owner : legacy?.owner || null, state, locked: Boolean(tree.locked), prunable: Boolean(tree.prunable) });
  }
  if (localEntry(management)) {
    if (!samePath(realpathSync(management), management)) throw Error('Managed workspace root resolves through a link');
    for (const item of readdirSync(management, { withFileTypes: true })) {
      if (!item.isDirectory() && !item.isSymbolicLink()) continue;
      const directory = path.join(management, item.name), key = pathKey(directory);
      if (occupied.has(key)) continue;
      const task = tasks.get(key);
      occupied.set(key, { name: task?.name || null, directory, owner: task?.owner || null, state: 'unregistered-directory' });
    }
  }
  for (const task of known.filter(item => item.state === 'creating')) {
    const key = pathKey(task.directory);
    if (!occupied.has(key)) occupied.set(key, { name: task.name, owner: task.owner, directory: task.directory, state: 'interrupted-reservation' });
  }
  const entries = [...occupied.values()];
  const queue = stateRecords('source-queue').sort((a, b) => a.position - b.position);
  return { limit: workspaceLimit, occupied: entries.length, available: Math.max(0, workspaceLimit - entries.length),
    entries, staleRegistrations, queue, violations: [
      ...(entries.length > workspaceLimit ? [`${entries.length} occupied workspaces exceed the limit of ${workspaceLimit}`] : []),
      ...entries.filter(entry => ['unmanaged', 'unregistered-directory', 'interrupted-reservation'].includes(entry.state))
        .map(entry => `${entry.state}: ${entry.directory}`),
    ] };
}
