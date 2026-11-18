import { APPS, REPO, STUDIO_STAGING, allowsEmptyFirstRelease } from './policy.mjs';
import { backendPath, serving } from './runtime.mjs';
import { recoverySnapshot } from './recovery.mjs';

const PROJECT_NUMBER = { 'fika-os': '397503564317', 'fika-os-dev': '594727519934' };

export function verifyStudioTraffic(t, traffic) {
  if (traffic.name !== `${backendPath(t)}/traffic` || traffic.rolloutPolicy?.codebaseBranch !== STUDIO_STAGING.sourceBranch ||
      traffic.rolloutPolicy?.disabled !== true) throw Error('Studio must use main with automatic rollouts disabled');
}

export async function readStudioReleaseDomain(t, read) {
  const resource = `${backendPath(t)}/domains/${new URL(STUDIO_STAGING.origin).hostname}`;
  const result = await read(resource);
  const status = result?.customDomainStatus;
  if (result?.name !== resource || status?.ownershipState !== 'OWNERSHIP_ACTIVE' ||
      status?.hostState !== 'HOST_ACTIVE' || status?.certState !== 'CERT_ACTIVE') {
    throw Object.assign(Error('Studio staging domain ownership, routing and certificate must be active on the selected backend'), { code: 'STUDIO_DOMAIN_MISMATCH' });
  }
  return { resource, ownershipState: status.ownershipState, hostState: status.hostState, certState: status.certState };
}

export async function releaseBackend(t, read) {
  const base = backendPath(t);
  const backend = await read(base);
  const expectedEnvironment = t.environment === 'prod' ? 'production' : 'staging';
  const expectedUri = `${t.backend}--${t.project}.${t.region}.hosted.app`;
  const root = APPS[t.app].path;
  const repository = String(backend.codebase?.repository || '');
  const connectionPrefix = `projects/${t.project}/locations/${t.region}/connections/`;
  const link = repository.startsWith(connectionPrefix) ? repository.slice(connectionPrefix.length).split('/') : [];
  if (backend.name !== base || backend.environment !== expectedEnvironment || backend.uri !== expectedUri ||
      ![root, `/${root}`].includes(backend.codebase?.rootDirectory) || link.length !== 3 || !link[0] ||
      link[1] !== 'gitRepositoryLinks' || link[2] !== 'derekfika-fika-os') throw Error('Firebase backend, project, source repository or app root differs from the selected target');
  if (backend.reconciling !== false) throw Error('Selected Firebase backend is still reconciling');
  if (t.app === 'menu-studio' && (!allowsEmptyFirstRelease(t) || backend.serviceAccount !== STUDIO_STAGING.serviceAccount ||
      (backend.overrideEnv !== undefined && (!Array.isArray(backend.overrideEnv) || backend.overrideEnv.length !== 0)))) {
    throw Error('Studio staging requires its dedicated App Hosting account and no environment overrides');
  }
  return backend;
}

export function verifiedReleaseServing(t, read) {
  return serving(t, read, { projectNumber: PROJECT_NUMBER[t.project], repository: REPO });
}

export async function releasePrestate(t, read) {
  const snapshot = await recoverySnapshot(t, t.app === 'menu-studio' ? async resource => {
    const response = await read(resource);
    if (resource === `${backendPath(t)}/traffic`) verifyStudioTraffic(t, response);
    return response;
  } : read, verifiedReleaseServing);
  const { traffic } = snapshot;
  const terminal = (items, states) => items.every(item => !item.reconciling && states.includes(item.state));
  const targetMatches = traffic.target.length === 0 ||
    (traffic.target.length === 1 && traffic.current.length === 1 &&
      traffic.target[0].build === traffic.current[0].build && traffic.target[0].percent === 100);
  if (snapshot.backend.name !== backendPath(t) || snapshot.backend.reconciling ||
      !traffic.autoDisabled || traffic.reconciling || !targetMatches || snapshot.operations.length ||
      !terminal(snapshot.builds, ['READY', 'FAILED', 'DELETED', 'CANCELLED', 'SKIPPED']) ||
      !terminal(snapshot.rollouts, ['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'])) {
    throw Error('Selected Firebase target has an active or unknown rollout, build, operation or traffic state');
  }
  const current = snapshot.current;
  if (current.sourceSha) {
    const rollout = snapshot.rollouts.find(item => item.name === `${t.backend}/rollouts/${current.rollout}`);
    const build = snapshot.builds.find(item => item.name === rollout?.build);
    if (rollout?.state !== 'SUCCEEDED' || build?.state !== 'READY' || build.sourceSha !== current.sourceSha ||
        traffic.current.length !== 1 || traffic.current[0].build !== build.name || traffic.current[0].percent !== 100) {
      throw Error('Firebase serving state changed during release preflight');
    }
  }
  return current;
}
