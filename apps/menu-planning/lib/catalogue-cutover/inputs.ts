import { readFileSync } from "node:fs";
import path from "node:path";
import type { MenuItem } from "../domain";
import { sha256 } from "./digest";
import type { Data, StoredDoc } from "./store";

export type MappingAction = "keep" | "archive" | "merge";
export type MappingEntry = { oldId: string; action: MappingAction; toId?: string; cluster?: string | null; basis?: string; verifiedTarget?: boolean; reviewHintOnly?: unknown };
export type ReferenceSet = { label: string; sha256: string; ids: string[] };
export type CutoverInputs = {
  survivorIds: string[];
  mappings: MappingEntry[];
  nineRollingIds: string[];
  /** Full V2 records for survivors (from a reviewed export). Only survivor ids are kept. */
  v2Records: Map<string, MenuItem>;
  references: ReferenceSet[];
  /** Normalised (trim + en-GB lower-case) display names explicitly allowed to collide among active survivors. Empty by default. */
  allowedDuplicateNames: string[];
  hashes: { survivors: string; mappings: string; v2Source: string; allowlist: string };
};

const readText = (file: string) => readFileSync(file, "utf8");
const readJson = (file: string) => JSON.parse(readText(file)) as unknown;

export function parseSurvivors(value: unknown): string[] {
  const list = (value as { survivors?: Array<{ id?: string }> })?.survivors;
  if (!Array.isArray(list)) throw new Error("Survivors file has no survivors[] array.");
  const ids = list.map(entry => entry?.id);
  if (ids.some(id => typeof id !== "string" || !id)) throw new Error("Survivors file contains an entry without an id.");
  if (new Set(ids).size !== ids.length) throw new Error("Survivors file contains duplicate ids.");
  return ids as string[];
}

export function parseMappings(value: unknown): { mappings: MappingEntry[]; nineRollingIds: string[] } {
  const body = value as { mappings?: unknown; nineRollingIds?: Array<{ id: string }> };
  if (!Array.isArray(body?.mappings)) throw new Error("Mappings file has no mappings[] array.");
  const mappings = (body.mappings as Array<Record<string, unknown>>).map(entry => {
    const action = entry.action;
    if (typeof entry.oldId !== "string" || !entry.oldId || (action !== "keep" && action !== "archive" && action !== "merge")) throw new Error(`Invalid mapping entry: ${JSON.stringify(entry).slice(0, 120)}`);
    return { oldId: entry.oldId, action, ...(typeof entry.toId === "string" ? { toId: entry.toId } : {}), cluster: (entry.cluster as string | null | undefined) ?? null, ...(typeof entry.basis === "string" ? { basis: entry.basis } : {}), ...(entry.verifiedTarget === true ? { verifiedTarget: true } : {}), ...(entry.reviewHintOnly !== undefined ? { reviewHintOnly: entry.reviewHintOnly } : {}) } as MappingEntry;
  });
  if (new Set(mappings.map(entry => entry.oldId)).size !== mappings.length) throw new Error("Mappings file maps an id more than once.");
  return { mappings, nineRollingIds: (body.nineRollingIds || []).map(entry => entry.id) };
}

/** Accepts a Firestore export ({documents:[{fields:{record}}]}), {records:[...]} or a plain MenuItem[]. */
export function parseV2Records(value: unknown): MenuItem[] {
  const body = value as { documents?: Array<{ fields?: { record?: MenuItem } }>; records?: Array<{ fields?: { record?: MenuItem } }> } | MenuItem[];
  if (Array.isArray(body)) return body;
  const entries = body.documents || body.records;
  if (!Array.isArray(entries)) throw new Error("V2 records source has no documents[]/records[]/array.");
  return entries.map(entry => entry.fields?.record).filter((record): record is MenuItem => Boolean(record));
}

/** Accepts {label?, ids:[...]}, published day arrays (entries[].canonicalDishId) or a plain id array. */
export function parseReferences(value: unknown, label: string, fileHash: string): ReferenceSet {
  let ids: unknown[] = [];
  if (Array.isArray(value)) ids = value.flatMap(entry => typeof entry === "string" ? [entry] : Array.isArray((entry as { entries?: unknown[] })?.entries) ? (entry as { entries: Array<{ canonicalDishId?: string }> }).entries.map(item => item.canonicalDishId) : []);
  else if (Array.isArray((value as { ids?: unknown[] })?.ids)) ids = (value as { ids: unknown[] }).ids;
  const clean = ids.filter((id): id is string => typeof id === "string" && Boolean(id));
  if (clean.length !== ids.length) throw new Error(`Reference source ${label} contains an entry without a dish id; refusing to guess.`);
  return { label: (value as { label?: string })?.label || label, sha256: fileHash, ids: [...new Set(clean)].sort() };
}

export function parseAllowlist(value: unknown): string[] {
  const names = (value as { allowedNormalisedNames?: unknown })?.allowedNormalisedNames;
  if (!Array.isArray(names) || names.some(name => typeof name !== "string")) throw new Error("Duplicate-name allow-list needs allowedNormalisedNames: string[].");
  return (names as string[]).map(name => name.trim().toLocaleLowerCase("en-GB")).sort();
}

export function loadInputs(files: { survivors: string; mappings: string; v2Records: string; references: string[]; allowlist?: string }): CutoverInputs {
  const survivorsText = readText(files.survivors);
  const mappingsText = readText(files.mappings);
  const v2Text = readText(files.v2Records);
  const survivorIds = parseSurvivors(JSON.parse(survivorsText));
  const { mappings, nineRollingIds } = parseMappings(JSON.parse(mappingsText));
  const wanted = new Set(survivorIds);
  const v2Records = new Map<string, MenuItem>();
  for (const record of parseV2Records(JSON.parse(v2Text))) if (wanted.has(record.canonicalId)) v2Records.set(record.canonicalId, record);
  const references = files.references.map(file => { const text = readText(file); return parseReferences(JSON.parse(text), path.basename(file), sha256(text)); });
  const allowText = files.allowlist ? readText(files.allowlist) : "";
  const allowedDuplicateNames = allowText ? parseAllowlist(JSON.parse(allowText)) : [];
  return { survivorIds, mappings, nineRollingIds, v2Records, references, allowedDuplicateNames, hashes: { survivors: sha256(survivorsText), mappings: sha256(mappingsText), v2Source: sha256(v2Text), allowlist: sha256(allowText) } };
}

/** Reads the exported snapshot format used by the read-only staging/production exports. */
export function loadSnapshotDir(dir: string): { manifest?: Data; docs: StoredDoc[] } {
  const dishes = readJson(path.join(dir, "catalogue-dishes.json")) as { documents: Array<{ documentId: string; fields: Data }> };
  let manifest: Data | undefined;
  try { manifest = (readJson(path.join(dir, "catalogue-manifest.json")) as { document?: { fields?: Data } }).document?.fields; } catch { /* absent manifest is reported by the plan */ }
  return { manifest, docs: dishes.documents.map(document => ({ id: document.documentId, data: document.fields })) };
}
