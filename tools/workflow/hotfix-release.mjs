import { APPS, REPO, MAIN_CHECK, digest, exactSha, target } from './policy.mjs';
import { hotfixBranch, hotfixDiffHash, normalizeHotfixProtection, validateHotfixCandidate } from './hotfix.mjs';
import { backendPath, git } from './runtime.mjs';

const stableRows = rows => [...rows].map(row => ({ ...row })).sort((a,b) =>
  String(a.variable || a.name || '').localeCompare(String(b.variable || b.name || '')) ||
  String(a.origin || '').localeCompare(String(b.origin || '')));

/** Hash reviewed manifest fields committed indirectly by the source-bound changelog fragment.
 * The reviewed PR head is checked independently against the review and merge evidence. */
export function hotfixManifestDigest(manifest) {
  const { manifestHash, reviewedHeadSha, ...bound } = manifest || {};
  return digest(bound);
}

function manifestFromPr(pr) {
  const blocks = [...String(pr?.body || '').matchAll(/<!-- fika-hotfix-manifest:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- fika-hotfix-manifest:end -->/g)];
  if (blocks.length !== 1) throw Error('Hotfix PR must contain exactly one reviewed FIKA hotfix manifest block');
  try { return JSON.parse(blocks[0][1]); }
  catch { throw Error('Hotfix PR manifest block is not valid JSON'); }
}
function changedPaths(base, sha) {
  return git('diff', '--no-renames', '--name-only', '-z', base, sha).split('\0').filter(Boolean).sort();
}
function blobAt(sha, file) {
  try { return git('rev-parse', `${sha}:${file}`); }
  catch { return null; }
}
function readClassicProtection(branch, github) {
  try { return github(`repos/${REPO}/branches/${encodeURIComponent(branch)}/protection`); }
  catch { return null; }
}
function readEffectiveRules(branch, github) {
  try {
    const result = github(`repos/${REPO}/rules/branches/${encodeURIComponent(branch)}`);
    return Array.isArray(result) ? result : null;
  } catch { return null; }
}
function readRulesets(github) {
  try {
    const listed = [];
    for (let page=1; page<=10; page++) {
      const rows = github(`repos/${REPO}/rulesets?includes_parents=true&per_page=100&page=${page}`);
      if (!Array.isArray(rows)) return null;
      listed.push(...rows);
      if (rows.length < 100) {
        const details = listed.map(row => {
          if (Array.isArray(row.rules)) return row;
          try { return github(`repos/${REPO}/rulesets/${row.id}`); }
          catch { return null; }
        });
        return details.some(row => !row) ? null : details;
      }
    }
    return null;
  } catch { return null; }
}

export function configurationDigest(backend, servingBuild) {
  const effectiveEnv = servingBuild?.config?.effectiveEnv ?? servingBuild?.effectiveEnv;
  if (!Array.isArray(effectiveEnv)) throw Error('Current production effective configuration is unavailable');
  return digest({
    backendOverrides: stableRows(backend?.overrideEnv || []),
    effectiveEnv: stableRows(effectiveEnv),
  });
}

export function hotfixProtectionEvidence(app, releaseId, github) {
  const branch = hotfixBranch(app, releaseId);
  const classic = readClassicProtection(branch, github);
  const effectiveRules = readEffectiveRules(branch, github);
  const rulesets = readRulesets(github);
  if (effectiveRules === null || rulesets === null) {
    throw Error('GitHub could not verify classic branch protection or effective repository/organization rulesets');
  }
  const protection = normalizeHotfixProtection({ app, releaseId, branch, classic, effectiveRules: effectiveRules || [], rulesets: rulesets || [] });
  if (!protection) throw Error('The exact hotfix target has no verifiable protected-PR, exact-check, administrator, deletion and force-push policy with no bypass actors');
  return { branch, protection, evidence: { source: protection.source, branch, observedRulesets: (rulesets || []).filter(set =>
    set.target === 'branch' && (set.conditions?.ref_name?.include || []).includes(`refs/heads/hotfix/prod/${app}/*`)).map(set => set.id) } };
}

export async function prepareHotfixRelease({ app, releaseId, sourceSha, serving, backend, github, read,
  requireApproval = false, releaseState = {} }) {
  const t = target(app, 'prod');
  exactSha(sourceSha); exactSha(serving?.sourceSha);
  if (!releaseId || !backend || typeof github !== 'function' || typeof read !== 'function') throw Error('Hotfix release requires exact candidate and production evidence');
  const branch = hotfixBranch(app, releaseId);
  const matching = github(`repos/${REPO}/commits/${sourceSha}/pulls?per_page=100`);
  const prs = (Array.isArray(matching) ? matching : []).filter(pr => pr.merge_commit_sha === sourceSha && pr.merged_at &&
    pr.base?.ref === branch && pr.base?.repo?.full_name === REPO && pr.head?.repo?.full_name === REPO);
  if (prs.length !== 1) throw Error('Exactly one merged same-repository PR must identify the hotfix merge commit');
  const pr = github(`repos/${REPO}/pulls/${prs[0].number}`);
  const manifest = manifestFromPr(pr);
  if (manifest.app !== app || manifest.releaseId !== releaseId || manifest.branch !== branch) throw Error('Reviewed hotfix manifest target differs from the requested application release');
  const firstParent = git('rev-parse', `${sourceSha}^1`);
  const rawChanged = changedPaths(manifest.baselineSha, sourceSha);
  const appFolder = APPS[app].path.slice('apps/'.length);
  const changelogPath = new RegExp(`^\\.changes/${appFolder}/[a-z0-9][a-z0-9-]*\\.md$`);
  const metadataPaths = rawChanged.filter(file => changelogPath.test(file));
  const paths = rawChanged.filter(file => !changelogPath.test(file));
  if (metadataPaths.length !== 1) throw Error('Hotfix PR must include exactly one scoped app changelog fragment');
  const manifestPaths = Array.isArray(manifest.paths) ? [...manifest.paths].sort() : [];
  const changelog = git('show', `${sourceSha}:${metadataPaths[0]}`);
  const committedManifestHash = changelog.match(/<!-- fika-hotfix-manifest-sha256: ([a-f0-9]{64}) -->/)?.[1];
  if (!manifest.manifestHash || manifest.manifestHash !== hotfixManifestDigest(manifest) || committedManifestHash !== manifest.manifestHash) {
    throw Error('Reviewed PR manifest is not bound to its source-committed changelog evidence');
  }
  if (digest(paths) !== digest(manifestPaths)) throw Error('Hotfix manifest paths do not exactly match the baseline-to-candidate tree diff');
  const blobs = Object.fromEntries(paths.map(path => [path, blobAt(sourceSha, path)]));
  const base = backendPath(t), rollout = await read(`${base}/rollouts/${serving.rollout}`);
  if (!rollout?.build) throw Error('Serving rollout does not identify its verified build');
  const servingBuild = await read(rollout.build);
  if (servingBuild?.source?.codebase?.hash !== serving.sourceSha || servingBuild.state !== 'READY' || servingBuild.reconciling) {
    throw Error('Serving configuration build differs from the verified production baseline');
  }
  const configurationHash = configurationDigest(backend, servingBuild);
  const governance = hotfixProtectionEvidence(app, releaseId, github);
  const reviews = github(`repos/${REPO}/pulls/${pr.number}/reviews?per_page=100`);
  const checkResponse = github(`repos/${REPO}/commits/${sourceSha}/check-runs?per_page=100`);
  const checks = checkResponse?.check_runs || [];
  const config = { baselineHash: manifest.configurationHash, currentHash: configurationHash };
  const validated = validateHotfixCandidate({ app, releaseId, manifest, sourceSha, serving, firstParent, paths, blobs,
    pr, reviews, protection: governance.protection, checks, config, releaseState, requireApproval });
  const observed = { sourceSha, manifest, branch, serving, configurationHash,
    pr: { number:pr.number, headSha:pr.head?.sha, mergeCommitSha:pr.merge_commit_sha, mergedAt:pr.merged_at,
      base:pr.base?.ref, headRepository:pr.head?.repo?.full_name },
    reviewIds:reviews.filter(row=>row.state==='APPROVED'&&row.commit_id===pr.head?.sha).map(row=>row.id).sort(),
    checks:checks.filter(row=>row.name===MAIN_CHECK&&row.head_sha===sourceSha).map(row=>({id:row.id,conclusion:row.conclusion,app:row.app?.slug})).sort((a,b)=>a.id-b.id),
    protection:governance.evidence, diffHash:hotfixDiffHash(paths,path=>blobs[path]), validated };
  observed.metadataPaths=metadataPaths.map(file=>({path:file,blob:blobAt(sourceSha,file)}));
  return { target:t, observed, approvalHash:digest(observed) };
}
