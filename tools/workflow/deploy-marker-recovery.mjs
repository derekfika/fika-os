import path from 'node:path';
import { existsSync, mkdirSync, renameSync, openSync, writeSync, fsyncSync, closeSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { git, ref, stateDir, jsonFile, lock } from './runtime.mjs';
import { APPS, digest, target } from './policy.mjs';
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
export function ledgerEvidence(marker) {
  const startSeconds = Math.floor(Date.parse(marker.startedAt) / 1000);
  if (!Number.isFinite(startSeconds)) throw Error('Marker startedAt is missing or invalid; refusing');
  const candidates = []; const heads = [];
  for (const app of Object.keys(APPS)) for (const environment of ['staging', 'prod']) {
    const t = target(app, environment);
    const chain = ledgerChain(t.branch);
    if (!chain) continue;
    const headRecord = releaseJson(chain[0].commit);
    if (headRecord.kind === 'intent') throw Error(`Release ledger ${t.branch} head is a pending intent (${chain[0].commit.slice(0, 8)}); use fika reconcile`);
    heads.push({ ledgerBranch: t.branch, ...summarise(chain[0], headRecord) });
    chain.forEach((entry, index) => {
      if (entry.ct < startSeconds || entry.ct > startSeconds + INTENT_WINDOW_SECONDS) return;
      const record = releaseJson(entry.commit);
      if (record.kind === 'intent') candidates.push({ t, chain, index, entry, record });
    });
  }
  if (!candidates.length) throw Error(`No release intent record found on any release ledger within ${INTENT_WINDOW_SECONDS}s after the marker started; refusing. Use fika reconcile if a deploy is pending.`);
  const intents = candidates.map(({ t, chain, index, entry, record }) => {
    if (record.app !== t.app || record.environment !== t.environment) throw Error('Intent record app/environment does not match its ledger branch; refusing');
    if (!record.releaseId) throw Error(`Intent ${entry.commit.slice(0, 8)} on ${t.branch} has no releaseId; cannot prove it finished; use fika reconcile`);
    const later = chain.slice(0, index).reverse().map(item => ({ entry: item, record: releaseJson(item.commit) })); // oldest first
    for (const { record: r } of later) if (r.app !== t.app || r.environment !== t.environment) throw Error(`A later record on ${t.branch} names a different app/environment; refusing`);
    const terminal = later.find(({ record: r }) => TERMINAL_KINDS.includes(r.kind) && r.releaseId === record.releaseId);
    if (!terminal) throw Error(`Intent ${entry.commit.slice(0, 8)} (${t.app} ${t.environment}, release ${record.releaseId}) has no terminal record (deploy, rollback or abandoned) with the same releaseId; it may still be pending; use fika reconcile`);
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
  const record = workspaceRecords().find(r => r.name === marker.name);
  if (!record || record.owner !== marker.owner || !marker.leaseId || leaseIdentity(record) !== marker.leaseId) throw Error('Deploy marker does not match the recorded workspace lease; refusing');
  assertNoReleaseControl();
  const evidence = ledgerEvidence(marker);
  if (processAlive(marker.pid)) throw Error('Deploy process is live; preserve its marker');
  const lease = { workspace: record.name, owner: record.owner, leaseId: marker.leaseId, state: record.state };
  // The hash binds marker, lease and every intent/terminal pair. Unrelated head movement does not invalidate it.
  const approveHash = digest({ schema: 'fika.deploy-marker-recovery-plan.v2', marker, lease, intents: evidence.intents });
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
  return lock('workspaces', () => {
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
