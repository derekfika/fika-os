import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

export function digest(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function derivedId(namespace, value) {
  return `${namespace}:${digest(value).slice(0, 24)}`;
}
