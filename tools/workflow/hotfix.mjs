import { APPS, MAIN_CHECK, REPO, digest, exactSha } from './policy.mjs';

const releaseIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
const forbiddenPaths = /(^|\/)(package\.json|package-lock\.json|apphosting\.(production|staging)\.yaml|firebase\.json|\.firebaserc)$/;

export function hotfixBranch(app, releaseId) {
  if (!Object.hasOwn(APPS, app) || APPS[app].prod == null || !releaseIdPattern.test(releaseId || '')) throw Error('Invalid production hotfix target or release ID');
  return `hotfix/prod/${app}/${releaseId}`;
}

export function hotfixDiffHash(paths, blobAt) {
  const sorted = [...new Set(paths)].sort();
  return digest(sorted.map(path => ({ path, blob: blobAt(path) })));
}

function protectedBranchIsSafe(protection) {
  const contexts = protection?.required_status_checks?.contexts || [];
  const reviews = protection?.required_pull_request_reviews?.required_approving_review_count;
  return protection?.enforce_admins?.enabled === true &&
    protection?.allow_force_pushes?.enabled === false && protection?.allow_deletions?.enabled === false &&
    reviews >= 1 && contexts.includes(MAIN_CHECK) && protection?.bypass_actors?.length === 0;
}

/** Validate a read-only, exact-source hotfix candidate before an operator considers a release. */
export function validateHotfixCandidate({ app, releaseId, manifest, sourceSha, serving, firstParent,
  paths, blobs, pr, protection, checks, config = {}, releaseState = {} }) {
  const branch = hotfixBranch(app, releaseId);
  exactSha(sourceSha); exactSha(serving?.sourceSha); exactSha(manifest?.baselineSha);
  if (manifest?.schema !== 'fika.hotfix.v1' || manifest.app !== app || manifest.releaseId !== releaseId || manifest.environment !== 'prod') throw Error('Hotfix manifest target does not match the selected release');
  if (manifest.branch !== branch || pr?.base?.ref !== branch || pr?.base?.repo?.full_name !== REPO || !pr.merged_at || pr.merge_commit_sha !== sourceSha) throw Error('Hotfix source is not the exact merge commit of its protected application release PR');
  if (pr?.head?.sha !== manifest.reviewedHeadSha) throw Error('Hotfix PR head differs from the reviewed source recorded in the manifest');
  if (manifest.baselineSha !== serving.sourceSha || manifest.baselineRollout !== serving.rollout || firstParent !== serving.sourceSha) throw Error('Production source drift or hotfix ancestry mismatch');
  if (!protectedBranchIsSafe(protection)) throw Error('Hotfix target branch lacks verified required review, exact-source CI, admin enforcement or force-push/deletion protection');
  if (!checks?.some(c => c.name === MAIN_CHECK && c.head_sha === sourceSha && c.conclusion === 'success' && c.app?.slug === 'github-actions')) throw Error('Exact-source hotfix merge-gate CI is missing or unsuccessful');
  if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => forbiddenPaths.test(path) || !(path.startsWith(`${APPS[app].path}/`) || path.startsWith('apps/shared/') || path.startsWith('packages/')))) throw Error('Hotfix contains an unrelated application, configuration or dependency change');
  const sorted = [...new Set(paths)].sort();
  if (digest(sorted) !== digest([...(manifest.paths || [])].sort()) || hotfixDiffHash(sorted, path => blobs?.[path]) !== manifest.diffHash) throw Error('Hotfix changed paths or file contents differ from the approved release manifest');
  if (!manifest.tests?.includes('application-tests') || !manifest.tests?.includes('typecheck') || !manifest.tests?.includes('build') || !manifest.tests?.includes('security')) throw Error('Hotfix manifest does not require the full application and security validation set');
  if (manifest.configurationHash !== config.baselineHash || config.currentHash !== config.baselineHash) throw Error('Production runtime or application configuration drifted from the approved baseline');
  if (releaseState.lockActive || releaseState.pendingJournal || releaseState.activeRollout) throw Error('An active release lock, journal or rollout blocks this hotfix');
  if (!releaseState.explicitApproval || releaseState.approvalApp !== app || releaseState.approvalSourceSha !== sourceSha ||
      !releaseState.approvalReason?.trim() || !releaseState.approvalActor?.trim() || !releaseState.approvalId ||
      !Number.isFinite(Date.parse(releaseState.approvalAt || ''))) throw Error('Explicit authenticated production approval is missing or does not bind this exact hotfix');
  return { app, environment: 'prod', releaseId, branch, sourceSha, baselineSha: serving.sourceSha, baselineRollout: serving.rollout,
    diffHash: manifest.diffHash, reviewedHeadSha: pr.head.sha, mergeGate: MAIN_CHECK, ready: true };
}

export function assertMainReconciled(hotfixRecord, reconciliation) {
  if (!hotfixRecord || hotfixRecord.kind !== 'hotfix' || reconciliation?.hotfixSourceSha !== hotfixRecord.sourceSha ||
      reconciliation?.diffHash !== hotfixRecord.diffHash || !reconciliation?.mainPrMerged || !reconciliation?.mainCheckGreen ||
      !reconciliation?.recordCommit) throw Error('Production hotfix is not fully reconciled through a protected, green main PR');
  exactSha(reconciliation.recordCommit);
  return true;
}
