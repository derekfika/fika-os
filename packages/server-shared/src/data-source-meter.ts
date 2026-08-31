export const DATA_SOURCES = ["FIRESTORE", "SNAPSHOT", "CLIENT_CACHE", "APP_CACHE", "MEMORY", "STATIC", "UNKNOWN"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];
export type DataTraceLevel = "NORMAL" | "WARN" | "HIGH";
export const CANONICAL_OS_APPS = ["integration-hub", "menu-planning", "logistics", "cpu-production", "delivered-in", "hospitality-booking", "ad-hoc-production", "events-dashboard"] as const;
export type CanonicalOsApp = (typeof CANONICAL_OS_APPS)[number];
const APP_ALIASES: Record<string, CanonicalOsApp> = { hospitality: "hospitality-booking" };
export function canonicalOsAppId(app: string): string { return (CANONICAL_OS_APPS as readonly string[]).includes(app) ? app : APP_ALIASES[app] || app; }
export type CacheResult = "HIT" | "MISS" | "IN_FLIGHT_JOIN" | "FALLBACK" | "BYPASS" | "STALE" | "REVALIDATED";
export type TraceOutcome = "SUCCESS" | "ERROR" | "DENIED" | "NOT_FOUND" | "FALLBACK" | "PARTIAL";
export type DataTraceInput = { app: string; action?: string; path?: string; requestId?: string; traceId?: string; dataset?: string; outcome?: TraceOutcome };
export type DataAccessInput = { app?: string; action?: string; path?: string; operation: string; source: DataSource; /** Backward-compatible alias for returnedDocuments. */ documents: number; returnedDocuments?: number; /** Deprecated compatibility field; use estimatedBillableReads. */ firestoreReads?: number; estimatedBillableReads?: number; estimatedFirestoreWrites?: number; estimatedFirestoreDeletes?: number; firestoreReadKind?: "query" | "document" | "transaction"; cacheHit?: boolean; cacheResult?: CacheResult; dataset?: string; packageVersion?: number; projectionVersion?: number; outcome?: TraceOutcome; durationMs?: number };
export type DataAccessRecord = DataAccessInput & { app: string; action: string; path: string; traceId: string; requestId?: string; returnedDocuments: number; estimatedBillableReads: number; estimatedFirestoreWrites: number; estimatedFirestoreDeletes: number; level: DataTraceLevel };
export type CacheCounters = Record<CacheResult, number>;
export type DataTraceSummary = { schemaVersion: 1; app: string; action: string; path: string; traceId: string; requestId?: string; dataset?: string; outcome?: TraceOutcome; firestoreReturnedDocuments: number; estimatedFirestoreBillableReads: number; estimatedFirestoreWrites: number; estimatedFirestoreDeletes: number; snapshotRecords: number; clientCacheRecords: number; appCacheRecords: number; memoryRecords: number; staticRecords: number; unknownRecords: number; totalReturnedRecords: number; cache: CacheCounters; /** Deprecated compatibility aliases. */ firestoreDocuments: number; clientCacheDocuments: number; appCacheDocuments: number; memoryDocuments: number; staticDocuments: number; unknownDocuments: number; totalDocuments: number; operations: number; durationMs: number; level: DataTraceLevel; records: DataAccessRecord[]; };
export type DataTrace = DataTraceInput & { action: string; path: string; traceId: string; startedAt: number; records: DataAccessRecord[]; aggregateKeys: Set<string>; totals: Record<DataSource, number>; operations: number; estimatedFirestoreBillableReads: number; estimatedFirestoreWrites: number; estimatedFirestoreDeletes: number; cache: CacheCounters; };

const MAX_RECORDS = 128;
const MAX_OPERATION_DOCUMENTS = 250;
const HIGH_OPERATION_DOCUMENTS = 1000;

function randomTraceId() {
  try { return globalThis.crypto?.randomUUID() || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; } catch { return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}

export function isDataSourceTraceEnabled(env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env) {
  if (env.FIKA_DATA_SOURCE_TRACE === "1" || env.NEXT_PUBLIC_FIKA_DATA_SOURCE_TRACE === "1") return true;
  if (typeof window !== "undefined") { try { return window.localStorage.getItem("FIKA_DATA_SOURCE_TRACE") === "1"; } catch { return false; } }
  return false;
}

export function classifyDataTraceLevel(documents: number): DataTraceLevel {
  if (documents > HIGH_OPERATION_DOCUMENTS) return "HIGH";
  if (documents > MAX_OPERATION_DOCUMENTS) return "WARN";
  return "NORMAL";
}

export function startDataTrace(input: DataTraceInput): DataTrace | undefined {
  if (!isDataSourceTraceEnabled()) return undefined;
  return { ...input, app: canonicalOsAppId(input.app), action: input.action || "request", path: input.path || "unknown", traceId: input.traceId || randomTraceId(), startedAt: Date.now(), records: [], aggregateKeys: new Set(), totals: { FIRESTORE: 0, SNAPSHOT: 0, CLIENT_CACHE: 0, APP_CACHE: 0, MEMORY: 0, STATIC: 0, UNKNOWN: 0 }, operations: 0, estimatedFirestoreBillableReads: 0, estimatedFirestoreWrites: 0, estimatedFirestoreDeletes: 0, cache: { HIT: 0, MISS: 0, IN_FLIGHT_JOIN: 0, FALLBACK: 0, BYPASS: 0, STALE: 0, REVALIDATED: 0 } };
}

export function recordDataAccess(trace: DataTrace | undefined, input: DataAccessInput) {
  if (!trace) return;
  const source = DATA_SOURCES.includes(input.source) ? input.source : "UNKNOWN";
  const returnedDocuments = Number.isFinite(input.returnedDocuments) && (input.returnedDocuments || 0) >= 0 ? Math.floor(input.returnedDocuments || 0) : Number.isFinite(input.documents) && input.documents >= 0 ? Math.floor(input.documents) : 0;
  const estimatedBillableReads = Number.isFinite(input.estimatedBillableReads) && (input.estimatedBillableReads || 0) >= 0 ? Math.floor(input.estimatedBillableReads || 0) : source === "FIRESTORE" ? Math.max(1, returnedDocuments) : 0;
  const firestoreReads = Number.isFinite(input.firestoreReads) && (input.firestoreReads || 0) >= 0 ? Math.floor(input.firestoreReads || 0) : estimatedBillableReads;
  const estimatedFirestoreWrites = Number.isFinite(input.estimatedFirestoreWrites) && (input.estimatedFirestoreWrites || 0) >= 0 ? Math.floor(input.estimatedFirestoreWrites || 0) : 0;
  const estimatedFirestoreDeletes = Number.isFinite(input.estimatedFirestoreDeletes) && (input.estimatedFirestoreDeletes || 0) >= 0 ? Math.floor(input.estimatedFirestoreDeletes || 0) : 0;
  const cacheResult = input.cacheResult || (input.cacheHit === true ? "HIT" : input.cacheHit === false ? "MISS" : undefined);
  const key = `${input.app || trace.app}|${input.action || trace.action}|${input.path || trace.path}|${input.operation}|${source}`;
  if (!trace.aggregateKeys.has(key)) trace.aggregateKeys.add(key);
  trace.totals[source] += returnedDocuments;
  trace.operations += 1;
  if (source === "FIRESTORE") { trace.estimatedFirestoreBillableReads += estimatedBillableReads; trace.estimatedFirestoreWrites += estimatedFirestoreWrites; trace.estimatedFirestoreDeletes += estimatedFirestoreDeletes; }
  if (cacheResult) trace.cache[cacheResult] += 1;
  if (trace.records.length < MAX_RECORDS) trace.records.push({ ...input, source, app: canonicalOsAppId(input.app || trace.app), action: input.action || trace.action, path: input.path || trace.path, traceId: trace.traceId, ...(trace.requestId ? { requestId: trace.requestId } : {}), ...(cacheResult ? { cacheResult } : {}), documents: returnedDocuments, returnedDocuments, firestoreReads, estimatedBillableReads, estimatedFirestoreWrites, estimatedFirestoreDeletes, level: classifyDataTraceLevel(Math.max(returnedDocuments, estimatedBillableReads)) });
}

export function endDataTrace(trace: DataTrace | undefined, durationMs = trace ? Date.now() - trace.startedAt : 0): DataTraceSummary | undefined {
  if (!trace) return undefined;
  const totalDocuments = Object.values(trace.totals).reduce((sum, value) => sum + value, 0);
  return { schemaVersion: 1, app: trace.app, action: trace.action, path: trace.path, traceId: trace.traceId, requestId: trace.requestId, dataset: trace.dataset, outcome: trace.outcome, firestoreReturnedDocuments: trace.totals.FIRESTORE, estimatedFirestoreBillableReads: trace.estimatedFirestoreBillableReads, estimatedFirestoreWrites: trace.estimatedFirestoreWrites, estimatedFirestoreDeletes: trace.estimatedFirestoreDeletes, snapshotRecords: trace.totals.SNAPSHOT, clientCacheRecords: trace.totals.CLIENT_CACHE, appCacheRecords: trace.totals.APP_CACHE, memoryRecords: trace.totals.MEMORY, staticRecords: trace.totals.STATIC, unknownRecords: trace.totals.UNKNOWN, totalReturnedRecords: totalDocuments, cache: { ...trace.cache }, firestoreDocuments: trace.totals.FIRESTORE, clientCacheDocuments: trace.totals.CLIENT_CACHE, appCacheDocuments: trace.totals.APP_CACHE, memoryDocuments: trace.totals.MEMORY, staticDocuments: trace.totals.STATIC, unknownDocuments: trace.totals.UNKNOWN, totalDocuments, operations: trace.operations, durationMs, level: classifyDataTraceLevel(Math.max(totalDocuments, trace.estimatedFirestoreBillableReads, trace.estimatedFirestoreWrites, trace.estimatedFirestoreDeletes)), records: trace.records.map(record => ({ ...record, durationMs: record.durationMs })), };
}
