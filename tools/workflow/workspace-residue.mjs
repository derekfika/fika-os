import path from 'node:path';
import { readFileSync, readlinkSync, realpathSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { command } from './runtime.mjs';
import { localEntry, samePath } from './workspace-capacity.mjs';

const portable = value => value.split(path.sep).join('/');
export const inside = (directory, file) => {
  const relative = path.relative(directory, file);
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export function trackedJson(head, relative) {
  try { return JSON.parse(command('git', ['show', `${head}:${relative}`], { stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { return undefined; }
}

/** A previous, verified install names the exact node_modules root. The tracked npm
 * lockfile identifies which links it created and where they belong. */
export function dependencyLinkPlan(workspace, head, entries = {}) {
  const links = new Map();
  for (const [relative, fingerprint] of Object.entries(entries)) {
    if (!/^(?:[\w.-]+\/)*node_modules$/.test(relative) || !/^[a-f0-9]{64}$/.test(fingerprint)) continue;
    const dependencyRoot = path.resolve(workspace.directory, relative);
    if (!inside(workspace.directory, dependencyRoot)) continue;
    const packageDir = path.dirname(dependencyRoot);
    const lockfile = portable(path.relative(workspace.directory, path.join(packageDir, 'package-lock.json')));
    const packages = trackedJson(head, lockfile)?.packages ?? {};
    for (const [name, entry] of Object.entries(packages)) {
      if (!/^node_modules\/(?:@[\w.-]+\/)?[\w.-]+$/.test(name) || entry?.link !== true ||
          typeof entry.resolved !== 'string' || path.isAbsolute(entry.resolved)) continue;
      const link = path.resolve(packageDir, name);
      const target = path.resolve(packageDir, entry.resolved);
      if (!inside(dependencyRoot, link) || !inside(workspace.directory, target) || inside(dependencyRoot, target)) continue;
      const source = portable(path.relative(workspace.directory, target));
      // npm uses a directory link for a tracked local package. Require its manifest
      // in the same tree as the lockfile.
      if (!trackedJson(head, `${source}/package.json`)) continue;
      links.set(portable(path.relative(workspace.directory, link)), source);
    }
  }
  return links;
}

export function matchesDependencyLink(directory, relative, target, { danglingOnly = false } = {}) {
  const file = path.resolve(directory, relative);
  const expected = path.resolve(directory, target);
  if (!inside(directory, file) || !inside(directory, expected) || !localEntry(file)?.isSymbolicLink() ||
      !samePath(realpathSync(path.dirname(file)), path.dirname(file))) return false;
  const raw = readlinkSync(file);
  if (!samePath(path.resolve(path.dirname(file), raw), expected)) return false;
  // Check every existing ancestor of the target, including a junction on the way to
  // a missing target. The deletion itself only unlinks the leaf.
  let ancestor = expected;
  while (!localEntry(ancestor)) ancestor = path.dirname(ancestor);
  if (!samePath(realpathSync(ancestor), ancestor)) return false;
  return !danglingOnly || ancestor !== expected;
}

export function readArchivedRetirement(directory, task, head, ref) {
  const archive = localEntry(directory);
  if (!archive?.isDirectory() || !samePath(realpathSync(directory), directory)) return false;
  const read = name => {
    const file = path.join(directory, name);
    if (!localEntry(file)?.isFile() || !samePath(realpathSync(file), file)) return '';
    return readFileSync(file, 'utf8').trim();
  };
  const index = path.join(directory, 'index');
  return read('HEAD') === `ref: refs/heads/${task.branch}` &&
    samePath(path.resolve(directory, read('gitdir')), path.join(task.directory, '.git')) &&
    localEntry(index)?.isFile() && samePath(realpathSync(index), index) && ref === head &&
    !command('git', ['diff-index', '--cached', '--name-only', head, '--'],
      { env: { ...process.env, GIT_INDEX_FILE: index } });
}

/** Inspect the entire residue before removing any leaf. Unknown files and even
 * unknown empty directories leave the checkout intact. */
export function retirementResidue(directory, links) {
  if (!localEntry(directory)) return { directories: [], links: [] };
  if (!localEntry(directory).isDirectory() || !samePath(realpathSync(directory), directory)) throw Error('Retirement residue resolves through a link');
  const knownDirectories = new Set();
  for (const relative of links.keys()) {
    for (let parent = path.posix.dirname(relative); parent !== '.'; parent = path.posix.dirname(parent)) knownDirectories.add(parent);
  }
  const plan = { directories: [], links: [] };
  function visit(folder) {
    for (const name of readdirSync(folder).sort()) {
      const file = path.join(folder, name);
      const relative = portable(path.relative(directory, file));
      const entry = localEntry(file);
      if (entry?.isDirectory() && knownDirectories.has(relative) && samePath(realpathSync(file), file)) visit(file);
      else if (entry?.isSymbolicLink() && links.has(relative) && matchesDependencyLink(directory, relative, links.get(relative), { danglingOnly: true })) plan.links.push(relative);
      else throw Error(`Unverified retirement residue: ${relative}`);
    }
    plan.directories.push(folder);
  }
  visit(directory);
  return plan;
}

export function removeRetirementResidue(directory, links) {
  const plan = retirementResidue(directory, links);
  for (const relative of plan.links) {
    if (!matchesDependencyLink(directory, relative, links.get(relative), { danglingOnly: true })) throw Error(`Retirement residue changed: ${relative}`);
    unlinkSync(path.join(directory, relative));
  }
  for (const folder of plan.directories) {
    if (!samePath(realpathSync(folder), folder)) throw Error('Retirement residue directory changed');
    rmdirSync(folder);
  }
}
