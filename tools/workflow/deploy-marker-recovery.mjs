import path from 'node:path';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { git, ref, stateDir, jsonFile, save, lock } from './runtime.mjs';
import { APPS, digest, target } from './policy.mjs';
import { workspaceRecords } from './workspaces.mjs';
import { leaseIdentity } from './workspace-state.mjs';

/**
 * Recovery of an interrupted DEPLOY workspace-operation marker.
 *
 * Fail closed. The only thing this ever changes is: one audit record is written and the marker file is
 * MOVED to an archive directory. It never touches the lease registry, release ledgers, release journals
 * or release locks. A marker is recoverable only when read-only ledger evidence proves the interrupted
 * deploy intent was superseded by a later completed deploy of the same app and environment.
 */
export const INTENT_WINDOW_SECONDS = 120;
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

/** Read-only ledger evidence. Throws a precise refusal for anything ambiguous. */
export function ledgerEvidence(marker) {
  const startSeconds = Math.floor(Date.parse(marker.startedAt) / 1000);
  if (!Number.isFinite(startSeconds)) throw Error('Marker startedAt is missing or invalid; refusing');
  const candidates = [];
  const chains = new Map();
  for (const app of Object.keys(APPS)) for (const environment of ['staging', 'prod']) {
    const t = target(app, environment);
    const chain = ledgerChain(t.branch);
    if (!chain) continue;
    chains.set(t.branch, { t, chain });
    chain.forEach((entry, index) => {
      if (entry.ct < startSeconds || entry.ct > startSeconds + INTENT_WINDOW_SECONDS) return;
      const record = releaseJson(entry.commit);
      if (record.kind === 'intent') candidates.push({ t, index, entry, record });
    });
  }
  if (!candidates.length) throw Error(`No release intent record found on any release ledger within ${INTENT_WINDOW_SECONDS}s after the marker started; refusing. Use fika reconcile if a deploy is pending.`);
  if (candidates.length > 1) throw Error(`Ambiguous: ${candidates.length} release intent records within ${INTENT_WINDOW_SECONDS}s after the marker started (${candidates.map(c => `${c.t.app}/${c.t.environment}@${c.entry.commit.slice(0, 8)}`).join(', ')}); refusing`);
  const { t, index, entry, record: intent } = candidates[0];
  if (intent.app !== t.app || intent.environment !== t.environment) throw Error('Intent record app/environment does not match its ledger branch; refusing');
  const { chain } = chains.get(t.branch);
  const later = chain.slice(0, index).reverse().map(item => ({ entry: item, record: releaseJson(item.commit) })); // oldest first
  if (!later.length) throw Error('The intent is still the head of its ledger (pending, not superseded); use fika reconcile or --resume');
  const head = later[later.length - 1];
  if (head.record.kind === 'intent') throw Error('A newer release intent is pending on this ledger; use fika reconcile');
  for (const { record } of later) {
    if (record.app !== t.app || record.environment !== t.environment) throw Error('A later ledger record names a different app/environment; refusing');
    if (['deploy', 'rollback'].includes(record.kind) && (record.sourceSha === intent.sourceSha || (intent.releaseId && record.releaseId === intent.releaseId))) {
      throw Error(`The intent ${intent.sourceSha.slice(0, 8)} has a completed ${record.kind} record: it is not abandoned; use fika reconcile`);
    }
  }
  const superseding = later.find(({ record }) => record.kind === 'deploy');
  if (!superseding) throw Error('No later completed deploy record supersedes the intent; use fika reconcile');
  return {
    app: t.app, environment: t.environment, ledgerBranch: t.branch, windowSeconds: INTENT_WINDOW_SECONDS,
    intent: summarise(entry, intent), supersedingDeploy: summarise(superseding.entry, superseding.record),
    ledgerHead: summarise(head.entry, head.record), recordsAfterIntent: later.length,
  };
}

function assertNoReleaseControl(app, environment) {
  const dir = stateDir();
  const lockFile = path.join(dir, `release-${app}-${environment}.lock`);
  if (existsSync(lockFile)) throw Error(`A release lock exists for ${app} ${environment} (${lockFile}); never break it. Use fika reconcile`);
  const journalFile = path.join(dir, `release-${app}-${environment}.json`);
  if (existsSync(journalFile)) {
    let journal; try { journal = jsonFile(journalFile); } catch { throw Error(`Release journal ${journalFile} is unreadable; use fika reconcile`); }
    if (journal.state !== 'completed') throw Error(`A pending release journal exists for ${app} ${environment} (state ${journal.state || 'unknown'}); use fika reconcile`);
  }
}

function build(id, options, { processAlive, fetchLedgers }) {
  const dir = path.join(stateDir(), 'workspace-operations');
  const file = path.join(dir, `${id}.json`);
  if (!existsSync(file)) return { file, missing: true };
  const marker = jsonFile(file);
  if (marker.id !== id || marker.kind !== 'deploy' || !Number.isInteger(marker.pid) || marker.pid < 1 || processAlive(marker.pid)) throw Error('Only a deploy marker whose process is confirmed exited may be recovered; other kinds and live processes remain protected');
  const record = workspaceRecords().find(r => r.name === marker.name);
  if (!record || record.owner !== marker.owner || !marker.leaseId || leaseIdentity(record) !== marker.leaseId) throw Error('Deploy marker does not match the recorded workspace lease; refusing');
  const evidence = ledgerEvidence(marker);
  assertNoReleaseControl(evidence.app, evidence.environment);
  if (processAlive(marker.pid)) throw Error('Deploy process is live; preserve its marker');
  const lease = { workspace: record.name, owner: record.owner, leaseId: marker.leaseId, state: record.state };
  const body = { schema: 'fika.deploy-marker-recovery-plan.v1', marker, lease, evidence };
  return { file, marker, lease, evidence, approveHash: digest(body) };
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
    const plan = build(id, options, { processAlive, fetchLedgers });
    if (plan.missing) {
      if (execute && existsSync(auditFile) && existsSync(archiveFile)) return { ...jsonFile(auditFile), alreadyApplied: true };
      throw Error(`Deploy marker ${id} does not exist; nothing to recover`);
    }
    const { marker, lease, evidence, approveHash } = plan;
    if (!execute) {
      return { schema: 'fika.deploy-marker-recovery-preview.v1', dryRun: true, actor, reason, marker, lease, evidence, approveHash,
        action: `Write ${auditFile} and move the marker to ${archiveFile}. Nothing else changes (no lease, registry, ledger, journal or lock change).`,
        execute: `node tools/workflow/deploy-marker-recovery.mjs ${id} --reason "<reason>" --execute --approve-hash ${approveHash}` };
    }
    if (options['approve-hash'] !== approveHash) throw Error('Marker, lease or ledger evidence changed since the preview. Obtain and review a fresh preview.');
    if (existsSync(archiveFile)) throw Error(`Archive ${archiveFile} already exists; refusing to overwrite`);
    // Resume after an interrupted prior execution: keep the original audit event rather than rewriting it.
    const event = existsSync(auditFile) ? jsonFile(auditFile)
      : { schema: 'fika.deploy-marker-recovery.v1', at: now(), actor, reason, approveHash, operation: marker, lease, evidence, ledgerShas: { intent: evidence.intent.commit, supersedingDeploy: evidence.supersedingDeploy.commit, ledgerHead: evidence.ledgerHead.commit } };
    if (digest(event.operation) !== digest(marker)) throw Error('Existing recovery audit does not match the marker; refusing');
    if (!existsSync(auditFile)) save(auditFile, event);
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
    const { recoverDeployOperation: governed } = await import('./workspace-admin.mjs');
    console.log(JSON.stringify(governed(id, options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
