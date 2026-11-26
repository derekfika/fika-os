import { backendPath, cloud, command } from './runtime.mjs';
import { APPS, REPO, STUDIO_STAGING, digest, target } from './policy.mjs';
import { releaseBackend, readStudioReleaseDomain, verifyStudioTraffic } from './release-prestate.mjs';
import studioIam from './studio-staging-iam.json' with { type: 'json' };

export const studioStaging = Object.freeze({
  ...target('menu-studio', 'staging'),
  ...STUDIO_STAGING,
});

export function verifyStudioStagingOverlay(source) {
  const pins = {
    FIKA_DATA_SOURCE_TRACE: '"1"',
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
const projectResource = `projects/${studioStaging.project}`;
const repositoryResource = `${projectResource}/locations/${studioStaging.region}/repositories/${artifactRepository}`;

export const studioStagingBuildScope = Object.freeze({
  iamManifestSha256: digest(studioIam),
  managedRoleScope: projectResource,
  managedArtifactRepository: repositoryResource,
  accessBoundary: 'shared-staging-repository',
  storageGrant: 'none',
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
      /^ERROR: \(gcloud\.(?:iam\.service-accounts|iam\.roles|firestore\.databases)\.describe\) NOT_FOUND:/m.test(String(error?.stderr || ''));
    return missing ? 'MISSING' : 'UNVERIFIED';
  }
}

function matchesDirectStudioBindings(policy, resource) {
  if (typeof policy?.etag !== 'string' || !policy.etag ||
      (policy.bindings !== undefined && (!Array.isArray(policy.bindings) ||
        policy.bindings.some(binding => typeof binding?.role !== 'string' || !Array.isArray(binding.members))))) {
    throw Error('Could not verify the direct IAM policy');
  }
  const actual = (policy.bindings || []).filter(binding => binding.members?.includes(studioIam.principal));
  const expected = studioIam.bindings.filter(binding => binding.resource === resource);
  return actual.length === expected.length && expected.every(binding => actual.some(entry =>
    entry.role === binding.role && (binding.condition
      ? entry.condition?.title === binding.condition.title && entry.condition?.expression === binding.condition.expression
      : entry.condition == null)));
}

export function studioStagingIamStatus(describeResource = describe) {
  return observe(async () => {
    const [projectPolicy, repoPolicy] = await Promise.all([
      describeResource(['projects', 'get-iam-policy', studioStaging.project]),
      describeResource(['artifacts', 'repositories', 'get-iam-policy', artifactRepository, '--location', studioStaging.region]),
    ]);
    if (!matchesDirectStudioBindings(projectPolicy, projectResource) ||
        !matchesDirectStudioBindings(repoPolicy, repositoryResource)) return false;

    const roles = await Promise.all(studioIam.bindings.map(binding =>
      describeResource(['iam', 'roles', 'describe', binding.role.split('/').at(-1)])));
    return roles.every((role, index) => {
      const expected = studioIam.bindings[index];
      if (!Array.isArray(role?.includedPermissions) || role.includedPermissions.some(permission => typeof permission !== 'string')) {
        throw Error('Could not verify the IAM role definition');
      }
      return role.name === expected.role && !role.deleted && role.stage !== 'DISABLED' &&
        [...role.includedPermissions].sort().join('\n') === [...expected.permissions].sort().join('\n');
    });
  });
}

function history(page, key) {
  if (!page || typeof page !== 'object' || Array.isArray(page) ||
      Object.keys(page).some(field => field !== key && field !== 'nextPageToken') ||
      (page[key] !== undefined && !Array.isArray(page[key])) ||
      (page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string')) {
    throw Error('App Hosting history could not be verified');
  }
  if (page.nextPageToken) throw Error('App Hosting history page is incomplete');
  return page[key] || [];
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
  const [appHosting, serviceAccount, firestore, artifactScope, directStagingIam] = await Promise.all([
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
    studioStagingIamStatus(describeResource),
  ]);

  let firstRelease = false;
  let observedTraffic;
  const [rolloutPolicy, customDomain, buildHistory] = backendExists ? await Promise.all([
    observe(async () => {
      const traffic = await read(`${base}/traffic`);
      observedTraffic = traffic;
      if (traffic.name !== `${base}/traffic`) return false;
      try { verifyStudioTraffic(studioStaging, traffic); }
      catch { return false; }
      if (traffic.reconciling) return false;
      const current = traffic.current?.splits || [];
      const target = traffic.target?.splits || [];
      if (current.length === 0) return target.length === 0;
      if (current.length !== 1 || current[0].percent !== 100) return false;
      return target.length === 0 || (target.length === 1 && target[0].build === current[0].build && target[0].percent === 100);
    }),
    observe(async () => {
      try { return Boolean(await readStudioReleaseDomain(studioStaging, read)); }
      catch (error) {
        if (error.code === 'STUDIO_DOMAIN_MISMATCH') return false;
        throw error;
      }
    }),
    observe(async () => {
      const [buildPage, rolloutPage, traffic] = await Promise.all([
        read(`${base}/builds?pageSize=1`), read(`${base}/rollouts?pageSize=1`),
      ]);
      const builds = history(buildPage, 'builds'), rollouts = history(rolloutPage, 'rollouts');
      const current = observedTraffic?.current?.splits || [];
      if (current.length === 0) {
        firstRelease = builds.length === 0 && rollouts.length === 0 && !(buildPage.nextPageToken || rolloutPage.nextPageToken);
        return firstRelease;
      }
      if (builds.length !== 1 || rollouts.length !== 1 || current.length !== 1 || current[0].percent !== 100) return false;
      const build = builds[0], rollout = rollouts[0], sha = build.source?.codebase?.hash;
      return build.state === 'READY' && !build.reconciling && /^[a-f0-9]{40}$/.test(sha || '') &&
        build.source.codebase.commit === sha && build.source.codebase.uri === `https://github.com/${REPO}/commit/${sha}` &&
        rollout.state === 'SUCCEEDED' && !rollout.reconciling && rollout.build === build.name && current[0].build === build.name;
    }),
  ]) : ['UNVERIFIED', 'UNVERIFIED', 'UNVERIFIED'];

  return {
    status: 'BLOCKED',
    target: { ...studioStaging, rootDirectory: APPS[studioStaging.app].path },
    checks: { appHosting, serviceAccount, firestore, rolloutPolicy, buildHistory, customDomain, managedArtifactRepository: artifactScope, directStagingIam },
    buildScope: studioStagingBuildScope,
    pending: [
      'Studio-specific staging AUTHMOD registration, capabilities and exact return origin',
      'Effective IAM for named Studio Firestore access and denial of default Firestore, Cloud Storage, production resources, secrets and unrelated service accounts',
      'Owner approval of the exact IAM manifest and shared mutable tags, and effective verification of the approved build permissions',
      'Workspace and outbound side-effect isolation',
      ...(firstRelease ? ['Owner approval of the exact merged first-release plan'] : []),
    ],
  };
}
