import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, ENVIRONMENTS, canonicalRoot, configPath, historyPath, readConfig, setAssignment, targetFor } from './config.mjs';
import { appendEvent, latestVerified, readEvents } from './history.mjs';
import { createReader, readBackendStatus } from './firebase.mjs';
import { gitChecker, runDeployment, smokeProbe } from './runner.mjs';
import { withRepository } from '../workflow/runtime.mjs';
import { governedOperation } from '../workflow/workspace-state.mjs';
import { workspaceStatus, previewReleaseAll, releaseAllWorkspaces, previewSweep, sweepWorkspaces } from '../workflow/workspace-admin.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATUS_TTL_MS = 15000;

export function createDashboard({ port = 4180, enableProduction = false, config = configPath(), history = historyPath(), root = canonicalRoot(), read = createReader(), runner = runDeployment, deps = {}, token = randomBytes(24).toString('hex') } = {}) {
  const deployments = new Map();
  const inFlight = new Map(); // process memory only: stops a double click in this server, vanishes on restart, Firebase stays the real arbiter
  let statusCache = { at: 0, value: null };
  const workspaceCall = fn => withRepository(root, fn);
  const workspaceDeps = deps.workspaces || {};

  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const body = req => new Promise((resolve, reject) => {
    let data = ''; req.on('data', c => { data += c; if (data.length > 20000) { reject(Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Error('Invalid JSON')); } });
  });
  const hostOk = req => [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`].includes(req.headers.host);

  async function statuses(force) {
    if (!force && statusCache.value && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
    const cfg = readConfig(config);
    const out = {};
    await Promise.all(cfg.apps.flatMap(app => ENVIRONMENTS.map(async env => {
      const t = targetFor(cfg, app.id, env);
      try { const { _rollouts, ...status } = await readBackendStatus(t, read); out[`${app.id}:${env}`] = status; }
      catch (error) { out[`${app.id}:${env}`] = { ok: false, error: error.message, project: t.project, backend: t.backend, readAt: new Date().toISOString() }; }
    })));
    statusCache = { at: Date.now(), value: out };
    return out;
  }
  const refs = () => { const sha = name => { try { return execFileSync('git', ['rev-parse', '--verify', name], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }; return { originMain: sha('origin/main') }; };

  function startDeployment(payload) {
    const cfg = readConfig(config);
    const t = targetFor(cfg, payload.app, payload.environment);
    if (t.environment === 'production' && !enableProduction) { const e = Error('Production deployment is disabled. Start the dashboard with --enable-production.'); e.code = 403; throw e; }
    if (inFlight.has(t.backend)) { const e = Error(`A deployment to ${t.backend} is already running in this dashboard`); e.code = 409; throw e; }
    const id = randomUUID();
    const record = { id, app: t.app, environment: t.environment, events: [], listeners: new Set(), done: false };
    deployments.set(id, record); inFlight.set(t.backend, id);
    const emit = event => { const e = { ...event, at: new Date().toISOString() }; record.events.push(e); record.listeners.forEach(fn => fn(e)); };
    Promise.resolve().then(() => workspaceCall(() => (deps.operation || governedOperation)('dashboard-deployment', () => runner({ appId: payload.app, environment: payload.environment, sha: payload.sha, confirm: payload.confirm, dryRun: payload.dryRun === true, actor: 'dashboard' }, {
      config: cfg, read, emit, git: deps.git || gitChecker(root), history: event => appendEvent(history, event), smoke: smokeProbe, ...deps.runner,
    })))).then(result => emit({ type: 'result', ...result }), error => emit({ type: 'result', outcome: 'error', message: error.message }))
      .finally(() => { record.done = true; inFlight.delete(t.backend); statusCache.at = 0; record.listeners.forEach(fn => fn(null)); });
    return id;
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!hostOk(req)) return json(res, 403, { error: 'Host not allowed' });
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        const html = readFileSync(path.join(here, 'index.html'), 'utf8').replace('__DASHBOARD_TOKEN__', token);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const cfg = readConfig(config);
        const events = readEvents(history);
        return json(res, 200, { agents: AGENTS, productionEnabled: enableProduction, configFile: config, apps: cfg.apps, statuses: await statuses(url.searchParams.has('refresh')), localRecords: latestVerified(events), recent: events.slice(-15).reverse(), refs: refs(), now: new Date().toISOString() });
      }
      if (url.pathname.startsWith('/api/workspaces')) {
        if (req.headers['x-dashboard-token'] !== token) return json(res, 403, { error: 'Dashboard authentication token required' });
        if (req.method === 'GET' && url.pathname === '/api/workspaces') return json(res, 200, workspaceCall(() => workspaceStatus()));
      }
      const sse = /^\/api\/deploy\/([0-9a-f-]{36})\/events$/.exec(url.pathname);
      if (req.method === 'GET' && sse) {
        const record = deployments.get(sse[1]);
        if (!record) return json(res, 404, { error: 'Unknown deployment' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        const send = e => { if (e) res.write(`data: ${JSON.stringify(e)}\n\n`); else res.end(); };
        record.events.forEach(send);
        if (record.done) return res.end();
        record.listeners.add(send); req.on('close', () => record.listeners.delete(send));
        return;
      }
      if (req.method === 'POST') {
        if (req.headers['x-dashboard-token'] !== token) return json(res, 403, { error: 'Missing or wrong dashboard token; reload the page' });
        if (req.headers.origin && ![`http://127.0.0.1:${server.address().port}`, `http://localhost:${server.address().port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Origin not allowed' });
        const payload = await body(req);
        if (url.pathname.startsWith('/api/workspaces/')) {
          if (![`http://127.0.0.1:${server.address().port}`, `http://localhost:${server.address().port}`].includes(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site' || !String(req.headers['content-type']).startsWith('application/json')) return json(res, 403, { error: 'Workspace mutations require a same-origin JSON request' });
          if (url.pathname === '/api/workspaces/release-all/preview') return json(res, 200, workspaceCall(() => previewReleaseAll(workspaceDeps)));
          if (url.pathname === '/api/workspaces/release-all/execute') return json(res, 200, workspaceCall(() => releaseAllWorkspaces(payload, workspaceDeps)));
          if (url.pathname === '/api/workspaces/sweep/preview') return json(res, 200, workspaceCall(() => { (workspaceDeps.authorize || (() => previewReleaseAll()))(); return previewSweep(); }));
          if (url.pathname === '/api/workspaces/sweep/execute') return json(res, 200, workspaceCall(() => sweepWorkspaces(payload, workspaceDeps)));
        }
        if (url.pathname === '/api/agent') {
          const app = setAssignment(payload.app, { agent: payload.agent, branch: payload.branch, task: payload.task, source: 'dashboard' }, config);
          return json(res, 200, { app });
        }
        if (url.pathname === '/api/deploy') {
          try { return json(res, 202, { deploymentId: startDeployment(payload) }); }
          catch (error) { return json(res, error.code || 400, { error: error.message }); }
        }
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) { json(res, 400, { error: error.message }); }
  });
  return { server, token, listen: () => new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server.address().port))), close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const enableProduction = process.argv.includes('--enable-production') || process.env.FIKA_DEPLOY_ENABLE_PRODUCTION === '1';
  const dashboard = createDashboard({ port: Number(process.env.FIKA_DEPLOY_PORT || 4180), enableProduction });
  const port = await dashboard.listen();
  console.log(`FIKA OS Deploy Control: http://127.0.0.1:${port}  (production deploys ${enableProduction ? 'ENABLED' : 'disabled'})`);
  console.log(`Config: ${configPath()}\nHistory: ${historyPath()}`);
}
