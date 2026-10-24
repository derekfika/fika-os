import { execFileSync } from 'node:child_process';
import { targetFor } from './config.mjs';
import { ROLLOUT_TERMINAL, readBackendStatus, rolloutArguments, firebaseAuthPreflight, cloudTokenPreflight, spawnFirebase } from './firebase.mjs';

const SHA = /^[a-f0-9]{40}$/;
export class DeployRefused extends Error {}
const refuse = message => { throw new DeployRefused(message); };

/** Production needs the environment, the app and the SHA typed back exactly; staging needs a plain yes. */
export function checkConfirmation({ environment, appId, sha, confirm }) {
  if (environment === 'staging') { if (confirm !== true && confirm?.environment !== 'staging') refuse('Staging deployment was not confirmed'); return; }
  if (!confirm || confirm.environment !== 'production' || confirm.app !== appId || confirm.sha !== sha) refuse('Production confirmation must repeat the environment (production), the app id and the full source SHA exactly');
}

/** Git evidence about the pinned SHA. Production additionally requires it to be integrated into origin/main. */
export function gitChecker(root, run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })) {
  const ok = args => { try { run(args); return true; } catch { return false; } };
  return {
    fetch: () => ok(['fetch', 'origin', '--quiet']),
    check(target, sha) {
      if (!ok(['cat-file', '-e', `${sha}^{commit}`])) refuse(`Commit ${sha} is not in the local repository; fetch it first`);
      if (!run(['branch', '-r', '--contains', sha]).trim()) refuse(`Commit ${sha} is not on any pushed branch; App Hosting builds from GitHub, so push it first`);
      if (!ok(['cat-file', '-e', `${sha}:${target.path}`])) refuse(`${target.path} does not exist at ${sha}`);
      if (target.environment === 'production' && !ok(['merge-base', '--is-ancestor', sha, 'origin/main'])) refuse('Production source must already be integrated into origin/main');
    },
  };
}

/**
 * Submit one pinned commit to one backend and verify what Firebase reports.
 * Persistent state: only append-only history. Nothing here can block a later attempt.
 */
export async function runDeployment(request, deps) {
  const { appId, environment, sha, confirm, dryRun = false } = request;
  const { config, read, git, emit = () => {}, history = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), pollMs = 15000, timeoutMs = 45 * 60000, discoverMs = 120000 } = deps;
  const log = (message, level = 'info') => emit({ type: 'log', level, message });
  const phase = name => emit({ type: 'phase', name });
  const base = { app: appId, environment, sha, actor: request.actor || 'dashboard' };
  try {
    if (!SHA.test(sha || '')) refuse('A full lowercase 40-character source SHA is required');
    const t = targetFor(config, appId, environment);
    checkConfirmation({ environment, appId, sha, confirm });
    base.project = t.project; base.backend = t.backend;

    phase('Checking commit'); git.fetch?.(); git.check(t, sha);
    log(`Commit ${sha.slice(0, 12)} is pushed${environment === 'production' ? ' and integrated into origin/main' : ''}.`);

    phase('Checking Firebase authentication');
    (deps.cliPreflight || firebaseAuthPreflight)(t);
    await (deps.cloudPreflight || (() => cloudTokenPreflight(read, t)))();
    log(`Authenticated for ${t.project}; backend ${t.backend} is visible.`);

    phase('Checking Firebase for conflicting rollouts');
    const before = await readBackendStatus(t, read);
    if (before.activeRollouts.length) refuse(`Firebase reports a rollout in progress on ${t.backend}: ${before.activeRollouts.map(r => `${r.id} ${r.state}`).join(', ')}. Nothing was submitted.`);
    if (before.reconciling) refuse(`Traffic on ${t.backend} is reconciling in Firebase. Try again shortly. Nothing was submitted.`);
    if (!before.autoRolloutsDisabled) log('Warning: automatic rollouts are enabled on this backend.', 'warning');
    if (before.serving?.sourceSha === sha && before.serving.percent === 100 && before.serving.buildState === 'READY') {
      log(`Firebase already serves ${sha.slice(0, 12)} (build ${before.serving.buildId}). Nothing to submit.`);
      history({ ...base, type: 'noop', buildId: before.serving.buildId });
      return { outcome: 'already-serving', serving: before.serving };
    }
    const knownRollouts = new Set(before._rollouts.map(r => r.id));
    const previous = before.serving ? { buildId: before.serving.buildId, sourceSha: before.serving.sourceSha } : null;
    log(previous ? `Currently serving ${previous.sourceSha?.slice(0, 12)} (build ${previous.buildId}); rollback target recorded.` : 'Backend has no serving build yet.');

    const args = rolloutArguments(t, sha);
    if (dryRun) {
      log(`Dry run only. Would run: firebase ${args.join(' ')}`);
      return { outcome: 'dry-run', previous };
    }

    phase('Submitting rollout');
    history({ ...base, type: 'submit_started', previous });
    let exitCode;
    try { exitCode = await (deps.spawnFirebase || spawnFirebase)(args, line => log(line, 'cli')); }
    catch (error) { history({ ...base, type: 'submit_failed', reason: error.message }); throw error; }
    log(`Firebase CLI exited with code ${exitCode}. Verifying with Firebase, not trusting the exit code.`);

    phase('Identifying rollout');
    let rollout; const discoverBy = Date.now() + discoverMs;
    while (!rollout && Date.now() <= discoverBy) {
      const now = await readBackendStatus(t, read);
      rollout = now._rollouts.find(r => !knownRollouts.has(r.id));
      if (!rollout) await sleep(Math.min(pollMs, 5000));
    }
    if (!rollout) {
      history({ ...base, type: exitCode === 0 ? 'unverified' : 'submit_failed', exitCode, reason: 'No new rollout appeared in Firebase' });
      return { outcome: exitCode === 0 ? 'unverified' : 'failed', exitCode, message: 'Firebase shows no new rollout. Check the backend before retrying; nothing is stored that blocks a retry.' };
    }
    log(`Firebase created rollout ${rollout.id} (build ${rollout.buildId}).`);
    history({ ...base, type: 'submitted', exitCode, rollout: rollout.id, buildId: rollout.buildId });

    phase('Waiting for Firebase');
    const deadline = Date.now() + timeoutMs; let last = '';
    for (;;) {
      const now = await readBackendStatus(t, read);
      rollout = now._rollouts.find(r => r.id === rollout.id) || rollout;
      if (rollout.state !== last) { last = rollout.state; emit({ type: 'progress', rollout: rollout.id, state: rollout.state }); log(`Rollout ${rollout.id}: ${rollout.state}`); }
      if (ROLLOUT_TERMINAL.includes(rollout.state)) break;
      if (Date.now() > deadline) { history({ ...base, type: 'verify_timeout', rollout: rollout.id }); return { outcome: 'timeout', rollout: rollout.id, message: 'Still running in Firebase after the wait limit; status will keep updating on the dashboard.' }; }
      await sleep(pollMs);
    }

    phase('Verifying serving build');
    const after = await readBackendStatus(t, read);
    const s = after.serving;
    const verified = rollout.state === 'SUCCEEDED' && s && s.buildId === rollout.buildId && s.percent === 100 && s.buildState === 'READY' && s.sourceSha === sha;
    if (!verified) {
      const reason = rollout.state !== 'SUCCEEDED' ? `Rollout ended ${rollout.state}` : `Serving build ${s?.buildId} at ${s?.sourceSha} (${s?.percent}%) does not match ${rollout.buildId} at ${sha}`;
      history({ ...base, type: 'verify_failed', rollout: rollout.id, buildId: rollout.buildId, state: rollout.state, reason, previous });
      log(reason, 'error');
      return { outcome: 'failed', rollout: rollout.id, state: rollout.state, message: reason, previous };
    }
    let smoke = null;
    if (after.uri && deps.smoke) smoke = await deps.smoke(after.uri).catch(error => ({ ok: false, reason: error.message }));
    history({ ...base, type: 'verified', rollout: rollout.id, buildId: rollout.buildId, previous, smoke });
    log(`Verified: Firebase serves ${sha.slice(0, 12)} from build ${s.buildId} at 100% traffic.`, 'success');
    return { outcome: 'verified', rollout: rollout.id, buildId: s.buildId, previous, smoke };
  } catch (error) {
    if (error instanceof DeployRefused) { history({ ...base, type: 'refused', reason: error.message }); log(error.message, 'error'); return { outcome: 'refused', message: error.message }; }
    history({ ...base, type: 'error', reason: error.message });
    log(error.message, 'error');
    return { outcome: 'error', message: error.message };
  }
}

/** Non-gating HTTP smoke: records the status only; auth redirects are expected on these apps. */
export async function smokeProbe(uri, fetchImpl = fetch) {
  const url = `https://${String(uri).replace(/^https?:\/\//, '').replace(/\/$/, '')}/`;
  const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  return { url, status: response.status };
}
