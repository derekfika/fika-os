import { GoogleAuth } from "google-auth-library";
import { getFikaRuntimeConfig } from "./runtime-config";
import { aggregateAttribution, createCloudLoggingClient, type CloudLoggingClient, type UsageAttribution } from "./usage-attribution";

export type UsageMetric = "reads" | "writes" | "deletes";
export type UsagePoint = { timestamp: string; value: number };
export type UsageRange = { start: string; end: string; timezone: "Europe/London" };
export type UsageResolution = "1m" | "5m" | "1h" | "1d";
export type UsageStatus = "healthy" | "watch" | "high" | "critical" | "unknown";
export type UsageConfig = {
  projectId: string;
  dailyReadAllowance?: number;
  watchPercent: number;
  highPercent: number;
  criticalPercent: number;
  spikeMultiplier: number;
  maxWindowDays: number;
  cacheTtlMs: number;
};
export type UsageDashboard = {
  generatedAt: string;
  range: UsageRange;
  resolution: UsageResolution;
  source: { label: string; projectId: string };
  totals: Record<UsageMetric, number | null>;
  allowance?: { reads: number; used: number; percent: number; remaining: number; status: UsageStatus };
  timeline: Record<UsageMetric, UsagePoint[]>;
  dailyTotals7d: UsagePoint[];
  baseline: { available: boolean; multiplier?: number; message: string };
  appUsage: { available: false; message: string; rows: never[] };
  queryInsights: { available: false; message: string; url: string };
  deployMarkers: { available: false; message: string };
  metricErrors: Partial<Record<UsageMetric, string>>;
  attribution: UsageAttribution;
};

const METRIC_TYPES: Record<UsageMetric, string> = {
  reads: "firestore.googleapis.com/document/read_ops_count",
  writes: "firestore.googleapis.com/document/write_ops_count",
  deletes: "firestore.googleapis.com/document/delete_ops_count",
};
const FIRESTORE_RESOURCE_TYPE = "firestore.googleapis.com/Database";
export type MonitoringRequestShape = { metricType: string; resourceType: string; projectId: string; startTime: string; endTime: string; alignmentPeriod: string; perSeriesAligner: "ALIGN_SUM"; crossSeriesReducer: "REDUCE_SUM"; groupByFields: string[] };

export function monitoringRequestShape(metric: UsageMetric, range: UsageRange, resolution: UsageResolution, projectId: string): MonitoringRequestShape {
  return { metricType: METRIC_TYPES[metric], resourceType: FIRESTORE_RESOURCE_TYPE, projectId, startTime: range.start, endTime: range.end, alignmentPeriod: alignmentPeriod(resolution), perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM", groupByFields: [] };
}

export function normalizeMonitoringError(body: unknown, httpStatus: number): string {
  const error = body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : body;
  if (!error || typeof error !== "object") return "Google Monitoring returned HTTP " + httpStatus + ".";
  const value = error as { code?: unknown; status?: unknown; message?: unknown; details?: unknown };
  const details = Array.isArray(value.details) ? value.details.map(detail => typeof detail === "string" ? detail : JSON.stringify(detail)).join("; ") : value.details ? JSON.stringify(value.details) : "";
  return ["Google Monitoring returned HTTP " + httpStatus + ".", value.code ? "code=" + String(value.code) : "", value.status ? "status=" + String(value.status) : "", value.message ? "message=" + String(value.message) : "", details ? "details=" + details : ""].filter(Boolean).join(" ");
}
export function monitoringQueryParameters(metric: UsageMetric, range: UsageRange, resolution: UsageResolution, projectId: string): URLSearchParams {
  const shape = monitoringRequestShape(metric, range, resolution, projectId);
  return new URLSearchParams({ filter: "metric.type = \"".concat(shape.metricType, "\" AND resource.type = \"", shape.resourceType, "\""), "interval.startTime": shape.startTime, "interval.endTime": shape.endTime, "aggregation.alignmentPeriod": shape.alignmentPeriod, "aggregation.perSeriesAligner": shape.perSeriesAligner, "aggregation.crossSeriesReducer": shape.crossSeriesReducer, view: "FULL" });
}

export function getUsageConfig(env: Record<string, string | undefined> = process.env): UsageConfig {
  const runtime = getFikaRuntimeConfig(env);
  const positive = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const allowance = Number(env.FIKA_DAILY_READ_ALLOWANCE);
  return {
    projectId: runtime.projectId,
    dailyReadAllowance: Number.isFinite(allowance) && allowance > 0 ? allowance : undefined,
    watchPercent: positive("FIKA_USAGE_WATCH_PERCENT", 0.5),
    highPercent: positive("FIKA_USAGE_HIGH_PERCENT", 0.75),
    criticalPercent: positive("FIKA_USAGE_CRITICAL_PERCENT", 0.9),
    spikeMultiplier: Math.max(1, positive("FIKA_USAGE_SPIKE_MULTIPLIER", 2)),
    maxWindowDays: Math.min(31, Math.max(1, positive("FIKA_USAGE_MAX_WINDOW_DAYS", 31))),
    cacheTtlMs: positive("FIKA_USAGE_CACHE_TTL_SECONDS", 180) * 1000,
  };
}

export function parseUsageRange(input: { start: string; end: string }, now = new Date(), config = getUsageConfig()): UsageRange {
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("Start and end must be valid date-times.");
  if (end <= start) throw new Error("End must be after start.");
  if (end.getTime() - start.getTime() > config.maxWindowDays * 86400000) throw new Error("The selected window is too large. Choose a shorter diagnostic range.");
  if (end.getTime() > now.getTime() + 60000) throw new Error("The selected end time cannot be in the future.");
  return { start: start.toISOString(), end: end.toISOString(), timezone: "Europe/London" };
}

export function resolutionForDuration(durationMs: number): UsageResolution {
  if (durationMs <= 2 * 3600000) return "1m";
  if (durationMs <= 86400000) return "5m";
  if (durationMs <= 7 * 86400000) return "1h";
  return "1d";
}

export function alignmentPeriod(resolution: UsageResolution): string {
  return { "1m": "60s", "5m": "300s", "1h": "3600s", "1d": "86400s" }[resolution];
}

export function normalizeMonitoringPoints(points: UsagePoint[], range: UsageRange, resolution: UsageResolution): UsagePoint[] {
  const startMs = Date.parse(range.start);
  const endMs = Date.parse(range.end);
  const periodMs = Number.parseInt(alignmentPeriod(resolution), 10) * 1000;
  const bucketCount = Math.max(1, Math.ceil((endMs - startMs) / periodMs));
  const values = Array.from({ length: bucketCount }, () => 0);
  for (const point of points) {
    const pointMs = Date.parse(point.timestamp);
    if (!Number.isFinite(pointMs) || pointMs <= startMs || pointMs > endMs) continue;
    const bucketIndex = Math.min(bucketCount - 1, Math.ceil((pointMs - startMs) / periodMs) - 1);
    values[bucketIndex] += point.value;
  }
  return values.map((value, index) => ({ timestamp: new Date(startMs + index * periodMs).toISOString(), value }));
}

export function londonDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const midday = new Date(String(values.year) + "-" + String(values.month) + "-" + String(values.day) + "T12:00:00Z");
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "longOffset" }).formatToParts(midday).find(part => part.type === "timeZoneName")?.value || "GMT";
  const match = zone.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const minutes = match ? (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === "+" ? 1 : -1) : 0;
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - minutes * 60000);
}

export function calculateStatus(percent: number | undefined, config: UsageConfig): UsageStatus {
  if (percent === undefined) return "unknown";
  if (percent >= config.criticalPercent) return "critical";
  if (percent >= config.highPercent) return "high";
  if (percent >= config.watchPercent) return "watch";
  return "healthy";
}

export function calculateBaseline(points: UsagePoint[], multiplierThreshold: number): UsageDashboard["baseline"] {
  const current = points.at(-1)?.value || 0;
  const prior = points.slice(0, -1).map(point => point.value).filter(value => value > 0);
  if (prior.length < 4) return { available: false, message: "Not enough baseline data" };
  const sorted = [...prior].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) return { available: false, message: "Not enough baseline data" };
  const multiplier = current / median;
  return { available: true, multiplier, message: multiplier >= multiplierThreshold ? "Reads are " + multiplier.toFixed(1) + "x above recent baseline" : "No unusual read increase detected" };
}

export function aggregateDaily(points: UsagePoint[], now: Date): UsagePoint[] {
  const buckets = new Map<string, number>();
  for (const point of points) {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(point.timestamp));
    buckets.set(key, (buckets.get(key) || 0) + point.value);
  }
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - (6 - index) * 86400000);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(date);
    return { timestamp: key, value: Math.round(buckets.get(key) || 0) };
  });
}

type MonitoringClient = { query: (metricType: string, range: UsageRange, resolution: UsageResolution) => Promise<UsagePoint[]> };
type MonitoringResponse = { timeSeries?: Array<{ points?: Array<{ interval?: { endTime?: string }; value?: { int64Value?: string; doubleValue?: number } }> }> };

export function createMonitoringClient(fetchImpl: typeof fetch = fetch): MonitoringClient {
  return { async query(metricType, range, resolution) {
    const projectId = getUsageConfig().projectId;
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new Error("Google Monitoring credentials are not available to the server runtime.");
    const metric = (Object.entries(METRIC_TYPES).find(([, value]) => value === metricType)?.[0] || "reads") as UsageMetric;
    const params = monitoringQueryParameters(metric, range, resolution, projectId);
    const response = await fetchImpl("https://monitoring.googleapis.com/v3/projects/" + encodeURIComponent(projectId) + "/timeSeries?" + params, { headers: { Authorization: "Bearer " + token.token }, cache: "no-store" });
    const body = await response.json().catch(() => undefined) as MonitoringResponse | unknown;
    if (!response.ok) throw new Error(normalizeMonitoringError(body, response.status));
    const monitoringBody = body as MonitoringResponse;
    const totals = new Map<string, number>();
    for (const series of monitoringBody.timeSeries || []) for (const point of series.points || []) {
      const timestamp = point.interval?.endTime;
      if (!timestamp) continue;
      const value = Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0);
      if (Number.isFinite(value)) totals.set(timestamp, (totals.get(timestamp) || 0) + value);
    }
    return [...totals].map(([timestamp, value]) => ({ timestamp, value })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } };
}

let cached: { key: string; expiresAt: number; data: UsageDashboard } | undefined;
let inFlight: Promise<UsageDashboard> | undefined;
export function invalidateUsageCache() { cached = undefined; }

function unavailableAttribution(message: string, range: UsageRange, resolution: UsageResolution, authoritativeReads: number | null): UsageAttribution {
  const periodMs = Number.parseInt(alignmentPeriod(resolution), 10) * 1000;
  const bucketCount = Math.max(1, Math.ceil((Date.parse(range.end) - Date.parse(range.start)) / periodMs));
  return { available: false, message, traceCount: 0, estimatedFirestoreBillableReads: 0, firestoreReturnedDocuments: 0, authoritativeReads, unattributedReads: authoritativeReads === null ? null : authoritativeReads, coveragePercent: authoritativeReads === null || authoritativeReads === 0 ? 0 : 0, overAttribution: false, parseFailures: 0, truncated: false, apps: [], actions: [], operations: [], buckets: Array.from({ length: bucketCount }, (_, index) => ({ timestamp: new Date(Date.parse(range.start) + index * periodMs).toISOString(), cloudMonitoringReads: 0, attributedEstimatedReads: 0, unattributedReads: 0, byApp: {} })) };
}

export function attachMonitoringReads(attribution: UsageAttribution, monitoringPoints: UsagePoint[]): UsageAttribution {
  const values = new Map(monitoringPoints.map(point => [point.timestamp, point.value]));
  const buckets = attribution.buckets.map(bucket => { const cloudMonitoringReads = values.get(bucket.timestamp) || 0; return { ...bucket, cloudMonitoringReads, unattributedReads: Math.max(0, cloudMonitoringReads - bucket.attributedEstimatedReads) }; });
  return { ...attribution, buckets };
}

export async function loadUsageDashboard(input: { range?: UsageRange; now?: Date; client?: MonitoringClient; loggingClient?: CloudLoggingClient; config?: UsageConfig } = {}): Promise<UsageDashboard> {
  const config = input.config || getUsageConfig();
  const now = input.now || new Date();
  const range = input.range || parseUsageRange({ start: new Date(now.getTime() - 7 * 86400000).toISOString(), end: now.toISOString() }, now, config);
  const duration = Date.parse(range.end) - Date.parse(range.start);
  const resolution = resolutionForDuration(duration);
  const key = Math.floor(Date.parse(range.start) / 300000) + "|" + Math.floor(Date.parse(range.end) / 300000) + "|" + resolution;
  if (!input.client && cached?.key === key && cached.expiresAt > Date.now()) return cached.data;
  if (!input.client && inFlight) return inFlight;
  const client = input.client || createMonitoringClient();
  const promise = (async () => {
    const results = await Promise.all((Object.keys(METRIC_TYPES) as UsageMetric[]).map(async metric => { try { return { metric, points: normalizeMonitoringPoints(await client.query(METRIC_TYPES[metric], range, resolution), range, resolution) }; } catch (error) { const message = error instanceof Error ? error.message : "Monitoring metric failed."; console.error("[usage-observatory] Monitoring query failed", { metric, metricType: METRIC_TYPES[metric], range, resolution, error: message }); return { metric, error: message }; } }));
    const metrics = Object.fromEntries(results.map(result => [result.metric, "points" in result ? result.points : []])) as Record<UsageMetric, UsagePoint[]>;
    const metricErrors = Object.fromEntries(results.filter(result => "error" in result).map(result => [result.metric, result.error])) as Partial<Record<UsageMetric, string>>;
    const totals = Object.fromEntries((Object.keys(METRIC_TYPES) as UsageMetric[]).map(metric => [metric, metricErrors[metric] ? null : Math.round(metrics[metric].reduce((sum, point) => sum + point.value, 0))])) as Record<UsageMetric, number | null>;
    const allowance = config.dailyReadAllowance && totals.reads !== null ? { reads: config.dailyReadAllowance, used: totals.reads, percent: totals.reads / config.dailyReadAllowance, remaining: Math.max(0, config.dailyReadAllowance - totals.reads), status: calculateStatus(totals.reads / config.dailyReadAllowance, config) } : undefined;
    let attribution: UsageAttribution;
    if (input.loggingClient || !input.client) {
      try {
        const loggingClient = input.loggingClient || createCloudLoggingClient(fetch, config.projectId);
        const logs = await loggingClient.list(range);
        attribution = aggregateAttribution(logs.entries, range, resolution, totals.reads);
        attribution = { ...attribution, truncated: logs.truncated };
        attribution = attachMonitoringReads(attribution, metrics.reads);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Cloud Logging attribution query failed.";
        console.error("[usage-observatory] Cloud Logging attribution query failed", { range, resolution, error: message });
        attribution = unavailableAttribution(message, range, resolution, totals.reads);
      }
    } else {
      attribution = unavailableAttribution("Cloud Logging attribution was not queried for this isolated Monitoring test client.", range, resolution, totals.reads);
    }
    const data: UsageDashboard = {
      generatedAt: new Date().toISOString(), range, resolution, source: { label: "Google Cloud Monitoring · Firestore document operation metrics", projectId: config.projectId },
      totals, allowance, timeline: metrics, dailyTotals7d: aggregateDaily(metrics.reads, now), baseline: calculateBaseline(metrics.reads, config.spikeMultiplier), metricErrors,
      appUsage: { available: false, message: "Native Firestore operation metrics do not expose trustworthy FIKA app attribution. No app shares are inferred.", rows: [] },
      queryInsights: { available: false, message: "Query Insights is not exposed through a supported server API for this dashboard.", url: "https://console.firebase.google.com/project/" + encodeURIComponent(config.projectId) + "/firestore/usage/query-insights" },
      deployMarkers: { available: false, message: "No authoritative deploy marker source is configured." },
      attribution,
    };
    if (!input.client) cached = { key, expiresAt: Date.now() + config.cacheTtlMs, data };
    return data;
  })();
  if (!input.client) inFlight = promise;
  try { return await promise; } finally { if (!input.client) inFlight = undefined; }
}
