import path from 'node:path';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync, statSync } from 'node:fs';
import { command, save, stateDir } from './runtime.mjs';
import { APPS, safeScope } from './policy.mjs';
import { canonical, localEntry, managedRoot, optionalJson, samePath, split } from './workspace-capacity.mjs';
import { dependencyLinkPlan, inside as isInside, matchesDependencyLink, trackedJson } from './workspace-residue.mjs';

const artifactsFile = name => path.join(stateDir(), 'source-generated', `${name}.json`);

function fingerprint(directory, relative, { observedEntries, allowedEntries, knownLinks, observedLinks } = {}) {
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
      const entry = path.relative(directory, file).split(path.sep).join('/');
      const expected = knownLinks?.get(entry);
      if (expected && matchesDependencyLink(directory, entry, expected)) {
        observedLinks?.set(entry, expected);
      } else if (!isInside(directory, realpathSync(file))) {
        throw Error('Generated path links outside the checkout');
      }
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

function nextDeclaration(workspace, relative) {
  const file = path.join(workspace.directory, relative);
  const entry = localEntry(file);
  if (!entry?.isFile() || entry.size > 1024 || !samePath(realpathSync(file), file)) return false;
  const raw = readFileSync(file, 'utf8');
  const source = raw.replaceAll('\r\n', '\n');
  if (raw !== source && raw !== source.replaceAll('\n', '\r\n')) return false;
  // Match the whole Next 16 declaration template. A user import, added text,
  // or path outside the standard output directory leaves the file protected.
  const lines = source.split('\n');
  if (lines.shift() !== '/// <reference types="next" />') return false;
  for (const optional of ['next/image-types/global', 'next/navigation-types/compat/navigation']) {
    if (lines[0] === '/// <reference types="' + optional + '" />') lines.shift();
  }
  const output = /^import "\.\/(\.next(?:\/dev)?)\/types\/routes\.d\.ts";$/.exec(lines.shift())?.[1];
  if (!output) return false;
  const typeImport = name => 'import "./' + output + '/types/' + name + '";';
  if (lines[0] === typeImport('cache-life.d.ts')) {
    lines.shift();
    if (lines.shift() !== typeImport('validator.ts')) return false;
    if (lines[0] === typeImport('link.d.ts')) lines.shift();
  }
  return ['app', 'pages'].some(router => lines.join('\n') === [
    '', '// NOTE: This file should not be edited',
    '// see https://nextjs.org/docs/' + router + '/api-reference/config/typescript for more information.', '',
  ].join('\n'));
}

function verifiedNextDeclaration(workspace, relative, head) {
  const app = Object.values(APPS).find(candidate => relative === `${candidate.path}/next-env.d.ts`);
  if (!app || !nextDeclaration(workspace, relative)) return false;
  const lock = trackedJson(head, `${app.path}/package-lock.json`);
  return /^16\.\d+\.\d+$/.test(lock?.packages?.['node_modules/next']?.version ?? '') &&
    Boolean(trackedJson(head, `${app.path}/tsconfig.json`));
}

export function verifiedTypeScriptBuildInfo(workspace, relative, head) {
  const app = Object.values(APPS).find(candidate => relative === `${candidate.path}/tsconfig.tsbuildinfo`);
  if (!app) return false;
  const config = trackedJson(head, `${app.path}/tsconfig.json`);
  const lock = trackedJson(head, `${app.path}/package-lock.json`);
  const compiler = lock?.packages?.['node_modules/typescript'];
  if (config?.compilerOptions?.incremental !== true || !/^\d+\.\d+\.\d+$/.test(compiler?.version ?? '')) return false;
  const file = path.join(workspace.directory, relative);
  const entry = localEntry(file);
  if (!entry?.isFile() || entry.size > 20 * 1024 * 1024 || !samePath(realpathSync(file), file)) return false;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data.version === compiler.version && Array.isArray(data.fileNames) && data.fileNames.length > 0 &&
      data.fileNames.length <= 200_000 && data.fileNames.every(name => typeof name === 'string' && name.length < 4096) &&
      Array.isArray(data.fileInfos) && data.fileInfos.length === data.fileNames.length &&
      Array.isArray(data.root) && data.root.length > 0 && data.root.length <= data.fileNames.length &&
      data.root.every(index => Number.isSafeInteger(index) && index >= 0 && index < data.fileNames.length) &&
      data.options && typeof data.options === 'object' && !Array.isArray(data.options);
  } catch { return false; }
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
      if (relative.endsWith('/next-env.d.ts') && !nextDeclaration(workspace, relative)) throw Error('Next declaration differs from the known generated template');
      entries[relative] = fingerprint(workspace.directory, relative, { allowedEntries });
      paths.push(relative);
    } catch (error) { protectedPaths.push({ path: relative, reason: error.message.split(/\r?\n/)[0] }); }
  }
  if (paths.length) save(artifactsFile(workspace.name), { name: workspace.name, directory: workspace.directory, entries });
  return { paths, protectedPaths };
}

export function generatedEntries(workspace) {
  const record = optionalJson(artifactsFile(workspace.name));
  return record?.name === workspace.name && samePath(record.directory, workspace.directory) ? record.entries : undefined;
}

function matchesGenerated(workspace, relative, entries, options) {
  const expected = entries?.[relative];
  if (!expected) return false;
  try { return fingerprint(workspace.directory, relative, options) === expected; }
  catch { return false; }
}

export function validationOutputCandidates(workspace, apps) {
  const entries = generatedEntries(workspace);
  const candidates = [];
  for (const app of apps) {
    for (const relative of [`${app.path}/.next`, `${app.path}/tsconfig.tsbuildinfo`, `${app.path}/next-env.d.ts`]) {
      if (!localEntry(path.join(workspace.directory, relative))) {
        candidates.push(relative);
        continue;
      }
      const allowedEntries = new Map();
      if (matchesGenerated(workspace, relative, entries, { observedEntries: allowedEntries })) {
        // Retain the old fingerprint if a rerun adds paths that had no verified provenance.
        candidates.push({ relative, allowedEntries });
      }
    }
  }
  return candidates;
}

export function generatedRetirementPlan(workspace, status, head) {
  const entries = generatedEntries(workspace);
  const knownLinks = dependencyLinkPlan(workspace, head, entries);
  const links = new Map();
  const verifiedGenerated = [];
  for (const line of split(status)) {
    if (!line.startsWith('!! ')) throw Error('Tracked or untracked work remains');
    const relative = line.slice(3).replace(/\/$/, '');
    const fingerprinted = matchesGenerated(workspace, relative, entries, { knownLinks, observedLinks: links });
    const nextDeclaration = verifiedNextDeclaration(workspace, relative, head);
    const buildInfo = verifiedTypeScriptBuildInfo(workspace, relative, head);
    if (!fingerprinted && !nextDeclaration && !buildInfo) {
      throw Error(`Unverified ignored output: ${relative}`);
    }
    if (buildInfo) verifiedGenerated.push(relative);
  }
  links.verifiedGenerated = verifiedGenerated;
  return links;
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
