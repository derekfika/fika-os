import path from 'node:path';
import { createServer } from 'node:net';
import { existsSync, readdirSync, readFileSync, lstatSync, unlinkSync } from 'node:fs';
import { git, command, common, root, stateDir, jsonFile, save, lock, asyncLock, ancestor, ref, ghApi } from './runtime.mjs';
import { REPO, digest, safeScope } from './policy.mjs';
import { workspaceRecords, worktrees, checkWorkspace, finishWorkspace, retireWorkspace, retireWorkspaceUnderLock } from './workspaces.mjs';
import { leaseIdentity, registryFingerprint } from './workspace-state.mjs';

export const RELEASE_CONFIRMATION = 'RELEASE ALL LEASES';
export const STATUS_BRANCH = 'meta/workspace-status';
const now = () => new Date().toISOString();
function administrator(authorize) { const actor = authorize(); if (!actor?.administrator || !actor.login) throw Error('Administrator authorization required'); return actor; }
export function recoverValidationOperation(id, options, { authorize=repositoryAdministrator, processAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}} }={}) {
  const actor=administrator(authorize);
  if(!/^[a-f0-9-]{36}$/.test(id||'')||!options.reason?.trim())throw Error('A validation operation id and explicit recovery reason are required');
  return lock('workspaces',()=>{
    const file=path.join(stateDir(),'workspace-operations',`${id}.json`);const op=jsonFile(file);
    if(op.id!==id||op.kind!=='validate'||!Number.isInteger(op.pid)||processAlive(op.pid))throw Error('Only a confirmed exited validation process may be recovered; releases and live processes remain protected');
    const event={schema:'fika.workspace-operation-recovery.v1',at:now(),actor,reason:options.reason,operation:op};
    save(path.join(stateDir(),'workspace-audit',`validation-recovery-${id}.json`),event);unlinkSync(file);return event;
  });
}

export async function assertDevPortsIdle(ports) {
  if (!ports.length || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw Error('Workspace dev ports are missing or invalid');
  for (const port of new Set(ports)) await new Promise((resolve, reject) => {
    const server = createServer(socket => socket.destroy());
    server.once('error', error => reject(Error(`Workspace dev port ${port} is unavailable (${error.code})`)));
    server.listen({ port, exclusive: true }, () => server.close(error => error ? reject(error) : resolve()));
  });
}

/** A dead dev parent can leave an orphan listener; both must be absent before recovery. */
export async function recoverDevOperation(id, options, { authorize=repositoryAdministrator, processAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}, portsIdle=assertDevPortsIdle }={}) {
  const actor = administrator(authorize);
  if (!/^[a-f0-9-]{36}$/.test(id || '') || !options.reason?.trim()) throw Error('A dev operation id and explicit recovery reason are required');
  return asyncLock('workspaces', async () => {
    const file = path.join(stateDir(), 'workspace-operations', `${id}.json`);
    const op = jsonFile(file);
    if (op.id !== id || op.kind !== 'dev' || !Number.isInteger(op.pid) || op.pid < 1 || processAlive(op.pid)) throw Error('Only a confirmed exited dev process may be recovered; releases, integration and live processes remain protected');
    const record = workspaceRecords().find(record => record.name === op.name);
    if (!record || record.owner !== op.owner || leaseIdentity(record) !== op.leaseId) throw Error('Dev operation does not match the recorded workspace lease');
    const ports = Object.values(record.ports || {});
    await portsIdle(ports);
    if (processAlive(op.pid)) throw Error('Dev process is live; preserve its operation marker');
    const event = { schema: 'fika.workspace-operation-recovery.v1', at: now(), actor, reason: options.reason, operation: op, verifiedIdlePorts: ports };
    save(path.join(stateDir(), 'workspace-audit', `dev-recovery-${id}.json`), event);
    unlinkSync(file);
    return event;
  });
}

export function repositoryAdministrator() {
  if (path.resolve(root()) !== path.resolve(common(), '..')) throw Error('Administrator operations must run from the canonical integration checkout');
  if (!new RegExp(`github\\.com[:/]${REPO}(?:\\.git)?$`).test(git('remote', 'get-url', 'origin'))) throw Error('Administrator override requires the FIKA OS origin');
  const repo = ghApi(`repos/${REPO}`); const user = ghApi('user');
  if (repo.full_name !== REPO || repo.permissions?.admin !== true || user.login !== repo.owner.login) throw Error('Authenticated local repository owner with administrator permission is required');
  return { login: user.login, repository: repo.full_name, administrator: true };
}
export function criticalConditions() {
  const conditions = [];
  for (const file of readdirSync(stateDir()).filter(f => /^(release-|cleanup).*\.lock$/.test(f))) conditions.push({ name: null, reason: `Critical lock ${file}; inspect its existing release/recovery process. Never break this lock.` });
  const ops = path.join(stateDir(), 'workspace-operations');
  if (existsSync(ops)) for (const f of readdirSync(ops).filter(x => x.endsWith('.json'))) {
    try { const op = jsonFile(path.join(ops, f)); conditions.push({ name: op.name, reason: `In-flight or interrupted ${op.kind} operation ${op.id}; preserve its operation marker until the process and release journals are reconciled.` }); }
    catch { conditions.push({ name: null, reason: `Unreadable critical-operation marker ${f}; inspect registry integrity.` }); }
  }
  const rec = path.join(stateDir(), 'reconciliations');
  if (existsSync(rec)) for (const d of readdirSync(rec, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const file = path.join(rec, d.name, 'journal.json');
    if (existsSync(file) && jsonFile(file).phase !== 'committed') conditions.push({ name: null, reason: `Unfinished reconciliation ${d.name}; recover its registry transition first.` });
  }
  return conditions;
}
function releasePreview() {
  let records = []; let integrityError;
  try { records = workspaceRecords(); } catch (error) { integrityError = error.message; }
  const conditions = criticalConditions();
  const entries = records.filter(r => ['active', 'creating', 'reconciling', 'attention'].includes(r.state)).map(r => {
    const reasons = conditions.filter(c => !c.name || c.name === r.name).map(c => c.reason);
    if (r.state !== 'active') reasons.push(`Registry state ${r.state} needs recovery`);
    return { name: r.name, owner: r.owner, branch: r.branch, scopes: r.scopes, leaseId: leaseIdentity(r), state: r.state, eligible: !reasons.length, reasons };
  });
  const body = { schema: 'fika.workspace-release-plan.v1', registry: registryFingerprint(), entries, conditions, integrityError: integrityError || null };
  return { ...body, planHash: digest(body), activeCount: entries.filter(r => r.state === 'active').length, eligibleCount: entries.filter(r => r.eligible).length, protectedCount: entries.filter(r => !r.eligible).length, sourcePreserved: true };
}
export function previewReleaseAll({ authorize = repositoryAdministrator } = {}) {
  const actor = administrator(authorize);
  return lock('workspaces', () => ({ ...releasePreview(), actor, confirmation: RELEASE_CONFIRMATION }));
}
export function releaseAllWorkspaces(options, { authorize = repositoryAdministrator } = {}) {
  const actor = administrator(authorize);
  if (!actor.administrator || !actor.login) throw Error('Administrator authorization required');
  if (options.confirm !== RELEASE_CONFIRMATION || !options.reason?.trim() || options.reason.trim().length < 8) throw Error('Type RELEASE ALL LEASES and supply an explicit reason of at least 8 characters');
  if (!/^[a-f0-9]{64}$/.test(options['approve-hash'] || '')) throw Error('A fresh preview --approve-hash is required');
  return lock('workspaces', () => {
    const file = path.join(stateDir(), 'workspace-revocations', `${options['approve-hash']}.json`);
    if (existsSync(file)) {
      // workspaceRecords validates every committed event checksum before an idempotent response.
      workspaceRecords(); return { ...jsonFile(file), alreadyApplied: true, sourcePreserved: true };
    }
    const plan = releasePreview();
    if (plan.planHash !== options['approve-hash']) throw Error('Workspace registry or critical operations changed. Obtain and review a fresh preview.');
    if (plan.integrityError) throw Error(`Registry integrity failure; all leases protected: ${plan.integrityError}`);
    const event = { schema: 'fika.workspace-revocation.v1', phase: 'committed', planHash: plan.planHash, at: now(), actor, reason: options.reason.trim(),
      released: plan.entries.filter(r => r.eligible).map(({ name, owner, branch, leaseId }) => ({ name, owner, branch, leaseId })),
      protected: plan.entries.filter(r => !r.eligible), conditions: plan.conditions, sourcePreserved: true };
    // Atomic journal replacement is the single commit point and durable audit event. Readers overlay it,
    // so interruption before this save changes nothing and interruption afterwards cannot half-revoke.
    save(file, { ...event, eventHash: digest(event) });
    return { ...jsonFile(file), alreadyApplied: false };
  });
}

function inspectRetirement(record) {
  const reasons = []; let head; let dirty = ''; let ignored = ''; let unique = true; let lastCommit;
  if (record.state !== 'finished') reasons.push(`State ${record.state}; only finished workspaces may be swept`);
  if (!existsSync(record.directory)) reasons.push('Worktree unavailable; inspect registration');
  else {
    try {
      const run = (...args) => command('git', args, { cwd: record.directory, timeout: 5000 });
      const registered = worktrees().find(t => path.resolve(t.worktree) === path.resolve(record.directory));
      if (!registered || registered.locked || registered.prunable) reasons.push('Missing, locked or prunable worktree registration');
      if (run('branch', '--show-current') !== record.branch) reasons.push('Branch differs from recorded lease');
      head = run('rev-parse', 'HEAD'); ignored = run('status', '--porcelain', '--ignored=matching'); dirty = ignored.split(/\r?\n/).filter(line=>!line.startsWith('!! ')).join('\n');
      lastCommit = run('log', '-1', '--format=%cI');
      if (record.state === 'finished' && head !== record.finalSha) reasons.push('HEAD changed after completion');
      if (dirty) reasons.push('Dirty or untracked work is retained in the checkout');
      // Sweep does not move ignored data. Explicit completion/retire can archive allowlisted generated data.
      if (ignored !== dirty) reasons.push('Ignored data remains; use explicit preservation/retirement');
      unique = !ancestor(head, 'origin/main');
      if (unique) {
        if (!record.preservationRef || !record.bundle || ref(record.preservationRef) !== head) reasons.push('Unique commits lack a matching preservation ref and bundle');
        else try { git('bundle', 'verify', record.bundle); } catch { reasons.push('Preservation bundle cannot be verified'); }
      }
      if (path.resolve(record.directory) === path.resolve(root())) reasons.push('Calling checkout is protected');
    } catch (error) { reasons.push(`Inspection failed: ${error.message.split('\n')[0]}`); }
  }
  return { name: record.name, owner: record.owner, scopes: record.scopes, branch: record.branch, pr: record.completion?.pr || null, state: record.state,
    lastActivity: [record.lastActivityAt, record.finishedAt, record.createdAt, lastCommit].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0], head, unique, eligible: !reasons.length, reasons,
    fingerprint: digest([leaseIdentity(record), record.state, record.finalSha, head, dirty, ignored]) };
}
const recordedPr = record => Number.isInteger(record.completion?.pr?.number) && record.completion.pr.number > 0 ? { ...record.completion.pr, url: `https://github.com/${REPO}/pull/${record.completion.pr.number}` } : null;
function pullRequestInventory() {
  const pulls = new Map();
  if (!/github\.com[:/]derekfika\/fika-os(?:\.git)?$/.test(git('remote', 'get-url', 'origin'))) return { pulls, status: 'not-github' };
  try {
    // Project only metadata: full REST pull bodies can exceed command buffers and are unnecessary here.
    const batch=JSON.parse(command('gh',['pr','list','--repo',REPO,'--state','all','--limit','1000','--json','number,state,headRefName,headRepositoryOwner,mergedAt'],{timeout:20000}));
    for(const p of batch)if(p.headRepositoryOwner?.login==='derekfika'&&!pulls.has(p.headRefName))pulls.set(p.headRefName,{number:p.number,url:`https://github.com/${REPO}/pull/${p.number}`,state:p.state.toLowerCase(),merged:Boolean(p.mergedAt)});
    return {pulls,status:batch.length===1000?'bounded inventory; older PRs may be unavailable':'current'};
  } catch { return {pulls,status:'unavailable; only recorded PR evidence shown'}; }
}
function sizeCandidate(directory, limit = 10000) {
  let bytes = 0, entries = 0, complete = true;
  const walk = dir => { for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (++entries > limit) { complete = false; return; }
    const file = path.join(dir, item.name); const st = lstatSync(file);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { walk(file); if (!complete) return; } else bytes += st.size;
  } };
  try { walk(directory); } catch { complete = false; }
  return { bytes, complete, note: complete ? 'file sizes, excluding linked data' : 'lower bound; inventory capped or unreadable' };
}
export function workspaceStatus({ sizes = false, inspect = false } = {}) {
  const records = workspaceRecords();
  const inventory = pullRequestInventory();
  const entries = records.map(record => {
    if (record.state === 'retired') return { name: record.name, owner: record.owner, scopes: record.scopes, branch: record.branch, pr: recordedPr(record) || inventory.pulls.get(record.branch) || null, state: record.state, lastActivity: record.retiredAt || record.finishedAt, eligible: false, reasons: ['Already retired'] };
    const entry = inspect ? inspectRetirement(record) : { name:record.name,owner:record.owner,scopes:record.scopes,branch:record.branch,state:record.state,lastActivity:record.lastActivityAt||record.finishedAt||record.createdAt,eligible:false,reasons:[record.state==='finished'?'Inspection required; preview safe cleanup':`State ${record.state}; only finished workspaces may be swept`] };
    entry.pr = recordedPr(record) || inventory.pulls.get(record.branch) || null;
    if (sizes && entry.eligible) entry.disk = sizeCandidate(record.directory);
    return entry;
  });
  return { schema: 'fika.workspace-status.v1', observedAt: now(), authoritative: 'local governed workspace registry', prInventory: inventory.status, entries };
}
function sweepPreview() {
  const status = workspaceStatus({ sizes: true, inspect: true }); const conditions = criticalConditions();
  for (const e of status.entries) {
    const relevant = conditions.filter(c => !c.name || c.name === e.name);
    if (relevant.length) { e.eligible = false; e.reasons.push(...relevant.map(c => c.reason)); }
  }
  const body = { registry: registryFingerprint(), entries: status.entries, conditions };
  return { ...status, conditions, planHash: digest(body), eligibleCount: status.entries.filter(e => e.eligible).length,
    protectedCount: status.entries.filter(e => e.state !== 'retired' && !e.eligible).length,
    candidateBytes: status.entries.filter(e => e.eligible).reduce((sum, e) => sum + (e.disk?.bytes || 0), 0) };
}
export function previewSweep() {
  const before=lock('workspaces',()=>digest(registryFingerprint()));
  const plan=sweepPreview(); // Disk/Git inspection must not hold up other agents' lease operations.
  lock('workspaces',()=>{if(digest(registryFingerprint())!==before)throw Error('Registry changed during cleanup inspection; obtain a fresh preview');});
  return plan;
}
export function sweepWorkspaces(options, { authorize = repositoryAdministrator } = {}) {
  const actor=administrator(authorize);
  return lock('workspaces', () => {
    const plan = sweepPreview();
    if (plan.planHash !== options['approve-hash']) throw Error('Sweep preview changed; obtain a fresh preview');
    const retired = [], failed = [];
    for (const e of plan.entries.filter(e => e.eligible)) {
      try { retired.push(retireWorkspaceUnderLock(e.name, { owner: e.owner, archive: true })); }
      catch (error) { failed.push({ name: e.name, reason: error.message }); }
    }
    const result = { schema: 'fika.workspace-sweep.v1', at: now(), actor, planHash: plan.planHash, retired: retired.map(r => r.name), failed, protected: plan.entries.filter(e => !e.eligible && e.state !== 'retired') };
    save(path.join(stateDir(), 'workspace-audit', `sweep-${Date.now()}.json`), result); return result;
  });
}

function pushedEvidence(record, head) {
  git('fetch', 'origin');
  const inMain = ancestor(head, 'origin/main');
  const pushed = ref(`refs/remotes/origin/${record.branch}`) === head;
  let pr = null;
  if (/github\.com[:/]derekfika\/fika-os(?:\.git)?$/.test(git('remote', 'get-url', 'origin'))) {
    const pulls = ghApi(`repos/${REPO}/pulls?state=all&head=derekfika:${encodeURIComponent(record.branch)}&per_page=100`);
    if (pulls.length === 100) throw Error('PR inventory needs pagination');
    const match = pulls.find(p => p.head.sha === head); if (match) pr = { number: match.number, url: match.html_url, state: match.state, merged: Boolean(match.merged_at) };
  }
  return { pushed, inMain, pr };
}
export function completeWorkspace(name, options = {}, { evidenceFor = pushedEvidence } = {}) {
  let record = workspaceRecords().find(r => r.name === name);
  if (!record || record.owner !== options.owner || !['active', 'finished', 'retired'].includes(record.state)) throw Error('Completion requires the current owner of an active/finished workspace; revoked ownership cannot complete');
  if (record.state === 'retired') return { leaseReleased: true, retirement: 'already-retired', record };
  if (record.state === 'active') {
    checkWorkspace(name, options);
    const head = command('git', ['rev-parse', 'HEAD'], { cwd: record.directory });
    let evidence;
    try { evidence=evidenceFor(record, head); }
    catch (error) { if (!options.preserve) throw error; evidence={pushed:false,inMain:false,pr:null,unverifiedEvidence:error.message.split('\n')[0]}; }
    if (!evidence.inMain && !evidence.pushed && !options.preserve) throw Error('Final SHA is not pushed or integrated. Commit/push it or explicitly --preserve --reason unfinished work.');
    record = finishWorkspace(name, { ...options, expectedHead: head, completion: { ...evidence, head, at: now() } });
  }
  let retirement = 'protected', cleanupReason;
  try { record = retireWorkspace(name, { owner: options.owner, archive: true, 'preserve-generated': true }); retirement = 'retired'; }
  catch (error) { cleanupReason = error.message; }
  const outcome = { leaseReleased: true, branch: record.branch, pr: record.completion?.pr || null, finalSha: record.finalSha, retirement, cleanupReason, record };
  save(path.join(stateDir(), 'workspace-audit', `complete-${record.name}-${Date.now()}.json`), { ...outcome, at: now() });
  return outcome;
}

const publicText = (value, pattern) => pattern.test(String(value || '')) ? String(value) : '[redacted]';
export function publicWorkspaceReport(records = workspaceRecords(), at = now()) {
  const lines = ['# FIKA OS workspace status', '', `Snapshot: ${at}. The local governed registry remains authoritative.`, '', '| Workspace | Owner | Scope | Branch | PR | State | Last update |', '|---|---|---|---|---|---|---|'];
  for (const r of records) {
    const clean = v => publicText(v, /^[a-zA-Z0-9._:/ -]{1,180}$/);
    const scopes = r.scopes.map(s => { try { return safeScope(s); } catch { return '[redacted]'; } }).join(', ');
    const pr = r.completion?.pr?.number; const date = r.revokedAt || r.retiredAt || r.finishedAt || r.lastActivityAt || r.createdAt;
    lines.push(`| ${clean(r.name)} | ${clean(r.owner)} | ${scopes} | ${clean(r.branch)} | ${Number.isInteger(pr) ? `[#${pr}](https://github.com/${REPO}/pull/${pr})` : '—'} | ${clean(r.state)} | ${/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(date || '') ? date : 'unknown'} |`);
  }
  return `${lines.join('\n')}\n`;
}
export function publishWorkspaceStatus({ execute = false } = {}) {
  const inventory=pullRequestInventory();
  const records=workspaceRecords().map(r=>({...r,completion:{...r.completion,pr:r.completion?.pr||inventory.pulls.get(r.branch)||null}}));
  const report = publicWorkspaceReport(records);
  if (!execute) return { dryRun: true, branch: STATUS_BRANCH, report };
  if (!/github\.com[:/]derekfika\/fika-os(?:\.git)?$/.test(git('remote', 'get-url', 'origin'))) throw Error('Publication requires the FIKA OS GitHub origin');
  const repo = ghApi(`repos/${REPO}`); if (!repo.permissions?.push) throw Error('Repository write authority required for status publication');
  return lock('workspace-publication', () => {
    const remote = git('ls-remote', 'origin', `refs/heads/${STATUS_BRANCH}`).split(/\s/)[0];
    if (remote) git('fetch', 'origin', `refs/heads/${STATUS_BRANCH}`);
    const blob = command('git', ['hash-object', '-w', '--stdin'], { input: report });
    const tree = command('git', ['mktree'], { input: `100644 blob ${blob}\tWORKSPACES.md\n` });
    const sha = command('git', ['commit-tree', tree, ...(remote ? ['-p', remote] : []), '-m', 'Snapshot governed workspace status']);
    git('push', 'origin', `${sha}:refs/heads/${STATUS_BRANCH}`); // ordinary push is the concurrent-publisher CAS
    return { branch: STATUS_BRANCH, sha, url: `https://github.com/${REPO}/blob/${STATUS_BRANCH}/WORKSPACES.md`, observedAt: now() };
  });
}
