import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import { ancestor, command, common, git, ref, save, stateDir } from './runtime.mjs';
import { REPO, exactSha } from './policy.mjs';
import { canonical, completionFile, localEntry, managedRoot, optionalJson, pathKey, registrations, samePath, sourceTaskFile, split,
  stateRecords, workspaceName } from './workspace-capacity.mjs';
import { generatedEntries, generatedRetirementPlan, verifiedTypeScriptBuildInfo } from './workspace-cache.mjs';
import { dependencyLinkPlan, readArchivedRetirement, removeRetirementResidue, retirementResidue } from './workspace-residue.mjs';

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
const archivedCompletions = () => new Set(stateRecords('source-archive').map(record => record.name));

const retiring = new Set(['removing', 'removed', 'retired']);
const retirementArchive = name => path.join(stateDir(), 'source-recovery', 'retirements', name);
const preservedHead = (name, head) => ref('refs/preserve/source-recovery/retirements/' + name + '/' + head);
const gitOperationFiles = ['index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG'];

function removeEmptyGeneratedParents(directory, relative) {
  let current = path.dirname(path.join(directory, relative));
  while (!samePath(current, directory)) {
    const relativeParent = path.relative(directory, current);
    if (!relativeParent || relativeParent.startsWith('..') || path.isAbsolute(relativeParent) ||
        !localEntry(current)?.isDirectory() || !samePath(realpathSync(current), current)) return;
    try { rmdirSync(current); }
    catch (error) { if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) return; throw error; }
    current = path.dirname(current);
  }
}

function assertLocalIdentity(task, completion, tree, operations, historical, management) {
  if (!workspaceName(task.name) || !task.owner?.trim() || task.branch !== 'codex/' + task.name || task.state === 'creating' ||
    completion.name !== task.name || completion.owner !== task.owner || completion.branch !== task.branch ||
    !samePath(task.directory, completion.directory) || !samePath(task.directory, path.join(management, task.name))) throw Error('Ownership or workspace path mismatch');
  if (operations.some(op => op.name === task.name || (op.source?.directory && samePath(op.source.directory, task.directory)))) throw Error('In-flight or interrupted workspace operation');
  if (historical && !['finished', 'retired'].includes(historical.state)) throw Error('Protected historical workspace state: ' + historical.state);
  if (tree && (tree.locked || tree.prunable || tree.branch !== branchRef(task.branch) || tree.HEAD !== completion.finalSha || completion.retirement === 'retired')) {
    throw Error('Registration is locked, stale or changed since completion');
  }
  if (!tree && !retiring.has(completion.retirement)) throw Error('Registration disappeared outside governed cleanup');
  const local = ref(branchRef(task.branch));
  if (local !== completion.finalSha && (tree || local)) throw Error('Local branch moved or disappeared after completion');
  const remote = ref('refs/remotes/origin/' + task.branch);
  if (remote && remote !== completion.finalSha) throw Error('Remote branch moved after completion');
}

function registeredRetirement(task, completion) {
  const entry = localEntry(task.directory);
  if (!entry?.isDirectory() || !samePath(realpathSync(task.directory), task.directory)) throw Error('Workspace path is missing or resolves through a link');
  const run = (...args) => command('git', args, { cwd: task.directory });
  if (run('branch', '--show-current') !== task.branch || run('rev-parse', 'HEAD') !== completion.finalSha) throw Error('Checkout changed after completion');
  const admin = run('rev-parse', '--absolute-git-dir');
  if (!samePath(path.dirname(admin), path.join(common(), 'worktrees')) || !samePath(realpathSync(admin), admin)) throw Error('Unexpected Git worktree metadata path');
  const operation = gitOperationFiles.find(name => localEntry(path.join(admin, name)));
  if (operation) throw Error('Unresolved Git operation: ' + operation);
  if (split(run('ls-files', '-v', '-z')).some(line => /^[a-zS]/.test(line))) throw Error('Index contains assume-unchanged or skip-worktree paths');
  const status = sourceStatus(run);
  const links = generatedRetirementPlan(task, status, completion.finalSha);
  return { links, generated: links.verifiedGenerated || [] };
}

function unregisteredRetirement(task, completion, proof) {
  if (completion.mergedPr?.mergeSha !== proof.mergeSha || completion.mergedPr?.number !== proof.number ||
      !readArchivedRetirement(retirementArchive(task.name), task, completion.finalSha, preservedHead(task.name, completion.finalSha))) {
    throw Error('Unregistered retirement lacks matching archived Git and merged PR evidence');
  }
  if (!localEntry(task.directory)) return new Map();
  const allowed = dependencyLinkPlan(task, completion.finalSha, generatedEntries(task));
  // Old completions have the install fingerprint and Git archive. New ones also
  // recorded the exact verified links before Git started removal.
  const recorded = completion.retirementLinks;
  if (recorded !== undefined && (!Array.isArray(recorded) || recorded.some(pair =>
    !Array.isArray(pair) || pair.length !== 2 || !allowed.has(pair[0]) || allowed.get(pair[0]) !== pair[1]))) {
    throw Error('Saved retirement link plan no longer matches the dependency lockfile');
  }
  const links = recorded === undefined ? allowed : new Map(recorded);
  if (completion.retirementGenerated !== undefined && !Array.isArray(completion.retirementGenerated)) {
    throw Error('Saved generated-cache retirement plan is malformed');
  }
  for (const relative of completion.retirementGenerated || []) {
    if (!/^(?:apps\/[^/]+)\/tsconfig\.tsbuildinfo$/.test(relative)) throw Error(`Unverified generated cache residue: ${relative}`);
    const file = path.join(task.directory, relative);
    if (!localEntry(file)) continue;
    if (!verifiedTypeScriptBuildInfo(task, relative, completion.finalSha)) throw Error(`Unverified generated cache residue: ${relative}`);
    unlinkSync(file);
    removeEmptyGeneratedParents(task.directory, relative);
  }
  retirementResidue(task.directory, links, completion.retirementGenerated || []);
  for (const relative of completion.retirementGenerated || []) removeEmptyGeneratedParents(task.directory, relative);
  return links;
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

const nativeWorktreeRemove = directory => command('git', ['worktree', 'remove', directory], { timeout: 30000 });

export function cleanupSourceWorkspaces({ execute = false, name, inspect = false,
  readPulls = pullInventory, removeWorktree = nativeWorktreeRemove } = {}) {
  const tasks = recordsByName('source-tasks'), historical = recordsByName('workspaces');
  const recorded = recordsByName('source-completions');
  const archived = archivedCompletions();
  const trees = registrations();
  for (const [legacyName, record] of historical) {
    if (archived.has(legacyName) || record.state !== 'finished' || !record.finalSha || tasks.has(legacyName) || !workspaceName(legacyName)) continue;
    tasks.set(legacyName, record);
    if (!recorded.has(legacyName)) recorded.set(legacyName, { name: legacyName, directory: record.directory, owner: record.owner,
      branch: record.branch, finalSha: record.finalSha, outcome: 'completed', retirement: 'retained' });
  }
  // Archived tasks normally stay out of startup processing. Reopen only a completed
  // retirement whose supposedly removed checkout or registration physically reappears.
  for (const task of stateRecords('source-archive')) {
    if (!localEntry(task.directory) && !trees.some(tree => samePath(tree.worktree, task.directory))) continue;
    tasks.set(task.name, task);
    if (!recorded.has(task.name)) recorded.set(task.name, task);
  }
  const completions = [...recorded.values()].filter(record => {
    if (record.outcome !== 'completed' || (name && name !== record.name)) return false;
    const task = tasks.get(record.name);
    // Historical completion records are searchable evidence, not startup work.
    // Only reconcile a task while a physical checkout/residue or Git registration exists.
    if (!task || !samePath(task.directory, path.join(managedRoot(), task.name))) return false;
    return Boolean(localEntry(task.directory) || trees.some(tree => samePath(tree.worktree, task.directory)));
  });
  const result = { retired: [], ready: [], protected: [] };
  if (!completions.length) return result;
  process.stderr.write(`workspace retirement: verifying ${completions.length} physical checkout(s)\n`);
  const management = managedRoot();
  const github = githubOrigin();
  if (execute || inspect) command('git', ['fetch', '--no-write-fetch-head', 'origin'], { timeout: 45000 });
  const main = new Set(git('rev-list', 'origin/main').split(/\r?\n/));
  const pulls = readPulls(name ? tasks.get(name)?.branch : undefined);
  const markers = () => [...stateRecords('workspace-operations'), ...stateRecords('source-operations')];
  for (const completion of completions) {
    process.stderr.write(`workspace retirement: checking ${completion.name}\n`);
    const task = tasks.get(completion.name);
    const protect = reason => result.protected.push({ name: completion.name, directory: completion.directory, reason });
    const proof = integrationEvidence(pulls, completion.branch, completion.finalSha, { github, contains: sha => main.has(sha) });
    if (!task || !proof) { protect('Missing owner record or exact merged main PR evidence'); continue; }
    const candidate = { name: task.name, directory: task.directory, branch: task.branch, head: completion.finalSha, pr: proof };
    try {
      if (!execute) {
        const tree = trees.find(item => samePath(item.worktree, task.directory));
        assertLocalIdentity(task, completion, tree, markers(), historical.get(task.name), management);
        if (tree) registeredRetirement(task, completion);
        else unregisteredRetirement(task, completion, proof);
        result.ready.push({ ...candidate, action: tree ? 'retire-checkout' : 'finish-retirement' });
        continue;
      }
      const retire = () => {
        const file = completionFile(task.name);
        let latest = optionalJson(file) || completion;
        if (latest.retirement === 'retired' && !localEntry(task.directory)) return;
        if (latest.outcome !== 'completed' || latest.finalSha !== completion.finalSha) throw Error('Owner completion changed during cleanup');
        const history = optionalJson(path.join(stateDir(), 'workspaces', task.name + '.json'));
        const currentTask = optionalJson(sourceTaskFile(task.name)) || history || optionalJson(path.join(stateDir(), 'source-archive', `${task.name}.json`));
        if (!currentTask) throw Error('Owner record disappeared during cleanup');
        const current = registrations().find(item => samePath(item.worktree, currentTask.directory));
        assertLocalIdentity(currentTask, latest, current, markers(), history, management);
        if (current) {
          registeredRetirement(currentTask, latest);
          gitAdminSnapshot(current, task.name, sha => main.has(sha));
          // Recheck ignored and source content after archiving Git evidence. Record the
          // exact link paths before native Git may delete their targets.
          const plan = registeredRetirement(currentTask, latest);
          latest = { ...latest, retirement: 'removing', mergedPr: proof, retirementLinks: [...plan.links], retirementGenerated: plan.generated };
          save(file, latest);
          try { removeWorktree(currentTask.directory); }
          catch (error) {
            if (registrations().some(item => samePath(item.worktree, currentTask.directory))) {
              throw Error('Native Git retirement did not finish. The checkout stays registered for inspection', { cause: error });
            }
          }
        }
        if (registrations().some(item => samePath(item.worktree, currentTask.directory))) throw Error('Git worktree registration remains');
        const links = unregisteredRetirement(currentTask, latest, proof);
        if (localEntry(currentTask.directory)) removeRetirementResidue(currentTask.directory, links, latest.retirementGenerated || []);
        if (localEntry(currentTask.directory)) throw Error('Physical workspace directory remains after retirement');
        save(file, { ...latest, retirement: 'removed', mergedPr: proof });
        if (registrations().some(item => item.branch === branchRef(task.branch))) throw Error('Branch is checked out in another workspace');
        if (ref(branchRef(task.branch))) git('update-ref', '-d', branchRef(task.branch), latest.finalSha);
        save(file, { ...latest, retirement: 'retired', retiredAt: latest.retiredAt || new Date().toISOString(),
          ...(latest.retirement === 'retired' ? { residueReconciledAt: new Date().toISOString() } : {}), mergedPr: proof });
        const retired = optionalJson(file);
        save(path.join(stateDir(), 'source-archive', `${task.name}.json`), { ...currentTask, ...retired,
          archivedAt: new Date().toISOString(), searchable: true });
        unlinkSync(file);
        const activeTaskFile = sourceTaskFile(task.name);
        if (localEntry(activeTaskFile)) unlinkSync(activeTaskFile);
        result.ready.push({ ...candidate, action: current ? 'retire-checkout' : 'finish-retirement' });
        result.retired.push(candidate);
      };
      // Git inspection, metadata archival and native worktree removal may take minutes.
      // Never hold the shared SQLite admission lock during those operations. The retirement
      // intent and identity are re-read immediately before the irreversible remove.
      retire();
    } catch (error) { protect(error.message.split(/\r?\n/)[0]); }
  }
  return result;
}
