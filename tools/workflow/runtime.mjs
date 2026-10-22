import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { APPS, digest, exactSha } from './policy.mjs';

export function command(program, args, options = {}) {
  // .cmd wrappers need cmd.exe on Windows. quote every argument; no arbitrary shell input is accepted.
  if (process.platform === 'win32' && ['gcloud', 'firebase', 'npm', 'npx'].includes(program)) {
    const quote = text => { if (/["\r\n%&|<>^!]/.test(text)) throw Error('Unsafe Windows command argument'); return `"${text}"`; };
    const executable = execFileSync('where.exe', [`${program}.cmd`], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
    return (execFileSync('cmd.exe', ['/d', '/s', '/c', `"${[executable, ...args].map(quote).join(' ')}"`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, ...options }) || '').trim();
  }
  return (execFileSync(program, args, { encoding: 'utf8', windowsHide: true, ...options }) || '').trim();
}
export const git = (...args) => command('git', args);
export const root = () => git('rev-parse', '--show-toplevel');
export const common = () => path.resolve(root(), git('rev-parse', '--git-common-dir'));
export const stateDir = () => { const dir = path.join(common(), 'fika-workflow'); mkdirSync(dir, { recursive: true }); return dir; };
export function ancestor(a, b) { return spawnSync('git', ['merge-base', '--is-ancestor', a, b], { windowsHide: true }).status === 0; }
export function ref(name) { const r = spawnSync('git', ['rev-parse', '--verify', name], { encoding: 'utf8', windowsHide: true }); return r.status === 0 ? r.stdout.trim() : undefined; }
export function jsonFile(file) { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
export function save(file, value) { mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, file); }
export function lock(name, fn) {
  const file = path.join(stateDir(), `${name}.lock`); let fd;
  try { fd = openSync(file, 'wx'); } catch { throw Error(`Another operation holds ${file}; inspect it, never auto-break locks`); }
  try { return fn(); } finally { closeSync(fd); unlinkSync(file); }
}
export async function asyncLock(name, fn) {
  const file = path.join(stateDir(), `${name}.lock`); let fd;
  try { fd = openSync(file, 'wx'); } catch { throw Error(`Another operation holds ${file}; inspect it, never auto-break locks`); }
  try { return await fn(); } finally { closeSync(fd); unlinkSync(file); }
}
export function inside(parent, child) {
  const r = path.relative(realpathSync(parent), realpathSync(child));
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw Error('Target must be a strict descendant of the managed workspace root');
  return child;
}
export function scopeHash(app, sha) {
  exactSha(sha); const info = APPS[app]; if (!info) throw Error('Unknown app');
  const paths = [info.path, 'apps/shared', 'packages', 'package.json', 'package-lock.json', 'firebase.json', '.firebaserc'];
  return digest(git('ls-tree', '-r', sha, '--', ...paths));
}
export function ghApi(endpoint, method = 'GET', body) {
  const args = ['api', endpoint, '--method', method];
  if (body) args.push('--input', '-');
  return JSON.parse(command('gh', args, body ? { input: JSON.stringify(body) } : {}));
}
let tokenCache;
export async function cloud(resource) {
  if (!tokenCache || Date.now() > tokenCache.until) tokenCache = { value: command('gcloud', ['auth', 'print-access-token', '--quiet']), until: Date.now() + 40 * 60000 };
  // Read-only inspection may retry transient transport/service errors. Never retry rollout submission here.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://firebaseapphosting.googleapis.com/v1beta/${resource}`, { headers: { Authorization: `Bearer ${tokenCache.value}` }, signal: AbortSignal.timeout(45000) });
      if (!response.ok) { const error = Error(`App Hosting inspection failed: HTTP ${response.status}`); error.retryable = response.status === 429 || response.status >= 500; throw error; }
      return response.json();
    } catch (error) {
      if (attempt === 2 || error.retryable === false) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
export const backendPath = t => `projects/${t.project}/locations/${t.region}/backends/${t.backend}`;
export async function serving(t) {
  const traffic = await cloud(`${backendPath(t)}/traffic`);
  if (traffic.rolloutPolicy?.disabled !== true) throw Error(`Automatic rollouts must remain disabled for ${t.backend}`);
  const splits = traffic.current?.splits || [];
  if (splits.length !== 1 || splits[0].percent !== 100 || traffic.reconciling) throw Error('Backend is not quiescent at a single 100% revision');
  const build = await cloud(splits[0].build); const id = splits[0].build.split('/').at(-1);
  const rollout = await cloud(`${backendPath(t)}/rollouts/${id}`);
  if (build.state !== 'READY' || rollout.state !== 'SUCCEEDED') throw Error('Serving build/rollout is not READY/SUCCEEDED');
  return { sourceSha: exactSha(build.source?.codebase?.hash), rollout: id, state: rollout.state, percent: 100 };
}
