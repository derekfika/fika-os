import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalJson } from './canonical-json.js';

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function assertExplicitOutputDirectory(path) {
  if (!path || !isAbsolute(path)) {
    throw new Error('An explicit absolute --output-dir is required.');
  }
  return resolve(path);
}

export function safeOutputPath(outputDirectory, ...segments) {
  const root = assertExplicitOutputDirectory(outputDirectory);
  const candidate = resolve(join(root, ...segments));
  const relation = relative(root, candidate);
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Output path escapes the explicitly supplied output directory.');
  }
  return candidate;
}

export async function preserveEvidence(path, value) {
  const content = canonicalJson(value);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
    return { path, disposition: 'created', content };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readFile(path, 'utf8');
    if (existing !== content) {
      throw new Error(`Refusing to overwrite non-identical prior evidence: ${path}`);
    }
    return { path, disposition: 'preserved-identical', content };
  }
}
