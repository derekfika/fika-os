import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, validateConfig, setAssignment, targetFor, APP_IDS, AGENTS } from './config.mjs';
import { appendEvent, readEvents } from './history.mjs';
import { readBackendStatus, rolloutArguments, firebaseAuthPreflight } from './firebase.mjs';
import { runDeployment, checkConfirmation } from './runner.mjs';
import { createDashboard } from './server.mjs';
import { main as agentMain } from './agent.mjs';
import { APPS } from '../workflow/policy.mjs';
import { fixture } from '../workflow/lifecycle-fixture.mjs';
import { createWorkspace, workspaceRecords } from '../workflow/workspaces.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const starter = path.join(here, 'deploy-config.json');
const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const scratch = () => mkdtempSync(path.join(tmpdir(), 'fika-dash-'));
const copyConfig = () => { const dir = scratch(); const file = path.join(dir, 'deploy-config.json'); copyFileSync(starter, file); return { dir, file }; };

/** In-memory App Hosting simulator for one backend. */
function fakeFirebase(t, { rollouts = [], serving = { buildId: 'build-1', sha: OLD }, autoDisabled = true } = {}) {
  const base = `projects/${t.project}/locations/${t.region}/backends/${t.backend}`;
  const state = { rollouts: [...rollouts], builds: { [serving.buildId]: { state: 'READY', source: { codebase: { hash: serving.sha } } } }, current: serving.buildId, reads: 0 };
  if (!state.rollouts.some(r => r.id === serving.buildId)) state.rollouts.unshift({ id: serving.buildId, state: 'SUCCEEDED', createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:05:00Z' });
  const read = async resource => {
    state.reads++;
    if (resource === base) return { name: base, uri: `${t.backend}.example.app` };
    if (resource === `${base}/traffic`) return { rolloutPolicy: { disabled: autoDisabled }, reconciling: false, current: state.current ? { splits: [{ build: `${base}/builds/${state.current}`, percent: 100 }] } : {} };
    if (resource.startsWith(`${base}/rollouts?`)) return { rollouts: state.rollouts.map(r => ({ name: `${base}/rollouts/${r.id}`, build: `${base}/builds/${r.id}`, state: r.state, createTime: r.createTime, updateTime: r.updateTime })) };
    let m = /\/builds\/([^/?]+)$/.exec(resource);
    if (m) return state.builds[m[1]] ? { name: resource, ...state.builds[m[1]] } : Promise.reject(Object.assign(Error('HTTP 404'), { status: 404 }));
    m = /\/rollouts\/([^/?]+)$/.exec(resource);
    if (m) { const r = state.rollouts.find(x => x.id === m[1]); return r ? { name: resource, state: r.state, updateTime: r.updateTime } : Promise.reject(Object.assign(Error('HTTP 404'), { status: 404 })); }
    throw Error(`unexpected read ${resource}`);
  };
  /** Pretend the CLI created a rollout; `outcome` is what Firebase later reports. */
  const create = (id, sha, outcome = 'SUCCEEDED') => {
    state.rollouts.push({ id, state: 'QUEUED', createTime: new Date().toISOString(), updateTime: new Date().toISOString() });
    state.builds[id] = { state: outcome === 'SUCCEEDED' ? 'READY' : 'FAILED', source: { codebase: { hash: sha } } };
    setTimeout(() => { state.rollouts.find(r => r.id === id).state = outcome; if (outcome === 'SUCCEEDED') state.current = id; }, 5);
  };
  return { read, state, create };
}
function harness({ environment = 'staging', fake, spawn, cliPreflight = () => {}, gitCheck = () => {} } = {}) {
  const { dir, file } = copyConfig();
  const config = readConfig(file);
  const t = targetFor(config, 'adhoc', environment);
  const fb = fake || fakeFirebase(t);
  const historyFile = path.join(dir, 'deployments.jsonl');
  const events = [];
  const spawnCalls = [];
  const deps = {
    config, read: fb.read, emit: e => events.push(e), pollMs: 1, discoverMs: 60, timeoutMs: 2000, sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 3))),
    git: { check: gitCheck }, cliPreflight, cloudPreflight: async () => {},
    history: e => appendEvent(historyFile, e),
    spawnFirebase: spawn || (async () => { fb.create('build-2', SHA); return 0; }),
  };
  const wrapped = deps.spawnFirebase; deps.spawnFirebase = async (args, onLine) => { spawnCalls.push(args); return wrapped(args, onLine); };
  return { deps, fb, t, historyFile, events, spawnCalls, dir, file };
}

test('starter config has exactly seven apps whose backends match the governed workflow mapping', () => {
  const cfg = readConfig(starter);
  assert.deepEqual(cfg.apps.map(a => a.id).sort(), [...APP_IDS].sort());
  assert.equal(cfg.apps.length, 7);
  for (const app of cfg.apps.filter(a => APPS[a.id])) {
    assert.equal(app.staging.backend, APPS[app.id].staging, app.id);
    assert.equal(app.production.backend, APPS[app.id].prod, app.id);
    assert.equal(app.path, APPS[app.id].path);
  }
  assert.ok(cfg.apps.every(a => a.agent === 'free' && a.assignment === null));
  assert.ok(!JSON.stringify(cfg).includes('"version"'), 'deployed versions must not live in the config');
});

test('config validation rejects cross-environment projects, duplicate backends, unknown agents and wrong app counts', () => {
  const good = () => structuredClone(readConfig(starter));
  let c = good(); c.apps[0].production.project = 'fika-os-dev'; assert.throws(() => validateConfig(c), /production project/);
  c = good(); c.apps[0].staging.project = 'fika-os'; assert.throws(() => validateConfig(c), /staging project/);
  c = good(); c.apps[0].production.backend = c.apps[0].staging.backend; assert.throws(() => validateConfig(c), /must differ/);
  c = good(); c.apps[0].agent = 'gpt'; assert.throws(() => validateConfig(c), /agent must be one of/);
  c = good(); c.apps.pop(); assert.throws(() => validateConfig(c), /exactly 7/);
  c = good(); c.apps[1].id = 'hub'; assert.throws(() => validateConfig(c), /duplicate/);
});

test('setAssignment persists advisory metadata atomically and creates no lock, lease or extra file', () => {
  const { dir, file } = copyConfig();
  setAssignment('cpu', { agent: 'sol', branch: 'codex/x', task: 'calendar fix', source: 'cli' }, file, () => '2026-10-24T10:00:00.000Z');
  let app = readConfig(file).apps.find(a => a.id === 'cpu');
  assert.deepEqual(app.assignment, { branch: 'codex/x', task: 'calendar fix', since: '2026-10-24T10:00:00.000Z', source: 'cli' });
  assert.equal(app.agent, 'sol');
  // A second agent can take over immediately: assignments are information, not ownership.
  setAssignment('cpu', { agent: 'luna', branch: 'other' }, file);
  assert.equal(readConfig(file).apps.find(a => a.id === 'cpu').agent, 'luna');
  setAssignment('cpu', { agent: 'free' }, file);
  app = readConfig(file).apps.find(a => a.id === 'cpu');
  assert.equal(app.agent, 'free'); assert.equal(app.assignment, null);
  assert.deepEqual(readdirSync(dir), ['deploy-config.json']);
  assert.throws(() => setAssignment('cpu', { agent: 'nobody' }, file), /agent must be one of/);
  assert.throws(() => setAssignment('nope', { agent: 'sol' }, file), /Unknown app/);
});

test('agent start/finish commands update assignments and never deploy', () => {
  const { file } = copyConfig(); const out = [];
  assert.equal(agentMain(['start', 'menu', 'sonnet', '--branch', 'feat/y', '--task', 'dessert rows'], { file, log: m => out.push(m) }), 0);
  assert.match(out[0], /assigned to sonnet.*no deployment started/);
  assert.equal(readConfig(file).apps.find(a => a.id === 'menu').assignment.branch, 'feat/y');
  assert.equal(agentMain(['finish', 'menu'], { file, log: m => out.push(m) }), 0);
  assert.equal(readConfig(file).apps.find(a => a.id === 'menu').agent, 'free');
  assert.equal(agentMain(['start', 'menu', 'free'], { file, log: () => {} }), 2);
  assert.deepEqual(AGENTS, ['free', 'luna', 'sol', 'sonnet', 'haiku']);
});

test('status reader reports serving SHA, build, traffic, last success and in-progress rollouts from Firebase', async () => {
  const t = targetFor(readConfig(starter), 'hub', 'staging');
  const fb = fakeFirebase(t, { serving: { buildId: 'build-9', sha: SHA }, rollouts: [{ id: 'build-10', state: 'FAILED', createTime: '2026-10-02T00:00:00Z', updateTime: '2026-10-02T00:10:00Z' }] });
  let status = await readBackendStatus(t, fb.read);
  assert.equal(status.serving.sourceSha, SHA); assert.equal(status.serving.buildId, 'build-9'); assert.equal(status.serving.percent, 100);
  assert.equal(status.lastSuccess.buildId, 'build-9'); assert.equal(status.rolloutStatus.label, 'LATEST FAILED');
  assert.equal(status.autoRolloutsDisabled, true);
  fb.state.rollouts.push({ id: 'build-11', state: 'PROGRESSING', createTime: '2026-10-03T00:00:00Z', updateTime: '2026-10-03T00:00:00Z' });
  status = await readBackendStatus(t, fb.read);
  assert.equal(status.rolloutStatus.label, 'IN PROGRESS'); assert.equal(status.activeRollouts.length, 1);
  fb.state.rollouts.at(-1).state = 'SKIPPED';
  status = await readBackendStatus(t, fb.read);
  assert.equal(status.activeRollouts.length, 0, 'SKIPPED is terminal in Firebase');
  const none = fakeFirebase(t, { serving: { buildId: 'x', sha: OLD } }); none.state.current = null; none.state.rollouts = [];
  assert.equal((await readBackendStatus(t, none.read)).rolloutStatus.label, 'NEVER DEPLOYED');
});

test('the only submit command is the allowlisted rollouts:create with a pinned SHA', () => {
  const t = targetFor(readConfig(starter), 'adhoc', 'staging');
  assert.deepEqual(rolloutArguments(t, SHA), ['apphosting:rollouts:create', 'fika-os-staging-adhoc', '--project', 'fika-os-dev', '--git-commit', SHA, '--non-interactive', '--force']);
  assert.throws(() => rolloutArguments(t, 'main'), /40-character/);
  assert.throws(() => rolloutArguments(t, `${SHA}; calc`), /40-character/);
});

test('confirmation rules: staging simple yes, production must repeat environment, app and SHA', () => {
  assert.doesNotThrow(() => checkConfirmation({ environment: 'staging', appId: 'hub', sha: SHA, confirm: true }));
  assert.throws(() => checkConfirmation({ environment: 'staging', appId: 'hub', sha: SHA }), /not confirmed/);
  const ok = { environment: 'production', app: 'hub', sha: SHA };
  assert.doesNotThrow(() => checkConfirmation({ environment: 'production', appId: 'hub', sha: SHA, confirm: ok }));
  for (const bad of [true, { ...ok, environment: 'staging' }, { ...ok, app: 'cpu' }, { ...ok, sha: OLD }]) assert.throws(() => checkConfirmation({ environment: 'production', appId: 'hub', sha: SHA, confirm: bad }), /Production confirmation/);
});

test('staging deploy is verified against Firebase before it is called successful', async () => {
  const h = harness();
  const result = await runDeployment({ appId: 'adhoc', environment: 'staging', sha: SHA, confirm: true }, h.deps);
  assert.equal(result.outcome, 'verified');
  assert.equal(result.rollout, 'build-2');
  assert.equal(result.previous.sourceSha, OLD);
  assert.equal(h.spawnCalls.length, 1);
  assert.deepEqual(h.spawnCalls[0].slice(0, 3), ['apphosting:rollouts:create', 'fika-os-staging-adhoc', '--project']);
  assert.deepEqual(readEvents(h.historyFile).map(e => e.type), ['submit_started', 'submitted', 'verified']);
});

test('a CLI exit 0 is not success when the rollout fails in Firebase', async () => {
  const h = harness({ spawn: async () => { h.fb.create('build-2', SHA, 'FAILED'); return 0; } });
  const result = await runDeployment({ appId: 'adhoc', environment: 'staging', sha: SHA, confirm: true }, h.deps);
  assert.equal(result.outcome, 'failed');
  assert.match(result.message, /FAILED/);
  assert.equal(readEvents(h.historyFile).at(-1).type, 'verify_failed');
  assert.equal(h.fb.state.current, 'build-1', 'serving build unchanged');
});

test('exit 0 with no rollout in Firebase is reported unverified, never success', async () => {
  const h = harness({ spawn: async () => 0 });
  const result = await runDeployment({ appId: 'adhoc', environment: 'staging', sha: SHA, confirm: true }, h.deps);
  assert.equal(result.outcome, 'unverified');
});

test('an in-progress rollout seen in Firebase blocks submission', async () => {
  const t = targetFor(readConfig(starter), 'adhoc', 'staging');
  const h = harness({ fake: fakeFirebase(t, { rollouts: [{ id: 'build-5', state: 'QUEUED', createTime: '2026-10-24T15:00:00Z', updateTime: '2026-10-24T15:00:00Z' }] }) });
  const result = await runDeployment({ appId: 'adhoc', environment: 'staging', sha: SHA, confirm: true }, h.deps);
  assert.equal(result.outcome, 'refused'); assert.match(result.message, /build-5 QUEUED/);
  assert.equal(h.spawnCalls.length, 0);
});

test('failed authentication preflight submits nothing and leaves nothing that blocks a retry', async () => {
  let signedIn = false;
  const h = harness({ cliPreflight: () => { if (!signedIn) throw Error('Firebase CLI is not authenticated for fika-os-dev. Run firebase login --reauth'); } });
  const first = await runDeployment({ appId: 'adhoc', environment: 'staging', sha: SHA, confirm: true }, h.deps);
  assert.equal(first.outcome, 'error'); assert.match(first.message, /not authenticated/);
  assert.equal(h.spawnCalls.length, 0);
  assert.deepEqual(readdirSync(h.dir).sort(), ['deploy-config.json', 'deployments.jsonl']);
  assert.ok(readEvents(h.historyFile).every(e => !e.type.startsWith('submit')), 'audit rows only, no pending intent');
  signedIn = true;
  const retry = await runDeployment({ appId: 'adhoc', environment: 'staging', sha: SHA, confirm: true }, h.deps);
  assert.equal(retry.outcome, 'verified');
});

test('firebaseAuthPreflight explains reauth and requires the target backend to be visible', () => {
  const t = targetFor(readConfig(starter), 'adhoc', 'staging');
  assert.throws(() => firebaseAuthPreflight(t, () => { throw Error('401'); }), /login --reauth/);
  assert.throws(() => firebaseAuthPreflight(t, () => '{"result":[{"name":"projects/p/locations/l/backends/other"}]}'), /cannot see backend/);
  assert.doesNotThrow(() => firebaseAuthPreflight(t, () => `{"result":[{"name":"projects/p/locations/l/backends/${t.backend}"}]}`));
});

test('already-serving SHA is not resubmitted and dry run submits nothing', async () => {
  const h = harness();
  assert.equal((await runDeployment({ appId: 'adhoc', environment: 'staging', sha: OLD, confirm: true }, h.deps)).outcome, 'already-serving');
  assert.equal((await runDeployment({ appId: 'adhoc', environment: 'staging', sha: SHA, confirm: true, dryRun: true }, h.deps)).outcome, 'dry-run');
  assert.equal(h.spawnCalls.length, 0);
});

test('production requires exact confirmation and a SHA that git says is integrated; refusals do not submit', async () => {
  const h = harness({ environment: 'production' });
  let r = await runDeployment({ appId: 'adhoc', environment: 'production', sha: SHA, confirm: true }, h.deps);
  assert.equal(r.outcome, 'refused');
  const h2 = harness({ environment: 'production', gitCheck: () => { throw Error('not integrated'); } });
  r = await runDeployment({ appId: 'adhoc', environment: 'production', sha: SHA, confirm: { environment: 'production', app: 'adhoc', sha: SHA } }, h2.deps);
  assert.notEqual(r.outcome, 'verified');
  assert.equal(h.spawnCalls.length + h2.spawnCalls.length, 0);
  const h3 = harness({ environment: 'production' });
  r = await runDeployment({ appId: 'adhoc', environment: 'production', sha: SHA, confirm: { environment: 'production', app: 'adhoc', sha: SHA } }, h3.deps);
  assert.equal(r.outcome, 'verified');
  assert.equal(h3.spawnCalls[0][1], 'fika-os-prod-adhoc'); assert.equal(h3.spawnCalls[0][3], 'fika-os');
});

test('local server binds to loopback, rejects foreign hosts and tokenless writes, keeps production disabled by default', async () => {
  const { file, dir } = copyConfig();
  const t = targetFor(readConfig(file), 'adhoc', 'staging');
  const fb = fakeFirebase(t);
  // Every backend answers the same simulator shape: enough for the page to load.
  const read = async resource => fb.read(resource.replace(/backends\/[^/]+/, `backends/${t.backend}`).replace(/projects\/[^/]+/, `projects/${t.project}`));
  let runs = 0;
  const dash = createDashboard({ port: 0, config: file, history: path.join(dir, 'h.jsonl'), root: path.resolve(here, '..', '..'), read, runner: async () => { runs++; return { outcome: 'verified' }; }, deps: { operation: async (_kind, fn) => fn() } });
  const port = await dash.listen();
  try {
    assert.equal(dash.server.address().address, '127.0.0.1');
    const base = `http://127.0.0.1:${port}`;
    const page = await (await fetch(base)).text();
    assert.ok(page.includes(dash.token) && !page.includes('__DASHBOARD_TOKEN__'));
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.apps.length, 7); assert.equal(state.productionEnabled, false);
    assert.equal(Object.keys(state.statuses).length, 14);
    assert.equal(state.statuses['adhoc:staging'].serving.sourceSha, OLD);
    const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/api/agent', { app: 'hub', agent: 'sol' })).status, 403);
    assert.equal((await post('/api/agent', { app: 'hub', agent: 'sol' }, { 'x-dashboard-token': dash.token, origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('/api/agent', { app: 'hub', agent: 'sol', branch: 'b' }, { 'x-dashboard-token': dash.token })).status, 200);
    assert.equal(readConfig(file).apps.find(a => a.id === 'hub').agent, 'sol');
    assert.equal(runs, 0, 'changing an assignment never deploys');
    const prod = await post('/api/deploy', { app: 'hub', environment: 'production', sha: SHA, confirm: { environment: 'production', app: 'hub', sha: SHA } }, { 'x-dashboard-token': dash.token });
    assert.equal(prod.status, 403); assert.equal(runs, 0);
    const bad = await post('/api/deploy', { app: 'hub', environment: 'staging; rm -rf', sha: SHA }, { 'x-dashboard-token': dash.token });
    assert.equal(bad.status, 400);
    const raw = await new Promise(resolve => { import('node:http').then(({ default: http }) => http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { host: 'evil.example' } }, r => resolve(r.statusCode))); });
    assert.equal(raw, 403);
    const ok = await post('/api/deploy', { app: 'hub', environment: 'staging', sha: SHA, confirm: true }, { 'x-dashboard-token': dash.token });
    assert.equal(ok.status, 202);
    const { deploymentId } = await ok.json();
    const events = await (await fetch(`${base}/api/deploy/${deploymentId}/events`)).text();
    assert.match(events, /"outcome":"verified"/);
    assert.equal(runs, 1);
  } finally { await dash.close(); }
});

test('history is append-only JSON lines and never read as a gate', () => {
  const { dir } = copyConfig(); const file = path.join(dir, 'h.jsonl');
  appendEvent(file, { type: 'submit_started', app: 'hub' }); appendEvent(file, { type: 'verified', app: 'hub' });
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
  assert.ok(!existsSync(`${file}.lock`));
});

test('deployment adapters have no separate lock, lease or pending-intent mechanisms', () => {
  for (const f of ['config.mjs', 'history.mjs', 'firebase.mjs', 'runner.mjs', 'agent.mjs']) {
    const code = readFileSync(path.join(here, f), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    assert.ok(!/openSync\([^)]*['"]wx['"]|\.lock\b|flag:\s*['"]wx['"]|lease|mutex|pendingIntent/i.test(code), `${f} must not create locks or leases`);
  }
  const server=readFileSync(path.join(here,'server.mjs'),'utf8');
  assert.match(server,/workspace-admin\.mjs/);assert.match(server,/workspace-state\.mjs/);
  assert.ok(!/openSync|mkdirSync|workspaces\.json|\.lock'/.test(server),'server delegates registry/concurrency to the governed implementation');
});

test('workspace dashboard uses admin identity, token, origin, exact confirmation, fresh preview and shared audit',async()=>{
  const f=fixture();const {file,dir}=copyConfig();
  f.within(()=>createWorkspace('dashboard-task',{owner:'fixture-owner',scope:'src'}));
  let isAdmin=false;
  const dash=createDashboard({port:0,root:f.repo,config:file,history:path.join(dir,'history.jsonl'),read:async()=>{throw Error('Cloud is not used for workspace management');},deps:{workspaces:{authorize:()=>({login:'fixture-owner',administrator:isAdmin})}}});
  const port=await dash.listen();const base=`http://127.0.0.1:${port}`;
  const post=(suffix,body={},extra={})=>fetch(`${base}/api/workspaces/${suffix}`,{method:'POST',headers:{'content-type':'application/json','x-dashboard-token':dash.token,origin:base,...extra},body:JSON.stringify(body)});
  try{
    assert.equal((await fetch(`${base}/api/workspaces`)).status,403);
    assert.equal((await post('release-all/preview')).status,400,'non-administrator cannot preview');isAdmin=true;
    assert.equal((await post('release-all/preview',{}, {'x-dashboard-token':'wrong'})).status,403);
    assert.equal((await post('release-all/preview',{}, {origin:'https://evil.example'})).status,403);
    assert.equal((await post('release-all/preview',{}, {'sec-fetch-site':'cross-site'})).status,403);
    assert.equal((await post('release-all/preview',{}, {origin:''})).status,403);
    const plan=await (await post('release-all/preview')).json();assert.equal(plan.eligibleCount,1);
    assert.equal((await post('release-all/execute',{'approve-hash':plan.planHash,confirm:'yes',reason:'Owner recovery'})).status,400);
    const result=await (await post('release-all/execute',{'approve-hash':plan.planHash,confirm:'RELEASE ALL LEASES',reason:'Owner approved fixture recovery'})).json();assert.equal(result.released.length,1);
    assert.equal(f.within(()=>workspaceRecords()[0].state),'revoked');
    const page=await(await fetch(base)).text();assert.match(page,/<dialog[^>]+workspace-dialog/);assert.match(page,/Type RELEASE ALL LEASES/);assert.match(page,/workspace-reason/);assert.ok(page.includes('Preview safe cleanup'));
  }finally{await dash.close();f.dispose();}
});
