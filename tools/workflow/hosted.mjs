import { REPO, target } from './policy.mjs';

export const HOSTED = { repositoryId: '1297704019', ownerId: '290282101', ref: 'refs/heads/main', workflowRef: `${REPO}/.github/workflows/release.yml@refs/heads/main` };
export function assertHostedContext(env, t) {
  const expected = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: REPO,
    GITHUB_REPOSITORY_ID: HOSTED.repositoryId, GITHUB_REPOSITORY_OWNER_ID: HOSTED.ownerId,
    GITHUB_REF: HOSTED.ref, GITHUB_WORKFLOW_REF: HOSTED.workflowRef, FIKA_RELEASE_ENVIRONMENT: `${t.environment}-${t.app}` };
  for (const [key, value] of Object.entries(expected)) if (env[key] !== value) throw Error(`Unauthorised hosted release context: ${key}`);
  if (!/^\d+$/.test(env.GITHUB_RUN_ID || '') || !env.GITHUB_ACTOR) throw Error('Hosted release run/actor is missing');
  return { actor: env.GITHUB_ACTOR, run: `https://github.com/${REPO}/actions/runs/${env.GITHUB_RUN_ID}`, environment: expected.FIKA_RELEASE_ENVIRONMENT };
}
export function hostedTrust(app, environment) {
  const t = target(app, environment);
  const subject = `repo:${REPO}:environment:${environment}-${app}`;
  return { target: t, subject,
    providerRequirements: { issuerUri: 'https://token.actions.githubusercontent.com', audience: 'Exact workload identity provider resource used by the auth action; no broad audience override' },
    attributeMapping: { 'google.subject': 'assertion.sub' },
    attributeCondition: [`assertion.repository_id == '${HOSTED.repositoryId}'`, `assertion.repository_owner_id == '${HOSTED.ownerId}'`,
      `assertion.ref == '${HOSTED.ref}'`, `assertion.workflow_ref == '${HOSTED.workflowRef}'`,
      "assertion.event_name == 'workflow_dispatch'", `assertion.sub == '${subject}'`].join(' && '),
    iamRequirement: 'Bind only this exact subject to a dedicated service account for this app/environment. No repository-wide principalSet or wildcard. Provider/IAM changes require separate approval.' };
}
