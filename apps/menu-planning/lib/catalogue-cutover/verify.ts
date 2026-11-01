import { catalogueSourceHash } from "../catalogue-source";
import type { DishReferenceReaders } from "../dish-reference-resolver";
import type { MenuItem } from "../domain";
import { digest } from "./digest";
import { readSnapshot, snapshotFromArchive } from "./execute";
import type { CutoverInputs } from "./inputs";
import { isDishDoc, recordOf } from "./plan";
import { archivePath, COLLECTIONS, journalPath, MANIFEST_PATH, type CutoverStore, type Data } from "./store";

export type VerifyCheck = { name: string; ok: boolean; detail: string };
export type VerifyReport = { ok: boolean; cutoverId: string; notes: string[]; checks: VerifyCheck[]; resolverStates: Record<string, string>; counts: { total: number; active: number; archived: number } };
export type VerifyOptions = {
  cutoverId: string;
  inputs: CutoverInputs;
  expectActive?: number;
  /** Ids whose resolver state is asserted in addition to the references and the nine rolling ids. */
  sampleIds?: string[];
};

/** Resolver readers bound to a CutoverStore (same contract as the production default readers, no network). */
export function storeReaders(store: CutoverStore): DishReferenceReaders {
  const read = async (archiveId: string, collection: "dishes" | "successors", ids: string[]) => {
    const docs = await store.getMany(ids.map(id => `${archivePath(archiveId)}/${collection}/${id}`));
    return Object.fromEntries(ids.flatMap((id, index) => docs[index] ? [[id, docs[index]]] : []));
  };
  return {
    async source() {
      const manifest = await store.get(MANIFEST_PATH);
      return { revision: (manifest?.sourceRevision ?? manifest?.catalogueVersion) as number | undefined, hash: manifest?.sourceHash as string | undefined, ...(manifest?.historicalDishReferences ? { historical: manifest.historicalDishReferences as never } : {}) };
    },
    async items(ids) {
      const docs = await store.getMany(ids.map(id => `${COLLECTIONS.catalogue}/${id}`));
      return docs.flatMap(doc => doc ? [recordOf(doc) as MenuItem] : []);
    },
    async archiveManifest(archiveId) { return (await store.get(archivePath(archiveId)))?.referenceManifest; },
    archived: (archiveId, ids) => read(archiveId, "dishes", ids),
    successors: (archiveId, ids) => read(archiveId, "successors", ids),
  };
}

export async function verifyCutover(store: CutoverStore, options: VerifyOptions): Promise<VerifyReport> {
  const checks: VerifyCheck[] = [];
  const notes: string[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  const { cutoverId, inputs } = options;

  const journal = await store.get(journalPath(cutoverId));
  check("journal complete", journal?.status === "complete" && (journal.readback as { ok?: boolean } | undefined)?.ok === true, `status=${String(journal?.status)}`);

  let root: Data | undefined;
  try { root = (await snapshotFromArchive(store, cutoverId)).root; check("archive sealed and every raw digest verifies", true, `${(root.sourceIds as string[]).length} documents`); }
  catch (error) { check("archive sealed and every raw digest verifies", false, (error as Error).message); }

  const live = await readSnapshot(store);
  const dishes = live.docs.filter(isDishDoc);
  const records = dishes.map(doc => recordOf(doc.data));
  const active = records.filter(record => record.reviewStatus !== "archived");
  const counts = { total: records.length, active: active.length, archived: records.length - active.length };
  const liveHash = catalogueSourceHash(records);
  const atSealed = Boolean(journal) && live.manifest?.sourceRevision === journal!.finalRevision && live.manifest?.sourceHash === journal!.finalHash;
  if (!atSealed) notes.push("The live manifest is no longer at the sealed cutover revision/hash (catalogue edited after the cutover, or a restore ran). Exact-revision/hash equality with the seal and exact-revision resolver binding are NOT asserted; the archive digests, descriptor binding to the archive, counts and active-set checks still are. The #256 resolver currently pins archive provenance to the exact catalogue revision, so resolver states after later edits are informational until that is fixed separately.");
  check("manifest sourceHash equals the live documents", live.manifest?.sourceHash === liveHash, `manifest=${String(live.manifest?.sourceHash).slice(0, 12)} live=${liveHash.slice(0, 12)}`);
  if (atSealed) check("manifest revision/hash equal the journal's expected final state", true, `revision=${String(live.manifest?.sourceRevision)}`);
  check("manifest dishCount equals dish documents", live.manifest?.dishCount === counts.total, `${String(live.manifest?.dishCount)} vs ${counts.total}`);
  const reference = root?.referenceManifest as { archiveDigest?: string; mappingDigest?: string; mappingVersion?: number; archiveId?: string; catalogueRevision?: number; catalogueSourceHash?: string } | undefined;
  const descriptor = live.manifest?.historicalDishReferences as Record<string, unknown> | undefined;
  check("manifest historicalDishReferences binds the archive", Boolean(root && descriptor) && descriptor!.archiveId === reference?.archiveId && descriptor!.archiveDigest === reference?.archiveDigest && descriptor!.mappingDigest === reference?.mappingDigest && descriptor!.mappingVersion === reference?.mappingVersion && (!atSealed || (reference?.catalogueRevision === live.manifest?.sourceRevision && reference?.catalogueSourceHash === live.manifest?.sourceHash)), atSealed ? "descriptor/digests/revision" : "descriptor/digests (revision binding skipped: edited since seal)");
  if (options.expectActive !== undefined) check(`active picker set = ${options.expectActive}`, counts.active === options.expectActive, `${counts.active} active`);
  if (root) check("archive total equals live total (nothing hard-deleted)", (root.sourceIds as string[]).every(id => dishes.some(doc => doc.id === id)) && dishes.length === (root.sourceIds as string[]).length, `${counts.total} live vs ${(root.sourceIds as string[]).length} archived`);

  const activeIds = new Set(active.map(record => record.canonicalId));
  const retired = inputs.mappings.filter(entry => entry.action !== "keep").map(entry => entry.oldId).filter(id => dishes.some(doc => doc.id === id));
  check("no archived/merged dish is in the active set", retired.every(id => !activeIds.has(id)) && active.every(record => record.reviewStatus !== "archived"), `${retired.length} retired ids checked`);
  check("every survivor is active", inputs.survivorIds.every(id => activeIds.has(id)), `${inputs.survivorIds.length} survivors`);

  // Resolver (#256) on every reference, the nine rolling ids and samples.
  const resolverStates: Record<string, string> = {};
  const referenceIds = [...new Set(inputs.references.flatMap(set => set.ids))].sort();
  const samples = [...new Set([...inputs.nineRollingIds, ...(options.sampleIds ?? [])])];
  const allIds = [...new Set([...referenceIds, ...samples])];
  if (allIds.length) {
    const { resolveWeekDishReferences } = await import("../dish-reference-resolver");
    const snapshot = { week: { id: `verify:${cutoverId}`, version: 1 }, days: [], entries: allIds.map((id, index) => ({ id: `entry-${index}`, itemId: id, itemLabel: id, allocations: [] })) } as never;
    const { dishReferences } = await resolveWeekDishReferences(snapshot, { uid: "cutover-verify", oplocIds: [], allOplocs: true } as never, storeReaders(store));
    allIds.forEach((id, index) => { const ref = dishReferences.byEntryId[`entry-${index}`]; resolverStates[id] = ref.state === "unresolved" ? `unresolved(${ref.reason})` : ref.state === "merged" ? `merged->${ref.successor?.id}` : ref.state; });
    if (referenceIds.length) {
      const okRefs = referenceIds.filter(id => resolverStates[id] === "active" || resolverStates[id].startsWith("merged->")).length;
      check(`references resolve (${okRefs}/${referenceIds.length})`, okRefs === referenceIds.length || !atSealed, referenceIds.filter(id => !(resolverStates[id] === "active" || resolverStates[id].startsWith("merged->"))).map(id => `${id}=${resolverStates[id]}`).join(", ") || "all active or merged");
    }
    const mappingById = new Map(inputs.mappings.map(entry => [entry.oldId, entry]));
    const wrong: string[] = [];
    for (const id of samples) {
      const entry = mappingById.get(id);
      const state = resolverStates[id];
      const expected = !entry ? undefined : entry.action === "keep" ? "active" : entry.action === "merge" ? `merged->${entry.toId}` : "archived";
      if (expected && state !== expected) wrong.push(`${id}: ${state} (expected ${expected})`);
    }
    check(`resolver states for ${samples.length} sample ids`, wrong.length === 0 || !atSealed, wrong.join("; ") || "as expected");
  }
  return { ok: checks.every(item => item.ok), cutoverId, notes, checks, resolverStates, counts };
}

/** Sanity helper used by tests and the CLI: digest of a store's catalogue dish documents. */
export async function catalogueDigest(store: CutoverStore) {
  const live = await readSnapshot(store);
  return digest(Object.fromEntries(live.docs.filter(isDishDoc).map(doc => [doc.id, digest(doc.data)])));
}
