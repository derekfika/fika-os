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
const toolAccount = ['iam', 'service-accounts', 'describe', studioStaging.serviceAccount];
const toolDatabase = ['firestore', 'databases', 'describe', '--database', 'hospitality-menu-studio'];

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
  };
  const account = { projectId: 'fika-os-dev', email: studioStaging.serviceAccount };
  const database = { name: 'projects/fika-os-dev/databases/hospitality-menu-studio', type: 'FIRESTORE_NATIVE' };
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
    assert.deepEqual(args, toolDatabase);
    return database;
  };
  return { resources, account, database, read, describeResource, cloudReads, descriptions };
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

test('App Hosting defaults to closed with only the pinned read-only staging overlay', () => {
  const folder = new URL('../../apps/hospitality-menu-studio/', import.meta.url);
  assert.deepEqual(readdirSync(folder).filter(name => /^apphosting.*\.ya?ml$/i.test(name)).sort(), ['apphosting.staging.yaml', 'apphosting.yaml']);
  const config = readFileSync(new URL('apphosting.yaml', folder), 'utf8').replace(/^#.*\r?\n/gm, '').replaceAll('\r\n', '\n').trim();
  assert.equal(config, 'env:\n  - variable: FIKA_RUNTIME_MODE\n    value: unconfigured\n    availability: [RUNTIME]');
  const staging = readFileSync(new URL('apphosting.staging.yaml', folder), 'utf8').replaceAll('\r\n', '\n').trim();
  const bindings = {
    FIKA_RUNTIME_MODE: 'staging',
    FIREBASE_PROJECT_ID: studioStaging.project,
    FIKA_HUB_BASE_URL: 'https://staging-os.fikacatering.com',
    FIKA_STUDIO_ORIGIN: studioStaging.origin,
    FIKA_STUDIO_FIRESTORE_DATABASE: studioStaging.database,
    FIKA_SESSION_COOKIE_DOMAIN: '.fikacatering.com',
  };
  assert.equal(staging, 'env:\n' + Object.entries(bindings).map(([key, value]) =>
    `  - variable: ${key}\n    value: ${value}\n    availability: [RUNTIME]`).join('\n'));
  const rules = JSON.parse(readFileSync(new URL('firebase.staging.json', folder), 'utf8'));
  assert.deepEqual(rules, { firestore: [{ database: studioStaging.database, rules: 'firestore.rules' }] });
  assert.match(readFileSync(new URL('firestore.rules', folder), 'utf8'), /allow read, write: if false;/);
});

test('preflight observes only scoped metadata and leaves release blocked even when consistent', async () => {
  const fixture = evidence();
  const result = await studioStagingPreflight(fixture);
  assert.deepEqual(fixture.cloudReads, [backend, traffic, domain]);
  assert.deepEqual(fixture.descriptions, [toolAccount, toolDatabase]);
  assert.equal(result.target.rootDirectory, 'apps/hospitality-menu-studio');
  assert.equal(result.target.sourceBranch, 'main');
  assert.deepEqual(result.checks, {
    appHosting: 'VERIFIED', serviceAccount: 'VERIFIED', firestore: 'VERIFIED', rolloutPolicy: 'VERIFIED', customDomain: 'VERIFIED',
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
  const result = await studioStagingPreflight(fixture);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(Object.values(result.checks).every(value => value === 'MISMATCH'));

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
    appHosting: 'MISSING', serviceAccount: 'UNVERIFIED', firestore: 'UNVERIFIED', rolloutPolicy: 'UNVERIFIED', customDomain: 'UNVERIFIED',
  });
  assert.equal(missing.status, 'BLOCKED');
});

test('a partially provisioned target reports its independent evidence and wrong branch', async () => {
  const fixture = evidence();
  delete fixture.resources[backend].environment;
  fixture.resources[backend].serviceAccount = 'default-compute@fika-os-dev.iam.gserviceaccount.com';
  const describeResource = async args => {
    const operation = args[0] === 'iam' ? 'iam.service-accounts' : 'firestore.databases';
    throw Object.assign(Error('describe failed'), { stderr: `ERROR: (gcloud.${operation}.describe) NOT_FOUND: Fixture` });
  };
  const result = await studioStagingPreflight({ ...fixture, describeResource });
  assert.deepEqual(fixture.cloudReads, [backend, traffic, domain]);
  assert.deepEqual(result.checks, {
    appHosting: 'MISMATCH', serviceAccount: 'MISSING', firestore: 'MISSING', rolloutPolicy: 'VERIFIED', customDomain: 'VERIFIED',
  });
  fixture.resources[traffic].rolloutPolicy.codebaseBranch = 'other-branch';
  assert.equal((await studioStagingPreflight({ ...fixture, describeResource })).checks.rolloutPolicy, 'MISMATCH');
});
