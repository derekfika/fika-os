import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { common, git, jsonFile, ref, root, save, SOURCE_HISTORY_BARRIER, stateDir } from './runtime.mjs';
import { digest } from './policy.mjs';
import { repositoryAdministrator } from './workspace-admin.mjs';

function inventory(dir) {
  const history = {};
  for (const name of ['workspaces', 'workspace-revocations', 'reconciliations', 'workspace-operations', 'workspace-operations-archive', 'workspace-audit', 'archives']) {
    const parent = path.join(dir, name);
    const files = existsSync(parent) ? readdirSync(parent, { withFileTypes: true }).flatMap(entry => {
      if (entry.isFile()) return [entry.name];
      if (!entry.isDirectory()) return [];
      const children = readdirSync(path.join(parent, entry.name), { withFileTypes: true });
      return [entry.name + '/', ...children.filter(child => child.isFile()).map(child => path.join(entry.name, child.name))];
    }).sort() : [];
    history[name] = { count: files.length, checksum: digest(files.map(file =>
      [file, file.endsWith('.json') ? digest(readFileSync(path.join(parent, file))) : null])) };
  }
  return { history, refs: digest(git('show-ref')), worktrees: digest(git('worktree', 'list', '--porcelain', '-z')), stash: ref('refs/stash') || null };
}

export function migrateSourceHistory(options, { authorize = repositoryAdministrator, verifySource = () => {
  if (path.resolve(root()) !== path.resolve(common(), '..') || git('rev-parse', 'HEAD') !== ref('origin/main') ||
      git('status', '--porcelain', '--untracked-files=no')) throw Error('Use the clean, current canonical main checkout for migration');
  git('cat-file', '-e', 'HEAD:tools/workflow/source-migration.mjs');
} } = {}) {
  const actor = authorize();
  if (!actor?.administrator || !actor.login) throw Error('Repository owner administration is required');
  verifySource();
  const dir = stateDir(), lockFile = path.join(dir, 'workspaces.lock'), reportFile = path.join(dir, 'source-history-migration.json');
  const barrier = existsSync(lockFile) ? readFileSync(lockFile, 'utf8') : null;
  if (barrier === SOURCE_HISTORY_BARRIER && existsSync(reportFile)) {
    const { checksum, ...report } = jsonFile(reportFile);
    if (digest(report) !== checksum) throw Error('Source history migration report checksum mismatch');
    return { ...report, checksum, alreadyApplied: true };
  }
  if (barrier !== null && barrier !== SOURCE_HISTORY_BARRIER) throw Error('Legacy workspace lock is protected. New source worktrees remain available. Inspect the legacy holder through the administrator procedure before freezing history.');
  if (existsSync(reportFile)) throw Error('Source history migration report exists without its compatibility barrier');
  const before = inventory(dir);
  if (before.history['workspace-operations'].count || readdirSync(dir).some(name => /^release-.*\.lock$/.test(name))) throw Error('Quiesce existing governed operations before freezing source history');
  const planHash = digest({ before, actor, reason: options.reason?.trim() || null });
  if (!options.execute) return { dryRun: true, planHash, before, legacyBarrier: barrier !== null, actor };
  if (options['approve-hash'] !== planHash || !options.reason?.trim()) throw Error('Review the current migration preview and provide its hash and a reason');
  if (!barrier) {
    const tmp = path.join(dir, `source-migration-${randomUUID()}.tmp`);
    writeFileSync(tmp, SOURCE_HISTORY_BARRIER, { flag: 'wx' });
    try { linkSync(tmp, lockFile); } finally { unlinkSync(tmp); }
  }
  if (digest(inventory(dir)) !== digest(before)) throw Error('Evidence changed during cutover; preserve the barrier and obtain a fresh preview');
  const report = { schema: 'fika.source-workspace-history.v1', at: new Date().toISOString(), actor, reason: options.reason.trim(), planHash, before, historyPreserved: true };
  save(reportFile, { ...report, checksum: digest(report) });
  return { ...report, checksum: digest(report) };
}
