import { createHash } from 'node:crypto';

export const APPS = {
  hub: { path: 'apps/integration-hub', staging: 'fika-os-staging', prod: 'fika-os-prod-hub' },
  hospitality: { path: 'apps/hospitality-booking', staging: 'fika-hospitality-staging', prod: 'fika-os-prod-hospitality' },
  menu: { path: 'apps/menu-planning', staging: 'fika-menu-planning-staging', prod: 'fika-os-prod-menu' },
  cpu: { path: 'apps/cpu-production', staging: 'fika-cpu-production-staging', prod: 'fika-os-prod-cpu' },
  'delivered-in': { path: 'apps/delivered-in', staging: 'fika-delivered-in-staging', prod: 'fika-os-prod-deliveredin' },
  logistics: { path: 'apps/logistics', staging: 'fika-logistics-staging', prod: 'fika-os-prod-logistics' },
  adhoc: { path: 'apps/ad-hoc-production', staging: 'fika-os-staging-adhoc', prod: 'fika-os-prod-adhoc' },
  // Restricted no-write Beverage preview. There is deliberately no production target.
  beverage: { path: 'apps/beverage-innovation', staging: 'fika-beverage-staging', prod: null },
};
export const REPO = 'derekfika/fika-os';
export const MAIN_CHECK = 'Workflow / merge-gate';
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function supportedEnvironments(app) {
  if (!Object.hasOwn(APPS, app)) throw Error('Unknown application');
  return ['staging', 'prod'].filter(environment => typeof APPS[app][environment] === 'string' && APPS[app][environment].length > 0);
}
export function supportedTargets(apps = Object.keys(APPS)) {
  return apps.flatMap(app => supportedEnvironments(app).map(environment => target(app, environment)));
}
export function target(app, environment) {
  if (!Object.hasOwn(APPS, app) || !supportedEnvironments(app).includes(environment)) throw Error('Unknown application/environment');
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
  // Advisory workspace risk only. JSX, scripts, routes, configs and contracts default to standard.
  return paths.every(p => p === 'CHANGELOG.md' || /\.md$/.test(p) || /^apps\/[^/]+\/.*\.(css|png|svg|jpg|webp)$/.test(p)) ? 'fast' : 'standard';
}
export function assertClean(status) { if (status.trim()) throw Error('Dirty workspace: commit/preserve changes before validation or deployment'); }
export function validateRecord(record, { app, environment } = {}) {
  if (record?.schema !== 'fika.release.v1' || !Object.hasOwn(APPS, record.app) || !['staging', 'prod'].includes(record.environment)) throw Error('Invalid release record');
  const expected = target(record.app, record.environment);
  const firstReleaseBackend = record.kind === 'empty-baseline' && ((record.app === 'adhoc' && record.environment === 'prod') || (record.app === 'beverage' && record.environment === 'staging'))
    ? [expected.backend, `projects/${expected.project}/locations/${expected.region}/backends/${expected.backend}`].includes(record.backend)
    : record.backend === expected.backend;
  if (record.project !== expected.project || !firstReleaseBackend || (app && record.app !== app) || (environment && record.environment !== environment)) throw Error('Release target mismatch');
  if (record.kind === 'empty-baseline') {
    const allowedFirstRelease = (record.app === 'adhoc' && record.environment === 'prod') || (record.app === 'beverage' && record.environment === 'staging');
    if (!allowedFirstRelease || record.sourceSha != null || record.rollout != null || record.state !== 'EMPTY' || record.percent !== 0 || !record.scopeHash || record.recovery?.firstRelease !== true || record.recovery?.noPreviousRelease !== true) throw Error('Invalid first-release empty baseline');
    return record;
  }
  exactSha(record.sourceSha);
  if (record.kind === 'abandoned') {
    const recovery = record.recovery;
    if (recovery?.resolution !== 'abandon' || !recovery.reason?.trim() || recovery.reason.length > 500 ||
        !/^[a-f0-9]{40}$/.test(recovery.operator?.sourceSha || '') || !/^[a-f0-9]{64}$/.test(recovery.evidenceHash || '') ||
        !/^[a-f0-9]{64}$/.test(recovery.journalHash || '') || !Number.isFinite(Date.parse(recovery.at)) ||
        !/^[a-f0-9]{40}$/.test(record.originalIntent || '') || !record.scopeHash || !record.smoke || typeof record.smoke.ok !== 'boolean' ||
        recovery.rollout !== (record.rollout || null)) throw Error('Invalid abandoned release evidence');
    if (record.state === 'SUCCEEDED') {
      if (!record.rollout || record.percent !== 100) throw Error('Abandoned release does not identify its stable serving attempt');
    } else if (record.state === 'FAILED') {
      if (record.percent !== 0 || (record.rollout != null && !/^[a-z][a-z0-9-]{2,100}$/.test(record.rollout))) throw Error('Abandoned release does not identify its failed attempt');
    } else throw Error('Abandoned release has an unsupported terminal state');
    if (recovery.firstRelease === true) {
      const allowedFirstRelease = (record.app === 'adhoc' && record.environment === 'prod') || (record.app === 'beverage' && record.environment === 'staging');
      if (!allowedFirstRelease || recovery.noPreviousRelease !== true || record.previousGood != null || record.previousGoodRecord != null ||
          !/^[a-f0-9]{40}$/.test(record.firstReleaseBaselineRecord || '') || recovery.operator.sourceSha !== record.sourceSha || record.smoke.ok !== false) throw Error('Invalid abandoned Ad-Hoc first-release evidence');
    } else {
      const previous = record.previousGood;
      if (!previous || !/^[a-f0-9]{40}$/.test(record.previousGoodRecord || '') || !/^[a-f0-9]{40}$/.test(previous.sourceSha || '') ||
          !previous.rollout || previous.state !== 'SUCCEEDED' || previous.percent !== 100 ||
          (record.sourceSha !== previous.sourceSha && (record.sourceSha !== recovery.operator.sourceSha || record.smoke.ok !== false))) throw Error('Abandoned release has no valid previous-good lineage');
    }
    return record;
  }
  if (!['baseline', 'deploy', 'rollback'].includes(record.kind)) throw Error('Invalid release kind');
  if (!record.rollout || record.state !== 'SUCCEEDED' || record.percent !== 100 || !record.scopeHash) throw Error('Release is not verified serving state');
  return record;
}
export function partialPathOverlap(a, b) { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
export function assertResume(intent, journal, plan) {
  if (!journal || intent?.schema !== 'fika.release.v1' || intent.kind !== 'intent' || intent.state !== 'PENDING' || intent.releaseId !== journal.releaseId) throw Error('Missing/wrong release journal or intent');
  const expected = target(intent.app, intent.environment);
  for (const key of ['project','backend','region','branch']) if (intent[key] !== expected[key]) throw Error('Intent target differs from governed mapping');
  for (const key of ['app','environment','project','backend','sourceSha','scopeHash']) if (intent[key] !== plan[key] || journal.plan[key] !== plan[key]) throw Error(`Resume ${key} differs from original intent`);
  if (Boolean(intent.rollback) !== Boolean(plan.rollback) || Boolean(journal.plan.rollback) !== Boolean(plan.rollback)) throw Error('Resume action differs from original intent');
  if (intent.approval?.id !== plan.approval?.id || digest(intent.previousGood) !== digest(journal.before) || intent.previousGoodRecord !== journal.previousGoodRecord) throw Error('Resume approval/rollback baseline differs from original intent');
}
export function assertServingLineage(plan, current, containsCurrent, sameTree) {
  if (plan.environment === 'prod' && !plan.rollback && !containsCurrent && !sameTree) throw Error('Candidate omits the currently deployed production lineage. Integrate the deployed changes into main or use an explicit verified rollback.');
}
export function safeScope(scope) {
  if (!scope || scope.includes('..') || scope.includes('\\') || scope.startsWith('/') || scope.includes(':') || !/^[a-zA-Z0-9._/-]+$/.test(scope)) throw Error('Invalid workspace scope');
  return scope.replace(/\/$/, '');
}
