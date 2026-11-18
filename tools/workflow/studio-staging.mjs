import { backendPath, cloud, command } from './runtime.mjs';
import { APPS } from './policy.mjs';
import { releaseBackend } from './release-prestate.mjs';

export const studioStaging = Object.freeze({
  app: 'menu-studio',
  environment: 'staging',
  project: 'fika-os-dev',
  region: 'europe-west4',
  backend: 'fika-menu-studio-staging',
  origin: 'https://menu-studio-staging.fikacatering.com',
  serviceAccount: 'fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com',
  database: 'hospitality-menu-studio',
});

const base = backendPath(studioStaging);
const domain = `${base}/domains/${new URL(studioStaging.origin).hostname}`;
const database = `projects/${studioStaging.project}/databases/${studioStaging.database}`;

function describe(args) {
  return JSON.parse(command('gcloud', [
    ...args, '--project', studioStaging.project, '--format=json', '--quiet',
  ], { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }));
}

async function observe(check) {
  try { return await check() ? 'VERIFIED' : 'MISMATCH'; }
  catch (error) { return error?.status === 404 ? 'MISSING' : 'UNVERIFIED'; }
}

function emptyTraffic(state) {
  return state === undefined || (state !== null && typeof state === 'object' && !Array.isArray(state) &&
    (state.splits === undefined || (Array.isArray(state.splits) && state.splits.length === 0)));
}

export async function studioStagingPreflight({ read = cloud, describeResource = describe } = {}) {
  let backend;
  const [appHosting, serviceAccount, firestore] = await Promise.all([
    observe(async () => {
      backend = await releaseBackend(studioStaging, read);
      return backend.serviceAccount === studioStaging.serviceAccount &&
        (backend.overrideEnv === undefined || (Array.isArray(backend.overrideEnv) && backend.overrideEnv.length === 0));
    }),
    observe(async () => {
      const account = await describeResource(['iam', 'service-accounts', 'describe', studioStaging.serviceAccount]);
      return account.projectId === studioStaging.project && account.email === studioStaging.serviceAccount &&
        (account.disabled === undefined || account.disabled === false);
    }),
    observe(async () => {
      const store = await describeResource(['firestore', 'databases', 'describe', '--database', studioStaging.database]);
      return store.name === database && store.type === 'FIRESTORE_NATIVE';
    }),
  ]);

  const [rolloutPolicy, customDomain] = backend ? await Promise.all([
    observe(async () => {
      const traffic = await read(`${base}/traffic`);
      return traffic.name === `${base}/traffic` && traffic.rolloutPolicy?.disabled === true &&
        (traffic.reconciling === undefined || traffic.reconciling === false) &&
        emptyTraffic(traffic.current) && emptyTraffic(traffic.target);
    }),
    observe(async () => {
      const result = await read(domain);
      const status = result.customDomainStatus;
      return result.name === domain && status?.ownershipState === 'OWNERSHIP_ACTIVE' &&
        status.hostState === 'HOST_ACTIVE' && status.certState === 'CERT_ACTIVE';
    }),
  ]) : ['UNVERIFIED', 'UNVERIFIED'];

  return {
    status: 'BLOCKED',
    target: { ...studioStaging, rootDirectory: APPS[studioStaging.app].path },
    checks: { appHosting, serviceAccount, firestore, rolloutPolicy, customDomain },
    pending: [
      'Studio-specific staging AUTHMOD registration, capabilities and exact return origin',
      'Effective IAM and isolated named Firestore runtime binding',
      'Storage, Workspace and outbound side-effect isolation',
      'Reviewed release enablement, including first-release and exact-source probes',
    ],
  };
}
