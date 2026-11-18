import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { supportedTargets, target } from './policy.mjs';
import { backendPath } from './runtime.mjs';
import { studioStaging, studioStagingPreflight } from './studio-staging.mjs';

const backend = backendPath(studioStaging);
const traffic = `${backend}/traffic`;
const domain = `${backend}/domains/menu-studio-staging.fikacatering.com`;
const builds = `${backend}/builds?pageSize=1`;
const rollouts = `${backend}/rollouts?pageSize=1`;
const toolAccount = ['iam', 'service-accounts', 'describe', studioStaging.serviceAccount];
const toolDatabase = ['firestore', 'databases', 'describe', '--database', 'hospitality-menu-studio'];
const toolArtifacts = ['artifacts', 'packages', 'list', '--repository', 'firebaseapphosting-images', '--location', 'europe-west4', '--limit', '2'];

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
    [traffic]: { name: traffic, rolloutPolicy: { disabled: true, codebaseBranch: 'main' }, current: { splits: [] } },
    [domain]: { name: domain, customDomainStatus: {
      ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', certState: 'CERT_ACTIVE',
    } },
    [builds]: {},
    [rollouts]: { rollouts: [] },
  };
  const account = { projectId: 'fika-os-dev', email: studioStaging.serviceAccount };
  const database = { name: 'projects/fika-os-dev/databases/hospitality-menu-studio', type: 'FIRESTORE_NATIVE' };
  const packages = [{ name: studioStaging.backend }];
  const cloudReads = [];
  const descriptions = [];
  const read = async resource => {
    cloudReads.push(resource);
    assert.ok(Object.hasOwn(resources, resource));
    return resources[resource];
  };
  const describeResource = async args => {
    descriptions.push(args);
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
  return { resources, account, database, packages, read, describeResource, cloudReads, descriptions };
}

test('Studio provisioning has a staging identity but remains outside governed release targets', () => {
  assert.equal(backend, 'projects/fika-os-dev/locations/europe-west4/backends/fika-menu-studio-staging');
  assert.equal(supportedTargets().some(item => item.app === 'menu-studio' || item.backend === studioStaging.backend), false);
  for (const environment of ['staging', 'prod']) {
    assert.throws(() => target('menu-studio', environment), /Unknown application\/environment/);
  }
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

test('App Hosting defaults to closed without staging or production environment overlays', () => {
  const folder = new URL('../../apps/hospitality-menu-studio/', import.meta.url);
  assert.deepEqual(readdirSync(folder).filter(name => /^apphosting.*\.ya?ml$/i.test(name)), ['apphosting.yaml']);
  const config = readFileSync(new URL('apphosting.yaml', folder), 'utf8').replace(/^#.*\r?\n/gm, '').replaceAll('\r\n', '\n').trim();
  assert.equal(config, 'env:\n  - variable: FIKA_RUNTIME_MODE\n    value: unconfigured\n    availability: [RUNTIME]');
});

test('preflight observes only scoped metadata and leaves release blocked even when consistent', async () => {
  const fixture = evidence();
  const result = await studioStagingPreflight(fixture);
  assert.deepEqual(fixture.cloudReads, [backend, traffic, domain, builds, rollouts]);
  assert.deepEqual(fixture.descriptions, [toolAccount, toolDatabase, toolArtifacts]);
  assert.equal(result.target.rootDirectory, 'apps/hospitality-menu-studio');
  assert.equal(result.target.sourceBranch, 'main');
  assert.deepEqual(result.checks, {
    appHosting: 'VERIFIED', serviceAccount: 'VERIFIED', firestore: 'VERIFIED', rolloutPolicy: 'VERIFIED',
    buildHistory: 'VERIFIED', customDomain: 'VERIFIED', managedArtifactRepository: 'UNVERIFIED',
  });
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.pending.join(' '), /AUTHMOD.*IAM.*Storage.*release enablement/);
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
  const result = await studioStagingPreflight(fixture);
  assert.equal(result.status, 'BLOCKED');
  const { managedArtifactRepository, ...otherChecks } = result.checks;
  assert.equal(managedArtifactRepository, 'SHARED');
  assert.ok(Object.values(otherChecks).every(value => value === 'MISMATCH'));

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
    buildHistory: 'UNVERIFIED', customDomain: 'UNVERIFIED', managedArtifactRepository: 'UNVERIFIED',
  });
  assert.equal(missing.status, 'BLOCKED');
});

test('a partially provisioned target reports its independent evidence and wrong branch', async () => {
  const fixture = evidence();
  delete fixture.resources[backend].environment;
  fixture.resources[backend].serviceAccount = 'default-compute@fika-os-dev.iam.gserviceaccount.com';
  const describeResource = async args => {
    if (args[0] === 'artifacts') return fixture.describeResource(args);
    const operation = args[0] === 'iam' ? 'iam.service-accounts' : 'firestore.databases';
    throw Object.assign(Error('describe failed'), { stderr: `ERROR: (gcloud.${operation}.describe) NOT_FOUND: Fixture` });
  };
  const result = await studioStagingPreflight({ ...fixture, describeResource });
  assert.deepEqual(fixture.cloudReads, [backend, traffic, domain, builds, rollouts]);
  assert.deepEqual(result.checks, {
    appHosting: 'MISMATCH', serviceAccount: 'MISSING', firestore: 'MISSING', rolloutPolicy: 'VERIFIED',
    buildHistory: 'VERIFIED', customDomain: 'VERIFIED', managedArtifactRepository: 'UNVERIFIED',
  });
  fixture.resources[traffic].rolloutPolicy.codebaseBranch = 'other-branch';
  assert.equal((await studioStagingPreflight({ ...fixture, describeResource })).checks.rolloutPolicy, 'MISMATCH');
});

test('empty history needs complete pages even if traffic is empty', async () => {
  const fixture = evidence();
  fixture.resources[rollouts] = { rollouts: [], nextPageToken: 'opaque' };
  const partial = await studioStagingPreflight(fixture);
  assert.equal(partial.checks.buildHistory, 'UNVERIFIED');
  assert.equal(partial.checks.rolloutPolicy, 'VERIFIED');
  fixture.resources[rollouts] = { rollouts: null };
  assert.equal((await studioStagingPreflight(fixture)).checks.buildHistory, 'UNVERIFIED');
  fixture.resources[rollouts] = { rollouts: [{}], nextPageToken: 'opaque' };
  assert.equal((await studioStagingPreflight(fixture)).checks.buildHistory, 'MISMATCH');
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
