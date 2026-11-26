import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { ancestor, command, common, ghApi, git, ref, root, save, stateDir } from './runtime.mjs';
import { REPO, exactSha, partialPathOverlap, risk, safeScope } from './policy.mjs';
import { successfulValidation } from './releases.mjs';
import { canonical, completionFile, localEntry, managedRoot, optionalJson, registrations, requireCanonical, samePath,
  sourceTaskFile, split, stateRecords, withCapacityLock, workspaceInventory, workspaceName } from './workspace-capacity.mjs';
import { cleanupSourceWorkspaces, githubOrigin, integrationEvidence, pullInventory, sourceStatus } from './workspace-retirement.mjs';

const queueFile = name => path.join(stateDir(), 'source-queue', `${name}.json`);
const operationFile = id => path.join(stateDir(), 'source-operations', `${id}.json`);
function exited(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
const fetchMain = () => {
  git('fetch', '--no-write-fetch-head', 'origin', 'main');
  return exactSha(git('rev-parse', 'origin/main'));
};
const validateName = name => {
  if (!workspaceName(name)) throw Error('Use a 3–61 character lowercase workspace name');
  return name;
};

function openOverlap(paths, base) {
  if (!githubOrigin()) return { status: 'local fixture', overlaps: [], uninspected: [] };
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

function assertClaimAvailable(task, inventory) {
  if (localEntry(task.directory) || localEntry(sourceTaskFile(task.name))) {
    throw Error('Task name, path or branch already exists; choose a new name');
  }
  if (inventory.entries.some(entry => entry.owner === task.owner && ['awaiting-cleanup', 'retirement-residue'].includes(entry.state))) {
    throw Error('Your prior task is awaiting cleanup. Complete its merge or resolve its cleanup blocker before starting another task');
  }
}

function reserveSourceTask(task, queued) {
  mkdirSync(managedRoot(), { recursive: true });
  if (!samePath(realpathSync(managedRoot()), managedRoot())) throw Error('Managed workspace root resolves through a link');
  const reservation = { ...task, startedAt: new Date().toISOString(), state: 'creating',
    ...(queued ? { queuedAt: queued.queuedAt } : {}) };
  save(sourceTaskFile(task.name), { ...reservation, pid: process.pid });
  if (queued) unlinkSync(queueFile(task.name));
  return reservation;
}

function materializeSourceTask(claim) {
  // The creating reservation owns a slot. Git may be slow, so mutate the worktree
  // outside SQLite and revalidate the reservation before marking it active.
  git('worktree', 'add', '--quiet', '-b', claim.branch, claim.directory, claim.baseline);
  return withCapacityLock(() => {
    const current = optionalJson(sourceTaskFile(claim.name));
    if (current?.state !== 'creating' || current.owner !== claim.owner || current.baseline !== claim.baseline ||
      !samePath(current.directory, claim.directory) || !localEntry(claim.directory)?.isDirectory()) {
      throw Error('Checkout was created, but its reservation changed before activation; preserve for recovery');
    }
    const active = { ...claim, state: 'active' };
    save(sourceTaskFile(claim.name), active);
    return active;
  });
}

function taskClaim(name, owner, baseline, paths) {
  return { name, owner, branch: 'codex/' + name, directory: path.join(managedRoot(), name), baseline, paths };
}

function annotatedTask(task) {
  return { ...task, risk: task.paths.length ? risk(task.paths) : 'unclassified', review: openOverlap(task.paths, task.baseline) };
}

function alreadyPromoted(name, owner) {
  const task = optionalJson(sourceTaskFile(name));
  if (task?.owner !== owner || !task.queuedAt) return null;
  if (task.state === 'creating') return { name, owner, state: 'creating' };
  if (task.state !== 'active' || optionalJson(completionFile(name))) return null;
  sourceWorkspace(name);
  return task;
}

export function createSourceWorkspace(name, options) {
  requireCanonical();
  validateName(name);
  if (!options.owner?.trim()) throw Error('--owner is required for task metadata');
  const promoted = alreadyPromoted(name, options.owner);
  if (promoted) return promoted.state === 'active' ? annotatedTask(promoted) : promoted;
  const paths = options.scope ? options.scope.split(',').map(safeScope) : [];
  const task = { ...taskClaim(name, options.owner, fetchMain(), paths),
    ...(options.infrastructureRecovery ? { bootstrapException: options.infrastructureRecovery } : {}) };
  if (git('ls-remote', '--heads', 'origin', 'refs/heads/' + task.branch)) throw Error('Task name, path or branch already exists; choose a new name');
  if (ref(`refs/heads/${task.branch}`)) throw Error('Task name, path or branch already exists; choose a new name');
  const observedRegistrations = registrations();
  const claim = withCapacityLock(() => {
    const currentTask = optionalJson(sourceTaskFile(name));
    if (currentTask?.owner === options.owner && currentTask.queuedAt && currentTask.state === 'creating') return { ...currentTask, alreadyPromoted: true };
    const inventory = workspaceInventory({ observedRegistrations });
    assertClaimAvailable(task, inventory);
    const otherRecovery = inventory.entries.some(entry => entry.name !== name && /^infra-recovery-/.test(entry.name || ''));
    if (task.bootstrapException && (inventory.bootstrapExceptions || otherRecovery)) {
      throw Error('The single infrastructure-recovery slot is already occupied');
    }
    const existing = inventory.queue.find(entry => entry.name === name);
    if (existing && existing.owner !== options.owner) throw Error('This task is queued by a different owner');
    if (!task.bootstrapException && (!inventory.available || (inventory.queue.length && inventory.queue[0].name !== name))) {
      const queued = existing || { name, owner: options.owner, paths, position: (inventory.queue.at(-1)?.position || 0) + 1, queuedAt: new Date().toISOString() };
      if (!existing) save(queueFile(name), queued);
      return { ...queued, state: 'queued', occupied: inventory.occupied, available: inventory.available, limit: inventory.limit };
    }
    return reserveSourceTask(task, existing);
  });
  if (claim.state === 'queued' || (claim.alreadyPromoted && claim.state === 'creating')) return claim;
  return annotatedTask(claim.alreadyPromoted ? claim : materializeSourceTask(claim));
}

export function createInfrastructureRecoveryWorkspace(name, options) {
  requireCanonical();
  if (!/^infra-recovery-[a-z0-9-]{3,40}$/.test(name || '') || !options.owner?.trim() || !options.reason?.trim()) {
    throw Error('Infrastructure recovery requires an infra-recovery-* task name, --owner and a specific --reason');
  }
  const allowed = new Set(['tools/workflow', 'AGENTS.md', 'overnight.md', 'docs/deployment/workspace-management.md',
    'docs/deployment/workflow.md', 'docs/deployment/hospitality-menu-studio-staging.md']);
  const scope = options.scope?.split(',').map(safeScope) || [];
  if (!scope.length || scope.some(item => !allowed.has(item))) {
    throw Error('Recovery scope is limited to tools/workflow and the named governance documents');
  }
  if (options.reason.trim().length < 20) throw Error('Recovery reason must identify the reproducible admission or retirement defect');
  return createSourceWorkspace(name, { ...options, scope: scope.join(','), infrastructureRecovery: {
    authorization: 'owner-authorized-infrastructure-recovery', capacityExempt: true, taskName: name,
    owner: options.owner, reason: options.reason.trim(), scope,
    authorizedAt: new Date().toISOString(),
  } });
}

export function assignSourceWriter(name, options) {
  requireCanonical();
  validateName(name);
  if (!options.owner?.trim() || !options.writer?.trim()) throw Error('Writer assignment requires the task --owner and --writer');
  const paths = options.scope?.split(',').map(safeScope) || [];
  if (!paths.length) throw Error('Writer assignment requires explicit --scope paths');
  return withCapacityLock(() => {
    const file = sourceTaskFile(name), task = optionalJson(file);
    if (!task || task.state !== 'active' || task.owner !== options.owner) throw Error('Only the active accountable task owner can assign writers');
    const writers = task.writers || [];
    if (writers.some(writer => writer.name === options.writer)) throw Error('Writer already has an assignment; update requires removing its existing ownership first');
    const overlaps = writers.flatMap(writer => writer.scope.flatMap(owned => paths
      .filter(candidate => partialPathOverlap(owned, candidate)).map(candidate => ({ writer: writer.name, owned, requested: candidate }))));
    if (overlaps.length) throw Error(`Writer scopes overlap: ${JSON.stringify(overlaps)}`);
    const assignment = { name: options.writer.trim(), scope: paths, assignedAt: new Date().toISOString(), assignedBy: options.owner };
    save(file, { ...task, writers: [...writers, assignment] });
    return assignment;
  });
}

export function sourceWriters(name) {
  requireCanonical();
  validateName(name);
  const task = optionalJson(sourceTaskFile(name));
  if (!task) throw Error('Task has no active writer registry');
  return { name, owner: task.owner, writers: task.writers || [] };
}

/** Reserve each released slot at the head of the FIFO queue. If Git or a head
 * claim fails, report it and preserve the reservation or queue entry. */
export function promoteSourceQueue() {
  requireCanonical();
  const result = { admitted: [] };
  const initial = workspaceInventory();
  if (!initial.available || !initial.queue.length) return result;
  let name = initial.queue[0].name;
  try {
    const baseline = fetchMain();
    while (true) {
      // Fetch and remote branch inspection happen outside the capacity lock.
      const observed = workspaceInventory();
      const head = observed.queue[0];
      if (!observed.available || !head) return result;
      name = validateName(head.name);
      if (!head.owner?.trim()) throw Error('Queued claim is missing its owner');
      const paths = (head.paths ?? []).map(safeScope);
      const task = taskClaim(name, head.owner, baseline, paths);
      if (git('ls-remote', '--heads', 'origin', 'refs/heads/' + task.branch)) throw Error('Queued branch already exists remotely');
      if (ref(`refs/heads/${task.branch}`)) throw Error('Queued branch already exists locally');
      const observedRegistrations = registrations();
      const claim = withCapacityLock(() => {
        const inventory = workspaceInventory({ observedRegistrations });
        const next = inventory.queue[0];
        if (!inventory.available || !next) return null;
        if (next.name !== name || next.owner !== head.owner || next.queuedAt !== head.queuedAt) return false;
        assertClaimAvailable(task, inventory);
        return reserveSourceTask({ ...task, promotedAt: new Date().toISOString() }, next);
      });
      if (claim === null) return result;
      if (claim === false) continue;
      result.admitted.push(materializeSourceTask(claim));
    }
  } catch (error) {
    return { ...result, blocked: { name, reason: error.message.split(/\r?\n/)[0] } };
  }
}

export function cancelSourceQueue(name, options) {
  requireCanonical();
  validateName(name);
  return withCapacityLock(() => {
    const file = queueFile(name), entry = optionalJson(file);
    if (!entry) return { name, state: 'not-queued' };
    if (entry.owner !== options.owner) throw Error('Only the queued task owner can cancel its claim');
    unlinkSync(file);
    return { name, state: 'cancelled' };
  });
}

export function recoverSourceReservation(name, options) {
  requireCanonical();
  validateName(name);
  const file = sourceTaskFile(name), task = optionalJson(file);
  if (!task || task.state !== 'creating' || task.owner !== options.owner || !options.reason?.trim() ||
    !samePath(task.directory, path.join(managedRoot(), name)) || task.branch !== `codex/${name}` ||
    !Number.isSafeInteger(task.pid) || task.pid < 1) throw Error('Recovery requires the interrupted reservation owner and --reason confirming all checkout processes have stopped');
  if (!exited(task.pid)) throw Error('Reservation process may still be running');
  const tree = registrations().find(item => samePath(item.worktree, task.directory));
  let state = 'cancelled';
  if (tree) {
    const workspace = sourceWorkspace(name);
    if (workspace.head !== task.baseline || sourceStatus(workspace.run)) throw Error('Interrupted checkout contains changes. Preserve it for manual recovery');
    state = 'active';
  } else if (localEntry(task.directory) || ref(`refs/heads/${task.branch}`)) {
    throw Error('Interrupted checkout left a directory or branch. Preserve it for manual recovery');
  }
  return withCapacityLock(() => {
    const current = optionalJson(file);
    if (current?.state !== 'creating' || current.owner !== task.owner || current.pid !== task.pid ||
        current.baseline !== task.baseline || !samePath(current.directory, task.directory)) {
      throw Error('Reservation changed while recovery evidence was checked');
    }
    const recovered = { ...current, state, recoveryReason: options.reason, recoveredAt: new Date().toISOString() };
    save(file, recovered);
    return recovered;
  });
}

export function sourceWorkspace(name) {
  validateName(name);
  const directory = path.join(managedRoot(), name), branch = `codex/${name}`;
  const tree = registrations().find(entry => samePath(entry.worktree, directory));
  if (!tree || tree.locked || tree.prunable || tree.branch !== `refs/heads/${branch}` || !samePath(realpathSync(directory), directory)) throw Error('Expected an independent registered task checkout on its named branch');
  const run = (...args) => command('git', args, { cwd: directory });
  if (run('branch', '--show-current') !== branch || run('rev-parse', 'HEAD') !== tree.HEAD) throw Error('Task checkout changed during inspection');
  return { name, directory, branch, head: exactSha(tree.HEAD), task: optionalJson(sourceTaskFile(name)), run };
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
  // The dashboard consumes this advisory contract independently of the coordinator inventory.
  const prefix = 'refs/heads/codex/';
  const tasks = path.join(common(), 'fika-workflow', 'source-tasks');
  const entries = registrations().filter(tree => tree.branch?.startsWith(prefix)).map(tree => {
    const name = tree.branch.slice(prefix.length);
    const task = workspaceName(name) ? optionalJson(path.join(tasks, `${name}.json`)) : null;
    return { name, branch: `codex/${name}`, head: tree.HEAD, owner: task?.owner || null, protected: Boolean(tree.locked || tree.prunable) };
  });
  return { observedAt: new Date().toISOString(), entries };
}

export function runSourceOperation(kind, action, name, { capacityLock = withCapacityLock } = {}) {
  if (!name && samePath(root(), canonical())) return action();
  const observed = sourceWorkspace(name || path.basename(root()));
  if (!name && !samePath(observed.directory, root())) throw Error('Use a governed task checkout');
  const operation = capacityLock(() => {
    const task = optionalJson(sourceTaskFile(observed.name)), head = observed.head;
    if (!task || task.state === 'creating' || task.owner !== observed.task?.owner || !samePath(task.directory, observed.directory)) {
      throw Error('Task registration changed while starting the operation');
    }
    const completion = optionalJson(completionFile(task.name));
    if (kind !== 'integrate' && completion?.outcome === 'completed' && completion.finalSha === head) {
      throw Error('Task is awaiting cleanup. The owner must explicitly preserve it before restarting work');
    }
    if (stateRecords('source-operations').some(marker => marker.name === task.name)) {
      throw Error('A governed operation is active or interrupted in this workspace');
    }
    const id = randomUUID();
    const file = operationFile(id);
    save(file, { id, kind, name: task.name, owner: task.owner, pid: process.pid, startedAt: new Date().toISOString() });
    return { file, workspace: observed };
  });
  try {
    // Reserve the operation under the filesystem-only capacity lock, then recheck
    // Git after releasing it. The marker prevents another governed operation from
    // starting while this post-marker stale-head check runs.
    if (operation.workspace.run('rev-parse', 'HEAD') !== operation.workspace.head) {
      throw Error('Task checkout changed while starting the operation');
    }
    return action(operation.workspace);
  }
  finally { capacityLock(() => unlinkSync(operation.file)); }
}

export function recoverSourceOperation(id, options) {
  requireCanonical();
  if (!/^[0-9a-f-]{36}$/.test(id || '')) throw Error('Use the interrupted operation ID');
  return withCapacityLock(() => {
    const file = operationFile(id), marker = optionalJson(file);
    if (!marker || marker.id !== id || marker.owner !== options.owner || !options.reason?.trim() ||
      !Number.isSafeInteger(marker.pid) || marker.pid < 1) throw Error('Recovery requires the operation owner and --reason confirming all child processes have exited');
    if (!exited(marker.pid)) throw Error('Operation process may still be running');
    const archive = path.join(stateDir(), 'source-operation-recovery', `${id}.json`);
    save(file, { ...marker, recoveredAt: new Date().toISOString(), recoveryReason: options.reason });
    mkdirSync(path.dirname(archive), { recursive: true });
    if (localEntry(archive)) throw Error('Operation recovery evidence already exists');
    renameSync(file, archive);
    return { id, state: 'recovered', archive };
  });
}

export function completeSourceWorkspace(name, options, dependencies) {
  requireCanonical();
  validateName(name);
  const archived = optionalJson(path.join(stateDir(), 'source-archive', `${name}.json`));
  if (archived?.owner === options.owner && archived.retirement === 'retired' && !localEntry(archived.directory)) return archived;
  const completion = completeUnderLock(name, options, dependencies);
  return !options.preserve && completion.retirement === 'retired' && !localEntry(completion.directory)
    ? { ...completion, promotion: promoteSourceQueue() } : completion;
}

function completeUnderLock(name, options, { readPrs = pullInventory } = {}) {
  const previous = optionalJson(completionFile(name));
  if (previous?.retirement === 'retired' && previous.owner === options.owner && !localEntry(previous.directory)) return previous;
  if (['removing', 'removed', 'retired'].includes(previous?.retirement) && previous.owner === options.owner) {
    if (options.preserve) throw Error('Retirement already started. Inspect the preserved evidence with workspace cleanup without --execute');
    const cleanup = cleanupSourceWorkspaces({ execute: true, name, readPulls: () => readPrs(previous.branch) });
    return { ...(optionalJson(completionFile(name)) || optionalJson(path.join(stateDir(), 'source-archive', `${name}.json`))), cleanup };
  }
  const { branch, directory, head, task, run } = sourceWorkspace(name);
  if (!task || !options.owner || task.owner !== options.owner || task.state === 'creating') throw Error('Use the registered task owner for the completion record');
  if (options.preserve && !options.reason?.trim()) throw Error('Preserving unfinished work requires --reason');
  const status = sourceStatus(run);
  const dirty = split(status).some(line => !line.startsWith('!! '));
  let evidence = { pushed: false, inMain: false, pr: null };
  let pulls = [], merged = null;
  try {
    git('fetch', '--no-write-fetch-head', 'origin');
    evidence = { ...evidence, pushed: ref(`refs/remotes/origin/${branch}`) === head, inMain: ancestor(head, 'origin/main') };
    if (githubOrigin()) {
      pulls = readPrs(branch);
      const pr = pulls.find(item => item.head?.sha === head && item.head?.ref === branch && item.head?.repo?.full_name === REPO && item.base?.repo?.full_name === REPO && item.base?.ref === 'main');
      if (pr) evidence.pr = { number: pr.number, state: pr.state, merged: Boolean(pr.merged_at), url: pr.html_url };
    }
    merged = integrationEvidence(pulls, branch, head);
  } catch (error) {
    if (!options.preserve) throw error;
    evidence.unverified = true;
  }
  if (!options.preserve && (dirty || (!evidence.pushed && !evidence.inMain && !merged))) throw Error('Dirty or unpushed work remains. Commit/push or record --preserve --reason; the checkout is retained');
  if (run('branch', '--show-current') !== branch || run('rev-parse', 'HEAD') !== head || sourceStatus(run) !== status) throw Error('Checkout changed during completion');
  const result = { name, owner: options.owner, branch, finalSha: head, ...evidence, outcome: options.preserve ? 'unfinished-preserved' : 'completed',
    ...(options.preserve ? { reason: options.reason } : {}), retirement: 'retained', dirty, ignored: split(status).some(line => line.startsWith('!! ')),
    directory, at: new Date().toISOString() };
  save(completionFile(name), result);
  if (options.preserve || !merged) return result;
  const cleanup = cleanupSourceWorkspaces({ execute: true, name, readPulls: () => pulls });
  return { ...(optionalJson(completionFile(name)) || optionalJson(path.join(stateDir(), 'source-archive', `${name}.json`))), cleanup };
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
