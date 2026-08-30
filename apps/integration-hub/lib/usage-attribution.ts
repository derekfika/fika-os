import { GoogleAuth } from "google-auth-library";

export type AttributionRange = { start: string; end: string; timezone: "Europe/London" };
export type AttributionResolution = "1m" | "5m" | "1h" | "1d";
export type AttributionPoint = { timestamp: string; value: number };
export type CloudLogEntry = { timestamp?: string; receiveTimestamp?: string; textPayload?: string; jsonPayload?: unknown };
export type AttributionBucket = { timestamp: string; cloudMonitoringReads: number; attributedEstimatedReads: number; unattributedReads: number; byApp: Record<string, number> };
export type AttributionApp = { app: string; traceCount: number; estimatedFirestoreBillableReads: number; firestoreReturnedDocuments: number; clientCacheRecords: number; appCacheRecords: number; memoryRecords: number; highCount: number; warnCount: number };
export type AttributionAction = { action: string; app: string; traceCount: number; estimatedFirestoreBillableReads: number; firestoreReturnedDocuments: number; cacheServedRecords: number; averageDurationMs: number; maxDurationMs: number; highCount: number; warnCount: number };
export type AttributionOperation = { operation: string; app: string; source: string; executions: number; returnedDocuments: number; estimatedBillableReads: number; averageReadsPerExecution: number; maxReadsPerExecution: number };
export type UsageAttribution = {
  available: boolean;
  message?: string;
  traceCount: number;
  estimatedFirestoreBillableReads: number;
  firestoreReturnedDocuments: number;
  authoritativeReads: number | null;
  unattributedReads: number | null;
  coveragePercent: number | null;
  overAttribution: boolean;
  parseFailures: number;
  truncated: boolean;
  instrumentedApps: string[];
  appsSeenInWindow: string[];
  expectedInstrumentation: Record<string, "enabled" | "not-enabled" | "unknown">;
  apps: AttributionApp[];
  actions: AttributionAction[];
  operations: AttributionOperation[];
  buckets: AttributionBucket[];
};

export const CLOUD_LOGGING_PAGE_SIZE = 200;
export const EXPECTED_STAGING_INSTRUMENTATION = { "integration-hub": "enabled", logistics: "enabled", "menu-planning": "enabled", "cpu-production": "enabled", "delivered-in": "enabled", hospitality: "unknown" } as const;
const KNOWN_APPS = new Set(["integration-hub", "logistics", "menu-planning"]);
const MARKER = /^\[(FIKA_DATA_TRACE_TOTAL|FIKA_DATA_TRACE)\]\s+(\{.*\})\s*$/;

type NormalizedRecord = { app: string; action: string; operation: string; source: string; returnedDocuments: number; estimatedBillableReads: number; durationMs: number; level: string };
type NormalizedTrace = { app: string; action: string; path: string; traceId: string; firestoreReturnedDocuments: number; estimatedFirestoreBillableReads: number; clientCacheRecords: number; appCacheRecords: number; memoryRecords: number; durationMs: number; level: string; records: NormalizedRecord[]; timestamp: string };

const numberValue = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : typeof value === "string" && Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback;
const stringValue = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim() : fallback;
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const firstNumber = (object: Record<string, unknown>, names: string[]) => { for (const name of names) if (name in object) return numberValue(object[name]); return 0; };
const firstString = (object: Record<string, unknown>, names: string[], fallback: string) => { for (const name of names) if (typeof object[name] === "string" && object[name]) return String(object[name]); return fallback; };
const safeApp = (app: string) => KNOWN_APPS.has(app) ? app : "unknown/other";

export function cloudLoggingFilter(): string {
  return 'timestamp >= "{start}" AND timestamp <= "{end}" AND (resource.type = "cloud_run_revision" OR resource.type = "firebaseapphosting.googleapis.com/Backend") AND (textPayload:"[FIKA_DATA_TRACE_TOTAL]" OR jsonPayload.message:"[FIKA_DATA_TRACE_TOTAL]" OR jsonPayload.log:"[FIKA_DATA_TRACE_TOTAL]")';
}

export function cloudLoggingRequest(range: AttributionRange, projectId: string) {
  return {
    url: "https://logging.googleapis.com/v2/entries:list",
    body: { resourceNames: ["projects/" + projectId], filter: cloudLoggingFilter().replace("{start}", range.start).replace("{end}", range.end), orderBy: "timestamp asc", pageSize: CLOUD_LOGGING_PAGE_SIZE },
  };
}

export function parseTraceLogLine(line: string): { kind: "total" | "record"; value: Record<string, unknown> } | undefined {
  const match = line.match(MARKER);
  if (!match) return undefined;
  try { const parsed = JSON.parse(match[2]); return { kind: match[1] === "FIKA_DATA_TRACE_TOTAL" ? "total" : "record", value: objectValue(parsed) }; } catch { return undefined; }
}

function entryLine(entry: CloudLogEntry): string | undefined {
  if (typeof entry.textPayload === "string") return entry.textPayload.trim();
  const payload = objectValue(entry.jsonPayload);
  for (const key of ["message", "log", "textPayload"]) if (typeof payload[key] === "string") return String(payload[key]).trim();
  return undefined;
}

function normalizeRecord(value: Record<string, unknown>, parent: Pick<NormalizedTrace, "app" | "action">): NormalizedRecord {
  const source = firstString(value, ["source"], "UNKNOWN");
  const returnedDocuments = firstNumber(value, ["returnedDocuments", "firestoreReturnedDocuments", "documents", "firestoreDocuments", "totalDocuments"]);
  const estimatedBillableReads = source === "FIRESTORE" ? firstNumber(value, ["estimatedBillableReads", "estimatedFirestoreBillableReads", "firestoreReads", "firestoreDocuments", "returnedDocuments"]) : 0;
  return { app: safeApp(firstString(value, ["app"], parent.app)), action: firstString(value, ["action"], parent.action), operation: firstString(value, ["operation"], "unknown"), source, returnedDocuments, estimatedBillableReads, durationMs: numberValue(value.durationMs), level: firstString(value, ["level"], "NORMAL") };
}

function normalizeTrace(value: Record<string, unknown>, timestamp: string): NormalizedTrace {
  const app = safeApp(firstString(value, ["app"], "unknown/other"));
  const action = firstString(value, ["action"], "unknown");
  const base = { app, action, path: firstString(value, ["path"], "unknown"), traceId: firstString(value, ["traceId"], "unknown"), firestoreReturnedDocuments: firstNumber(value, ["firestoreReturnedDocuments", "firestoreDocuments"]), estimatedFirestoreBillableReads: firstNumber(value, ["estimatedFirestoreBillableReads", "estimatedBillableReads", "firestoreReads"]), clientCacheRecords: firstNumber(value, ["clientCacheRecords", "clientCacheDocuments"]), appCacheRecords: firstNumber(value, ["appCacheRecords", "appCacheDocuments"]), memoryRecords: firstNumber(value, ["memoryRecords", "memoryDocuments"]), durationMs: numberValue(value.durationMs), level: firstString(value, ["level"], "NORMAL"), timestamp };
  const rawRecords = Array.isArray(value.records) ? value.records : [];
  const records = rawRecords.map(item => normalizeRecord(objectValue(item), base));
  if (!base.estimatedFirestoreBillableReads && records.length) base.estimatedFirestoreBillableReads = records.reduce((sum, record) => sum + (record.source === "FIRESTORE" ? record.estimatedBillableReads : 0), 0);
  if (!base.firestoreReturnedDocuments && records.length) base.firestoreReturnedDocuments = records.reduce((sum, record) => sum + (record.source === "FIRESTORE" ? record.returnedDocuments : 0), 0);
  return { ...base, records };
}

function bucketCount(range: AttributionRange, resolution: AttributionResolution) { return Math.max(1, Math.ceil((Date.parse(range.end) - Date.parse(range.start)) / ({ "1m": 60000, "5m": 300000, "1h": 3600000, "1d": 86400000 }[resolution]))); }

export function aggregateAttribution(entries: CloudLogEntry[], range: AttributionRange, resolution: AttributionResolution, authoritativeReads: number | null): UsageAttribution {
  let parseFailures = 0;
  const traces: NormalizedTrace[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const line = entryLine(entry);
    if (!line) { parseFailures++; continue; }
    const parsed = parseTraceLogLine(line);
    if (!parsed) { parseFailures++; continue; }
    if (parsed.kind !== "total") continue;
    const trace = normalizeTrace(parsed.value, entry.timestamp || entry.receiveTimestamp || range.start);
    const identity = trace.traceId === "unknown" ? `${trace.timestamp}|${trace.app}|${trace.action}` : trace.traceId;
    if (seen.has(identity)) continue;
    seen.add(identity); traces.push(trace);
  }
  const apps = new Map<string, AttributionApp>(); const actions = new Map<string, AttributionAction>(); const operations = new Map<string, AttributionOperation>();
  for (const trace of traces) {
    const app = apps.get(trace.app) || { app: trace.app, traceCount: 0, estimatedFirestoreBillableReads: 0, firestoreReturnedDocuments: 0, clientCacheRecords: 0, appCacheRecords: 0, memoryRecords: 0, highCount: 0, warnCount: 0 };
    app.traceCount++; app.estimatedFirestoreBillableReads += trace.estimatedFirestoreBillableReads; app.firestoreReturnedDocuments += trace.firestoreReturnedDocuments; app.clientCacheRecords += trace.clientCacheRecords; app.appCacheRecords += trace.appCacheRecords; app.memoryRecords += trace.memoryRecords; if (trace.level === "HIGH") app.highCount++; if (trace.level === "WARN") app.warnCount++; apps.set(trace.app, app);
    const actionKey = trace.app + "|" + trace.action; const action = actions.get(actionKey) || { action: trace.action, app: trace.app, traceCount: 0, estimatedFirestoreBillableReads: 0, firestoreReturnedDocuments: 0, cacheServedRecords: 0, averageDurationMs: 0, maxDurationMs: 0, highCount: 0, warnCount: 0 };
    action.traceCount++; action.estimatedFirestoreBillableReads += trace.estimatedFirestoreBillableReads; action.firestoreReturnedDocuments += trace.firestoreReturnedDocuments; action.cacheServedRecords += trace.clientCacheRecords + trace.appCacheRecords + trace.memoryRecords; action.averageDurationMs += trace.durationMs; action.maxDurationMs = Math.max(action.maxDurationMs, trace.durationMs); if (trace.level === "HIGH") action.highCount++; if (trace.level === "WARN") action.warnCount++; actions.set(actionKey, action);
    for (const record of trace.records) { const key = `${record.app}|${record.operation}|${record.source}`; const operation = operations.get(key) || { operation: record.operation, app: record.app, source: record.source, executions: 0, returnedDocuments: 0, estimatedBillableReads: 0, averageReadsPerExecution: 0, maxReadsPerExecution: 0 }; operation.executions++; operation.returnedDocuments += record.returnedDocuments; operation.estimatedBillableReads += record.estimatedBillableReads; operation.maxReadsPerExecution = Math.max(operation.maxReadsPerExecution, record.estimatedBillableReads); operations.set(key, operation); }
  }
  for (const action of actions.values()) action.averageDurationMs = action.traceCount ? Math.round(action.averageDurationMs / action.traceCount) : 0;
  for (const operation of operations.values()) operation.averageReadsPerExecution = operation.executions ? Math.round(operation.estimatedBillableReads / operation.executions) : 0;
  const attributed = traces.reduce((sum, trace) => sum + trace.estimatedFirestoreBillableReads, 0);
  const overAttribution = authoritativeReads !== null && attributed > authoritativeReads;
  const bucketMs = ({ "1m": 60000, "5m": 300000, "1h": 3600000, "1d": 86400000 }[resolution]); const count = bucketCount(range, resolution); const buckets = Array.from({ length: count }, (_, index) => ({ timestamp: new Date(Date.parse(range.start) + index * bucketMs).toISOString(), cloudMonitoringReads: 0, attributedEstimatedReads: 0, unattributedReads: 0, byApp: {} as Record<string, number> }));
  for (const trace of traces) { const index = Math.min(count - 1, Math.max(0, Math.floor((Date.parse(trace.timestamp) - Date.parse(range.start)) / bucketMs))); const bucket = buckets[index]; bucket.attributedEstimatedReads += trace.estimatedFirestoreBillableReads; bucket.byApp[trace.app] = (bucket.byApp[trace.app] || 0) + trace.estimatedFirestoreBillableReads; }
  const coverage = authoritativeReads === null ? null : authoritativeReads === 0 ? 0 : Math.round(attributed / authoritativeReads * 10000) / 100;
  const appsSeenInWindow = [...apps.keys()].sort();
  return { available: true, traceCount: traces.length, estimatedFirestoreBillableReads: attributed, firestoreReturnedDocuments: traces.reduce((sum, trace) => sum + trace.firestoreReturnedDocuments, 0), authoritativeReads, unattributedReads: authoritativeReads === null ? null : Math.max(0, authoritativeReads - attributed), coveragePercent: coverage, overAttribution, parseFailures, truncated: false, instrumentedApps: Object.keys(EXPECTED_STAGING_INSTRUMENTATION), appsSeenInWindow, expectedInstrumentation: { ...EXPECTED_STAGING_INSTRUMENTATION }, apps: [...apps.values()].sort((a, b) => b.estimatedFirestoreBillableReads - a.estimatedFirestoreBillableReads), actions: [...actions.values()].sort((a, b) => b.estimatedFirestoreBillableReads - a.estimatedFirestoreBillableReads).slice(0, 50), operations: [...operations.values()].sort((a, b) => b.estimatedBillableReads - a.estimatedBillableReads).slice(0, 50), buckets };
}

export type CloudLoggingClient = { list: (range: AttributionRange) => Promise<{ entries: CloudLogEntry[]; truncated: boolean }> };
export function createCloudLoggingClient(fetchImpl: typeof fetch = fetch, configuredProjectId?: string): CloudLoggingClient {
  return { async list(range) { const projectId = configuredProjectId || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "fika-os-dev"; const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/logging.read"] }); const client = await auth.getClient(); const token = await client.getAccessToken(); if (!token.token) throw new Error("Google Cloud Logging credentials are not available to the server runtime."); const request = cloudLoggingRequest(range, projectId); const response = await fetchImpl(request.url, { method: "POST", headers: { Authorization: "Bearer " + token.token, "Content-Type": "application/json" }, body: JSON.stringify(request.body), cache: "no-store" }); const body = await response.json().catch(() => undefined) as { entries?: CloudLogEntry[]; nextPageToken?: string; error?: { message?: string } } | undefined; if (!response.ok) throw new Error("Google Cloud Logging returned HTTP " + response.status + (body?.error?.message ? ": " + body.error.message : ".")); return { entries: body?.entries || [], truncated: Boolean(body?.nextPageToken) }; } };
}
