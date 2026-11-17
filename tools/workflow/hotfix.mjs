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
  const requiredCheck = protection?.required_status_checks?.checks?.some(check =>
    check?.context === MAIN_CHECK && check?.app_id === 15368);
  return protection?.enforce_admins?.enabled === true &&
    protection?.allow_force_pushes?.enabled === false && protection?.allow_deletions?.enabled === false &&
    reviews >= 1 && protection.required_pull_request_reviews.dismiss_stale_reviews === true &&
    protection.required_status_checks?.strict === true && contexts.includes(MAIN_CHECK) && requiredCheck &&
    Array.isArray(protection?.bypass_actors) && protection.bypass_actors.length === 0;
}

const active = value => value === 'active' || value === 'enabled';
const hotfixPattern = app => `refs/heads/hotfix/prod/${app}/*`;
function patternMatches(pattern, branch) {
  if (!pattern || pattern === '~ALL') return true;
  if (pattern === '~DEFAULT_BRANCH') return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '.*').replace(/\?/g, '.');
  try { return new RegExp(`^${escaped}$`).test(branch); } catch { return true; }
}

/** Convert either the GitHub classic protection response or an effective ruleset snapshot
 * into the deliberately narrow shape consumed by the hotfix gate. Unobservable fields fail closed. */
export function normalizeHotfixProtection({ app, releaseId, branch, classic, rulesets = [], effectiveRules = [] }) {
  if (branch !== hotfixBranch(app, releaseId)) return null;
  const expected = hotfixPattern(app);
  const branchRef = `refs/heads/${branch}`;
  const targetingRulesets = rulesets.filter(set => set.target === 'branch' && active(set.enforcement) &&
    (set.conditions?.ref_name?.include || []).some(pattern => patternMatches(pattern, branchRef)) &&
    !(set.conditions?.ref_name?.exclude || []).some(pattern => patternMatches(pattern, branchRef)));
  if (targetingRulesets.some(set => (set.bypass_actors || []).length > 0)) return null;
  if (classic) {
    const normalized = {
      required_status_checks: classic.required_status_checks,
      required_pull_request_reviews: classic.required_pull_request_reviews,
      enforce_admins: classic.enforce_admins,
      allow_force_pushes: classic.allow_force_pushes,
      allow_deletions: classic.allow_deletions,
      bypass_actors: [],
      source: 'classic-branch-protection',
    };
    if (protectedBranchIsSafe(normalized)) return normalized;
  }
  const safe = targetingRulesets.find(set => {
    const include = set.conditions?.ref_name?.include || [];
    return include.length === 1 && include[0] === expected && (set.conditions?.ref_name?.exclude || []).length === 0;
  });
  if (!safe || !Array.isArray(safe.rules) || !Array.isArray(effectiveRules)) return null;
  const rules = new Map(safe.rules.map(rule => [rule.type, rule.parameters || {}]));
  const approvals = rules.get('pull_request')?.required_approving_review_count;
  const staleReviews = rules.get('pull_request')?.dismiss_stale_reviews_on_push;
  const checkParameters = rules.get('required_status_checks');
  const checks = checkParameters?.required_status_checks || [];
  const exactCheck = checks.some(check => check.context === MAIN_CHECK && check.integration_id === 15368);
  const requiredWorkflows = rules.get('workflows')?.workflows || [];
  const exactWorkflow = requiredWorkflows.some(workflow => workflow.path === '.github/workflows/validate.yml' &&
    workflow.repository_id === 1297704019 && ['main', 'refs/heads/main'].includes(workflow.ref));
  const effectiveTypes = new Set(effectiveRules.map(rule => rule.type));
  if (approvals < 1 || staleReviews !== true || checkParameters?.strict_required_status_checks_policy !== true || !exactCheck || !exactWorkflow ||
      !rules.has('deletion') || !rules.has('non_fast_forward') ||
      !['pull_request', 'required_status_checks', 'workflows', 'deletion', 'non_fast_forward'].every(type => effectiveTypes.has(type))) return null;
  return {
    required_status_checks: { strict: true, contexts: [MAIN_CHECK], checks: [{ context: MAIN_CHECK, app_id: 15368 }] },
    required_pull_request_reviews: { required_approving_review_count: approvals, dismiss_stale_reviews: staleReviews },
    enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
    bypass_actors: [], source: `ruleset:${safe.id}`,
  };
}

function hasCurrentIndependentApprovals(reviews, author, headSha, required) {
  const latest = new Map();
  for (const review of reviews || []) {
    const login = review.user?.login;
    if (!login || login === author || review.commit_id !== headSha) continue;
    const prior = latest.get(login);
    const currentTime = Date.parse(review.submitted_at || '') || 0;
    const priorTime = Date.parse(prior?.submitted_at || '') || 0;
    if (!prior || currentTime > priorTime || (currentTime === priorTime && Number(review.id) > Number(prior.id))) latest.set(login, review);
  }
  return [...latest.values()].filter(review => review.state === 'APPROVED').length >= Math.max(1, Number(required) || 0);
}

/** Validate a read-only, exact-source hotfix candidate before an operator considers a release. */
export function validateHotfixCandidate({ app, releaseId, manifest, sourceSha, serving, firstParent,
  paths, blobs, pr, reviews = [], protection, checks, config = {}, releaseState = {}, requireApproval = true }) {
  const branch = hotfixBranch(app, releaseId);
  exactSha(sourceSha); exactSha(serving?.sourceSha); exactSha(manifest?.baselineSha);
  if (manifest?.schema !== 'fika.hotfix.v1' || manifest.app !== app || manifest.releaseId !== releaseId || manifest.environment !== 'prod') throw Error('Hotfix manifest target does not match the selected release');
  if (manifest.branch !== branch || pr?.base?.ref !== branch || pr?.base?.repo?.full_name !== REPO ||
      pr?.head?.repo?.full_name !== REPO || !pr?.user?.login || !pr.merged_at || pr.merge_commit_sha !== sourceSha) throw Error('Hotfix source is not the exact merge commit of its protected application release PR');
  if (pr?.head?.sha !== manifest.reviewedHeadSha) throw Error('Hotfix PR head differs from the reviewed source recorded in the manifest');
  if (!hasCurrentIndependentApprovals(reviews, pr.user.login, pr.head.sha,
    protection?.required_pull_request_reviews?.required_approving_review_count)) {
    throw Error('Hotfix PR lacks a current non-author approval for its exact reviewed head');
  }
  if (manifest.baselineSha !== serving.sourceSha || manifest.baselineRollout !== serving.rollout || firstParent !== serving.sourceSha) throw Error('Production source drift or hotfix ancestry mismatch');
  if (!protectedBranchIsSafe(protection)) throw Error('Hotfix target branch lacks verified required review, exact-source CI, admin enforcement or force-push/deletion protection');
  if (!checks?.some(c => c.name === MAIN_CHECK && c.head_sha === sourceSha && c.conclusion === 'success' && c.app?.slug === 'github-actions')) throw Error('Exact-source hotfix merge-gate CI is missing or unsuccessful');
  if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => forbiddenPaths.test(path) || !path.startsWith(`${APPS[app].path}/`))) throw Error('Hotfix contains a non-application-specific, configuration or dependency change');
  const sorted = [...new Set(paths)].sort();
  if (digest(sorted) !== digest([...(manifest.paths || [])].sort()) || hotfixDiffHash(sorted, path => blobs?.[path]) !== manifest.diffHash) throw Error('Hotfix changed paths or file contents differ from the approved release manifest');
  if (manifest.configurationHash !== config.baselineHash || config.currentHash !== config.baselineHash) throw Error('Production runtime or application configuration drifted from the approved baseline');
  if (releaseState.lockActive || releaseState.pendingJournal || releaseState.activeRollout) throw Error('An active release lock, journal or rollout blocks this hotfix');
  if (requireApproval && (!releaseState.explicitApproval || releaseState.approvalApp !== app || releaseState.approvalSourceSha !== sourceSha ||
      !releaseState.approvalReason?.trim() || !releaseState.approvalActor?.trim() || !releaseState.approvalId ||
      !Number.isFinite(Date.parse(releaseState.approvalAt || '')) || !/^[a-f0-9]{64}$/.test(releaseState.approvalHash || ''))) {
    throw Error('Explicit authenticated production approval is missing or does not bind this exact hotfix plan');
  }
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
