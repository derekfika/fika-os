import path from 'node:path';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readlinkSync, readSync, realpathSync, statSync } from 'node:fs';
import { command, save, stateDir } from './runtime.mjs';
import { safeScope } from './policy.mjs';
import { canonical, localEntry, managedRoot, optionalJson, samePath, split } from './workspace-capacity.mjs';

const artifactsFile = name => path.join(stateDir(), 'source-generated', `${name}.json`);
const isInside = (directory, file) => {
  const relative = path.relative(directory, file);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function fingerprint(directory, relative, { observedEntries, allowedEntries } = {}) {
  const target = path.resolve(directory, relative);
  if (!isInside(directory, target) || !samePath(realpathSync(target), target)) throw Error('Generated root resolves through a link');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  function visit(file) {
    const info = lstatSync(file);
    const name = path.relative(target, file);
    const type = info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : null;
    if (!type) throw Error('Unexpected file type in generated output');
    if (allowedEntries && allowedEntries.get(name) !== type) throw Error('Generated output contains a new or changed entry');
    observedEntries?.set(name, type);
    if (type === 'link') {
      if (!isInside(directory, realpathSync(file))) throw Error('Generated path links outside the checkout');
      hash.update(JSON.stringify([name, 'link', readlinkSync(file)]));
    } else if (type === 'directory') {
      hash.update(JSON.stringify([name, 'directory']));
      for (const child of readdirSync(file).sort()) visit(path.join(file, child));
    } else {
      hash.update(JSON.stringify([name, 'file', info.size, info.mode]));
      const fd = openSync(file, 'r');
      try {
        let bytes;
        while ((bytes = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, bytes));
      } finally { closeSync(fd); }
      const current = lstatSync(file);
      if (current.size !== info.size || current.mtimeMs !== info.mtimeMs || current.ino !== info.ino) throw Error('Generated file changed while being recorded');
    }
  }
  visit(target);
  return hash.digest('hex');
}

export function recordGenerated(workspace, candidates) {
  const paths = [], protectedPaths = [];
  if (!candidates.length) return { paths, protectedPaths };
  const previous = optionalJson(artifactsFile(workspace.name));
  const entries = { ...previous?.entries };
  for (const candidate of candidates) {
    const { relative, allowedEntries } = typeof candidate === 'string' ? { relative: candidate } : candidate;
    if (!localEntry(path.join(workspace.directory, relative))) continue;
    try {
      if (workspace.run('ls-files', '--', relative)) throw Error('Generated path contains tracked files');
      workspace.run('check-ignore', '-q', '--', relative);
      entries[relative] = fingerprint(workspace.directory, relative, { allowedEntries });
      paths.push(relative);
    } catch (error) { protectedPaths.push({ path: relative, reason: error.message.split(/\r?\n/)[0] }); }
  }
  if (paths.length) save(artifactsFile(workspace.name), { name: workspace.name, directory: workspace.directory, entries });
  return { paths, protectedPaths };
}

function generatedEntries(workspace) {
  const record = optionalJson(artifactsFile(workspace.name));
  return record?.name === workspace.name && samePath(record.directory, workspace.directory) ? record.entries : undefined;
}

function matchesGenerated(workspace, relative, entries, observedEntries) {
  const expected = entries?.[relative];
  if (!expected) return false;
  try { return fingerprint(workspace.directory, relative, { observedEntries }) === expected; }
  catch { return false; }
}

export function validationOutputCandidates(workspace, apps) {
  const entries = generatedEntries(workspace);
  const candidates = [];
  for (const app of apps) {
    for (const relative of [`${app.path}/.next`, `${app.path}/tsconfig.tsbuildinfo`]) {
      if (!localEntry(path.join(workspace.directory, relative))) {
        candidates.push(relative);
        continue;
      }
      const allowedEntries = new Map();
      if (matchesGenerated(workspace, relative, entries, allowedEntries)) {
        // Retain the old fingerprint if a rerun adds paths that had no verified provenance.
        candidates.push({ relative, allowedEntries });
      }
    }
  }
  return candidates;
}

export function verifiedGenerated(workspace, status) {
  const entries = generatedEntries(workspace);
  return Boolean(entries) && split(status).every(line =>
    line.startsWith('!! ') && matchesGenerated(workspace, line.slice(3).replace(/\/$/, ''), entries));
}

export function sharedNpmCache() {
  const primary = canonical();
  const configured = command('npm', ['config', 'get', 'cache'], { cwd: primary });
  const entry = path.isAbsolute(configured) ? localEntry(configured) : null;
  if (entry?.isDirectory() && samePath(realpathSync(configured), configured) && entry.dev === statSync(primary).dev &&
    !samePath(primary, configured) && !isInside(primary, configured) && !isInside(configured, primary) &&
    !samePath(managedRoot(), configured) && !isInside(managedRoot(), configured)) return configured;
  return path.join(path.dirname(primary), '.fika-cache', 'npm');
}

export function installSourceDependencies(workspace, selected = '.') {
  const packagePath = selected === '.' ? '.' : safeScope(selected);
  const manifest = packagePath === '.' ? 'package.json' : `${packagePath}/package.json`;
  const lockfile = packagePath === '.' ? 'package-lock.json' : `${packagePath}/package-lock.json`;
  if (split(workspace.run('ls-files', '-z', '--', manifest, lockfile)).length !== 2) {
    throw Error('Select a repository package with a tracked npm lockfile');
  }
  const directory = path.resolve(workspace.directory, packagePath);
  const relative = packagePath === '.' ? 'node_modules' : `${packagePath}/node_modules`;
  if (!samePath(realpathSync(directory), directory)) throw Error('Package directory resolves through a link');
  if (localEntry(path.join(workspace.directory, relative))) throw Error('An existing dependency directory requires owner review before reinstalling');
  const cache = sharedNpmCache();
  mkdirSync(cache, { recursive: true });
  if (!samePath(realpathSync(cache), cache)) throw Error('Shared npm cache resolves through a link');
  command('npm', ['ci', '--prefer-offline', '--cache', cache], { cwd: directory, stdio: ['ignore', 'inherit', 'inherit'] });
  return { package: packagePath, cache, generated: recordGenerated(workspace, [relative]) };
}
