import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FieldPath, type Query, type QueryDocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { assertSafeLocalPath, dataRoot } from "./safety";
import type { Actor } from "./auth";
import type { Activity, HubState } from "./types";
import type { StagingRecord, SyncProgress, SyncRun } from "./schemas";
import { parseCanonical, type CanonicalEntityType } from "./schemas";
import { schemaDefinition } from "./schema-catalogue";
import { sha256 } from "./profiler";
import { formatAddress } from "./address";

const ref = () => db.collection("integrationHub").doc("local-state-v1");
const stagingRef = () => db.collection("integrationHubStaging");
const canonicalRef = () => db.collection("integrationHubCanonical");
const MAX_STAGING_DOCUMENT_BYTES = 450_000;
export const emptyState = (): HubState => ({ imports: [], staging: [], canonical: [], mappings: [], syncRuns: [], activity: [], profiles: [], manifests: [] });

export function clearProviderData(state: HubState, provider: "brighthr" | "square") {
  const stagingBefore = state.staging.length;
  const canonicalBefore = state.canonical.length;
  const runsBefore = state.syncRuns.length;
  state.staging = state.staging.filter(record => String(record.raw.provider || "") !== provider);
  state.canonical = state.canonical.filter(record => !canonicalHasProvider(record.record, provider));
  state.syncRuns = state.syncRuns.filter(run => run.provider !== provider);
  if (state.stagingGenerations) delete state.stagingGenerations[provider];
  state.manifests = [];
  return {
    stagingRemoved: stagingBefore - state.staging.length,
    canonicalRemoved: canonicalBefore - state.canonical.length,
    syncRunsRemoved: runsBefore - state.syncRuns.length,
  };
}

export async function getState(): Promise<HubState> {
  const [snapshot, stagingDocuments, canonicalDocuments] = await Promise.all([ref().get(), readCollectionInPages(stagingRef(), 5), readCollectionInPages(canonicalRef(), 50)]);
  const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
  state.staging = mergeStaging(state.staging || [], activeStagingDocuments(state, stagingDocuments).flatMap(document => (document.data().records || []) as HubState["staging"]));
  state.canonical = mergeCanonical(state.canonical || [], canonicalDocuments.map(document => document.data() as HubState["canonical"][number]));
  migrateLegacyTerminology(state);
  return state;
}

export async function createRunningSyncRun(actor: Actor, provider: "brighthr" | "square", run: SyncRun) {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref());
    const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
    state.syncRuns.push(run);
    state.activity.push(activity(actor, "Sync started", run.syncRunId, provider, "Provider retrieval started outside the Firestore transaction.", run.correlationId));
    transaction.set(ref(), { ...state, staging: [], canonical: state.canonical || [] });
  });
}

export async function completeProviderSync(actor: Actor, provider: "brighthr" | "square", runId: string, prepared: { mode: "fixture" | "live-local"; status: "succeeded" | "partial"; records: StagingRecord[]; counts: Record<string, number>; sourceSnapshotReference?: string; sourceSnapshotHash?: string }, correlationId: string) {
  const existing = await readProviderStagingDocuments(provider);
  const generation = crypto.randomUUID();
  const replacement = chunkStagingRecords(prepared.records).map((chunk, index) => ({ ...chunk, id: `${provider}-${generation}-${String(index).padStart(4, "0")}`, generation }));
  // Firestore's gRPC request limit is lower than the total Square catalogue.
  // New chunks are therefore written in bounded batches and remain invisible
  // until the metadata pointer is switched after every write succeeds.
  for (let index = 0; index < replacement.length; index += 5) {
    const batch = db.batch();
    const batchChunks = replacement.slice(index, index + 5);
    for (const chunk of batchChunks) batch.set(stagingRef().doc(chunk.id), { source: chunk.source, generation, records: chunk.records });
    await batch.commit();
    const writtenRecords = replacement.slice(0, index + batchChunks.length).reduce((total, chunk) => total + chunk.records.length, 0);
    await updateSyncRunProgress(runId, { phase: "Writing local staging", message: `Safely wrote ${writtenRecords} of ${prepared.records.length} ${provider === "square" ? "Square" : "BrightHR"} records across ${Math.min(index + 5, replacement.length)} of ${replacement.length} bounded chunks.`, completed: writtenRecords, total: prepared.records.length || 1, percent: Math.min(99, 95 + (4 * writtenRecords / Math.max(1, prepared.records.length))) });
  }

  const finishedAt = new Date().toISOString();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref());
    const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
    const run = state.syncRuns.find(candidate => candidate.syncRunId === runId);
    if (!run) throw new Error("Running SyncRun could not be found.");
    Object.assign(run, { mode: prepared.mode, status: prepared.status, counts: prepared.counts, sourceSnapshotReference: prepared.sourceSnapshotReference, sourceSnapshotHash: prepared.sourceSnapshotHash, finishedAt, progress: { phase: "Complete", message: `${prepared.records.length} records staged for review.`, completed: prepared.records.length, total: prepared.records.length || 1, percent: 100, updatedAt: finishedAt } });
    state.activity.push(activity(actor, "Sync finished", runId, provider, `${prepared.status}: ${prepared.records.length} record(s) staged`, correlationId));
    state.stagingGenerations = { ...(state.stagingGenerations || {}), [provider]: generation };
    transaction.set(ref(), { ...state, staging: [], canonical: state.canonical || [] });
  });
  // Cleanup is non-authoritative: after the pointer switch, old generations
  // are ignored even if a later local cleanup attempt is interrupted.
  await deleteStagingDocumentsInBatches(existing.filter(document => document.data().generation !== generation)).catch(() => undefined);
  return getState();
}

export async function failProviderSync(actor: Actor, provider: "brighthr" | "square", runId: string, correlationId: string) {
  const finishedAt = new Date().toISOString();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref());
    const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
    const run = state.syncRuns.find(candidate => candidate.syncRunId === runId);
    if (run) Object.assign(run, { status: "failed", finishedAt, message: "Connector failed safely; inspect local configuration.", progress: { phase: "Failed safely", message: "No partial provider data replaced the previous staging set.", percent: 100, updatedAt: finishedAt } });
    state.activity.push(activity(actor, "Sync failed", runId, provider, "Safe connector failure; no provider response or secret recorded.", correlationId));
    transaction.set(ref(), { ...state, staging: [], canonical: state.canonical || [] });
  });
}

export async function getLatestSyncRun(provider: "brighthr" | "square") {
  const snapshot = await ref().get();
  const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
  return state.syncRuns.filter(run => run.provider === provider).at(-1) || null;
}

export async function updateSyncRunProgress(runId: string, progress: Omit<SyncProgress, "updatedAt">) {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref());
    const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
    const run = state.syncRuns.find(candidate => candidate.syncRunId === runId);
    if (!run || run.status !== "running") return;
    run.progress = { ...progress, updatedAt: new Date().toISOString() };
    transaction.set(ref(), { ...state, staging: [] });
  });
}

export async function updateState(mutator: (state: HubState) => void) {
  const state = await getState();
  const embeddedCanonical = (await ref().get()).data()?.canonical as HubState["canonical"] | undefined || [];
  migrateLegacyTerminology(state);
  mutator(state);

  const existingStagingDocuments = await readCollectionInPages(stagingRef(), 5);
  const generations: Record<string, string> = {};
  const generatedChunks = chunkStagingRecords(state.staging).map(chunk => {
    const generation = generations[chunk.source] ||= crypto.randomUUID();
    return { ...chunk, generation, id: `${chunk.source}-${generation}-${chunk.id.split("-").at(-1)}` };
  });
  for (let index = 0; index < generatedChunks.length; index += 5) {
    const batch = db.batch();
    for (const chunk of generatedChunks.slice(index, index + 5)) batch.set(stagingRef().doc(chunk.id), { source: chunk.source, generation: chunk.generation, records: chunk.records });
    await batch.commit();
  }

  await db.runTransaction(async transaction => {
    const canonicalDocuments = await readCollectionInTransactionPages(transaction, canonicalRef(), 50);
    state.stagingGenerations = generations;
    const collectionIsAuthoritative = canonicalDocuments.length > 0 || embeddedCanonical.length === 0;
    if (collectionIsAuthoritative) {
      const desired = new Map(state.canonical.map(record => [record.canonicalId, record]));
      const existing = new Map(canonicalDocuments.map(document => [(document.data() as HubState["canonical"][number]).canonicalId, document]));
      for (const [canonicalId, record] of desired) if (JSON.stringify(existing.get(canonicalId)?.data()) !== JSON.stringify(record)) transaction.set(canonicalRef().doc(canonicalDocumentId(canonicalId)), record);
      for (const [canonicalId, document] of existing) if (!desired.has(canonicalId)) transaction.delete(document.ref);
      transaction.set(ref(), { ...state, staging: [], canonical: [] });
    } else transaction.set(ref(), { ...state, staging: [] });
  });
  await deleteStagingDocumentsInBatches(existingStagingDocuments).catch(() => undefined);
  return state;
}

export type RegistryQuery = { search?: string; entityType?: string; provider?: string; status?: string; site?: string; sort?: "name" | "entityType" | "updatedAt" | "createdAt" | "status"; direction?: "asc" | "desc"; page?: number; pageSize?: number };

export async function queryCanonicalRegistry(query: RegistryQuery) {
  const records = await readCanonicalRecords();
  const search = String(query.search || "").trim().toLowerCase();
  const filtered = records.filter(record => {
    if (query.entityType && record.entityType !== query.entityType) return false;
    if (query.provider && !externalIdentities(record).some(identity => String(identity.provider || "") === query.provider)) return false;
    if (query.status && canonicalStatus(record) !== query.status) return false;
    if (query.site && !siteReferences(record.record).includes(query.site)) return false;
    if (search && !registrySearchText(record).includes(search)) return false;
    return true;
  });
  const sort = query.sort || "name", direction = query.direction === "desc" ? -1 : 1;
  filtered.sort((a, b) => registrySortValue(a, sort).localeCompare(registrySortValue(b, sort), undefined, { numeric: true }) * direction || a.canonicalId.localeCompare(b.canonicalId));
  const pageSize = Math.min(100, Math.max(10, query.pageSize || 25));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, query.page || 1));
  return {
    records: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: records.length,
    filteredTotal: filtered.length,
    page,
    pageSize,
    pageCount,
    filters: {
      entityTypes: [...new Set(records.map(record => record.entityType))].sort(),
      providers: [...new Set(records.flatMap(externalIdentities).map(identity => String(identity.provider || "")).filter(Boolean))].sort(),
      statuses: [...new Set(records.map(canonicalStatus))].sort(),
      sites: [...new Set(records.flatMap(record => siteReferences(record.record)))].sort(),
    },
  };
}

export async function getCanonicalRecord(canonicalId: string) {
  return (await readCanonicalRecords()).find(record => record.canonicalId === canonicalId) || null;
}

export async function canonicalCountsByType() {
  const records = await readCanonicalRecords();
  return Object.fromEntries([...new Set(records.map(record => record.entityType))].map(entityType => [entityType, records.filter(record => record.entityType === entityType).length]));
}

export async function getCanonicalStorageStatus() {
  const [snapshot, canonicalCount] = await Promise.all([ref().get(), canonicalRef().count().get()]);
  const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
  return { embeddedRecords: (state.canonical || []).length, collectionRecords: canonicalCount.data().count, migrationRequired: (state.canonical || []).length > 0 };
}

export async function migrateCanonicalStorage(actor: Actor) {
  const [snapshot, collectionCount] = await Promise.all([ref().get(), canonicalRef().count().get()]);
  const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
  const embedded = state.canonical || [];
  if (!embedded.length) return { migrated: 0, alreadyComplete: true, snapshotReference: "" };
  if (collectionCount.data().count) throw new Error("Canonical migration requires an empty target collection; reconcile the existing collection first.");
  const timestamp = new Date().toISOString();
  const snapshotReference = saveLocalSnapshot(`snapshots/canonical-pre-collection-${timestamp.replaceAll(":", "-")}.json`, JSON.stringify({ capturedAt: timestamp, records: embedded }, null, 2));
  for (let index = 0; index < embedded.length; index += 400) {
    const batch = db.batch();
    for (const record of embedded.slice(index, index + 400)) batch.set(canonicalRef().doc(canonicalDocumentId(record.canonicalId)), record);
    await batch.commit();
  }
  const verification = await readCollectionInPages(canonicalRef(), 50);
  const migrated = verification.map(document => document.data() as HubState["canonical"][number]);
  const expected = new Map(embedded.map(record => [record.canonicalId, record.dataHash]));
  if (migrated.length !== embedded.length || migrated.some(record => expected.get(record.canonicalId) !== record.dataHash)) throw new Error("Canonical migration verification failed; embedded records were preserved.");
  await db.runTransaction(async transaction => {
    const current = await transaction.get(ref());
    const currentState = current.exists ? current.data() as HubState : emptyState();
    if ((currentState.canonical || []).length !== embedded.length) throw new Error("Canonical data changed during migration; embedded records were preserved.");
    currentState.canonical = [];
    currentState.activity.push(activity(actor, "Canonical storage migrated", "integrationHubCanonical", "local-migration", `${embedded.length} canonical record(s) copied and hash-verified; source snapshot ${snapshotReference}.`));
    transaction.set(ref(), currentState);
  });
  return { migrated: embedded.length, alreadyComplete: false, snapshotReference };
}

export async function correctCanonicalRecord(actor: Actor, input: { canonicalId: string; expectedVersion: number; patch: Record<string, unknown>; reason: string; lockFields?: string[] }) {
  const documentRef = canonicalRef().doc(canonicalDocumentId(input.canonicalId));
  return db.runTransaction(async transaction => {
    const [document, stateSnapshot] = await Promise.all([transaction.get(documentRef), transaction.get(ref())]);
    if (!document.exists) throw Object.assign(new Error("Canonical record is not in the managed collection. Complete canonical storage migration first."), { status: 409 });
    const current = document.data() as HubState["canonical"][number];
    if (Number(current.record.version || 0) !== input.expectedVersion) throw Object.assign(new Error("This canonical record changed after it was opened. Reload it before applying a correction."), { status: 409 });
    const definition = schemaDefinition(current.entityType);
    if (!definition) throw new Error("Canonical schema definition is missing.");
    const editable = new Set(definition.fields.filter(field => field.editable).map(field => field.name));
    const rejected = Object.keys(input.patch).filter(field => !editable.has(field));
    if (rejected.length) throw Object.assign(new Error(`These fields are not editable: ${rejected.join(", ")}.`), { status: 400 });
    const required = new Set(definition.fields.filter(field => field.required).map(field => field.name));
    const now = new Date().toISOString();
    const nextRecord: Record<string, unknown> = { ...current.record, ...input.patch, canonicalId: current.canonicalId, entityType: current.entityType, schemaVersion: current.record.schemaVersion, createdAt: current.record.createdAt, createdBy: current.record.createdBy, version: input.expectedVersion + 1, updatedAt: now, updatedBy: actor.uid };
    for (const [field, value] of Object.entries(input.patch)) if (value === null) { if (required.has(field)) throw Object.assign(new Error(`${field} is required and cannot be cleared.`), { status: 400 }); else delete nextRecord[field]; }
    const ownership = current.record.ownership && typeof current.record.ownership === "object" ? structuredClone(current.record.ownership as Record<string, unknown>) : { providerOwned: {}, fikaOwned: {} };
    const fikaOwned = ownership.fikaOwned && typeof ownership.fikaOwned === "object" ? ownership.fikaOwned as Record<string, unknown> : {};
    const existingLocks = new Set(Array.isArray(fikaOwned.fieldLocks) ? fikaOwned.fieldLocks.map(String) : []);
    const lockedChanges = Object.keys(input.patch).filter(field => existingLocks.has(field));
    if (lockedChanges.length) throw Object.assign(new Error(`Locked fields cannot be changed: ${lockedChanges.join(", ")}. Use the separately governed unlock action first.`), { status: 409 });
    const governedOverrides = fikaOwned.governedOverrides && typeof fikaOwned.governedOverrides === "object" ? { ...fikaOwned.governedOverrides as Record<string, unknown> } : {};
    for (const [field, value] of Object.entries(input.patch)) if (value === null) delete governedOverrides[field]; else governedOverrides[field] = value;
    const fieldLocks = [...new Set([...existingLocks, ...(input.lockFields || [])])];
    ownership.fikaOwned = { ...fikaOwned, governedOverrides, ...(fieldLocks.length ? { fieldLocks } : {}) };
    nextRecord.ownership = ownership;
    const validated = parseCanonical(current.entityType as CanonicalEntityType, nextRecord);
    if (!validated.success) throw Object.assign(new Error(`Canonical correction failed schema validation: ${validated.error.issues[0]?.message}`), { status: 400 });
    const fieldProvenance = structuredClone(current.fieldProvenance || {});
    for (const field of Object.keys(input.patch)) fieldProvenance[field] = [...(fieldProvenance[field] || []), { source: "manual-correction", actorId: actor.uid, timestamp: now, reason: input.reason, previousValue: current.record[field], newValue: nextRecord[field] }];
    const next = { ...current, record: nextRecord, dataHash: sha256(JSON.stringify(nextRecord)), fieldProvenance };
    const state = stateSnapshot.exists ? stateSnapshot.data() as HubState : emptyState();
    state.activity.push(activity(actor, "Canonical record corrected", current.canonicalId, "data-registry", `${Object.keys(input.patch).join(", ") || "publication status"}; reason recorded; version ${input.expectedVersion + 1}.`));
    transaction.set(documentRef, next);
    transaction.set(ref(), { ...state, canonical: [], staging: [] });
    return next;
  });
}

async function readCanonicalRecords() {
  const [snapshot, collectionDocuments] = await Promise.all([ref().get(), readCollectionInPages(canonicalRef(), 50)]);
  const state = snapshot.exists ? snapshot.data() as HubState : emptyState();
  return mergeCanonical(state.canonical || [], collectionDocuments.map(document => document.data() as HubState["canonical"][number]));
}

function externalIdentities(record: HubState["canonical"][number]) {
  return Array.isArray(record.record.externalIdentities) ? record.record.externalIdentities.filter((identity): identity is Record<string, unknown> => Boolean(identity && typeof identity === "object")) : [];
}

function canonicalStatus(record: HubState["canonical"][number]) {
  if (record.lifecycleStatus) return record.lifecycleStatus;
  if (record.publicationStatus === "published") return "published";
  if (record.publicationStatus === "withdrawn") return "archived";
  return "needs-review";
}

function registryName(record: HubState["canonical"][number]) {
  return record.entityType === "Address" ? formatAddress(record.record) || record.canonicalId : String(record.record.displayName || record.record.name || record.record.approvedName || record.canonicalId);
}

function registrySearchText(record: HubState["canonical"][number]) {
  const identities = externalIdentities(record).flatMap(identity => [identity.provider, identity.externalId]);
  const references = [record.record.workEmail, record.record.operationalLocationId, record.record.legendId, record.record.tillItemId, record.record.categoryId, record.record.addressLine1, record.record.addressLine2, record.record.addressLine3, record.record.locality, record.record.region, record.record.postalCode, record.record.countryCode, record.record.addressReference, ...siteReferences(record.record)];
  return [record.canonicalId, record.entityType, registryName(record), ...identities, ...references].filter(Boolean).join(" ").toLowerCase();
}

function registrySortValue(record: HubState["canonical"][number], sort: NonNullable<RegistryQuery["sort"]>) {
  if (sort === "entityType") return record.entityType;
  if (sort === "updatedAt") return String(record.record.updatedAt || "");
  if (sort === "createdAt") return String(record.record.createdAt || "");
  if (sort === "status") return canonicalStatus(record);
  return registryName(record);
}

function siteReferences(value: unknown, key = ""): string[] {
  if (Array.isArray(value)) return value.flatMap(item => siteReferences(item, key));
  if (!value || typeof value !== "object") return /site|oploc|operationalLocation/i.test(key) && !/status|hash/i.test(key) && typeof value === "string" ? [value] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, childValue]) => siteReferences(childValue, childKey));
}

function migrateLegacyTerminology(state: HubState) {
  for (const record of state.staging) {
    if (String(record.entityType) === "Menu Item") record.entityType = "Till Item";
    if (String(record.entityType) === "Menu Item Variation") record.entityType = "Till Item Variation";
    if ("menuItemId" in record.normalised && !("tillItemId" in record.normalised)) record.normalised.tillItemId = record.normalised.menuItemId;
    if ("menuItemExternalId" in record.normalised && !("tillItemExternalId" in record.normalised)) record.normalised.tillItemExternalId = record.normalised.menuItemExternalId;
    delete record.normalised.menuItemId;
    delete record.normalised.menuItemExternalId;
  }
  for (const record of state.canonical) {
    if (String(record.entityType) === "Menu Item") { record.entityType = "Till Item"; record.record.entityType = "Till Item"; }
    if (String(record.entityType) === "Menu Item Variation") { record.entityType = "Till Item Variation"; record.record.entityType = "Till Item Variation"; }
    if ("menuItemId" in record.record && !("tillItemId" in record.record)) record.record.tillItemId = record.record.menuItemId;
    delete record.record.menuItemId;
  }
  for (const mapping of state.mappings) {
    if (mapping.targetEntity === "Menu Item") mapping.targetEntity = "Till Item";
    if (mapping.targetEntity === "Menu Item Variation") mapping.targetEntity = "Till Item Variation";
    for (const field of mapping.fields) if (field.target === "menuItemId") field.target = "tillItemId";
  }
}

function mergeStaging(...groups: HubState["staging"][]) {
  const byId = new Map<string, HubState["staging"][number]>();
  for (const record of groups.flat()) byId.set(record.stagingId, record);
  return [...byId.values()];
}

export function activeStagingDocuments<T extends { data(): { source?: string; generation?: string } }>(state: Pick<HubState, "stagingGenerations">, documents: T[]) {
  return documents.filter(document => {
    const data = document.data();
    const source = String(data.source || "other");
    const activeGeneration = state.stagingGenerations?.[source];
    return activeGeneration ? data.generation === activeGeneration : !data.generation;
  });
}

async function readCollectionInPages(query: Query, pageSize: number) {
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get();
    documents.push(...page.docs);
    if (page.size < pageSize) break;
    cursor = page.docs.at(-1);
  }
  return documents;
}

async function readCollectionInTransactionPages(transaction: Transaction, query: Query, pageSize: number) {
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await transaction.get(pageQuery);
    documents.push(...page.docs);
    if (page.size < pageSize) break;
    cursor = page.docs.at(-1);
  }
  return documents;
}

async function readProviderStagingDocuments(provider: "brighthr" | "square") {
  return readCollectionInPages(stagingRef().where("source", "==", provider), 5);
}

async function deleteStagingDocumentsInBatches(documents: QueryDocumentSnapshot[]) {
  for (let index = 0; index < documents.length; index += 400) {
    const batch = db.batch();
    for (const document of documents.slice(index, index + 400)) batch.delete(document.ref);
    await batch.commit();
  }
}

function mergeCanonical(...groups: HubState["canonical"][]) {
  const byId = new Map<string, HubState["canonical"][number]>();
  for (const record of groups.flat()) byId.set(record.canonicalId, record);
  return [...byId.values()];
}

function canonicalDocumentId(canonicalId: string) {
  return crypto.createHash("sha256").update(canonicalId).digest("hex");
}

function canonicalHasProvider(record: Record<string, unknown>, provider: string) {
  const direct = Array.isArray(record.externalIdentities) ? record.externalIdentities : [];
  const ownership = record.ownership && typeof record.ownership === "object" ? record.ownership as Record<string, unknown> : {};
  const providerOwned = ownership.providerOwned && typeof ownership.providerOwned === "object" ? ownership.providerOwned as Record<string, unknown> : {};
  const nested = Array.isArray(providerOwned.externalIdentities) ? providerOwned.externalIdentities : [];
  return [...direct, ...nested].some(identity => identity && typeof identity === "object" && String((identity as Record<string, unknown>).provider || "") === provider);
}

export function chunkStagingRecords(records: HubState["staging"], maximumBytes = MAX_STAGING_DOCUMENT_BYTES) {
  const grouped = new Map<string, HubState["staging"]>();
  for (const record of records) {
    const source = String(record.raw.provider || (record.importId.startsWith("import:") ? "spreadsheet" : "other"));
    grouped.set(source, [...(grouped.get(source) || []), record]);
  }
  const chunks: { id: string; source: string; records: HubState["staging"] }[] = [];
  for (const [source, sourceRecords] of grouped) {
    let current: HubState["staging"] = [], index = 0;
    for (const record of sourceRecords) {
      const candidate = [...current, record];
      if (current.length && Buffer.byteLength(JSON.stringify({ source, records: candidate }), "utf8") > maximumBytes) {
        chunks.push({ id: `${source}-${String(index).padStart(4, "0")}`, source, records: current });
        current = [record]; index += 1;
      } else current = candidate;
      if (Buffer.byteLength(JSON.stringify({ source, records: current }), "utf8") > maximumBytes) throw new Error(`One ${source} staging record exceeds the safe Firestore document size.`);
    }
    if (current.length) chunks.push({ id: `${source}-${String(index).padStart(4, "0")}`, source, records: current });
  }
  return chunks;
}

export function activity(actor: Actor, action: string, entityReference: string, source: string, summary: string, correlationId: string = crypto.randomUUID()): Activity {
  return { activityId: crypto.randomUUID(), timestamp: new Date().toISOString(), actorId: actor.uid, actorName: actor.name, action, entityReference, source, correlationId, summary };
}

export function ensureDataFolders() {
  for (const folder of ["uploads", "snapshots", "emulator-export", "generated-reports", "quarantine"]) fs.mkdirSync(assertSafeLocalPath(path.join(dataRoot(), folder)), { recursive: true });
}

export function saveLocalSnapshot(relative: string, data: Buffer | string) {
  ensureDataFolders();
  const target = assertSafeLocalPath(path.join(dataRoot(), relative));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return path.relative(dataRoot(), target).replaceAll("\\", "/");
}
