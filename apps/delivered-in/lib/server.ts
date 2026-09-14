import type { NextRequest } from "next/server";
import { assertAuthorisedOploc, operationalDateLondon, projectPublishedWeeks, type ProjectedDay, type Site, type SiteAccess, type SourcePublication } from "./projection";
import type { DeliveredInService } from "@fika/server-shared/delivered-in-access";
import { recordDeliveredInAppReadBudget } from "./delivered-in-read-budget";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { buildDeliveredInDayProjection } from "./delivered-in-projection-materialiser";
import { markDeliveredInProjectionDayUnavailable, readDeliveredInProjection, readDeliveredInProjectionIndex } from "./delivered-in-projection-store";
import type { DeliveredInDayProjection } from "./delivered-in-day-projection";
import type { DeliveredInProjectionIndexEntry } from "./delivered-in-projection-store";
import { packetPublicationsForRange, readMenuPlanningWeekPackets } from "./menu-planning-week-packet";
import { cpuDailyPacketReview, readCpuDailySignedPacket } from "./cpu-daily-signed-packet";

export const DELIVERED_IN_PROJECTION_HORIZON_DAYS = 42;
export const DELIVERED_IN_MAX_DAY_PACKAGES = 50;

const hubBase = () => (process.env.INTEGRATION_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
const menuBase = () => (process.env.MENU_PLANNING_BASE_URL || "http://localhost:3500").replace(/\/$/, "");
const failure = (message: string, status = 502, code?: string, requestId?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}), ...(requestId ? { requestId } : {}) });
export type RequestedWeekRecoveryCode = "CPU_REVIEW_UNAVAILABLE" | "CPU_REVIEW_UNSIGNED" | "CPU_REVIEW_LINEAGE_MISMATCH" | "CPU_PACKET_MISSING_DISH" | "CPU_DAILY_PACKET_INVALID" | "MENU_PLANNING_WEEK_PACKET_INVALID" | "FIKA_SESSION_MISSING" | "FIKA_SESSION_INVALID" | "UNKNOWN_INTERNAL";
type DiagnosticError = { name: string; message: string; code?: string; status?: number; cause?: unknown };
const diagnosticText = (value: unknown) => String(value || "").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]").slice(0, 500);
const diagnosticError = (error: unknown): DiagnosticError => {
  const value = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown; cause?: unknown } : {};
  return { name: typeof value.name === "string" ? value.name : "UnknownError", message: diagnosticText(error instanceof Error ? error.message : error), ...(typeof value.code === "string" ? { code: value.code } : {}), ...(typeof value.status === "number" ? { status: value.status } : {}), ...(value.cause ? { cause: value.cause } : {}) };
};
export function classifyRequestedWeekRecoveryFailure(error: unknown) {
  const current = diagnosticError(error);
  const cause = current.cause ? diagnosticError(current.cause) : undefined;
  const known = new Set<RequestedWeekRecoveryCode>(["CPU_REVIEW_UNAVAILABLE", "CPU_REVIEW_UNSIGNED", "CPU_REVIEW_LINEAGE_MISMATCH", "CPU_PACKET_MISSING_DISH", "CPU_DAILY_PACKET_INVALID", "MENU_PLANNING_WEEK_PACKET_INVALID", "FIKA_SESSION_MISSING", "FIKA_SESSION_INVALID"]);
  const code = (current.code && known.has(current.code as RequestedWeekRecoveryCode) ? current.code : cause?.code && known.has(cause.code as RequestedWeekRecoveryCode) ? cause.code : "UNKNOWN_INTERNAL") as RequestedWeekRecoveryCode;
  return { code, errorCode: code, errorName: current.name, errorStatus: current.status ?? null, errorMessage: current.message, causeCode: cause?.code ?? null, causeMessage: cause?.message ?? null };
}
export function logRequestedWeekRecoveryFailure(request: NextRequest, requestedWeek: string, serviceDate: string, oplocId: string, error: unknown) {
  const classified = classifyRequestedWeekRecoveryFailure(error);
  console.error(JSON.stringify({
    event: "delivered_in.requested_week_recovery_failed",
    message: "Delivered-In requested-week day recovery failed",
    app: "delivered-in",
    operation: "delivered-in.requested-week.recovery",
    requestedWeek,
    serviceDate,
    oplocId,
    ...classified,
    buildSha: process.env.FIKA_BUILD_SHA || null,
    requestId: request.headers.get("x-request-id") || null,
  }));
}
export function deliveredInErrorBody(error: unknown, fallback: string) {
  const detail = error && typeof error === "object" ? error as { code?: unknown; requestId?: unknown } : {};
  return { error: { ...(typeof detail.code === "string" ? { code: detail.code } : {}), message: error instanceof Error ? error.message : fallback, ...(typeof detail.requestId === "string" ? { requestId: detail.requestId } : {}) } };
}
const addDays = (date: string, days: number) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const mondayOf = (date: string) => { const value = new Date(`${date}T00:00:00Z`); const day = value.getUTCDay(); value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1)); return value.toISOString().slice(0, 10); };
async function readJson<T>(response: Response, label: string): Promise<T> { const text = await response.text(); if (!response.headers.get("content-type")?.includes("application/json")) throw failure(`${label} returned a non-JSON response (${response.status}); the source service may be unavailable.`); try { return JSON.parse(text) as T; } catch (cause) { throw Object.assign(failure(`${label} returned invalid JSON; no empty projection was used.`), { cause }); } }

/** Ordinary Delivered-In reads consume the immutable, signed CPU packet only. */
export async function cpuReviewForDay(_request: NextRequest, date: string, oplocId: string, sourceBundleHash?: string) {
  if (!sourceBundleHash) return undefined;
  try {
    const packet = await readCpuDailySignedPacket(date, oplocId, sourceBundleHash);
    if (!packet) return undefined;
    recordDataAccess({ app: "delivered-in", operation: "cpu-review-package.by-day", source: "SNAPSHOT", dataset: "cpu-production/review", documents: packet.manifest.recordCount, cacheResult: "HIT" });
    recordDeliveredInAppReadBudget({ stage: "cpu_review_package", upstreamRequests: 0, recordsInspected: packet.manifest.recordCount, serviceDate: date, oplocId });
    return cpuDailyPacketReview(packet);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is unavailable.")) return undefined;
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "CPU_DAILY_PACKET_INVALID") throw error;
    throw Object.assign(new Error(`CPU daily signed packet could not be verified for ${oplocId} on ${date}.`), { code: "CPU_DAILY_PACKET_INVALID", status: 503, cause: error });
  }
}

async function resolveGovernedOplocIds(request: NextRequest) {
  const response = await fetch(`${hubBase()}/api/oplocs`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  recordDataAccess({ app: "delivered-in", operation: "hub.oplocs", source: "NETWORK_UPSTREAM", dataset: "integration-hub/oplocs", documents: 0, cacheResult: "BYPASS" });
  const body = await readJson<{ oplocs?: Array<{ canonicalId?: string }>; error?: { code?: string; message?: string; requestId?: string }; requestId?: string }>(response, "Integration Hub OPLOC authority");
  if (!response.ok || !body.oplocs) throw failure(body.error?.message || "Integration Hub OPLOC authority could not be loaded.", response.status || 502, body.error?.code, body.error?.requestId || body.requestId);
  return new Set(body.oplocs.map(oploc => oploc.canonicalId).filter((id): id is string => Boolean(id)));
}

export async function resolveAccess(request: NextRequest, service: DeliveredInService = "delivered-in"): Promise<{ access: SiteAccess; sites: Site[] }> {
  // Keep the default route URL compatible with older local Hub processes;
  // only Grab & Go needs the explicit service selector.
  const accessUrl = service === "grab-and-go" ? `${hubBase()}/api/delivered-in/access?service=grab-and-go` : `${hubBase()}/api/delivered-in/access`;
  const response = await fetch(accessUrl, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  recordDataAccess({ app: "delivered-in", operation: "hub.authmod.access", source: "NETWORK_UPSTREAM", dataset: "integration-hub/delivered-in-access", documents: 0, cacheResult: "BYPASS" });
  const body = await readJson<{ access?: SiteAccess; sites?: Site[]; error?: { code?: string; message?: string; requestId?: string }; requestId?: string }>(response, "Integration Hub access service");
  if (!response.ok || !body.access || !body.sites) throw failure(body.error?.message || "Delivered-In access could not be resolved.", response.status || 502, body.error?.code, body.error?.requestId || body.requestId);
  return { access: body.access, sites: body.sites };
}

const weekRecovery = new Map<string, Promise<void>>();

async function recoverRequestedWeek(request: NextRequest, oplocId: string, weekCommencing: string) {
  const key = `${oplocId}:${weekCommencing}`;
  const existing = weekRecovery.get(key);
  if (existing) return existing;
  const work = (async () => {
    const toWeek = addDays(weekCommencing, 7);
    let publications: SourcePublication[] = [];
    const packets = await readMenuPlanningWeekPackets(weekCommencing, toWeek);
    if (packets.length) publications = packetPublicationsForRange(packets, weekCommencing, toWeek) as SourcePublication[];
    else {
      const response = await fetch(`${menuBase()}/api/rolling-menu/publications?fromWeek=${encodeURIComponent(weekCommencing)}&toWeek=${encodeURIComponent(toWeek)}`, { cache: "no-store" });
      const body = await readJson<{ publications?: SourcePublication[]; error?: { message?: string } }>(response, "Menu Planning publication service");
      if (!response.ok) throw failure(body.error?.message || "Published Delivered-In menus could not be loaded.");
      publications = body.publications || [];
    }
    if (!publications.length) return;
    const { reconcileDeliveredInDay } = await import("./delivered-in-reconciliation");
    const dates = [...new Set(publications.flatMap(publication => publication.days.filter(day => day.status !== "withdrawn" && day.date >= weekCommencing && day.date < toWeek).map(day => day.date)))].sort();
    await Promise.all(dates.map(async date => {
      try {
        await reconcileDeliveredInDay(request, oplocId, date);
      } catch (error) {
        // A single day may be unavailable while its CPU safety packet is
        // pending or invalid. Keep recovery bounded to that day so a valid
        // requested week does not become an opaque whole-dashboard 503.
        logRequestedWeekRecoveryFailure(request, weekCommencing, date, oplocId, error);
        try {
          await markDeliveredInProjectionDayUnavailable({ oplocId, serviceDate: date, weekCommencing, sourceVersion: "requested-week-recovery-unavailable" });
        } catch (markerError) {
          logRequestedWeekRecoveryFailure(request, weekCommencing, date, oplocId, Object.assign(new Error("The unavailable-day marker could not be written."), { code: "UNKNOWN_INTERNAL", status: 503, cause: markerError }));
        }
      }
    }));
  })();
  weekRecovery.set(key, work);
  try { await work; } finally { weekRecovery.delete(key); }
}

function emptyWeek(weekCommencing: string) { return { publicationId: "", weekCommencing, weekEnding: addDays(weekCommencing, 6), days: [] as DeliveredInDayProjection[] }; }

export async function projectedWeeks(request: NextRequest, requestedOplocId?: string, options: { usePackages?: boolean; requestedWeek?: string } = {}) {
  const resolved = await resolveAccess(request); const access = resolved.access; const sites = resolved.sites;
  if (!access.oplocIds.length) return { access, sites, selectedOplocId: undefined, weeks: [] };
  const selectedOplocId = requestedOplocId || (access.oplocIds.length === 1 ? access.oplocIds[0] : undefined);
  if (!selectedOplocId) return { access, sites, selectedOplocId: undefined, weeks: [] };
  assertAuthorisedOploc(access, selectedOplocId);
  const site = sites.find(candidate => candidate.oplocId === selectedOplocId) || { oplocId: selectedOplocId, label: selectedOplocId };
  if (options.usePackages !== false) {
    let discovered = await readProjectionWindow(selectedOplocId);
    if (options.requestedWeek && !weeksFromProjectionDays(discovered.days).some(week => week.weekCommencing === options.requestedWeek)) {
      await recoverRequestedWeek(request, selectedOplocId, options.requestedWeek);
      discovered = await readProjectionWindow(selectedOplocId);
    }
    const weeks = weeksFromProjectionDays(discovered.days);
    const requested = options.requestedWeek && !weeks.some(week => week.weekCommencing === options.requestedWeek) ? emptyWeek(options.requestedWeek) : undefined;
    return {
      access,
      sites,
      selectedOplocId,
      weeks: requested ? [...weeks, requested] : weeks,
      withdrawnServiceDates: discovered.withdrawnServiceDates,
      projectionState: discovered.state,
      unavailableServiceDates: discovered.unavailableServiceDates,
    };
  }
  const fromWeek = mondayOf(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()));
  let publications: SourcePublication[] = [];
  const toWeek = addDays(fromWeek, 49);
  const packets = await readMenuPlanningWeekPackets(fromWeek, toWeek);
  if (packets.length) {
    publications = packetPublicationsForRange(packets, fromWeek, toWeek) as SourcePublication[];
  } else {
    const response = await fetch(`${menuBase()}/api/rolling-menu/publications?fromWeek=${encodeURIComponent(fromWeek)}&toWeek=${encodeURIComponent(toWeek)}`, { cache: "no-store" });
    recordDataAccess({ app: "delivered-in", operation: "menu.publications.by-window", source: "NETWORK_UPSTREAM", dataset: "menu-planning/publications", documents: 0, cacheResult: "BYPASS" });
    const body = await readJson<{ publications?: SourcePublication[]; error?: { message?: string } }>(response, "Menu Planning publication service");
    if (!response.ok) throw failure(body.error?.message || "Published Delivered-In menus could not be loaded.");
    publications = body.publications || [];
  }
  const governedOplocIds = await resolveGovernedOplocIds(request);
  const projected = projectPublishedWeeks(publications, selectedOplocId, governedOplocIds);
  const weeks = await Promise.all(projected.map(async week => {
    const days = await Promise.all(week.days.map(async day => {
      try {
        const cached = await readDeliveredInProjection(selectedOplocId, day.date);
        if (cached) return cached.value;
      } catch { /* Explicit authoritative rebuild mode may continue to canonical sources. */ }
      try {
        return await buildDeliveredInDayProjection({ request, site, day, loadReview: cpuReviewForDay, governed: governedOplocIds.has(selectedOplocId) });
      } catch (error) {
        recordDeliveredInAppReadBudget({ stage: "day_projection_unavailable", upstreamRequests: 1, serviceDate: day.date, oplocId: selectedOplocId });
        return unavailableDayProjection(day, site, error);
      }
    }));
    return { ...week, days };
  }));
  return { access, sites, selectedOplocId, weeks, withdrawnServiceDates: [] as string[] };
}

export async function projectionHead(request: NextRequest, requestedOplocId?: string, requestedWeek?: string) {
  const resolved = await resolveAccess(request);
  const access = resolved.access;
  const sites = resolved.sites;
  if (!access.oplocIds.length) return { access, sites, selectedOplocId: undefined, projectionState: "unavailable" as const, entries: [], withdrawnServiceDates: [], unavailableServiceDates: [] };
  const selectedOplocId = requestedOplocId || (access.oplocIds.length === 1 ? access.oplocIds[0] : undefined);
  if (!selectedOplocId) return { access, sites, selectedOplocId: undefined, projectionState: "unavailable" as const, entries: [], withdrawnServiceDates: [], unavailableServiceDates: [] };
  assertAuthorisedOploc(access, selectedOplocId);
  let window = await readProjectionIndexWindow(selectedOplocId);
  if (requestedWeek && !window.weeks.some(week => week.weekCommencing === requestedWeek)) {
    await recoverRequestedWeek(request, selectedOplocId, requestedWeek);
    window = await readProjectionIndexWindow(selectedOplocId);
  }
  const weeks = requestedWeek && !window.weeks.some(week => week.weekCommencing === requestedWeek) ? [...window.weeks, emptyWeek(requestedWeek)] : window.weeks;
  return { access, sites, selectedOplocId, projectionState: window.state, weeks, entries: window.entries, withdrawnServiceDates: window.withdrawnServiceDates, unavailableServiceDates: window.unavailableServiceDates };
}

export function projectionWindowBounds(asOf = operationalDateLondon()) {
  const from = mondayOf(asOf);
  return { from, to: addDays(from, DELIVERED_IN_PROJECTION_HORIZON_DAYS) };
}

export function boundedProjectionIndexEntries(entries: DeliveredInProjectionIndexEntry[], asOf = operationalDateLondon()) {
  const { from, to } = projectionWindowBounds(asOf);
  return entries
    .filter(entry => entry.serviceDate >= from && entry.serviceDate <= to)
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))
    .slice(0, DELIVERED_IN_MAX_DAY_PACKAGES);
}

export function publishedWeeksFromProjectionIndex(entries: DeliveredInProjectionIndexEntry[]) {
  return [...new Map(entries
    .filter(entry => entry.state !== "withdrawn" && entry.freshness === "current" && entry.completeness === "complete" && entry.weekCommencing)
    .map(entry => [entry.weekCommencing, { publicationId: entry.publicationId || "", weekCommencing: entry.weekCommencing!, weekEnding: entry.weekEnding || addDays(entry.weekCommencing!, 6) }]))
    .values()].sort((a, b) => b.weekCommencing.localeCompare(a.weekCommencing));
}

async function readProjectionWindow(oplocId: string, asOf = operationalDateLondon()) {
  const indexWindow = await readProjectionIndexWindow(oplocId, asOf);
  if (indexWindow.state === "unavailable" && !indexWindow.entries.length && !indexWindow.withdrawnServiceDates.length) return { days: [] as DeliveredInDayProjection[], withdrawnServiceDates: [], unavailableServiceDates: [], state: "unavailable" as const };
  const { entries, withdrawnServiceDates } = indexWindow;
  const results = await Promise.all(entries.map(async entry => {
    try {
      const packageValue = await readDeliveredInProjection(oplocId, entry.serviceDate);
      return packageValue?.value;
    } catch {
      return undefined;
    }
  }));
  const unavailableServiceDates = entries.filter((_, index) => !results[index]).map(entry => entry.serviceDate);
  const days = results.filter((day): day is DeliveredInDayProjection => Boolean(day));
  const allUnavailable = [...new Set([...indexWindow.unavailableServiceDates, ...unavailableServiceDates])];
  const state: "current" | "partial" | "unavailable" = allUnavailable.length ? (days.length ? "partial" : "unavailable") : "current";
  return { days, withdrawnServiceDates, unavailableServiceDates: allUnavailable, state };
}

async function readProjectionIndexWindow(oplocId: string, asOf = operationalDateLondon()) {
  const index = await readDeliveredInProjectionIndex(oplocId).catch(() => undefined);
  if (!index) return { entries: [], weeks: [], withdrawnServiceDates: [], unavailableServiceDates: [], state: "unavailable" as const };
  const inWindow = boundedProjectionIndexEntries(index.value.entries, asOf);
  const withdrawnServiceDates = inWindow.filter(entry => entry.state === "withdrawn").map(entry => entry.serviceDate);
  // Keep old immutable bodies in storage for audit, but never retrieve or
  // display them while their pointer says stale/partial/missing.
  const unavailableServiceDates = inWindow.filter(entry => entry.state !== "withdrawn" && (entry.freshness !== "current" || entry.completeness !== "complete")).map(entry => entry.serviceDate);
  const entries = inWindow.filter(entry => entry.state !== "withdrawn" && entry.freshness === "current" && entry.completeness === "complete").slice(0, DELIVERED_IN_MAX_DAY_PACKAGES);
  // Older projection indexes predate week metadata. Recover only that bounded
  // legacy metadata from the already-authoritative day packages so a valid
  // future week cannot disappear on a cold browser cache.
  const enrichedEntries = await Promise.all(entries.map(async entry => {
    if (entry.weekCommencing) return entry;
    const packageValue = await readDeliveredInProjection(oplocId, entry.serviceDate).catch(() => undefined);
    const day = packageValue?.value;
    return day ? { ...entry, weekCommencing: day.weekCommencing || mondayOf(day.serviceDate), weekEnding: addDays(day.weekCommencing || mondayOf(day.serviceDate), 6), publicationId: day.publicationId } : entry;
  }));
  const weeks = publishedWeeksFromProjectionIndex(enrichedEntries);
  return { entries: enrichedEntries, weeks, withdrawnServiceDates, unavailableServiceDates, state: unavailableServiceDates.length ? (enrichedEntries.length ? "partial" as const : "unavailable" as const) : "current" as const };
}

function weeksFromProjectionDays(days: DeliveredInDayProjection[]) {
  const byWeek = new Map<string, DeliveredInDayProjection[]>();
  for (const day of days) byWeek.set(day.weekCommencing || mondayOf(day.date), [...(byWeek.get(day.weekCommencing || mondayOf(day.date)) || []), day]);
  return [...byWeek.entries()].map(([weekCommencing, weekDays]) => ({ publicationId: weekDays[0].publicationId, weekCommencing, weekEnding: addDays(weekCommencing, 6), days: weekDays.sort((a, b) => a.date.localeCompare(b.date)) })).sort((a, b) => b.weekCommencing.localeCompare(a.weekCommencing));
}

function unavailableDayProjection(day: ProjectedDay, site: Site, error: unknown): DeliveredInDayProjection {
  return {
    ...day,
    projectionId: `delivered-in:${site.oplocId}:${day.date}`,
    projectionVersion: 0,
    contractVersion: "delivered-in.day.v1",
    oplocId: site.oplocId,
    oplocLabel: site.label,
    serviceDate: day.date,
    entries: day.entries.map(entry => ({ ...entry, allergens: Object.fromEntries(Object.keys(entry.allergens).map(key => [key, "unrecorded" as const])), allergensVisible: false })),
    siteMenu: { status: "unavailable" },
    sourceLineage: { menu: { publicationId: day.publicationId, publicationDayId: day.publicationDayId, sourceDayId: day.sourceDayId, version: day.version, contentHash: day.contentHash }, cpu: { orderIds: [] }, deliveredIn: { generatedAt: new Date().toISOString() } },
    generatedAt: new Date().toISOString(),
    state: { freshness: "stale", completeness: "unavailable", menu: day.entries.length ? "present" : "empty", cpu: "unavailable", exceptions: [{ code: "PROJECTION_UNAVAILABLE", source: "delivered-in", message: error instanceof Error ? error.message : "The day projection could not be loaded." }] },
  };
}

export async function projectedAllergenDay(request: NextRequest, requestedOplocId: string, publicationDayId: string, options: { authoritative?: boolean } = {}) {
  const result = await projectedWeeks(request, requestedOplocId, { usePackages: !options.authoritative });
  for (const week of result.weeks) {
    const day = week.days.find(candidate => candidate.publicationDayId === publicationDayId);
    if (day) return { ...day, site: result.sites.find(site => site.oplocId === requestedOplocId) };
  }
  throw failure("The signed published day was not found for this site.", 404);
}
