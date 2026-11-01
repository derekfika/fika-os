import { Firestore } from "@google-cloud/firestore";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { actorCanAccessOploc, type MenuActor } from "./auth";
import { listCanonicalMenuItemsByIds } from "./canonical-menu-repository";
import { getCatalogueManifest } from "./catalogue-manifest";
import { stableHash } from "./fika-contracts";
import { isMenuPlanningVisible, type MenuItem } from "./domain";
import type { RollingSnapshot } from "./rolling-menu-types";
import type { DishReference, DishReferences, HistoricalDishReferenceDescriptor, HistoricalDishReferenceManifest, HistoricalDishSuccessor } from "./dish-reference-contract";

type Source = { revision?: number; hash?: string; historical?: HistoricalDishReferenceDescriptor };
export type DishReferenceReaders = {
  source(): Promise<Source>;
  items(ids: string[]): Promise<MenuItem[]>;
  archiveManifest(archiveId: string): Promise<unknown>;
  archived(archiveId: string, ids: string[]): Promise<Record<string, unknown>>;
  successors(archiveId: string, ids: string[]): Promise<Record<string, unknown>>;
};
const hashPattern = /^[a-f0-9]{64}$/;
const documentId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && !value.includes("/") && Buffer.byteLength(value, "utf8") <= 1500;
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered((value as Record<string, unknown>)[key])])) : value;
/** Shared deterministic digest for immutable reference manifests/documents; never based on dish names. */
export const dishReferenceDigest = (value: unknown) => stableHash(ordered(JSON.parse(JSON.stringify(value))));
const indexValid = (value: unknown): value is Record<string, string> => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= 1500 && Object.entries(value).every(([id, hash]) => documentId(id) && typeof hash === "string" && hashPattern.test(hash)));
const identityValid = (source: Source) => Number.isInteger(source.revision) && Number(source.revision) > 0 && typeof source.hash === "string" && hashPattern.test(source.hash);
const sourceKey = (source: Source) => dishReferenceDigest(source);
const hasUnresolvedMerge = (item?: MenuItem) => item?.audit?.some(event => event.action === "automatically-merged-into-canonical-dish") === true;

function verifiedManifest(value: unknown, source: Source): HistoricalDishReferenceManifest | undefined {
  const manifest = value as HistoricalDishReferenceManifest | undefined;
  const expected = source.historical;
  if (!manifest || !expected || !documentId(expected.archiveId) || !hashPattern.test(expected.archiveDigest || "") || !hashPattern.test(expected.mappingDigest || "") || !Number.isInteger(expected.mappingVersion) || expected.mappingVersion < 1) return;
  if (manifest.schemaVersion !== 1 || manifest.archiveId !== expected.archiveId || manifest.catalogueRevision !== source.revision || manifest.catalogueSourceHash !== source.hash || manifest.archiveDigest !== expected.archiveDigest || manifest.mappingVersion !== expected.mappingVersion || manifest.mappingDigest !== expected.mappingDigest) return;
  if (!indexValid(manifest.dishHashes) || !indexValid(manifest.mappingHashes) || dishReferenceDigest(manifest.dishHashes) !== expected.archiveDigest || dishReferenceDigest(manifest.mappingHashes) !== expected.mappingDigest) return;
  return manifest;
}

function archivedItem(value: unknown, id: string, manifest: HistoricalDishReferenceManifest) {
  if (!value || !manifest.dishHashes[id] || dishReferenceDigest(value) !== manifest.dishHashes[id]) return;
  const archived = value as { id?: string; data?: { kind?: string; record?: MenuItem } };
  const item = archived.data?.record;
  return archived.id === id && archived.data?.kind === "dish" && item?.canonicalId === id ? item : undefined;
}

function verifiedSuccessor(value: unknown, id: string, manifest: HistoricalDishReferenceManifest) {
  if (!value || !manifest.mappingHashes[id] || dishReferenceDigest(value) !== manifest.mappingHashes[id]) return;
  const mapping = value as HistoricalDishSuccessor;
  return mapping.fromId === id && documentId(mapping.toId) && mapping.toId !== id && Boolean(mapping.decisionId?.trim() && mapping.decidedBy?.trim() && mapping.decidedAt?.trim()) ? mapping : undefined;
}

/** Requires the existing server actor and independently limits every read to visible saved entries. */
export async function resolveWeekDishReferences(snapshot: RollingSnapshot, actor: MenuActor, readers: DishReferenceReaders = defaultReaders()): Promise<{ dishReferences: DishReferences; items: MenuItem[] }> {
  if (!actor?.uid || !Array.isArray(actor.oplocIds) || typeof actor.allOplocs !== "boolean") throw Object.assign(new Error("An authenticated Menu Planning actor is required."), { status: 401 });
  const entries = snapshot.entries.filter(entry => entry.itemLabel.trim() && (actor.allOplocs || entry.allocations.length === 0 || entry.allocations.some(allocation => actorCanAccessOploc(actor, allocation.destinationId))));
  const ids = [...new Set(entries.map(entry => entry.itemId).filter(documentId))];
  if (!ids.length) return {
    items: [],
    dishReferences: { schemaVersion: "menu-planning.dish-references.v1" as const, weekId: snapshot.week.id, weekVersion: snapshot.week.version, byEntryId: Object.fromEntries(entries.map(entry => [entry.id, { entryId: entry.id, ...(entry.itemId ? { requestedId: entry.itemId } : {}), state: "unresolved" as const, reason: entry.itemId ? "integrity_failed" as const : "missing_id" as const, provenance: {} }])) },
  };
  const source = await readers.source().catch(() => ({} as Source));
  // Keep catalogue read failure semantics unchanged. Missing archive metadata never makes a saved week disappear.
  const items = (await readers.items(ids)).filter(item => ids.includes(item.canonicalId) && isMenuPlanningVisible(item));
  const byId = new Map(items.map(item => [item.canonicalId, item]));
  let manifest: HistoricalDishReferenceManifest | undefined;
  let historicalFailure: DishReference["reason"];
  let archives: Record<string, unknown> = {};
  let mappings: Record<string, unknown> = {};
  const verifiedMappings = new Map<string, HistoricalDishSuccessor>();
  let targets = new Map<string, MenuItem>();
  if (source.historical && identityValid(source)) {
    try {
      const raw = await readers.archiveManifest(source.historical.archiveId);
      manifest = verifiedManifest(raw, source);
      if (!manifest) historicalFailure = raw ? "integrity_failed" : "archive_unavailable";
      else {
        const mappingIds = ids.filter(id => Object.hasOwn(manifest!.mappingHashes, id));
        const archiveIds = ids.filter(id => !byId.has(id) || mappingIds.includes(id));
        [archives, mappings] = await Promise.all([
          archiveIds.length ? readers.archived(manifest.archiveId, archiveIds) : {},
          mappingIds.length ? readers.successors(manifest.archiveId, mappingIds) : {},
        ]);
        for (const id of mappingIds) {
          const mapping = verifiedSuccessor(mappings[id], id, manifest);
          if (mapping && archivedItem(archives[id], id, manifest)) verifiedMappings.set(id, mapping);
        }
        const targetIds = [...new Set([...verifiedMappings.values()].map(mapping => mapping.toId))];
        // One hop only: chains/cycles/inactive targets are unresolved, never guessed or name-joined.
        targets = new Map((targetIds.length ? await readers.items(targetIds) : []).filter(item => targetIds.includes(item.canonicalId) && isMenuPlanningVisible(item)).map(item => [item.canonicalId, item]));
      }
    } catch { historicalFailure = "archive_unavailable"; }
  }
  const after = await readers.source().catch(() => ({} as Source));
  const stable = identityValid(source) && identityValid(after) && sourceKey(source) === sourceKey(after);
  const provenance: DishReference["provenance"] = {
    ...(identityValid(source) ? { catalogueRevision: source.revision, catalogueSourceHash: source.hash } : {}),
    ...(manifest ? { archiveId: manifest.archiveId, archiveDigest: manifest.archiveDigest, mappingVersion: manifest.mappingVersion, mappingDigest: manifest.mappingDigest } : {}),
  };
  const byEntryId: Record<string, DishReference> = {};
  for (const entry of entries) {
    const id = entry.itemId;
    const ref: DishReference = { entryId: entry.id, ...(id ? { requestedId: id } : {}), state: "unresolved", provenance };
    const item = id ? byId.get(id) : undefined;
    if (!id) ref.reason = "missing_id";
    else if (!stable || !documentId(id)) ref.reason = "integrity_failed";
    else if (manifest && Object.hasOwn(manifest.mappingHashes, id)) {
      const mapping = verifiedMappings.get(id);
      const target = mapping ? targets.get(mapping.toId) : undefined;
      if (!mapping || !target || target.reviewStatus === "archived" || Object.hasOwn(manifest.mappingHashes, target.canonicalId) || item && item.reviewStatus !== "archived") ref.reason = "mapping_unverified";
      else { ref.state = "merged"; ref.successor = { id: target.canonicalId, name: target.displayName, category: target.category, ...(target.subcategory ? { subcategory: target.subcategory } : {}) }; }
    } else if (item && item.reviewStatus !== "archived") {
      ref.state = "active";
      ref.classification = { category: item.category, ...(item.subcategory ? { subcategory: item.subcategory } : {}) };
    } else if (historicalFailure) ref.reason = historicalFailure;
    else if (hasUnresolvedMerge(item) || manifest && hasUnresolvedMerge(archivedItem(archives[id], id, manifest))) ref.reason = "mapping_unverified";
    else if (item || manifest && archivedItem(archives[id], id, manifest)) ref.state = "archived";
    else if (manifest?.dishHashes[id]) ref.reason = "integrity_failed";
    else ref.reason = "not_found";
    byEntryId[entry.id] = ref;
  }
  const dishReferences: DishReferences = { schemaVersion: "menu-planning.dish-references.v1", weekId: snapshot.week.id, weekVersion: snapshot.week.version, byEntryId };
  return { dishReferences, items };
}

function defaultReaders(): DishReferenceReaders {
  const hosted = ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
  const db = () => {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
    if (!projectId) throw new Error("Hosted Menu Planning catalogue is not configured.");
    return new Firestore({ projectId });
  };
  const readExact = async (archiveId: string, collection: "dishes" | "successors", ids: string[]) => {
    if (!documentId(archiveId) || ids.some(id => !documentId(id))) throw new Error("Invalid historical reference identity.");
    const store = db();
    const records = (await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, offset) => store.getAll(...ids.slice(offset * 100, offset * 100 + 100).map(id => store.collection("fikaMenuPlanningCatalogueArchives").doc(archiveId).collection(collection).doc(id)))))).flat();
    recordDataAccess({ app: "menu-planning", operation: `catalogue.references.${collection}`, source: "FIRESTORE", documents: records.filter(record => record.exists).length });
    return Object.fromEntries(records.filter(record => record.exists).map(record => [record.id, record.data()]));
  };
  return {
    async source() {
      if (!hosted) { const value = await getCatalogueManifest(); return { revision: value.sourceRevision, hash: value.sourceHash }; }
      const document = await db().collection("fikaMenuPlanningCatalogueManifests").doc("catalogue").get();
      recordDataAccess({ app: "menu-planning", operation: "catalogue.references.manifest", source: "FIRESTORE", documents: document.exists ? 1 : 0 });
      const value = document.data() || {};
      return { revision: value.sourceRevision ?? value.catalogueVersion, hash: value.sourceHash, ...(value.historicalDishReferences ? { historical: value.historicalDishReferences } : {}) };
    },
    items: listCanonicalMenuItemsByIds,
    async archiveManifest(archiveId) {
      if (!documentId(archiveId)) throw new Error("Invalid historical archive identity.");
      const record = await db().collection("fikaMenuPlanningCatalogueArchives").doc(archiveId).get();
      recordDataAccess({ app: "menu-planning", operation: "catalogue.references.archive-manifest", source: "FIRESTORE", documents: record.exists ? 1 : 0 });
      return record.data()?.referenceManifest;
    },
    archived: (archiveId, ids) => readExact(archiveId, "dishes", ids),
    successors: (archiveId, ids) => readExact(archiveId, "successors", ids),
  };
}
