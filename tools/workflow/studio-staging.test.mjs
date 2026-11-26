import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { supportedTargets, target, validateRecord } from './policy.mjs';
import { inspectEmptyFirstReleaseState, emptyFirstReleaseBaselineRecord, releaseHealthProbe } from './releases.mjs';
import { readStudioReleaseDomain } from './release-prestate.mjs';
import { backendPath } from './runtime.mjs';
import { studioStaging, studioStagingIamStatus, studioStagingPreflight, verifyStudioStagingOverlay } from './studio-staging.mjs';
import studioIam from './studio-staging-iam.json' with { type: 'json' };

const backend = backendPath(studioStaging);
const traffic = `${backend}/traffic`;
const domain = `${backend}/domains/menu-studio-staging.fikacatering.com`;
const builds = `${backend}/builds?pageSize=1`;
const rollouts = `${backend}/rollouts?pageSize=1`;
const servingBuild = `${backend}/builds/build-2026-11-25-002`;
const servingRollout = `${backend}/rollouts/rollout-2026-11-25-002`;
const toolAccount = ['iam', 'service-accounts', 'describe', studioStaging.serviceAccount];
const toolDatabase = ['firestore', 'databases', 'describe', '--database', 'hospitality-menu-studio'];
const toolArtifacts = ['artifacts', 'packages', 'list', '--repository', 'firebaseapphosting-images', '--location', 'europe-west4', '--limit', '2'];
const toolProjectPolicy = ['projects', 'get-iam-policy', 'fika-os-dev'];
const toolRepoPolicy = ['artifacts', 'repositories', 'get-iam-policy', 'firebaseapphosting-images', '--location', 'europe-west4'];
const toolRoles = studioIam.bindings.map(binding => ['iam', 'roles', 'describe', binding.role.split('/').at(-1)]);

function evidence() {
  const resources = {
    [backend]: {
      name: backend,
      environment: 'staging',
      uri: 'fika-menu-studio-staging--fika-os-dev.europe-west4.hosted.app',
      serviceAccount: studioStaging.serviceAccount,
      reconciling: false,
      codebase: {
        rootDirectory: '/apps/hospitality-menu-studio',
        repository: 'projects/fika-os-dev/locations/europe-west4/connections/apphosting-test/gitRepositoryLinks/derekfika-fika-os',
      },
    },
    [traffic]: { name: traffic, rolloutPolicy: { disabled: true, codebaseBranch: 'main' },
      current: { splits: [{ build: servingBuild, percent: 100 }] }, target: { splits: [] } },
    [domain]: { name: domain, customDomainStatus: {
      ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', certState: 'CERT_ACTIVE',
    } },
    [builds]: { builds: [{ name: servingBuild, state: 'READY', source: { codebase: {
      hash: 'a'.repeat(40), commit: 'a'.repeat(40), uri: `https://github.com/${'derekfika/fika-os'}/commit/${'a'.repeat(40)}`,
    } } }] },
    [rollouts]: { rollouts: [{ name: servingRollout, state: 'SUCCEEDED', build: servingBuild }] },
  };
  const account = { projectId: studioStaging.project, email: studioStaging.serviceAccount };
  const database = { name: 'projects/fika-os-dev/databases/hospitality-menu-studio', type: 'FIRESTORE_NATIVE',
    locationId: studioStaging.region, deleteProtectionState: 'DELETE_PROTECTION_ENABLED' };
  const packages = [{ name: studioStaging.backend }];
  const bindings = resource => studioIam.bindings.filter(binding => binding.resource === resource).map(binding => ({
    role: binding.role, members: [studioIam.principal], ...(binding.condition ? { condition: { ...binding.condition } } : {}),
  }));
  const projectPolicy = { etag: 'example-project-policy', bindings: bindings('projects/fika-os-dev') };
  const repoPolicy = { etag: 'example-repository-policy', bindings: bindings('projects/fika-os-dev/locations/europe-west4/repositories/firebaseapphosting-images') };
  const roles = studioIam.bindings.map(binding => ({ name: binding.role, stage: 'GA', includedPermissions: [...binding.permissions] }));
  const cloudReads = [];
  const descriptions = [];
  const read = async resource => {
    cloudReads.push(resource);
    assert.ok(Object.hasOwn(resources, resource));
    return resources[resource];
  };
  const describeResource = async args => {
    descriptions.push(args);
    if (args[0] === 'projects') {
      assert.deepEqual(args, toolProjectPolicy);
      return projectPolicy;
    }
    if (args[1] === 'repositories') {
      assert.deepEqual(args, toolRepoPolicy);
      return repoPolicy;
    }
    if (args[1] === 'roles') {
      const index = toolRoles.findIndex(command => command[3] === args[3]);
      assert.deepEqual(args, toolRoles[index]);
      return roles[index];
    }
    if (args[0] === 'iam') {
      assert.deepEqual(args, toolAccount);
      return account;
    }
    if (args[0] === 'artifacts') {
      assert.deepEqual(args, toolArtifacts);
      return packages;
    }
    assert.deepEqual(args, toolDatabase);
    return database;
  };
  return { resources, account, database, packages, projectPolicy, repoPolicy, roles, read, describeResource, cloudReads, descriptions };
}

test('Studio maps to exactly one governed backend in the existing staging project', () => {
  assert.equal(backend, 'projects/fika-os-dev/locations/europe-west4/backends/fika-menu-studio-staging');
  assert.deepEqual(supportedTargets().filter(item => item.app === 'menu-studio' || item.backend === studioStaging.backend),
    [target('menu-studio', 'staging')]);
  assert.throws(() => target('menu-studio', 'prod'), /Unknown application\/environment/);
});

test('the preflight rejects execution, production and configurable targets before inspecting cloud', () => {
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  for (const args of [['--prod'], ['--staging', '--execute'], ['other-app', '--staging'], []]) {
    const result = spawnSync(process.execPath, [cli, 'studio-preflight', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Use only fika studio-preflight --staging/);
    assert.equal(result.stdout, '');
  }
});

test('App Hosting defaults to closed with only the pinned Studio staging overlay', () => {
  const folder = new URL('../../apps/hospitality-menu-studio/', import.meta.url);
  assert.deepEqual(readdirSync(folder).filter(name => /^apphosting.*\.ya?ml$/i.test(name)).sort(), ['apphosting.staging.yaml', 'apphosting.yaml']);
  const config = readFileSync(new URL('apphosting.yaml', folder), 'utf8').replace(/^#.*\r?\n/gm, '').replaceAll('\r\n', '\n').trim();
  assert.equal(config, 'env:\n  - variable: FIKA_RUNTIME_MODE\n    value: unconfigured\n    availability: [RUNTIME]');
  const staging = readFileSync(new URL('apphosting.staging.yaml', folder), 'utf8').replaceAll('\r\n', '\n').trim();
  const bindings = {
    FIKA_DATA_SOURCE_TRACE: '"1"',
    FIKA_RUNTIME_MODE: 'staging',
    FIREBASE_PROJECT_ID: studioStaging.project,
    FIKA_HUB_BASE_URL: 'https://staging-os.fikacatering.com',
    FIKA_STUDIO_ORIGIN: studioStaging.origin,
    FIKA_STUDIO_FIRESTORE_DATABASE: studioStaging.database,
    FIKA_SESSION_COOKIE_DOMAIN: '.fikacatering.com',
  };
  assert.equal(staging, 'env:\n' + Object.entries(bindings).map(([key, value]) =>
    `  - variable: ${key}\n    value: ${value}\n    availability: [RUNTIME]`).join('\n'));
  assert.doesNotThrow(() => verifyStudioStagingOverlay(staging));
  assert.throws(() => verifyStudioStagingOverlay(staging.replace(studioStaging.project, 'another-staging-project')), /exact Studio staging overlay/);
  assert.throws(() => verifyStudioStagingOverlay(staging.replace('value: "1"', 'value: "0"')), /exact Studio staging overlay/);
  const rules = JSON.parse(readFileSync(new URL('firebase.staging.json', folder), 'utf8'));
  assert.deepEqual(rules, { firestore: [{ database: studioStaging.database, rules: 'firestore.rules' }] });
  assert.match(readFileSync(new URL('firestore.rules', folder), 'utf8'), /allow read, write: if false;/);
});

test('existing successful Studio backend follows subsequent-release preflight without empty-state requirements', async () => {
  const fixture = evidence();
  const result = await studioStagingPreflight(fixture);
  assert.deepEqual(fixture.cloudReads, [backend, traffic, domain, builds, rollouts]);
  assert.deepEqual(fixture.descriptions, [toolAccount, toolDatabase, toolArtifacts, toolProjectPolicy, toolRepoPolicy, ...toolRoles]);
  assert.equal(result.target.rootDirectory, 'apps/hospitality-menu-studio');
  assert.equal(result.target.sourceBranch, 'main');
  assert.deepEqual(result.checks, {
    appHosting: 'VERIFIED', serviceAccount: 'VERIFIED', firestore: 'VERIFIED', rolloutPolicy: 'VERIFIED',
    buildHistory: 'VERIFIED', customDomain: 'VERIFIED', managedArtifactRepository: 'UNVERIFIED', directStagingIam: 'VERIFIED',
  });
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.buildScope, {
    iamManifestSha256: 'e86965af555ad12e38700da499a68583dab8fbbc1f6e2156ae03f1a3344f1d55',
    managedRoleScope: 'projects/fika-os-dev',
    managedArtifactRepository: 'projects/fika-os-dev/locations/europe-west4/repositories/firebaseapphosting-images',
    accessBoundary: 'shared-staging-repository',
    storageGrant: 'none',
    buildMetadataUpdates: 'staging-project',
  });
  assert.match(result.pending.join(' '), /AUTHMOD.*IAM.*default Firestore, Cloud Storage, production resources.*mutable tags/);
  assert.doesNotMatch(result.pending.join(' '), /first-release plan/);
});

test('mismatched identity, active traffic, overrides and unfinished domain certificate block the preflight', async () => {
  const fixture = evidence();
  fixture.resources[backend].serviceAccount = 'shared-runtime@fika-os-dev.iam.gserviceaccount.com';
  fixture.resources[traffic].current.splits = [{ build: 'unexpected', percent: 100 }];
  fixture.resources[domain].customDomainStatus.certState = 'CERT_PREPARING';
  fixture.account.disabled = true;
  fixture.database.name = 'projects/fika-os-dev/databases/(default)';
  fixture.resources[builds] = { builds: [{ name: 'existing-build' }] };
  fixture.packages.push({ name: 'fika-other-staging' });
  fixture.projectPolicy.bindings.push({ role: 'roles/firebaseapphosting.computeRunner', members: [studioIam.principal] });
  const result = await studioStagingPreflight(fixture);
  assert.equal(result.status, 'BLOCKED');
  const { managedArtifactRepository, ...otherChecks } = result.checks;
  assert.equal(managedArtifactRepository, 'SHARED');
  assert.equal(otherChecks.rolloutPolicy, 'VERIFIED');
  assert.equal(otherChecks.buildHistory, 'MISMATCH');
  assert.ok(Object.entries(otherChecks).filter(([name]) => !['rolloutPolicy', 'buildHistory'].includes(name))
    .every(([, value]) => value === 'MISMATCH'));

  const overrides = evidence();
  overrides.resources[backend].overrideEnv = [{ variable: 'EXTERNAL_SECRET', secret: 'untrusted-reference' }];
  const resultWithOverride = await studioStagingPreflight(overrides);
  assert.equal(resultWithOverride.checks.appHosting, 'MISMATCH');
  assert.doesNotMatch(JSON.stringify(resultWithOverride), /untrusted-reference|EXTERNAL_SECRET/);
});

test('foreign backend skips associated reads and errors yield missing or unverified evidence', async () => {
  const fixture = evidence();
  fixture.resources[backend].name = 'projects/fika-os/locations/europe-west4/backends/unrelated';
  const foreign = await studioStagingPreflight(fixture);
  assert.deepEqual(fixture.cloudReads, [backend]);
  assert.equal(foreign.checks.appHosting, 'MISMATCH');

  const missing = await studioStagingPreflight({
    read: async resource => {
      assert.equal(resource, backend);
      throw Object.assign(Error('No backend found'), { status: 404 });
    },
    describeResource: async () => { throw Error('Unconfirmed cloud exception or permission denied'); },
  });
  assert.deepEqual(missing.checks, {
    appHosting: 'MISSING', serviceAccount: 'UNVERIFIED', firestore: 'UNVERIFIED', rolloutPolicy: 'UNVERIFIED',
    buildHistory: 'UNVERIFIED', customDomain: 'UNVERIFIED', managedArtifactRepository: 'UNVERIFIED', directStagingIam: 'UNVERIFIED',
  });
  assert.equal(missing.status, 'BLOCKED');
});

test('a partially provisioned target reports its independent evidence and wrong branch', async () => {
  const fixture = evidence();
  delete fixture.resources[backend].environment;
  fixture.resources[backend].serviceAccount = 'default-compute@fika-os-dev.iam.gserviceaccount.com';
  const describeResource = async args => {
    if (args[0] === 'artifacts' || args[0] === 'projects' || args[1] === 'roles') return fixture.describeResource(args);
    const operation = args[0] === 'iam' ? 'iam.service-accounts' : 'firestore.databases';
    throw Object.assign(Error('describe failed'), { stderr: `ERROR: (gcloud.${operation}.describe) NOT_FOUND: Fixture` });
  };
  const result = await studioStagingPreflight({ ...fixture, describeResource });
  assert.deepEqual(fixture.cloudReads, [backend, traffic, domain, builds, rollouts]);
  assert.deepEqual(result.checks, {
    appHosting: 'MISMATCH', serviceAccount: 'MISSING', firestore: 'MISSING', rolloutPolicy: 'VERIFIED',
    buildHistory: 'VERIFIED', customDomain: 'VERIFIED', managedArtifactRepository: 'UNVERIFIED', directStagingIam: 'VERIFIED',
  });
  fixture.resources[traffic].rolloutPolicy.codebaseBranch = 'other-branch';
  assert.equal((await studioStagingPreflight({ ...fixture, describeResource })).checks.rolloutPolicy, 'MISMATCH');
});

test('direct Studio IAM holds on missing, broader or wrongly scoped access and retains unknown reads', async () => {
  const baseline = evidence();
  baseline.projectPolicy.bindings = [];
  assert.equal(await studioStagingIamStatus(baseline.describeResource), 'MISMATCH');

  const actorGrant = evidence();
  actorGrant.projectPolicy.bindings[1].condition.expression = 'resource.name == "projects/fika-os-dev/databases/(default)"';
  assert.equal(await studioStagingIamStatus(actorGrant.describeResource), 'MISMATCH');

  const broadRole = evidence();
  broadRole.roles[0].includedPermissions.push('storage.objects.get');
  assert.equal(await studioStagingIamStatus(broadRole.describeResource), 'MISMATCH');

  const broadRepo = evidence();
  broadRepo.roles[1].includedPermissions.push('artifactregistry.tags.update');
  assert.equal(await studioStagingIamStatus(broadRepo.describeResource), 'MISMATCH');

  const unverified = evidence();
  delete unverified.repoPolicy.etag;
  assert.equal(await studioStagingIamStatus(unverified.describeResource), 'UNVERIFIED');
});

test('a genuinely empty first release needs complete history pages and retains its approval gate', async () => {
  const fixture = evidence();
  fixture.resources[traffic].current.splits = [];
  fixture.resources[builds] = {};
  fixture.resources[rollouts] = { rollouts: [] };
  fixture.resources[rollouts] = { rollouts: [], nextPageToken: 'opaque' };
  const partial = await studioStagingPreflight(fixture);
  assert.equal(partial.checks.buildHistory, 'UNVERIFIED');
  assert.equal(partial.checks.rolloutPolicy, 'VERIFIED');
  fixture.resources[rollouts] = { rollouts: null };
  assert.equal((await studioStagingPreflight(fixture)).checks.buildHistory, 'UNVERIFIED');
  fixture.resources[rollouts] = { rollouts: [{}], nextPageToken: 'opaque' };
  assert.equal((await studioStagingPreflight(fixture)).checks.buildHistory, 'UNVERIFIED');
});

test('the artifact probe detects a foreign package without returning names or certifying an empty inventory', async () => {
  const fixture = evidence();
  fixture.packages.length = 0;
  assert.equal((await studioStagingPreflight(fixture)).checks.managedArtifactRepository, 'UNVERIFIED');
  fixture.packages.push({ name: 'projects/fika-os-dev/locations/europe-west4/repositories/firebaseapphosting-images/packages/sensitive-unrelated' });
  const result = await studioStagingPreflight(fixture);
  assert.equal(result.checks.managedArtifactRepository, 'SHARED');
  assert.doesNotMatch(JSON.stringify(result), /sensitive-unrelated/);
  fixture.packages[0].name = 'projects/another-project/locations/europe-west4/repositories/firebaseapphosting-images/packages/sensitive-unrelated';
  assert.equal((await studioStagingPreflight(fixture)).checks.managedArtifactRepository, 'UNVERIFIED');
});

test('first Studio release requires the exact integrated backend, main branch and active custom domain', async () => {
  const t = target('menu-studio', 'staging');
  const fixture = evidence();
  fixture.resources[traffic].current.splits = [];
  const read = async resource => resource.endsWith('?pageSize=100') ? {} : fixture.read(resource);
  const before = await inspectEmptyFirstReleaseState(t, read);
  assert.equal(before.state, 'EMPTY');
  assert.equal(validateRecord(emptyFirstReleaseBaselineRecord(t, before), t).project, t.project);
  await assert.rejects(inspectEmptyFirstReleaseState({ ...t, project: 'fika-os' }, read), /does not support/);
  assert.equal((await readStudioReleaseDomain(t, read)).resource, domain);
  fixture.resources[domain].customDomainStatus.certState = 'CERT_PREPARING';
  await assert.rejects(readStudioReleaseDomain(t, read), /certificate must be active/);
  fixture.resources[traffic].rolloutPolicy.codebaseBranch = 'other-branch';
  await assert.rejects(inspectEmptyFirstReleaseState(t, read), /must use main/);
});

test('Studio serving verification binds the custom-domain SHA and rejects an open unauthenticated API', async () => {
  const sha = 'a'.repeat(40);
  const provider = evidence().resources[backend].uri;
  const makeFetch = (status = 401, buildSha = sha) => async (url, options) => {
    assert.equal(new URL(url).origin, studioStaging.origin);
    assert.equal(options.redirect, 'manual');
    if (url.endsWith('/api/build-info')) return Response.json({ appId: 'hospitality-menu-studio', buildSha });
    return Response.json({ code: 'FIKA_SESSION_MISSING' }, { status });
  };
  assert.equal((await releaseHealthProbe('menu-studio', provider, sha, makeFetch(), 'staging')).ok, true);
  assert.equal((await releaseHealthProbe('menu-studio', provider, sha, makeFetch(200), 'staging')).ok, false);
  assert.equal((await releaseHealthProbe('menu-studio', provider, sha, makeFetch(401, 'b'.repeat(40)), 'staging')).ok, false);
  assert.equal((await releaseHealthProbe('menu-studio', provider.replace('fika-os-dev', 'fika-os'), sha,
    () => assert.fail('foreign backend must not get a probe'), 'staging')).ok, false);
});
