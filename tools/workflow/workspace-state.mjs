import path from 'node:path';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { common, root, git, stateDir, lock, save, jsonFile } from './runtime.mjs';
import { digest, safeScope } from './policy.mjs';

export const leaseIdentity = r => r.leaseId || digest([r.name, r.owner, r.directory, r.branch, r.baseline, r.createdAt]);
export const registryDirectory = () => path.join(stateDir(), 'workspaces');
export function revocationEvents() {
  const dir = path.join(stateDir(), 'workspace-revocations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(p => p.endsWith('.json')).sort().map(p => {
    const event = jsonFile(path.join(dir, p)); const { eventHash, ...body } = event;
    if (event.schema !== 'fika.workspace-revocation.v1' || event.phase !== 'committed' || digest(body) !== eventHash) throw Error(`Workspace revocation journal integrity failure: ${p}`);
    return event;
  });
}
export function applyRevocations(records) {
  const byName = new Map(records.map(r => [r.name, r]));
  for (const e of revocationEvents()) for (const item of e.released) {
    const record = byName.get(item.name);
    if (!record || leaseIdentity(record) !== item.leaseId || (e.kind === 'stacked-single-lease-recovery' && (record.owner !== item.owner || record.branch !== item.branch))) throw Error(`Revoked lease identity changed: ${item.name}`);
    byName.set(record.name, { ...record, state: 'revoked', revokedAt: e.at, revokedBy: e.actor.login, revocation: e.planHash, lastActivityAt: e.at });
  }
  return [...byName.values()];
}
export function diskRecords() {
  const dir = registryDirectory();
  if (!existsSync(dir)) return [];
  const records=readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>{
    const r=jsonFile(path.join(dir,n));
    if (`${r.name}.json`!==n||!/^[a-z][a-z0-9-]{2,60}$/.test(r.name||'')||!r.owner||!path.isAbsolute(r.directory||'')||!r.branch||!/^[a-f0-9]{40}$/.test(r.baseline||'')||!Array.isArray(r.scopes)||!r.scopes.length||!['active','creating','attention','reconciling','finished','retired','superseded','revoked'].includes(r.state))throw Error(`Workspace registry inconsistency: ${n}`);
    r.scopes.forEach(safeScope);return r;
  });
  if(new Set(records.map(r=>path.resolve(r.directory))).size!==records.length||new Set(records.map(r=>r.branch)).size!==records.length)throw Error('Workspace registry has duplicated directories or branches');
  return records;
}
export function authorityForCurrentWorkspace() {
  const cwd = path.resolve(root()); const canonical = path.resolve(common(), '..');
  if (cwd === canonical) return null; // Owner administration/integration checkout; never a displaced worktree.
  const records = applyRevocations(diskRecords());
  const record = records.find(r => path.resolve(r.directory) === cwd);
  if (!record || record.state !== 'active' || git('branch', '--show-current') !== record.branch) throw Error('Workspace ownership is absent, finished or revoked. Stop governed validation, integration and releases; preserve the checkout and obtain a new lease.');
  return record;
}
export function beginWorkspaceOperation(kind, selection) {
  return lock('workspaces', () => {
    let record = authorityForCurrentWorkspace();
    if (selection?.workspace) {
      const selected = applyRevocations(diskRecords()).find(r => r.name === selection.workspace);
      if (!selected || selected.state !== 'active' || selected.owner !== selection.owner || (record && record.name !== selected.name)) throw Error('Selected workspace ownership is absent or revoked');
      record = selected;
    }
    const id = randomUUID(); const file = path.join(stateDir(), 'workspace-operations', `${id}.json`);
    save(file, { id, kind, name: record?.name || null, owner: record?.owner || 'canonical-operator', leaseId: record ? leaseIdentity(record) : null, pid: process.pid, startedAt: new Date().toISOString() });
    return { end() { lock('workspaces', () => { if (existsSync(file)) unlinkSync(file); }); } };
  });
}
export async function governedOperation(kind, fn, selection) {
  const operation = beginWorkspaceOperation(kind, selection);
  try { return await fn(); } finally {
    // A legitimate concurrent registry reader/writer can briefly hold the lock at process exit.
    // Wait for that holder; never break its lock or leave a false interrupted marker silently.
    const deadline=Date.now()+60000;
    for(;;)try{operation.end();break;}catch(error){if(!error.message.includes('Another operation holds')||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,200));}
  }
}
/** Registry bytes and durable operation files participate in preview concurrency detection. */
export function registryFingerprint() {
  const entries = [];
  for (const sub of ['workspaces', 'workspace-revocations', 'workspace-operations', 'reconciliations']) {
    const dir = path.join(stateDir(), sub); if (!existsSync(dir)) continue;
    const visit = folder => { for (const item of readdirSync(folder, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) { if (sub === 'reconciliations') visit(file); }
      else if (item.name.endsWith('.json') && (sub !== 'reconciliations' || item.name === 'journal.json')) entries.push([path.relative(stateDir(), file), digest(readFileSync(file))]);
    } }; visit(dir);
  }
  return entries;
}
