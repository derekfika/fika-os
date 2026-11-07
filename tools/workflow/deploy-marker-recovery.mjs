import path from 'node:path';
import { existsSync, mkdirSync, renameSync, openSync, writeSync, fsyncSync, closeSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { git, ref, stateDir, jsonFile, operationMarkerLock } from './runtime.mjs';
import { APPS, digest, target, validateRecord, supportedEnvironments } from './policy.mjs';
import { workspaceRecords } from './workspaces.mjs';
import { leaseIdentity } from './workspace-state.mjs';
import { recoverDeployOperation as governed } from './workspace-admin.mjs';

/**
 * Recovery of an interrupted DEPLOY workspace-operation marker.
 *
 * Fail closed. The only thing this ever changes is: one audit record is written and the marker file is
 * MOVED to an archive directory. It never touches the lease registry, release ledgers, release journals
 * or release locks.
 *
 * A deploy marker records no app, environment or release id, so it is matched to the release ledgers by
 * time alone. That is only safe when the whole release system is quiescent and every intent in the window
 * is provably finished: every intent record committed within the window after the marker started must have
 * a TERMINAL record (deploy, rollback or abandoned) with the same releaseId later on its own ledger; no
 * ledger head (any app, either environment) may be an intent; and no release lock or non-completed release
 * journal may exist anywhere. Follow-up: future deploy markers should record app/env/releaseId.
 */
export const INTENT_WINDOW_SECONDS = 120;
export const TERMINAL_KINDS = ['deploy', 'rollback', 'abandoned'];
const MAX_CHAIN = 2000;
const defaultAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const now = () => new Date().toISOString();
const releaseJson = commit => JSON.parse(git('show', `${commit}:release.json`));

function ledgerChain(branch) {
  const tip = `refs/remotes/origin/${branch}`;
  if (!ref(tip)) return undefined;
  const out = git('log', '--first-parent', `--max-count=${MAX_CHAIN + 1}`, '--format=%H%x09%ct', tip);
  const chain = out.split(/\r?\n/).filter(Boolean).map(line => { const [commit, ct] = line.split('\t'); return { commit, ct: Number(ct) }; });
  if (chain.length > MAX_CHAIN) throw Error(`Release ledger ${branch} is longer than ${MAX_CHAIN} records; refusing to guess`);
  return chain; // newest first
}
const summarise = (entry, record) => ({ commit: entry.commit, committedAt: new Date(entry.ct * 1000).toISOString(), kind: record.kind, app: record.app, environment: record.environment, sourceSha: record.sourceSha, releaseId: record.releaseId || null, recordDigest: digest(record) });

/** Read-only ledger evidence. Throws a precise refusal for anything unfinished or ambiguous. */
export function ledgerEvidence(marker, { requireAll = false } = {}) {
  const startSeconds = Math.floor(Date.parse(marker.startedAt) / 1000);
  if (!Number.isFinite(startSeconds)) throw Error('Marker startedAt is missing or invalid; refusing');
  const candidates = []; const heads = [];
  for (const app of Object.keys(APPS)) for (const environment of supportedEnvironments(app)) {
    const t = target(app, environment);
    const chain = ledgerChain(t.branch);
    if (!chain) { if (requireAll) throw Error(`Expected release ledger ${t.branch} is missing or unreadable; refusing`); else continue; }
    const headRecord = releaseJson(chain[0].commit);
    if (headRecord.kind === 'intent') throw Error(`Release ledger ${t.branch} head is a pending intent (${chain[0].commit.slice(0, 8)}); use fika reconcile`);
    validateRecord(headRecord, { app, environment });
    heads.push({ ledgerBranch: t.branch, ...summarise(chain[0], headRecord) });
    chain.forEach((entry, index) => {
      if (entry.ct < startSeconds || entry.ct > startSeconds + INTENT_WINDOW_SECONDS) return;
      const record = releaseJson(entry.commit);
      if (record.kind === 'intent') {
        if (!record.releaseId) throw Error(`Intent ${entry.commit.slice(0, 8)} on ${t.branch} has no releaseId; cannot prove it finished; use fika reconcile`);
        if (record.schema !== 'fika.release.v1' || record.state !== 'PENDING' || record.app !== app || record.environment !== environment || record.project !== t.project || record.backend !== t.backend || record.region !== t.region || record.branch !== t.branch || !/^[a-f0-9]{40}$/.test(record.sourceSha || '') || !/^[a-f0-9]{64}$/.test(record.scopeHash || '')) throw Error(`Invalid or mismatched pending intent on ${t.branch}; refusing`);
        candidates.push({ t, chain, index, entry, record });
      } else validateRecord(record, { app, environment });
    });
  }
  if (!candidates.length) throw Error(`No release intent record found on any release ledger within ${INTENT_WINDOW_SECONDS}s after the marker started; refusing. Use fika reconcile if a deploy is pending.`);
  const intents = candidates.map(({ t, chain, index, entry, record }) => {
    if (record.app !== t.app || record.environment !== t.environment) throw Error('Intent record app/environment does not match its ledger branch; refusing');
    const later = chain.slice(0, index).reverse().map(item => ({ entry: item, record: releaseJson(item.commit) })); // oldest first
    for (let laterIndex = 0; laterIndex < later.length; laterIndex++) {
      const { entry: laterEntry, record: r } = later[laterIndex];
      if (r.app !== t.app || r.environment !== t.environment) throw Error(`A later record on ${t.branch} names a different app/environment; refusing`);
      if (r.kind === 'intent') {
        if (r.schema !== 'fika.release.v1' || r.state !== 'PENDING' || r.project !== t.project || r.backend !== t.backend || r.region !== t.region || r.branch !== t.branch || !r.releaseId || !/^[a-f0-9]{40}$/.test(r.sourceSha || '') || !/^[a-f0-9]{64}$/.test(r.scopeHash || '')) throw Error(`Invalid later pending intent on ${t.branch}; refusing`);
        const completion = later.slice(laterIndex + 1).find(({ record: terminal }) => TERMINAL_KINDS.includes(terminal.kind) && terminal.releaseId === r.releaseId);
        if (!completion) throw Error(`Later intent ${laterEntry.commit.slice(0, 8)} on ${t.branch} has no matching terminal record; refusing`);
        if (completion.record.kind === 'abandoned') {
          if (completion.record.originalIntent !== laterEntry.commit) throw Error(`Later abandoned release ${r.releaseId} does not reference its intent; refusing`);
        } else if (completion.record.sourceSha !== r.sourceSha || completion.record.scopeHash !== r.scopeHash || completion.record.project !== r.project || completion.record.backend !== r.backend) throw Error(`Later terminal for ${r.releaseId} does not match intent source, scope or target; refusing`);
      } else validateRecord(r, { app: t.app, environment: t.environment });
    }
    const terminal = later.find(({ record: r }) => TERMINAL_KINDS.includes(r.kind) && r.releaseId === record.releaseId);
    if (!terminal) throw Error(`Intent ${entry.commit.slice(0, 8)} (${t.app} ${t.environment}, release ${record.releaseId}) has no terminal record (deploy, rollback or abandoned) with the same releaseId; it may still be pending; use fika reconcile`);
    if (terminal.record.kind !== 'abandoned' && (terminal.record.sourceSha !== record.sourceSha || terminal.record.scopeHash !== record.scopeHash || terminal.record.project !== record.project || terminal.record.backend !== record.backend)) throw Error(`Terminal record for ${record.releaseId} does not match intent source, scope or target; refusing`);
    if (terminal.record.kind === 'abandoned' && terminal.record.originalIntent !== entry.commit) throw Error(`Abandoned terminal for ${record.releaseId} does not reference its original intent; refusing`);
    return { ledgerBranch: t.branch, app: t.app, environment: t.environment, intent: summarise(entry, record), terminal: summarise(terminal.entry, terminal.record) };
  }).sort((a, b) => a.intent.commit.localeCompare(b.intent.commit));
  return { windowSeconds: INTENT_WINDOW_SECONDS, intents, ledgerHeads: heads };
}

/** Any release lock or unfinished journal anywhere (all apps, both environments) blocks recovery. */
function assertNoReleaseControl() {
  const dir = stateDir();
  for (const name of readdirSync(dir)) {
    if (/^release-.*\.lock$/.test(name)) throw Error(`A release lock exists (${name}); never break it. Use fika reconcile`);
    if (/^release-.*\.json$/.test(name)) {
      let journal; try { journal = jsonFile(path.join(dir, name)); } catch { throw Error(`Release journal ${name} is unreadable; use fika reconcile`); }
      if (journal.state !== 'completed') throw Error(`A non-completed release journal exists (${name}, state ${journal.state || 'unknown'}); use fika reconcile`);
    }
  }
}

function build(id, { processAlive }) {
  const file = path.join(stateDir(), 'workspace-operations', `${id}.json`);
  if (!existsSync(file)) return { file, missing: true };
  const marker = jsonFile(file);
  if (marker.id !== id || marker.kind !== 'deploy' || !Number.isInteger(marker.pid) || marker.pid < 1 || processAlive(marker.pid)) throw Error('Only a deploy marker whose process is confirmed exited may be recovered; other kinds and live processes remain protected');
  const canonical = marker.name === null && marker.leaseId === null && marker.owner === 'canonical-operator';
  const registry = workspaceRecords(); // validates registry integrity for both identity forms
  const record = canonical ? null : registry.find(r => r.name === marker.name);
  if (!canonical && (!record || record.owner !== marker.owner || !marker.leaseId || leaseIdentity(record) !== marker.leaseId)) throw Error('Deploy marker does not match the recorded workspace lease; refusing');
  if (canonical) {
    const ops = path.join(stateDir(), 'workspace-operations');
    for (const name of readdirSync(ops)) {
      if (!name.endsWith('.json')) throw Error(`Unexpected operation entry ${name}; refusing canonical recovery`);
      let other; try { other = jsonFile(path.join(ops, name)); } catch { throw Error(`Unreadable operation marker ${name}; refusing canonical recovery`); }
      if (other.id !== id) throw Error(`Another unresolved operation marker ${other.id || name} exists; refusing canonical recovery`);
    }
  } else if (marker.name == null || marker.leaseId == null || marker.owner == null) {
    throw Error('Partial workspace identity is not recoverable');
  }
  assertNoReleaseControl();
  const evidence = ledgerEvidence(marker, { requireAll: canonical });
  if (processAlive(marker.pid)) throw Error('Deploy process is live; preserve its marker');
  const lease = canonical ? null : { workspace: record.name, owner: record.owner, leaseId: marker.leaseId, state: record.state };
  // The hash binds marker, lease and every intent/terminal pair. Unrelated head movement does not invalidate it.
  const approveHash = digest({ schema: 'fika.deploy-marker-recovery-plan.v3', marker, lease, intents: evidence.intents });
  return { file, marker, lease, evidence, approveHash };
}

/** Atomic and durable: write a temp file, fsync it, then rename. */
function durableSave(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}

/**
 * `authorize` and `processAlive` are injectable like the other recovery commands. The ledger fetch happens
 * before the shared workspace lock so a slow network never blocks other agents' lease operations.
 */
export function recoverDeployOperation(id, options = {}, { authorize, processAlive = defaultAlive, fetchLedgers = () => git('fetch', 'origin') } = {}) {
  const actor = authorize?.();
  if (!actor?.administrator || !actor.login) throw Error('Administrator authorization required');
  const reason = options.reason?.trim();
  if (!/^[a-f0-9-]{36}$/.test(id || '') || !reason || reason.length < 8) throw Error('A deploy operation id and an explicit recovery reason of at least 8 characters are required');
  const execute = Boolean(options.execute);
  if (execute && !/^[a-f0-9]{64}$/.test(options['approve-hash'] || '')) throw Error('Execution requires the --approve-hash from a fresh preview');
  fetchLedgers();
  return operationMarkerLock(() => {
    const auditFile = path.join(stateDir(), 'workspace-audit', `deploy-recovery-${id}.json`);
    const archiveFile = path.join(stateDir(), 'workspace-operations-archive', `${id}.json`);
    const plan = build(id, { processAlive });
    if (plan.missing) {
      if (execute && existsSync(auditFile) && existsSync(archiveFile)) return { ...jsonFile(auditFile), alreadyApplied: true };
      throw Error(`Deploy marker ${id} does not exist; nothing to recover`);
    }
    const { marker, lease, evidence, approveHash } = plan;
    if (!execute) {
      return { schema: 'fika.deploy-marker-recovery-preview.v2', dryRun: true, actor, reason, marker, lease, evidence, approveHash,
        action: `Write ${auditFile} and move the marker to ${archiveFile}. Nothing else changes (no lease, registry, ledger, journal or lock change).`,
        execute: `node tools/workflow/deploy-marker-recovery.mjs ${id} --reason "<reason>" --execute --approve-hash ${approveHash}` };
    }
    if (options['approve-hash'] !== approveHash) throw Error('Marker, lease or ledger evidence changed since the preview. Obtain and review a fresh preview.');
    if (existsSync(archiveFile)) throw Error(`Archive ${archiveFile} already exists; refusing to overwrite`);
    let event;
    if (existsSync(auditFile)) {
      // Resume after an interrupted execution: keep the original event and append who resumed and why.
      event = jsonFile(auditFile);
      if (digest(event.operation) !== digest(marker)) throw Error('Existing recovery audit does not match the marker; refusing');
      event = { ...event, resumes: [...(event.resumes || []), { at: now(), actor, reason, approveHash, evidence }] };
    } else {
      event = { schema: 'fika.deploy-marker-recovery.v2', at: now(), actor, reason, approveHash, operation: marker, lease, evidence,
        ledgerShas: { intents: evidence.intents.map(i => i.intent.commit), terminals: evidence.intents.map(i => i.terminal.commit) } };
    }
    durableSave(auditFile, event); // flushed before the marker moves
    mkdirSync(path.dirname(archiveFile), { recursive: true });
    renameSync(plan.file, archiveFile); // move, never delete
    return { ...event, archived: archiveFile };
  });
}

export function parseArguments(argv) {
  const [id, ...rest] = argv; const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--reason' || arg === '--approve-hash') { const value = rest[++i]; if (value === undefined || value.startsWith('--')) throw Error(`${arg} requires a value`); options[arg.slice(2)] = value; }
    else throw Error(`Unknown argument ${arg}`);
  }
  return { id, options };
}

/** Standalone entrypoint until the governed cli.mjs is wired (follow-up). Run from the canonical checkout. */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { id, options } = parseArguments(process.argv.slice(2));
    console.log(JSON.stringify(governed(id, options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
