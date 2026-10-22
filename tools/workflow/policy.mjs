import { createHash } from 'node:crypto';

export const APPS = {
  hub: { path: 'apps/integration-hub', staging: 'fika-os-staging', prod: 'fika-os-prod-hub' },
  hospitality: { path: 'apps/hospitality-booking', staging: 'fika-hospitality-staging', prod: 'fika-os-prod-hospitality' },
  menu: { path: 'apps/menu-planning', staging: 'fika-menu-planning-staging', prod: 'fika-os-prod-menu' },
  cpu: { path: 'apps/cpu-production', staging: 'fika-cpu-production-staging', prod: 'fika-os-prod-cpu' },
  'delivered-in': { path: 'apps/delivered-in', staging: 'fika-delivered-in-staging', prod: 'fika-os-prod-deliveredin' },
  logistics: { path: 'apps/logistics', staging: 'fika-logistics-staging', prod: 'fika-os-prod-logistics' },
};
export const REPO = 'derekfika/fika-os';
export const MAIN_CHECK = 'Workflow / merge-gate';
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function target(app, environment) {
  if (!Object.hasOwn(APPS, app) || !['staging', 'prod'].includes(environment)) throw Error('Unknown application/environment');
  return { app, environment, project: environment === 'prod' ? 'fika-os' : 'fika-os-dev', backend: APPS[app][environment], region: 'europe-west4', branch: `release/${environment}/${app}` };
}
export function exactSha(value) { if (!/^[a-f0-9]{40}$/.test(value || '')) throw Error('A full lowercase 40-character source SHA is required'); return value; }
export function affected(paths, { rootRuntimeChanged = true } = {}) {
  const apps = new Set(); let shared = false; let tooling = false;
  for (const name of paths) {
    if (/^(packages\/|apps\/shared\/)/.test(name) || /^(package-lock\.json|firebase\.json|\.firebaserc)$/.test(name) || (name === 'package.json' && rootRuntimeChanged)) shared = true;
    if (/^(tools\/workflow\/|\.github\/|AGENTS\.md|docs\/deployment\/workflow)/.test(name)) tooling = true;
    for (const [app, info] of Object.entries(APPS)) if (name.startsWith(`${info.path}/`) && !/\/(docs\/|[^/]+\.md$)/.test(name)) apps.add(app);
  }
  if (shared) Object.keys(APPS).forEach(app => apps.add(app));
  return { apps: [...apps].sort(), shared, tooling };
}
export function risk(paths) {
  // Only explicitly cosmetic paths qualify. JSX, scripts, routes, configs and contracts default to Standard.
  return paths.every(p => p === 'CHANGELOG.md' || /\.md$/.test(p) || /^apps\/[^/]+\/.*\.(css|png|svg|jpg|webp)$/.test(p)) ? 'fast' : 'standard';
}
export function assertClean(status) { if (status.trim()) throw Error('Dirty workspace: commit/preserve changes before validation or deployment'); }
export function validateRecord(record, { app, environment } = {}) {
  if (record?.schema !== 'fika.release.v1' || !Object.hasOwn(APPS, record.app) || !['staging', 'prod'].includes(record.environment)) throw Error('Invalid release record');
  exactSha(record.sourceSha);
  const expected = target(record.app, record.environment);
  if (record.project !== expected.project || record.backend !== expected.backend || (app && record.app !== app) || (environment && record.environment !== environment)) throw Error('Release target mismatch');
  if (!['baseline', 'deploy', 'rollback'].includes(record.kind)) throw Error('Invalid release kind');
  if (!record.rollout || record.state !== 'SUCCEEDED' || record.percent !== 100 || !record.scopeHash) throw Error('Release is not verified serving state');
  return record;
}
export function approvalText({ app, environment, sha, lane, expires }) { return `/fika-approve ${app} ${environment} ${exactSha(sha)} ${lane} ${expires}`; }
export function validateApproval(comment, repository, request, now = Date.now()) {
  const expected = approvalText(request);
  if (comment.user?.login !== repository.owner.login || comment.user?.type !== 'User' || comment.body?.trim() !== expected) throw Error('Explicit repository-owner approval does not match app/environment/SHA/lane');
  if (!['fast', 'standard', 'owner-exception'].includes(request.lane)) throw Error('Invalid approval lane');
  const expiry = Date.parse(request.expires);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > Date.parse(comment.created_at) + 7 * 86400000) throw Error('Approval expired or exceeds seven-day lifetime');
  return { url: comment.html_url, id: comment.id, owner: comment.user.login, expires: request.expires, lane: request.lane };
}
export function partialPathOverlap(a, b) { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
export function assertResume(intent, journal, plan) {
  if (!journal || intent?.schema !== 'fika.release.v1' || intent.kind !== 'intent' || intent.state !== 'PENDING' || intent.releaseId !== journal.releaseId) throw Error('Missing/wrong release journal or intent');
  for (const key of ['app','environment','project','backend','sourceSha','scopeHash']) if (intent[key] !== plan[key] || journal.plan[key] !== plan[key]) throw Error(`Resume ${key} differs from original intent`);
  if (intent.approval?.id !== plan.approval?.id || digest(intent.previousGood) !== digest(journal.before)) throw Error('Resume approval/rollback baseline differs from original intent');
}
export function assertServingLineage(plan, current, containsCurrent, sameTree) {
  if (plan.environment === 'prod' && !plan.rollback && !containsCurrent && !sameTree) throw Error('Candidate omits the currently deployed production lineage. Reconcile its approved changes into main first; only explicit verified rollback may go backwards.');
}
export function safeScope(scope) {
  if (!scope || scope.includes('..') || scope.includes('\\') || scope.startsWith('/') || scope.includes(':') || !/^[a-zA-Z0-9._/-]+$/.test(scope)) throw Error('Invalid workspace scope');
  return scope.replace(/\/$/, '');
}
