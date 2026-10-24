import { execFileSync, spawn } from 'node:child_process';

const API = 'https://firebaseapphosting.googleapis.com/v1beta';
export const ROLLOUT_TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'];
const backendPath = t => `projects/${t.project}/locations/${t.region}/backends/${t.backend}`;
const lastSegment = name => String(name || '').split('/').at(-1);

/** Windows installs gcloud/firebase as .cmd wrappers; arguments are fixed allowlisted values, never browser text. */
function runTool(program, args) {
  if (process.platform === 'win32') {
    const quote = text => { if (/["\r\n%&|<>^!]/.test(text)) throw Error('Unsafe Windows command argument'); return `"${text}"`; };
    const exe = execFileSync('where.exe', [`${program}.cmd`], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
    return execFileSync('cmd.exe', ['/d', '/s', '/c', `"${[exe, ...args].map(quote).join(' ')}"`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).trim();
  }
  return execFileSync(program, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).trim();
}

/** Read-only App Hosting REST client. Fetch and token source are injectable for tests. */
export function createReader({ fetchImpl = fetch, getToken = () => runTool('gcloud', ['auth', 'print-access-token', '--quiet']) } = {}) {
  let cached;
  return async function read(resource) {
    if (!cached || Date.now() > cached.until) cached = { value: getToken(), until: Date.now() + 30 * 60000 };
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetchImpl(`${API}/${resource}`, { headers: { Authorization: `Bearer ${cached.value}` }, signal: AbortSignal.timeout(45000) });
        if (!response.ok) { const error = Error(`App Hosting read failed: HTTP ${response.status}`); error.retryable = response.status === 429 || response.status >= 500; error.status = response.status; throw error; }
        return await response.json();
      } catch (error) {
        if (attempt >= 2 || error.retryable === false) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  };
}

async function listAll(read, resource, key, maxPages = 6) {
  const rows = []; let token;
  for (let page = 0; page < maxPages; page++) {
    const body = await read(`${resource}?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    rows.push(...(body[key] || [])); token = body.nextPageToken;
    if (!token) return { rows, complete: true };
  }
  return { rows, complete: false };
}
const splits = s => (s?.splits || []).map(x => ({ buildId: lastSegment(x.build), percent: x.percent }));
const sourceOf = build => build?.source?.codebase?.hash || build?.source?.codebase?.commit || null;

/** Authoritative status of one backend, straight from Firebase. Throws are caught per backend by the caller. */
export async function readBackendStatus(t, read) {
  const base = backendPath(t);
  const [backend, traffic, rolloutPage] = await Promise.all([read(base), read(`${base}/traffic`), listAll(read, `${base}/rollouts`, 'rollouts')]);
  const rollouts = rolloutPage.rows.map(r => ({ id: lastSegment(r.name), buildId: lastSegment(r.build), state: r.state, createTime: r.createTime, updateTime: r.updateTime, reconciling: Boolean(r.reconciling) }))
    .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
  const current = splits(traffic.current);
  const target = splits(traffic.target);
  const active = rollouts.filter(r => !ROLLOUT_TERMINAL.includes(r.state));
  const lastSuccess = [...rollouts].reverse().find(r => r.state === 'SUCCEEDED');
  const latest = rollouts.at(-1) || null;

  let serving = null;
  if (current.length) {
    const lead = [...current].sort((a, b) => b.percent - a.percent)[0];
    const [build, rollout] = await Promise.all([read(`${base}/builds/${lead.buildId}`), read(`${base}/rollouts/${lead.buildId}`).catch(() => null)]);
    serving = { buildId: lead.buildId, percent: lead.percent, sourceSha: sourceOf(build), buildState: build.state, rolloutState: rollout?.state || null, since: rollout?.updateTime || null };
  }
  let lastSuccessInfo = null;
  if (lastSuccess) {
    const build = serving?.buildId === lastSuccess.buildId ? null : await read(`${base}/builds/${lastSuccess.buildId}`).catch(() => null);
    lastSuccessInfo = { rolloutId: lastSuccess.id, buildId: lastSuccess.buildId, sourceSha: serving?.buildId === lastSuccess.buildId ? serving.sourceSha : sourceOf(build), finishedAt: lastSuccess.updateTime };
  }
  const issues = [];
  if (traffic.rolloutPolicy?.disabled !== true) issues.push('Automatic rollouts are enabled on this backend');
  if (traffic.reconciling) issues.push('Traffic is reconciling');
  if (!rolloutPage.complete) issues.push('Rollout history truncated to the newest pages read');
  if (serving && serving.buildState !== 'READY') issues.push(`Serving build is ${serving.buildState}`);
  if (current.length > 1) issues.push('Traffic is split across builds');

  let rolloutStatus;
  if (active.length) rolloutStatus = { label: 'IN PROGRESS', detail: `${active.at(-1).id} ${active.at(-1).state}`, tone: 'info' };
  else if (!serving) rolloutStatus = { label: 'NEVER DEPLOYED', detail: latest ? `Latest attempt ${latest.id} ${latest.state}` : 'No rollouts', tone: 'warning' };
  else if (latest && latest.state !== 'SUCCEEDED') rolloutStatus = { label: `LATEST ${latest.state}`, detail: `${latest.id}; still serving ${serving.buildId}`, tone: 'danger' };
  else rolloutStatus = { label: 'SUCCEEDED', detail: `${serving.percent}% traffic`, tone: 'success' };

  return {
    ok: true, project: t.project, backend: t.backend, uri: backend.uri || null, reconciling: Boolean(traffic.reconciling),
    autoRolloutsDisabled: traffic.rolloutPolicy?.disabled === true, trafficCurrent: current, trafficTarget: target,
    serving, lastSuccess: lastSuccessInfo, latest, activeRollouts: active, rolloutStatus, issues, readAt: new Date().toISOString(), _rollouts: rollouts,
  };
}

/** Only the exact allowlisted `rollouts:create` invocation can be built; caller supplies validated values. */
export function rolloutArguments(t, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('A full lowercase 40-character source SHA is required');
  return ['apphosting:rollouts:create', t.backend, '--project', t.project, '--git-commit', sha, '--non-interactive', '--force'];
}
/** Proves the Firebase CLI itself is signed in and can see the target backend. Writes nothing anywhere. */
export function firebaseAuthPreflight(t, run = runTool) {
  let listing;
  try { listing = run('firebase', ['apphosting:backends:list', '--project', t.project, '--json']); }
  catch { throw Error(`Firebase CLI is not authenticated for ${t.project}. Run 'firebase login --reauth' and try again. Nothing was submitted or recorded.`); }
  if (!String(listing).includes(`/backends/${t.backend}"`)) throw Error(`Firebase CLI cannot see backend ${t.backend} in ${t.project}. Nothing was submitted.`);
}
export function cloudTokenPreflight(read, t) {
  return read(backendPath(t)).catch(error => { throw Error(`Google Cloud credentials cannot read ${t.backend}: ${error.message}. Run 'gcloud auth login' if expired. Nothing was submitted.`); });
}

/** Streams the Firebase CLI's output line by line. Resolves with the exit code; never throws on non-zero exit. */
export function spawnFirebase(args, onLine) {
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      const quote = text => { if (/["\r\n%&|<>^!]/.test(text)) throw Error('Unsafe Windows command argument'); return `"${text}"`; };
      const exe = execFileSync('where.exe', ['firebase.cmd'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
      child = spawn('cmd.exe', ['/d', '/s', '/c', `"${[exe, ...args].map(quote).join(' ')}"`], { windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } else child = spawn('firebase', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      let buffer = '';
      stream.on('data', chunk => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(l => l.trim() && onLine(l)); });
      stream.on('end', () => buffer.trim() && onLine(buffer));
    }
    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
}
