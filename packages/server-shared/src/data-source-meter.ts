export const DATA_SOURCES = ["FIRESTORE", "CLIENT_CACHE", "APP_CACHE", "MEMORY", "STATIC", "UNKNOWN"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];
export type DataTraceLevel = "NORMAL" | "WARN" | "HIGH";
export type DataTraceInput = { app: string; action?: string; path?: string; requestId?: string; traceId?: string };
export type DataAccessInput = { app?: string; action?: string; path?: string; operation: string; source: DataSource; documents: number; firestoreReads?: number; cacheHit?: boolean; durationMs?: number };
export type DataAccessRecord = DataAccessInput & { app: string; action: string; path: string; traceId: string; requestId?: string; level: DataTraceLevel };
export type DataTraceSummary = { app: string; action: string; path: string; traceId: string; requestId?: string; firestoreDocuments: number; clientCacheDocuments: number; appCacheDocuments: number; memoryDocuments: number; staticDocuments: number; unknownDocuments: number; totalDocuments: number; operations: number; durationMs: number; level: DataTraceLevel; records: DataAccessRecord[]; };
export type DataTrace = DataTraceInput & { action: string; path: string; traceId: string; startedAt: number; records: DataAccessRecord[]; aggregateKeys: Set<string>; totals: Record<DataSource, number>; operations: number; };

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
  return { ...input, action: input.action || "request", path: input.path || "unknown", traceId: input.traceId || randomTraceId(), startedAt: Date.now(), records: [], aggregateKeys: new Set(), totals: { FIRESTORE: 0, CLIENT_CACHE: 0, APP_CACHE: 0, MEMORY: 0, STATIC: 0, UNKNOWN: 0 }, operations: 0 };
}

export function recordDataAccess(trace: DataTrace | undefined, input: DataAccessInput) {
  if (!trace) return;
  const source = DATA_SOURCES.includes(input.source) ? input.source : "UNKNOWN";
  const documents = Number.isFinite(input.documents) && input.documents >= 0 ? Math.floor(input.documents) : 0;
  const firestoreReads = Number.isFinite(input.firestoreReads) && (input.firestoreReads || 0) >= 0 ? Math.floor(input.firestoreReads || 0) : source === "FIRESTORE" ? documents : 0;
  const key = `${input.app || trace.app}|${input.action || trace.action}|${input.path || trace.path}|${input.operation}|${source}`;
  if (!trace.aggregateKeys.has(key)) trace.aggregateKeys.add(key);
  trace.totals[source] += documents;
  trace.operations += 1;
  if (trace.records.length < MAX_RECORDS) trace.records.push({ ...input, source, app: input.app || trace.app, action: input.action || trace.action, path: input.path || trace.path, traceId: trace.traceId, ...(trace.requestId ? { requestId: trace.requestId } : {}), documents, firestoreReads, level: classifyDataTraceLevel(Math.max(documents, firestoreReads)) });
}

export function endDataTrace(trace: DataTrace | undefined, durationMs = trace ? Date.now() - trace.startedAt : 0): DataTraceSummary | undefined {
  if (!trace) return undefined;
  const totalDocuments = Object.values(trace.totals).reduce((sum, value) => sum + value, 0);
  return { app: trace.app, action: trace.action, path: trace.path, traceId: trace.traceId, requestId: trace.requestId, firestoreDocuments: trace.totals.FIRESTORE, clientCacheDocuments: trace.totals.CLIENT_CACHE, appCacheDocuments: trace.totals.APP_CACHE, memoryDocuments: trace.totals.MEMORY, staticDocuments: trace.totals.STATIC, unknownDocuments: trace.totals.UNKNOWN, totalDocuments, operations: trace.operations, durationMs, level: classifyDataTraceLevel(Math.max(totalDocuments, trace.totals.FIRESTORE)), records: trace.records.map(record => ({ ...record, durationMs: record.durationMs })), };
}
