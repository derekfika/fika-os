import path from 'node:path';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { ancestor, command, common, ghApi, git, jsonFile, ref, root, save, stateDir } from './runtime.mjs';
import { REPO, exactSha, partialPathOverlap, risk, safeScope } from './policy.mjs';
import { successfulValidation } from './releases.mjs';

const split = value => value.split('\0').filter(Boolean);
const isGitHubOrigin = () => new RegExp(`github\\.com[:/]${REPO}(?:\\.git)?$`, 'i').test(git('remote', 'get-url', 'origin'));
const managedRoot = () => path.resolve(realpathSync(common()), '..', '..', 'agent-workspaces', 'fika-os');
const metadataFile = name => path.join(common(), 'fika-workflow', 'source-tasks', `${name}.json`);
const readMetadata = name => {
  try { return jsonFile(metadataFile(name)); } catch { return null; }
};
const fetchMain = () => {
  git('fetch', '--no-write-fetch-head', 'origin', 'main');
  return exactSha(git('rev-parse', 'origin/main'));
};
const validateName = name => {
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(name || '')) throw Error('Use a 3–61 character lowercase workspace name');
  return name;
};

function registrations() {
  return git('worktree', 'list', '--porcelain', '-z').split('\0\0').filter(Boolean).map(row =>
    Object.fromEntries(split(row).map(field => {
      const [key] = field.split(' ', 1);
      return [key, field === key ? true : field.slice(key.length + 1)];
    })));
}

function openOverlap(paths, base) {
  if (!isGitHubOrigin()) return { status: 'local fixture', overlaps: [], uninspected: [] };
  try {
    const pulls = JSON.parse(command('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--base', 'main', '--limit', '100', '--json', 'number,url,headRefOid'], { timeout: 10000 }));
    const overlaps = [], uninspected = [];
    for (const pull of pulls) {
      if (!ref(`${exactSha(pull.headRefOid)}^{commit}`)) { uninspected.push(pull.number); continue; }
      const matching = split(git('diff', '--name-only', '--no-renames', '-z', `${base}...${pull.headRefOid}`))
        .filter(file => paths.some(candidate => partialPathOverlap(candidate, file)));
      if (matching.length) overlaps.push({ pr: pull.number, url: pull.url, paths: matching });
    }
    return { status: pulls.length === 100 ? 'bounded; more PRs may exist' : 'observed', overlaps, uninspected };
  } catch {
    return { status: 'unavailable; inspect open PRs before editing shared paths', overlaps: [], uninspected: [] };
  }
}

export function createSourceWorkspace(name, options) {
  validateName(name);
  if (!options.owner?.trim()) throw Error('--owner is required for task metadata');
  const paths = options.scope ? options.scope.split(',').map(safeScope) : [];
  const baseline = fetchMain();
  const branch = `codex/${name}`, directory = path.join(managedRoot(), name);
  const file = metadataFile(name);
  if (existsSync(directory) || existsSync(file) || ref(`refs/heads/${branch}`) || git('ls-remote', '--heads', 'origin', `refs/heads/${branch}`)) throw Error('Task name, path or branch already exists; choose a new name');
  const review = openOverlap(paths, baseline);
  mkdirSync(managedRoot(), { recursive: true });
  // Git owns the branch/worktree transaction. A concurrent same-name create must fail without force.
  git('worktree', 'add', '--quiet', '-b', branch, directory, baseline);
  const task = { name, owner: options.owner, branch, baseline, directory, paths, startedAt: new Date().toISOString() };
  save(file, task);
  return { ...task, risk: paths.length ? risk(paths) : 'unclassified', review };
}

export function sourceWorkspace(name) {
  validateName(name);
  const directory = path.join(managedRoot(), name), branch = `codex/${name}`;
  const tree = registrations().find(entry => path.resolve(entry.worktree) === directory);
  if (!tree || tree.locked || tree.prunable || tree.branch !== `refs/heads/${branch}` || realpathSync(directory) !== directory) throw Error('Expected an independent registered task checkout on its named branch');
  const run = (...args) => command('git', args, { cwd: directory });
  if (run('branch', '--show-current') !== branch || run('rev-parse', 'HEAD') !== tree.HEAD) throw Error('Task checkout changed during inspection');
  return { name, directory, branch, head: exactSha(tree.HEAD), task: readMetadata(name), run };
}

export function checkSourceWorkspace(name) {
  const { directory, branch, head, task, run } = sourceWorkspace(name);
  const main = fetchMain();
  const paths = [...new Set([
    ...split(run('diff', '--name-only', '--no-renames', '-z', `${main}...${head}`)),
    ...split(run('diff', '--name-only', '--no-renames', '-z', 'HEAD')),
    ...split(run('ls-files', '--others', '--exclude-standard', '-z')),
  ])];
  return { name, directory, branch, head, main, baseline: task?.baseline ?? git('merge-base', main, head), paths,
    risk: paths.length ? risk(paths) : 'unclassified', review: openOverlap(paths, main) };
}

export function sourceWorkspaceStatus() {
  const prefix = 'refs/heads/codex/';
  const entries = registrations().filter(tree => String(tree.branch).startsWith(prefix)).map(tree => {
    const name = tree.branch.slice(prefix.length);
    const task = /^[a-z][a-z0-9-]{2,60}$/.test(name) ? readMetadata(name) : null;
    return { name, branch: tree.branch.slice('refs/heads/'.length), head: tree.HEAD, owner: task?.owner || null, protected: Boolean(tree.locked || tree.prunable) };
  });
  return { observedAt: new Date().toISOString(), entries };
}

export function completeSourceWorkspace(name, options, { readPrs = branch => ghApi(`repos/${REPO}/pulls?state=all&head=derekfika:${encodeURIComponent(branch)}&per_page=100`) } = {}) {
  const { branch, directory, head, task, run } = sourceWorkspace(name);
  if (!options.owner || (task && task.owner !== options.owner)) throw Error('Use the task owner for the completion record');
  if (options.preserve && !options.reason?.trim()) throw Error('Preserving unfinished work requires --reason');
  const status = run('status', '--porcelain', '--ignored=matching', '--untracked-files=all');
  const dirty = status.split(/\r?\n/).some(line => line && !line.startsWith('!! '));
  let evidence = { pushed: false, inMain: false, pr: null };
  try {
    git('fetch', '--no-write-fetch-head', 'origin');
    evidence = { ...evidence, pushed: ref(`refs/remotes/origin/${branch}`) === head, inMain: ancestor(head, 'origin/main') };
    if (isGitHubOrigin()) {
      const pulls = readPrs(branch);
      if (pulls.length >= 100) throw Error('PR inventory is incomplete');
      const pr = pulls.find(item => item.head.sha === head && item.head.ref === branch && item.head.repo?.full_name === REPO && item.base.repo?.full_name === REPO && item.base.ref === 'main');
      if (pr) evidence.pr = { number: pr.number, state: pr.state, merged: Boolean(pr.merged_at), url: pr.html_url };
    }
  } catch (error) {
    if (!options.preserve) throw error;
    evidence.unverified = true;
  }
  if (!options.preserve && (dirty || (!evidence.pushed && !evidence.inMain))) throw Error('Dirty or unpushed work remains. Commit/push or record --preserve --reason; the checkout is retained');
  if (run('branch', '--show-current') !== branch || run('rev-parse', 'HEAD') !== head || run('status', '--porcelain', '--ignored=matching', '--untracked-files=all') !== status) throw Error('Checkout changed during completion');
  const result = { name, owner: options.owner, branch, finalSha: head, ...evidence, outcome: options.preserve ? 'unfinished-preserved' : 'completed',
    ...(options.preserve ? { reason: options.reason } : {}), retirement: 'retained', dirty, ignored: status.split(/\r?\n/).some(line => line.startsWith('!! ')), directory };
  save(path.join(stateDir(), 'source-completions', `${name}.json`), { ...result, at: new Date().toISOString() });
  return result;
}

export function integrateSourceWorkspace(name, prNumber, { readPr = number => ghApi(`repos/${REPO}/pulls/${number}`), validate = successfulValidation,
  merge = (number, head) => command('gh', ['pr', 'merge', number, '--repo', REPO, '--merge', '--match-head-commit', head]) } = {}) {
  if (!/^[1-9]\d*$/.test(prNumber || '')) throw Error('Integration requires --pr');
  const { branch, head, run } = sourceWorkspace(name);
  const base = fetchMain();
  if (!ancestor(base, head) || base === head) throw Error('Merge current origin/main into the task branch, review the diff and rerun CI');
  const matches = pr => pr.state === 'open' && !pr.draft && pr.head?.sha === head && pr.head?.ref === branch && pr.head?.repo?.full_name === REPO &&
    pr.base?.ref === 'main' && pr.base?.sha === base && pr.base?.repo?.full_name === REPO;
  const pr = readPr(prNumber);
  if (!matches(pr)) throw Error('PR does not match the same-repository main target, current base and exact task head');
  const validation = validate(head);
  if (!matches(readPr(prNumber)) || run('status', '--porcelain') || run('rev-parse', 'HEAD') !== head || run('branch', '--show-current') !== branch) throw Error('Source, base or PR changed during integration checks');
  merge(prNumber, head);
  return { pr: pr.html_url, sourceSha: head, validation, merged: true, branchPreserved: true };
}

export function devSourceWorkspace(name, app, port) {
  if (!/^[1-9]\d*$/.test(port || '') || Number(port) < 1024 || Number(port) > 65535) throw Error('Dev requires an unused --port between 1024 and 65535');
  const { directory } = sourceWorkspace(name);
  command('npm', ['--prefix', app.path, 'run', 'dev', '--', '--port', port], {
    cwd: directory, env: { ...process.env, FIKA_RUNTIME_MODE: 'local' }, stdio: ['inherit', 'inherit', 'inherit'],
  });
  return { stopped: true };
}
