import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Append-only audit trail. Nothing reads this to decide whether a deployment may start. */
export function appendEvent(file, event, now = () => new Date().toISOString()) {
  mkdirSync(path.dirname(file), { recursive: true });
  const row = { id: randomUUID(), at: now(), ...event };
  appendFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}
export function readEvents(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
/** Latest verified local record per app/environment, shown beside (never instead of) Firebase's serving state. */
export function latestVerified(events) {
  const latest = {};
  for (const e of events) if (e.type === 'verified') latest[`${e.app}:${e.environment}`] = e;
  return latest;
}
