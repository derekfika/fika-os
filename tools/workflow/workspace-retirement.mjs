import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync } from 'node:fs';
import { ancestor, command, common, git, ref, save, stateDir } from './runtime.mjs';
import { REPO, exactSha } from './policy.mjs';
import { canonical, completionFile, localEntry, managedRoot, optionalJson, pathKey, registrations, samePath, sourceTaskFile, split,
  stateRecords, withCapacityLock, workspaceName } from './workspace-capacity.mjs';
import { verifiedGenerated } from './workspace-cache.mjs';

export const githubOrigin = () => new RegExp(`github\\.com[:/]${REPO}(?:\\.git)?$`, 'i').test(git('remote', 'get-url', 'origin'));
export function pullInventory(branch) {
  if (!githubOrigin()) return [];
  const fields = '{number,state,html_url,merged_at,merge_commit_sha,head:{sha:.head.sha,ref:.head.ref,repo:{full_name:.head.repo.full_name}},base:{ref:.base.ref,repo:{full_name:.base.repo.full_name}}}';
  const head = branch ? `&head=${encodeURIComponent(`derekfika:${branch}`)}` : '';
  return command('gh', ['api', '--paginate', `repos/${REPO}/pulls?state=all&per_page=100${head}`, '--jq', `.[] | ${fields}`],
    { timeout: 45000, maxBuffer: 4 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

const ownPull = (pr, branch) => pr.head?.ref === branch && pr.head?.repo?.full_name === REPO;
export function integrationEvidence(pulls, branch, head, { github = githubOrigin(), contains = sha => ancestor(sha, 'origin/main') } = {}) {
  if (pulls.some(pr => ownPull(pr, branch) && pr.state === 'open')) return null;
  const pr = pulls.find(pr => ownPull(pr, branch) && pr.head.sha === head && pr.state === 'closed' && pr.merged_at &&
    pr.base?.ref === 'main' && pr.base?.repo?.full_name === REPO &&
    /^[a-f0-9]{40}$/.test(pr.merge_commit_sha || '') && contains(pr.merge_commit_sha));
  if (pr) return { number: pr.number, url: pr.html_url, mergeSha: pr.merge_commit_sha };
  // Local test repositories have no PR service. A real GitHub checkout always needs exact PR evidence.
  if (!github && contains(head)) return { mergeSha: head };
  return null;
}

export function sourceStatus(run) {
  return run('-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'status', '--porcelain=v1', '-z', '--ignored=matching',
    '--untracked-files=normal', '--ignore-submodules=none');
}

const branchRef = branch => `refs/heads/${branch}`;
const recordsByName = area => new Map(stateRecords(area).map(record => [record.name, record]));

function localSafety(task, completion, tree, operations, historical, management, checkFiles = true) {
  if (!workspaceName(task.name) || task.branch !== `codex/${task.name}` ||
    completion.name !== task.name || completion.owner !== task.owner || completion.branch !== task.branch ||
    !samePath(task.directory, completion.directory) || !samePath(task.directory, path.join(management, task.name))) return 'ownership or workspace path mismatch';
  if (operations.some(op => op.name === task.name || (op.source?.directory && samePath(op.source.directory, task.directory)))) return 'in-flight or interrupted operation';
  if (historical && !['finished', 'retired'].includes(historical.state)) return `protected historical workspace state: ${historical.state}`;
  if (tree && (tree.locked || tree.prunable || tree.branch !== branchRef(task.branch) || tree.HEAD !== completion.finalSha)) return 'registration is locked, stale or changed since completion';
  if (!tree && localEntry(task.directory)) return 'unregistered workspace directory remains';
  if (!tree && completion.retirement !== 'removing' && completion.retirement !== 'removed') return 'registration disappeared outside governed cleanup';
  const local = ref(branchRef(task.branch));
  if (local !== completion.finalSha && (tree || local)) return 'local branch moved or disappeared after completion';
  const remote = ref(`refs/remotes/origin/${task.branch}`);
  if (remote && remote !== completion.finalSha) return 'remote branch moved after completion';
  if (!tree) return null;
  const entry = localEntry(task.directory);
  if (!entry?.isDirectory() || entry.isSymbolicLink() || !samePath(realpathSync(task.directory), task.directory)) return 'workspace path is missing or resolves through a link';
  if (!checkFiles) return null;
  const run = (...args) => command('git', args, { cwd: task.directory });
  if (run('branch', '--show-current') !== task.branch || run('rev-parse', 'HEAD') !== completion.finalSha) return 'checkout changed after completion';
  if (split(run('ls-files', '-v', '-z')).some(line => /^[a-zS]/.test(line))) return 'index contains assume-unchanged or skip-worktree paths';
  const status = sourceStatus(run);
  if (split(status).some(line => !line.startsWith('!! '))) return 'tracked or untracked work remains';
  if (status && !verifiedGenerated(task, status)) return 'ignored files remain and require recovery or independent verification';
  return null;
}

function gitAdminSnapshot(tree, name, contains) {
  const directory = command('git', ['rev-parse', '--absolute-git-dir'], { cwd: tree.worktree });
  const adminRoot = path.join(common(), 'worktrees');
  if (!samePath(path.dirname(directory), adminRoot) || !samePath(realpathSync(directory), directory)) throw Error('Unexpected Git worktree metadata path');
  archiveGitMetadata(directory, path.join('retirements', name), tree.HEAD, tree.branch, contains);
}

function archiveGitMetadata(directory, archive, head, branch, contains) {
  const destination = path.join(stateDir(), 'source-recovery', archive);
  if (!localEntry(destination)) {
    mkdirSync(path.dirname(destination), { recursive: true });
    const staging = mkdtempSync(path.join(path.dirname(destination), '.pending-'));
    const snapshot = path.join(staging, 'snapshot');
    cpSync(directory, snapshot, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    renameSync(snapshot, destination);
    rmdirSync(staging);
  } else if (!samePath(realpathSync(destination), destination)) {
    throw Error('Git metadata recovery path resolves through a link');
  }
  const prefix = `refs/preserve/source-recovery/${archive.split(path.sep).join('/')}`;
  const roots = new Set([exactSha(head)]);
  const logs = [path.join(directory, 'logs', 'HEAD')];
  if (branch) {
    const branchLog = path.join(common(), 'logs', branch);
    if (localEntry(branchLog)) {
      if (!samePath(realpathSync(branchLog), branchLog)) throw Error('Branch reflog resolves through a link');
      const retained = path.join(destination, 'branch-reflog');
      if (!localEntry(retained)) cpSync(branchLog, retained, { errorOnExist: true, force: false });
      logs.push(branchLog);
    }
  }
  for (const log of logs) if (localEntry(log)) {
    if (!samePath(realpathSync(log), log)) throw Error('Git evidence path resolves through a link');
    for (const line of readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
      const points = /^([a-f0-9]{40}) ([a-f0-9]{40}) /.exec(line);
      if (!points) throw Error('Unexpected Git reflog format');
      for (const sha of points.slice(1)) if (!/^0+$/.test(sha)) roots.add(sha);
    }
  }
  // Preserve the original tip even for a squash/rebase merge, and retain reflog-only commits.
  const refs = [...roots].filter(sha => sha === head || !contains(sha)).map(sha => `update ${prefix}/${sha} ${sha}\n`);
  // A manually removed checkout can still have staged blobs in its admin index.
  const index = path.join(destination, 'index');
  if (archive.startsWith('stale') && localEntry(index)) {
    if (!samePath(realpathSync(index), index)) throw Error('Git recovery index resolves through a link');
    const staged = split(command('git', ['ls-files', '--stage', '-z'], { env: { ...process.env, GIT_INDEX_FILE: index } }));
    const blobs = new Set(staged.map(line => /^\d{6} ([a-f0-9]{40}) [1230]\t/.exec(line))
      .filter((match, position) => match && !staged[position].startsWith('160000 ')).map(match => match[1]));
    if (blobs.size) {
      // Build a recovery tree even for a conflict index. The copied index retains paths and stages.
      const tree = command('git', ['mktree'], { input: [...blobs].map(sha => `100644 blob ${sha}\t${sha}\n`).join('') });
      refs.push(`update ${prefix}/index ${exactSha(tree)}\n`);
    }
  }
  command('git', ['update-ref', '--stdin'], { input: refs.join('') });
}

export function pruneStaleSourceRegistrations({ execute = false } = {}) {
  const adminRoot = path.join(common(), 'worktrees');
  const stale = registrations().filter(tree => tree.prunable && !tree.locked && !localEntry(tree.worktree));
  const dryRun = () => {
    const result = spawnSync('git', ['worktree', 'prune', '--dry-run', '--verbose', '--expire', 'now'],
      { cwd: canonical(), encoding: 'utf8', windowsHide: true, env: { ...process.env, LC_ALL: 'C' } });
    if (result.error || result.status !== 0) throw Error('Cannot preview Git worktree pruning', { cause: result.error });
    return (result.stderr || result.stdout).trim();
  };
  const preview = dryRun();
  if (!preview) return { stale, pruned: [] };
  const byDirectory = new Map(stale.map(tree => [pathKey(tree.worktree), tree]));
  const entries = preview.split(/\r?\n/).map(line => {
    const id = /^Removing worktrees\/([^/\\]+): gitdir file points to non-existent location$/.exec(line)?.[1];
    if (!id || !/^[a-zA-Z0-9_.-]+$/.test(id) || id === '.' || id === '..') throw Error('Git proposes pruning an unverified registration');
    const directory = path.join(adminRoot, id);
    if (!samePath(realpathSync(directory), directory)) throw Error('Git worktree admin directory resolves through a link');
    const gitdir = readFileSync(path.join(directory, 'gitdir'), 'utf8').trim();
    const tree = byDirectory.get(pathKey(path.dirname(path.resolve(directory, gitdir))));
    if (!tree || path.basename(gitdir) !== '.git') throw Error('Git proposes pruning a registration whose checkout could not be verified missing');
    return { id, directory, tree };
  });
  if (!execute) return { stale, eligible: entries.map(entry => entry.tree), pruned: [] };
  const main = new Set(git('rev-list', 'origin/main').split(/\r?\n/));
  for (const { id, directory, tree } of entries) archiveGitMetadata(directory, path.join('stale', id), tree.HEAD, null, sha => main.has(sha));
  if (dryRun() !== preview || entries.some(({ tree }) => localEntry(tree.worktree))) throw Error('Git registrations changed after preservation');
  git('worktree', 'prune', '--expire', 'now');
  return { stale, pruned: entries.map(entry => entry.tree) };
}

export function cleanupSourceWorkspaces({ execute = false, name, inspect = false, locked = false, readPulls = pullInventory } = {}) {
  const tasks = recordsByName('source-tasks'), historical = recordsByName('workspaces');
  const operations = [...stateRecords('workspace-operations'), ...stateRecords('source-operations')];
  const recorded = recordsByName('source-completions');
  for (const [legacyName, record] of historical) {
    if (record.state !== 'finished' || !record.finalSha || tasks.has(legacyName) || !workspaceName(legacyName)) continue;
    tasks.set(legacyName, record);
    if (!recorded.has(legacyName)) recorded.set(legacyName, { name: legacyName, directory: record.directory, owner: record.owner,
      branch: record.branch, finalSha: record.finalSha, outcome: 'completed', retirement: 'retained' });
  }
  const completions = [...recorded.values()].filter(record => record.outcome === 'completed' &&
    record.retirement !== 'retired' && (!name || name === record.name));
  if (!completions.length) return { retired: [], ready: [], protected: [] };
  const trees = registrations();
  const management = managedRoot();
  const github = githubOrigin();
  if (execute || inspect) git('fetch', '--no-write-fetch-head', 'origin');
  const main = new Set(git('rev-list', 'origin/main').split(/\r?\n/));
  const pulls = readPulls(name ? tasks.get(name)?.branch : undefined);
  const result = { retired: [], ready: [], protected: [] };
  for (const completion of completions) {
    const task = tasks.get(completion.name);
    const protect = reason => result.protected.push({ name: completion.name, directory: completion.directory, reason });
    const proof = integrationEvidence(pulls, completion.branch, completion.finalSha, { github, contains: sha => main.has(sha) });
    if (!task || !proof) { protect('missing owner record or exact merged main PR evidence'); continue; }
    try {
      const tree = trees.find(item => samePath(item.worktree, task.directory));
      const reason = localSafety(task, completion, tree, operations, historical.get(task.name), management, !execute);
      if (reason) { protect(reason); continue; }
      const candidate = { name: task.name, directory: task.directory, branch: task.branch, head: completion.finalSha, pr: proof };
      if (!execute) { result.ready.push(candidate); continue; }
      const retire = () => {
        const file = completionFile(task.name);
        const latest = optionalJson(file) || completion;
        if (latest.retirement === 'retired') return;
        if (latest.outcome !== 'completed' || latest.finalSha !== completion.finalSha) throw Error('Owner completion changed during cleanup');
        const history = optionalJson(path.join(stateDir(), 'workspaces', `${task.name}.json`));
        const currentTask = optionalJson(sourceTaskFile(task.name)) || history;
        const current = registrations().find(item => samePath(item.worktree, task.directory));
        const markers = () => [...stateRecords('workspace-operations'), ...stateRecords('source-operations')];
        if (!currentTask) throw Error('Owner record disappeared during cleanup');
        const hold = localSafety(currentTask, latest, current, markers(), history, management);
        if (hold) throw Error(hold);
        if (current) {
          gitAdminSnapshot(current, task.name, sha => main.has(sha));
          save(file, { ...latest, retirement: 'removing', mergedPr: proof });
          // Native removal checks tracked and untracked files again. Retest ignored files just before it.
          const run = (...args) => command('git', args, { cwd: currentTask.directory });
          const status = sourceStatus(run);
          if (status && !verifiedGenerated(currentTask, status)) throw Error('Workspace changed during retirement');
          git('worktree', 'remove', currentTask.directory);
        }
        save(file, { ...latest, retirement: 'removed', mergedPr: proof });
        if (registrations().some(item => item.branch === branchRef(task.branch))) throw Error('Branch is checked out in another workspace');
        if (ref(branchRef(task.branch))) git('update-ref', '-d', branchRef(task.branch), latest.finalSha);
        save(file, { ...latest, retirement: 'retired', retiredAt: new Date().toISOString(), mergedPr: proof });
        result.ready.push(candidate);
        result.retired.push(candidate);
      };
      if (locked) retire();
      else withCapacityLock(retire);
    } catch (error) { protect(error.message.split(/\r?\n/)[0]); }
  }
  return result;
}
