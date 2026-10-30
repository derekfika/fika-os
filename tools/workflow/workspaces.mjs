import path from 'node:path';
import { existsSync, readdirSync, mkdirSync, lstatSync, renameSync, readFileSync, writeFileSync, chmodSync, symlinkSync, readlinkSync, realpathSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { git, common, stateDir, save, jsonFile, lock, ancestor, inside, command, ref, ghApi } from './runtime.mjs';
import { safeScope, partialPathOverlap, digest, REPO, APPS } from './policy.mjs';
import { changelogPath } from './changelog.mjs';
import { applyRevocations, diskRecords, leaseIdentity } from './workspace-state.mjs';

const leases = () => { const p = path.join(stateDir(), 'workspaces'); mkdirSync(p, { recursive: true }); return p; };
const managedRoot = () => path.resolve(common(), '..', '..', 'agent-workspaces', 'fika-os');
const validateName = name => { if (!/^[a-z][a-z0-9-]{2,60}$/.test(name || '')) throw Error('Use a 3–61 character lowercase workspace name'); return name; };
export function workspaceRecords() {
  leases(); const records = diskRecords();
  for (const journal of committedReconciliationJournals()) {
    const diskByName = new Map(records.map(x => [x.name, x]));
    for (const snapshot of [journal.leaseTransition.source, journal.leaseTransition.replacement]) {
      const disk = diskByName.get(snapshot.name);
      if (!disk || disk.owner !== snapshot.owner) throw Error(`Committed reconciliation ${journal.id} has a missing or changed lease owner`);
      if (snapshot.state === 'active' && !['reconciling','active','finished','retired','superseded'].includes(disk.state)) throw Error(`Committed reconciliation ${journal.id} replacement state is contradictory`);
      if (snapshot.state === 'superseded' && !['active','superseded'].includes(disk.state)) throw Error(`Committed reconciliation ${journal.id} source state is contradictory`);
      if (snapshot.state === 'active' && ['finished','retired'].includes(disk.state)) continue;
      const index = records.findIndex(x => x.name === snapshot.name); if (index >= 0) records[index] = snapshot;
    }
  }
  if (new Set(records.map(r => path.resolve(r.directory))).size !== records.length || new Set(records.map(r => r.branch)).size !== records.length) throw Error('Workspace registry has duplicated directories or branches');
  return applyRevocations(records);
}
function committedReconciliationJournals() {
  const transitions = path.join(stateDir(), 'reconciliations'); if (!existsSync(transitions)) return [];
  return readdirSync(transitions, { withFileTypes: true }).filter(x => x.isDirectory()).map(dir => {
    const file = path.join(transitions, dir.name, 'journal.json'); return existsSync(file) ? jsonFile(file) : undefined;
  }).filter(x => x?.phase === 'committed' && x.leaseTransition).sort((a,b) => a.completedAt.localeCompare(b.completedAt)).map(journal => {
    verifyRecoveryArtifact(journal.recoveryFile, journal.recoveryChecksum); return journal;
  });
}
/**
 * Lease IDs are unique, with one historical exception: reconcileWorkspace once copied the source
 * lease (including leaseId) into its replacement. A shared ID is therefore accepted only for exactly
 * one source/replacement pair linked by a committed, checksum-verified reconciliation journal, whose
 * on-disk leases cross-reference that journal and share its owner, and whose states are terminal
 * (superseded source; finished/retired/superseded replacement). Anything else fails closed.
 */
export function assertLeaseIdentitiesUnique(records) {
  const groups = new Map();
  for (const r of records) { const id = leaseIdentity(r); groups.set(id, [...(groups.get(id) || []), r]); }
  const journals = [...groups.values()].some(g => g.length > 1) ? committedReconciliationJournals() : [];
  for (const [id, group] of groups) {
    if (group.length === 1) continue;
    const fail = why => { throw Error(`Registry contains duplicated lease identities: ${why}`); };
    if (group.length !== 2) fail('more than two records share one lease ID');
    const matching = journals.filter(j => group.every(r => [j.source, j.replacement].includes(r.name)));
    if (matching.length !== 1) fail('no single committed reconciliation links them');
    const [journal] = matching; const transition = journal.leaseTransition;
    const source = group.find(r => r.name === journal.source); const replacement = group.find(r => r.name === journal.replacement);
    const journalFile = path.join(stateDir(), 'reconciliations', String(journal.id), 'journal.json');
    if (!source || !replacement) fail('reconciliation does not name both records');
    if (!source.leaseId || id !== source.leaseId || transition.source.leaseId !== id || transition.replacement.leaseId !== id || journal.sourceLease?.leaseId !== id) fail('reconciliation evidence does not carry this lease ID');
    if (source.owner !== journal.owner || replacement.owner !== journal.owner || transition.source.owner !== journal.owner || transition.replacement.owner !== journal.owner) fail('owners differ from the reconciliation');
    if (source.state !== 'superseded' || source.supersededBy !== replacement.name || !source.reconciliationJournal || path.resolve(source.reconciliationJournal) !== journalFile) fail('source is not the superseded side of this reconciliation');
    if (!['finished', 'retired', 'superseded'].includes(replacement.state) || replacement.reconciles?.source !== source.name || !replacement.reconciles.journal || path.resolve(replacement.reconciles.journal) !== journalFile || replacement.reconciles.recoveryChecksum !== journal.recoveryChecksum) fail('replacement is not a terminal successor of this reconciliation');
  }
}
function materializeCommittedTransitions() {
  for (const journal of committedReconciliationJournals()) {
    verifyRecoveryArtifact(journal.recoveryFile, journal.recoveryChecksum);
    const sourceFile = path.join(leases(), `${journal.source}.json`); const replacementFile = path.join(leases(), `${journal.replacement}.json`);
    const sourceDisk = jsonFile(sourceFile); const replacementDisk = jsonFile(replacementFile);
    if (sourceDisk.owner !== journal.owner || replacementDisk.owner !== journal.owner) throw Error(`Committed reconciliation ${journal.id} has a lease owner contradiction`);
    const sourceMatchesBefore = sha256(readFileSync(sourceFile)) === journal.sourceLeaseDigest;
    const sourceMatchesAfter = sourceDisk.state === 'superseded' && sourceDisk.supersededBy === journal.replacement;
    if (sourceMatchesBefore) save(sourceFile, journal.leaseTransition.source); else if (!sourceMatchesAfter) throw Error(`Committed reconciliation ${journal.id} source lease changed unexpectedly`);
    const prepared = journal.preparedReplacement;
    const replacementMatchesBefore = prepared && replacementDisk.state === 'reconciling' && replacementDisk.directory === prepared.directory && replacementDisk.branch === prepared.branch && replacementDisk.baseline === prepared.baseline;
    const replacementMatchesAfter = ['active','finished','retired','superseded'].includes(replacementDisk.state) && replacementDisk.reconciles?.source === journal.source;
    if (replacementMatchesBefore) save(replacementFile, journal.leaseTransition.replacement); else if (!replacementMatchesAfter) throw Error(`Committed reconciliation ${journal.id} replacement lease changed unexpectedly`);
  }
}
export function worktrees() {
  return git('worktree', 'list', '--porcelain').split(/\r?\n\r?\n/).filter(Boolean).map(block => Object.fromEntries(block.split(/\r?\n/).map(line => { const i = line.indexOf(' '); return i < 0 ? [line, true] : [line.slice(0, i), line.slice(i + 1)]; })));
}
export function createWorkspace(name, options) {
  validateName(name); if (!options.owner) throw Error('--owner is required');
  const scopes = String(options.scope || '').split(',').map(safeScope);
  return lock('workspaces', () => {
    git('fetch', 'origin'); const baseline = git('rev-parse', 'origin/main');
    if (existsSync(path.join(leases(), `${name}.json`))) throw Error('Workspace name already registered; never reuse another task lease');
    for (const lease of workspaceRecords().filter(x => x.state === 'active')) for (const a of scopes) for (const b of lease.scopes) if (partialPathOverlap(a, b)) throw Error(`Scope ${a} is owned by ${lease.name}/${lease.owner}`);
    mkdirSync(managedRoot(), { recursive: true });
    const directory = path.join(managedRoot(), name); const branch = `codex/${name}`;
    if (existsSync(directory) || ref(`refs/heads/${branch}`)) throw Error('Workspace path/branch exists; refusing overwrite');
    const portBase = 13000 + workspaceRecords().length * 10;
    if (portBase > 65000) throw Error('Workspace port allocation exhausted');
    const ports = Object.fromEntries(Object.keys(APPS).map((app,i)=>[app,portBase+i]));
    const record = { schema: 'fika.workspace.v1', leaseId: randomUUID(), name, owner: options.owner, scopes, baseline, directory, branch, ports, state: 'creating', createdAt: new Date().toISOString() };
    save(path.join(leases(), `${name}.json`), record);
    try { git('worktree', 'add', '-b', branch, directory, baseline); record.state = 'active'; save(path.join(leases(), `${name}.json`), record); }
    catch (error) { record.state = 'attention'; save(path.join(leases(), `${name}.json`), record); throw error; }
    return record;
  });
}
export function finishWorkspace(name, options) {
  validateName(name); return lock('workspaces', () => {
    const file = path.join(leases(), `${name}.json`); const record = jsonFile(file);
    if (record.owner !== options.owner || workspaceRecords().find(x => x.name === name)?.state !== 'active') throw Error('Only the task owner can finish an active workspace');
    const operations=path.join(stateDir(),'workspace-operations');
    if(existsSync(operations)&&readdirSync(operations).filter(f=>f.endsWith('.json')).some(f=>jsonFile(path.join(operations,f)).name===name))throw Error('Workspace has an in-flight or interrupted operation; reconcile it before completion');
    if (command('git', ['branch', '--show-current'], { cwd: record.directory }) !== record.branch) throw Error('Workspace branch differs from its lease');
    if (options.expectedHead && command('git', ['rev-parse', 'HEAD'], { cwd: record.directory }) !== options.expectedHead) throw Error('HEAD changed during completion; validate the final state again');
    const dirty = command('git', ['status', '--porcelain'], { cwd: record.directory });
    if (dirty && !options.preserve) throw Error('Dirty work must be committed/preserved; finish refuses it');
    if (options.preserve) {
      if (!options.reason?.trim()) throw Error('Preserving unfinished work requires --reason');
      record.preservedWork = preserveWorkspace(record, options.reason);
    }
    record.state = 'finished'; record.finishedAt = new Date().toISOString(); record.lastActivityAt = record.finishedAt; record.finalSha = command('git', ['rev-parse', 'HEAD'], { cwd: record.directory });
    if (options.completion) record.completion = options.completion;
    save(file, record); return record;
  });
}
export function checkWorkspace(name, options) {
  validateName(name);
  const record = jsonFile(path.join(leases(), `${name}.json`));
  if (record.owner !== options.owner || workspaceRecords().find(x => x.name === name)?.state !== 'active') throw Error('Scope check requires the active task owner');
  const run = (...args) => command('git', args, { cwd: record.directory });
  const dirty = [...new Set([run('diff', '--name-only', '--no-renames', 'HEAD'), run('ls-files', '--others', '--exclude-standard')].flatMap(s=>s.split(/\r?\n/)).filter(Boolean))];
  const paths = [...new Set([run('diff', '--name-only', '--no-renames', `${record.baseline}...HEAD`).split(/\r?\n/),dirty].flat().filter(Boolean))];
  const outsideCandidates = paths.filter(p => !changelogPath(p) && !record.scopes.some(s => p === s || p.startsWith(`${s}/`)));
  // Concurrent integration may bring other apps from main into this task. Only exact committed
  // content already in the fetched authority is exempt; dirty or divergent content stays blocked.
  const inheritedFromMain = outsideCandidates.filter(p=>!dirty.includes(p)&&!run('diff','--name-only','HEAD','origin/main','--',p));
  const outside = outsideCandidates.filter(p=>!inheritedFromMain.includes(p));
  if (outside.length) throw Error(`Changes exceed owned scope: ${outside.join(', ')}`);
  return { name, baseline: record.baseline, paths, inheritedFromMain, withinScope: true };
}

/** Preserve unfinished content without changing source, index, branch, ignored files or stashes. */
export function preserveWorkspace(record, reason) {
  const cwd = record.directory; const id = randomUUID();
  const archive = path.join(stateDir(), 'archives', `${record.name}-unfinished-${id}`); mkdirSync(archive, { recursive: true });
  const head = repoCommand(cwd, 'rev-parse', 'HEAD');
  const preservationRef = `refs/preserve/workspace/${record.name}/${id}`;
  repoCommand(cwd, 'update-ref', preservationRef, head, '0'.repeat(40));
  const bundle = path.join(archive, 'commits.bundle'); repoCommand(cwd, 'bundle', 'create', bundle, preservationRef); repoCommand(cwd, 'bundle', 'verify', bundle);
  const payload = { schema: 'fika.workspace-preservation.v1', name: record.name, owner: record.owner, reason, head, branch: record.branch,
    stagedPatch: patch(cwd, ['diff', '--cached', '--binary', '--full-index', 'HEAD']), unstagedPatch: patch(cwd, ['diff', '--binary', '--full-index']),
    files: nulPaths((...args) => repoCommand(cwd, ...args), ['ls-files', '--others', '--exclude-standard', '-z']).map(p => fileSnapshot(cwd, p)),
    ignoredRetained: nulPaths((...args) => repoCommand(cwd, ...args), ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']), at: new Date().toISOString() };
  const recoveryFile = path.join(archive, 'recovery.json'); save(recoveryFile, payload); chmodSync(recoveryFile, 0o600);
  return { preservationRef, bundle, recoveryFile, recoveryChecksum: verifyRecoveryArtifact(recoveryFile, sha256(readFileSync(recoveryFile))), sourceRetained: true };
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyRecoveryArtifact(file, expectedSha256) {
  const actual = sha256(readFileSync(file)); if (actual !== expectedSha256) throw Error(`Recovery checksum mismatch: expected ${expectedSha256}, got ${actual}`); return actual;
}
const scoped = (file, scopes) => scopes.some(scope => file === scope || file.startsWith(`${scope}/`));
function nulPaths(run, args) { const out = run(...args); return out ? out.split('\0').filter(Boolean) : []; }
function repoCommand(cwd, ...args) { return command('git', args, { cwd }); }
function repoText(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); }
function fileSnapshot(rootDir, relative) {
  const absolute = path.resolve(rootDir, relative); const parent = path.dirname(absolute); assertWorkspaceParent(rootDir, parent); const st = lstatSync(absolute);
  if (st.isSymbolicLink()) {
    const target = readlinkSync(absolute); const resolvedTarget = path.resolve(parent, target); const rel = path.relative(path.resolve(rootDir), resolvedTarget);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error(`Untracked symlink escapes the workspace; source remains untouched: ${relative}`);
    return { path: relative, kind: 'symlink', mode: st.mode & 0o777, target, sha256: sha256(Buffer.from(target)) };
  }
  if (!st.isFile()) throw Error(`Unsupported untracked path type; original remains untouched: ${relative}`);
  const bytes = readFileSync(absolute); return { path: relative, kind: 'file', mode: st.mode & 0o777, bytes: bytes.toString('base64'), sha256: sha256(bytes) };
}
function writeSnapshot(rootDir, item) {
  const absolute = path.resolve(rootDir, item.path); const parent = path.dirname(absolute); mkdirSync(parent, { recursive: true }); assertWorkspaceParent(rootDir, parent);
  if (existsSync(absolute) || (() => { try { lstatSync(absolute); return true; } catch { return false; } })()) throw Error(`Replacement already contains ${item.path}; refusing overwrite`);
  if (item.kind === 'symlink') {
    if (sha256(Buffer.from(item.target)) !== item.sha256) throw Error(`Recovery checksum mismatch: ${item.path}`);
    symlinkSync(item.target, absolute);
  } else {
    const bytes = Buffer.from(item.bytes, 'base64'); if (sha256(bytes) !== item.sha256) throw Error(`Recovery checksum mismatch: ${item.path}`);
    writeFileSync(absolute, bytes, { flag: 'wx' }); chmodSync(absolute, item.mode);
  }
}
function assertWorkspaceParent(rootDir, parent) {
  const rootReal = realpathSync(rootDir); const parentReal = realpathSync(parent); const relative = path.relative(rootReal, parentReal);
  if (relative && (relative.startsWith('..') || path.isAbsolute(relative))) throw Error('Recovery path escapes the workspace');
}
function patch(cwd, args) { return repoText(cwd, ...args); }
function buildReconcilePlan(record, targetSha) {
  const cwd = record.directory; const run = (...args) => repoCommand(cwd, ...args);
  if (!existsSync(cwd) || !existsSync(path.join(cwd, '.git'))) throw Error('Existing workspace checkout is unavailable; no recovery action taken');
  if (path.resolve(run('rev-parse', '--show-toplevel')) !== path.resolve(cwd) || run('branch', '--show-current') !== record.branch) throw Error('Workspace checkout or branch does not match its lease');
  const head = run('rev-parse', 'HEAD');
  if (!ancestor(record.baseline, head)) throw Error('Workspace HEAD does not descend from its recorded baseline');
  if (!ancestor(head, targetSha)) throw Error('Ancestor-only reconciliation requires the complete source HEAD to already be in origin/main; unmerged feature commits need separately verified recovery support');
  const committed = nulPaths(run, ['diff', '--no-renames', '--name-only', '-z', `${record.baseline}..${head}`]);
  const outsideCommits = committed.filter(file => !scoped(file, record.scopes));
  if (outsideCommits.length) {
    const different = nulPaths(run, ['diff', '--no-renames', '--name-only', '-z', `${head}..${targetSha}`, '--', ...outsideCommits]);
    if (different.length) throw Error(`Out-of-scope committed content differs at target: ${different.join(', ')}`);
  }
  const stagedPaths = nulPaths(run, ['diff', '--cached', '--no-renames', '--name-only', '-z', 'HEAD']);
  const unstagedPaths = nulPaths(run, ['diff', '--no-renames', '--name-only', '-z']);
  const untrackedPaths = nulPaths(run, ['ls-files', '--others', '--exclude-standard', '-z']);
  const dirty = [...new Set([...stagedPaths, ...unstagedPaths, ...untrackedPaths])];
  const outside = dirty.filter(file => !scoped(file, record.scopes));
  if (outside.length) throw Error(`Uncommitted changes outside leased scopes cannot be transferred: ${outside.join(', ')}`);
  const stagedPatch = patch(cwd, ['diff', '--cached', '--binary', '--full-index', 'HEAD']);
  const unstagedPatch = patch(cwd, ['diff', '--binary', '--full-index']);
  const files = untrackedPaths.map(file => fileSnapshot(cwd, file));
  const manifest = { schema: 'fika.workspace-reconcile.v1', source: record.name, owner: record.owner, sourceBaseline: record.baseline, sourceHead: head, targetSha, scopes: record.scopes,
    stagedPatchSha256: sha256(Buffer.from(stagedPatch)), unstagedPatchSha256: sha256(Buffer.from(unstagedPatch)), untracked: files.map(({ bytes, ...item }) => item) };
  return { manifest, stagedPatch, unstagedPatch, files, dirty, committed, outsideCommits };
}

/** Rebase only explicitly leased local work onto a verified descendant of the recorded baseline.
 * The old checkout is retained permanently; recovery data is checksummed under the common git dir.
 */
export function reconcileWorkspace(name, options) {
  validateName(name); if (!options.owner) throw Error('--owner is required');
  const replacementName = validateName(options.replacement || '');
  return lock('workspaces', () => {
    materializeCommittedTransitions();
    const records = workspaceRecords(); const source = records.find(x => x.name === name);
    if (!source || source.owner !== options.owner || source.state !== 'active') throw Error('Reconcile requires the current owner of an active source lease');
    const overlapping = records.filter(x => x.state === 'active' && x.name !== name && x.scopes.some(a => source.scopes.some(b => partialPathOverlap(a,b))));
    if (overlapping.length) throw Error(`Another active lease already overlaps source scope: ${overlapping.map(x=>x.name).join(', ')}`);
    if (replacementName === name || records.some(x => x.name === replacementName)) throw Error('Replacement name is already used or matches source');
    const sourceLeaseFile = path.join(leases(), `${name}.json`); const sourceLeaseDigest = sha256(readFileSync(sourceLeaseFile));
    const cwd = source.directory; repoCommand(cwd, 'fetch', 'origin');
    const targetSha = repoCommand(cwd, 'rev-parse', 'origin/main');
    if (!/^[a-f0-9]{40}$/.test(targetSha)) throw Error('Target must resolve to a full commit SHA');
    const plan = buildReconcilePlan(source, targetSha);
    const preview = { source: name, owner: source.owner, sourceBaseline: source.baseline, sourceHead: plan.manifest.sourceHead, targetSha,
      replacement: replacementName, scopes: source.scopes, staged: plan.dirty.filter(file => nulPaths((...args) => repoCommand(cwd, ...args), ['diff', '--cached', '--name-only', '-z', 'HEAD']).includes(file)),
      unstaged: nulPaths((...args) => repoCommand(cwd, ...args), ['diff', '--name-only', '-z']), untracked: plan.manifest.untracked,
      outOfScopeCommitsProvenInTarget: plan.outsideCommits, recoveryChecksum: sha256(Buffer.from(JSON.stringify(plan.manifest))) };
    if (!options.execute) return { dryRun: true, wouldChange: preview, originalRetained: true };

    const id = randomUUID(); const state = path.join(stateDir(), 'reconciliations', id); mkdirSync(state, { recursive: true });
    const journalFile = path.join(state, 'journal.json'); const recoveryFile = path.join(state, 'recovery.json');
    const recovery = { manifest: plan.manifest, stagedPatch: plan.stagedPatch, unstagedPatch: plan.unstagedPatch, files: plan.files };
    save(recoveryFile, recovery);
    chmodSync(recoveryFile, 0o600);
    const recoveryChecksum = verifyRecoveryArtifact(recoveryFile, sha256(readFileSync(recoveryFile)));
    if (sha256(Buffer.from(JSON.stringify(recovery.manifest))) !== preview.recoveryChecksum) throw Error('Recovery manifest checksum mismatch; source workspace remains unchanged');
    const journal = { schema: 'fika.workspace-reconcile-journal.v1', id, phase: 'preserved', source: name, owner: source.owner, sourceLeaseDigest, sourceLease: source,
      replacement: replacementName, targetSha, recoveryFile, recoveryChecksum, createdAt: new Date().toISOString() };
    save(journalFile, journal);
    const directory = path.join(managedRoot(), replacementName); const branch = `codex/${replacementName}`;
    if (existsSync(directory) || ref(`refs/heads/${branch}`)) throw Error('Replacement path/branch exists; source and recovery remain intact');
    const portsBase = 13000 + (records.length + 1) * 10; if (portsBase > 65000) throw Error('Workspace port allocation exhausted');
    const ports = Object.fromEntries(Object.keys(APPS).map((app,i)=>[app,portsBase+i]));
    const replacement = { ...source, name: replacementName, directory, branch, ports, baseline: targetSha, state: 'reconciling', createdAt: new Date().toISOString(), reconciles: { source: name, journal: journalFile, recoveryChecksum: journal.recoveryChecksum } };
    journal.preparedReplacement = replacement; save(journalFile, journal);
    save(path.join(leases(), `${replacementName}.json`), replacement); journal.phase = 'creating'; save(journalFile, journal);
    try {
      mkdirSync(managedRoot(), { recursive: true }); repoCommand(cwd, 'worktree', 'add', '-b', branch, directory, targetSha);
      const apply = (patchText, staged) => { if (patchText) command('git', ['apply', ...(staged ? ['--index'] : []), '--3way', '-'], { cwd: directory, input: patchText }); };
      apply(plan.stagedPatch, true); apply(plan.unstagedPatch, false);
      for (const item of plan.files) writeSnapshot(directory, item);
      const paths = [...new Set([...nulPaths((...args) => repoCommand(directory, ...args), ['diff', '--no-renames', '--name-only', '-z', `${targetSha}...HEAD`]),
        ...nulPaths((...args) => repoCommand(directory, ...args), ['diff', '--no-renames', '--name-only', '-z', 'HEAD']),
        ...nulPaths((...args) => repoCommand(directory, ...args), ['ls-files', '--others', '--exclude-standard', '-z'])])];
      const bad = paths.filter(file => !scoped(file, source.scopes)); if (bad.length) throw Error(`Replacement diff exceeds leased scope: ${bad.join(', ')}`);
      journal.phase = 'validated'; journal.resultPaths = paths; save(journalFile, journal);
      const freshSource = jsonFile(sourceLeaseFile);
      if (sha256(readFileSync(sourceLeaseFile)) !== sourceLeaseDigest || freshSource.owner !== options.owner || freshSource.state !== 'active') throw Error('Source lease changed during reconciliation; replacement retained for recovery, no ownership transition performed');
      repoCommand(cwd, 'fetch', 'origin');
      const freshTarget = repoCommand(cwd, 'rev-parse', 'origin/main'); if (freshTarget !== targetSha) throw Error('Target baseline changed during reconciliation; retry after review');
      const competing = workspaceRecords().filter(x => x.state === 'active' && x.name !== name && x.scopes.some(a => source.scopes.some(b => partialPathOverlap(a,b))));
      if (competing.length) throw Error(`Another active lease now overlaps source scope: ${competing.map(x=>x.name).join(', ')}`);
      const superseded = { ...freshSource, state: 'superseded', supersededAt: new Date().toISOString(), supersededBy: replacementName, reconciliationJournal: journalFile };
      const activeReplacement = { ...replacement, state: 'active', reconciledAt: new Date().toISOString(), finalDiff: paths };
      // One atomic journal rename is the CAS point; workspaceRecords overlays both lease states
      // from this committed transition, so readers cannot observe overlapping active scopes.
      journal.phase = 'committed'; journal.completedAt = new Date().toISOString();
      journal.leaseTransition = { source: superseded, replacement: activeReplacement };
      save(journalFile, journal);
      return { dryRun: false, source: superseded, replacement: activeReplacement, journal: journalFile, recoveryFile, recoveryChecksum: journal.recoveryChecksum, paths };
    } catch (error) {
      journal.phase = 'attention'; journal.error = error.message; journal.interruptedAt = new Date().toISOString(); save(journalFile, journal);
      const recFile = path.join(leases(), `${replacementName}.json`); if (existsSync(recFile)) { const rec = jsonFile(recFile); rec.state = 'attention'; rec.attention = error.message; save(recFile, rec); }
      throw Error(`${error.message}. Original lease and checkout remain active; recovery artifacts: ${journalFile}`);
    }
  });
}
export function retireWorkspace(name, options) {
  validateName(name); return lock('workspaces', () => retireWorkspaceUnderLock(name, options));
}
export function retireWorkspaceUnderLock(name, options) {
    const file = path.join(leases(), `${name}.json`); const record = jsonFile(file);
    if (record.owner !== options.owner || workspaceRecords().find(x => x.name === name)?.state !== 'finished') throw Error('Retirement requires the owner and a finished lease');
    inside(managedRoot(), record.directory);
    if (command('git', ['branch', '--show-current'], { cwd: record.directory }) !== record.branch) throw Error('Workspace branch differs from its lease');
    const tree = worktrees().find(t => path.resolve(t.worktree) === path.resolve(record.directory));
    if (!tree || tree.locked || tree.prunable) throw Error('Worktree registration is missing, locked or prunable; inspect before cleanup');
    if (path.resolve(record.directory) === path.resolve(git('rev-parse', '--show-toplevel'))) throw Error('Cannot retire the calling workspace');
    if (command('git', ['status', '--porcelain'], { cwd: record.directory })) throw Error('Dirty/untracked files must be preserved before retirement');
    const head = command('git', ['rev-parse', 'HEAD'], { cwd: record.directory });
    if (head !== record.finalSha) throw Error('Workspace changed after finish');
    git('fetch', 'origin');
    const unique = !ancestor(head, 'origin/main');
    if (unique && !options.archive) throw Error('Unique commits: integrate first or explicitly --archive the finished clean workspace');
    const generated = generatedPlan(record, options);
    if (unique) {
      const archive = path.join(stateDir(), 'archives'); mkdirSync(archive, { recursive: true });
      record.preservationRef ||= `refs/preserve/workspace/${name}/${randomUUID()}`;
      if (!ref(record.preservationRef)) git('update-ref', record.preservationRef, head, '0000000000000000000000000000000000000000');
      if (ref(record.preservationRef) !== head) throw Error('Preservation ref does not match final HEAD');
      record.bundle ||= path.join(archive, `${name}-${randomUUID()}.bundle`);
      if (!existsSync(record.bundle)) git('bundle', 'create', record.bundle, record.preservationRef);
      git('bundle', 'verify', record.bundle); save(file, record);
    }
    if (generated.length) {
      const archive = path.join(stateDir(), 'archives', `${name}-generated-${randomUUID()}`);
      mkdirSync(path.dirname(archive), { recursive: true }); mkdirSync(archive);
      const manifest = { name, owner: record.owner, head, source: record.directory, archive, createdAt: new Date().toISOString(), items: generated.map(item => ({ path: item, moved: false })) };
      record.generatedArchive = archive; record.generatedArchives = [...(record.generatedArchives || []), archive]; save(file, record); save(path.join(archive, 'manifest.json'), manifest);
      for (const item of manifest.items) {
        const from = inside(record.directory, path.join(record.directory, item.path));
        const to = path.join(archive, item.path); mkdirSync(path.dirname(to), { recursive: true });
        renameSync(from, to); item.moved = true; save(path.join(archive, 'manifest.json'), manifest);
      }
    }
    if (command('git', ['status', '--porcelain', '--ignored'], { cwd: record.directory })) throw Error('Workspace changed or ignored files remain; preserve it and inspect generated archive manifest');
    git('worktree', 'remove', record.directory); // no --force and no recursive shell deletion
    // Branches (including open PR heads) are retained. Worktree retirement never deletes them.
    record.state = 'retired'; record.retiredAt = new Date().toISOString(); save(file, record); return record;
}
function generatedPlan(record, options) {
  const ignored = command('git', ['status', '--porcelain', '-z', '--ignored'], { cwd: record.directory }).split('\0').filter(Boolean);
  if (!ignored.length) return [];
  if (!options['preserve-generated']) throw Error('Ignored files remain; --preserve-generated archives only allowlisted ignored dependencies/build outputs, never deletes them');
  const allowed = ['node_modules', ...Object.values(APPS).flatMap(app => [`${app.path}/node_modules`, `${app.path}/.next`, `${app.path}/tsconfig.tsbuildinfo`])];
  for (const entry of ignored) {
    const name = entry.slice(3).replace(/\/$/, '');
    if (!entry.startsWith('!! ') || !allowed.some(a => name === a || name.startsWith(`${a}/`))) throw Error(`Non-disposable ignored file must be preserved separately: ${name}`);
  }
  return allowed.filter(a => existsSync(path.join(record.directory, a))).map(a => {
    const p = inside(record.directory, path.join(record.directory, a));
    if (lstatSync(p).isSymbolicLink()) throw Error(`Generated root is a link; inspect instead of retiring: ${a}`);
    command('git', ['check-ignore', '-q', '--', a], { cwd: record.directory });
    if (command('git', ['ls-files', '--', a], { cwd: record.directory })) throw Error(`Generated path contains tracked files: ${a}`);
    return a;
  });
}
export function cleanupPlan() {
  const occupied = new Set(worktrees().map(x => x.branch));
  const openPulls = /github\.com[:/]derekfika\/fika-os(?:\.git)?$/.test(git('remote', 'get-url', 'origin')) ? ghApi(`repos/${REPO}/pulls?state=open&per_page=100`) : [];
  if (openPulls.length === 100) throw Error('Open-PR inventory needs pagination before cleanup');
  const activeBranches = new Set(openPulls.map(p => `refs/heads/${p.head.ref}`));
  const branches = git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').split(/\r?\n/).filter(Boolean).map(line => {
    const [name, sha] = line.split(' '); const candidate = /^refs\/heads\/(codex|claude|feature|fix)\//.test(name);
    const eligible = candidate && !occupied.has(name) && !activeBranches.has(name) && ancestor(sha, 'origin/main');
    return { name, sha, eligible, reason: occupied.has(name) ? 'worktree attached; activity ambiguous/protected' : activeBranches.has(name) ? 'open PR head protected' : !candidate ? 'integration/release/recovery namespace protected' : !eligible ? 'unique or unmerged commits protected' : 'fully integrated, no attached worktree; preservation ref required' };
  });
  const body = { schema: 'fika.cleanup.v1', baseline: git('rev-parse', 'origin/main'), branches, worktrees: worktrees(), stashes: git('stash', 'list', '--format=%H').split(/\r?\n/).filter(Boolean), limit: 8 };
  return { ...body, planHash: digest(body) };
}
export function applyCleanup(plan, approvedHash) {
  return lock('cleanup', () => {
    const { planHash, ...body } = plan;
    if (planHash !== approvedHash || digest(body) !== planHash) throw Error('Cleanup plan/hash mismatch');
    const fresh = cleanupPlan(); if (fresh.planHash !== planHash) throw Error('Repository changed since cleanup plan');
    // Never remove any worktree/stash/archive here. Only a bounded set of fully integrated unattached refs.
    const retired = [];
    for (const item of body.branches.filter(x => x.eligible).slice(0, body.limit)) {
      git('update-ref', `refs/preserve/workflow-cleanup/${item.name.slice('refs/heads/'.length)}`, item.sha, '0000000000000000000000000000000000000000');
      git('update-ref', '-d', item.name, item.sha); retired.push(item);
    }
    return { planHash, retired, protectedWorktrees: body.worktrees.length, stashesPreserved: body.stashes.length };
  });
}
