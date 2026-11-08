import { APPS, REPO } from './policy.mjs';
import { backendPath, serving } from './runtime.mjs';
import { recoverySnapshot } from './recovery.mjs';

const PROJECT_NUMBER = { 'fika-os': '397503564317', 'fika-os-dev': '594727519934' };

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
  return backend;
}

export function verifiedReleaseServing(t, read) {
  return serving(t, read, { projectNumber: PROJECT_NUMBER[t.project], repository: REPO });
}

export async function releasePrestate(t, read) {
  const snapshot = await recoverySnapshot(t, read, verifiedReleaseServing);
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
