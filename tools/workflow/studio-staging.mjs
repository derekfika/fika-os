import { backendPath, cloud, command } from './runtime.mjs';
import { APPS, STUDIO_STAGING, target } from './policy.mjs';
import { releaseBackend, readStudioReleaseDomain } from './release-prestate.mjs';

export const studioStaging = Object.freeze({
  ...target('menu-studio', 'staging'),
  ...STUDIO_STAGING,
});

export function verifyStudioStagingOverlay(source) {
  const pins = {
    FIKA_RUNTIME_MODE: 'staging',
    FIREBASE_PROJECT_ID: STUDIO_STAGING.project,
    FIKA_HUB_BASE_URL: STUDIO_STAGING.hub,
    FIKA_STUDIO_ORIGIN: STUDIO_STAGING.origin,
    FIKA_STUDIO_FIRESTORE_DATABASE: STUDIO_STAGING.database,
    FIKA_SESSION_COOKIE_DOMAIN: '.fikacatering.com',
  };
  const expected = 'env:\n' + Object.entries(pins).map(([name, value]) =>
    `  - variable: ${name}\n    value: ${value}\n    availability: [RUNTIME]`).join('\n');
  if (source.replaceAll('\r\n', '\n').trim() !== expected) throw Error('Selected source does not declare the exact Studio staging overlay');
}

const base = backendPath(studioStaging);
const database = `projects/${studioStaging.project}/databases/${studioStaging.database}`;
const artifactRepository = STUDIO_STAGING.artifactRepository;

export const studioStagingBuildScope = Object.freeze({
  managedRole: 'roles/firebaseapphosting.computeRunner',
  managedRoleScope: `projects/${studioStaging.project}`,
  managedArtifactRepository: `projects/${studioStaging.project}/locations/${studioStaging.region}/repositories/${artifactRepository}`,
  accessBoundary: 'shared-staging-project',
  storageObjectAccess: 'staging-project',
  buildMetadataUpdates: 'staging-project',
});

const packagesPath = `${studioStagingBuildScope.managedArtifactRepository}/packages/`;

function describe(args) {
  return JSON.parse(command('gcloud', [
    ...args, '--project', studioStaging.project, '--format=json', '--quiet',
  ], { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }));
}

async function observe(check) {
  try { return await check() ? 'VERIFIED' : 'MISMATCH'; }
  catch (error) {
    const missing = error?.status === 404 ||
      /^ERROR: \(gcloud\.(?:iam\.service-accounts|firestore\.databases)\.describe\) NOT_FOUND:/m.test(String(error?.stderr || ''));
    return missing ? 'MISSING' : 'UNVERIFIED';
  }
}

function emptyTraffic(state) {
  return state === undefined || (state !== null && typeof state === 'object' && !Array.isArray(state) &&
    (state.splits === undefined || (Array.isArray(state.splits) && state.splits.length === 0)));
}

function emptyHistory(page, key) {
  if (!page || typeof page !== 'object' || Array.isArray(page) ||
      Object.keys(page).some(field => field !== key && field !== 'nextPageToken') ||
      (page[key] !== undefined && !Array.isArray(page[key])) ||
      (page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string')) {
    throw Error('App Hosting history could not be verified');
  }
  if (page[key]?.length) return false;
  if (page.nextPageToken) throw Error('App Hosting history page is incomplete');
  return true;
}

async function managedArtifactScope(describeResource) {
  try {
    const rows = await describeResource(['artifacts', 'packages', 'list',
      '--repository', artifactRepository, '--location', studioStaging.region, '--limit', '2']);
    if (!Array.isArray(rows) || rows.length > 2) return 'UNVERIFIED';
    const names = rows.map(row => typeof row?.name === 'string' && row.name.startsWith(packagesPath)
      ? row.name.slice(packagesPath.length) : row?.name);
    if (names.every(name => typeof name === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(name)) &&
        names.some(name => name !== studioStaging.backend)) return 'SHARED';
  } catch { /* An unavailable inventory cannot prove isolation. */ }
  // A package inventory only demonstrates sharing. Effective access needs separate evidence.
  return 'UNVERIFIED';
}

export async function studioStagingPreflight({ read = cloud, describeResource = describe } = {}) {
  let backendExists = false;
  const [appHosting, serviceAccount, firestore, artifactScope] = await Promise.all([
    observe(async () => {
      const backend = await read(base);
      if (backend?.name !== base) return false;
      backendExists = true;
      // Validate the release binding without losing separately observable traffic and domain evidence.
      try {
        await releaseBackend(studioStaging, async () => backend);
        return true;
      } catch { return false; }
    }),
    observe(async () => {
      const account = await describeResource(['iam', 'service-accounts', 'describe', studioStaging.serviceAccount]);
      return account.projectId === studioStaging.project && account.email === studioStaging.serviceAccount &&
        (account.disabled === undefined || account.disabled === false);
    }),
    observe(async () => {
      const store = await describeResource(['firestore', 'databases', 'describe', '--database', studioStaging.database]);
      return store.name === database && store.type === 'FIRESTORE_NATIVE' &&
        store.locationId === studioStaging.region && store.deleteProtectionState === 'DELETE_PROTECTION_ENABLED';
    }),
    managedArtifactScope(describeResource),
  ]);

  const [rolloutPolicy, customDomain, buildHistory] = backendExists ? await Promise.all([
    observe(async () => {
      const traffic = await read(`${base}/traffic`);
      return traffic.name === `${base}/traffic` && traffic.rolloutPolicy?.disabled === true &&
        traffic.rolloutPolicy.codebaseBranch === studioStaging.sourceBranch &&
        (traffic.reconciling === undefined || traffic.reconciling === false) &&
        emptyTraffic(traffic.current) && emptyTraffic(traffic.target);
    }),
    observe(async () => {
      try { return Boolean(await readStudioReleaseDomain(studioStaging, read)); }
      catch (error) {
        if (error.code === 'STUDIO_DOMAIN_MISMATCH') return false;
        throw error;
      }
    }),
    observe(async () => {
      const [builds, rollouts] = await Promise.all([read(`${base}/builds?pageSize=1`), read(`${base}/rollouts?pageSize=1`)]);
      const noBuilds = emptyHistory(builds, 'builds');
      const noRollouts = emptyHistory(rollouts, 'rollouts');
      return noBuilds && noRollouts;
    }),
  ]) : ['UNVERIFIED', 'UNVERIFIED', 'UNVERIFIED'];

  return {
    status: 'BLOCKED',
    target: { ...studioStaging, rootDirectory: APPS[studioStaging.app].path },
    checks: { appHosting, serviceAccount, firestore, rolloutPolicy, buildHistory, customDomain, managedArtifactRepository: artifactScope },
    buildScope: studioStagingBuildScope,
    pending: [
      'Studio-specific staging AUTHMOD registration, capabilities and exact return origin',
      'Effective IAM for named Studio Firestore access and denial of default Firestore, production resources, secrets and unrelated service accounts',
      'Owner approval and effective verification of Compute Runner access to shared staging images, Storage objects and build metadata',
      'Workspace and outbound side-effect isolation',
      'Owner approval of the exact merged first-release plan',
    ],
  };
}
