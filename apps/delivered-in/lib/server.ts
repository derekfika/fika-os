import type { NextRequest } from "next/server";
import { assertAuthorisedOploc, operationalDateLondon, projectPublishedWeeks, type ProjectedDay, type Site, type SiteAccess, type SourcePublication } from "./projection";
import type { DeliveredInService } from "@fika/server-shared/delivered-in-access";
import { recordDeliveredInAppReadBudget } from "./delivered-in-read-budget";
import { buildDeliveredInDayProjection } from "./delivered-in-projection-materialiser";
import { readDeliveredInProjection, readDeliveredInProjectionIndex } from "./delivered-in-projection-store";
import type { DeliveredInDayProjection } from "./delivered-in-day-projection";
import type { DeliveredInProjectionIndexEntry } from "./delivered-in-projection-store";

export const DELIVERED_IN_PROJECTION_HORIZON_DAYS = 42;
export const DELIVERED_IN_MAX_DAY_PACKAGES = 50;

const hubBase = () => (process.env.INTEGRATION_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
const menuBase = () => (process.env.MENU_PLANNING_BASE_URL || "http://localhost:3500").replace(/\/$/, "");
const cpuBase = () => (process.env.CPU_PRODUCTION_BASE_URL || "http://localhost:3400").replace(/\/$/, "");
const failure = (message: string, status = 502) => Object.assign(new Error(message), { status });
const addDays = (date: string, days: number) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const mondayOf = (date: string) => { const value = new Date(`${date}T00:00:00Z`); const day = value.getUTCDay(); value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1)); return value.toISOString().slice(0, 10); };
async function readJson<T>(response: Response, label: string): Promise<T> { const text = await response.text(); if (!response.headers.get("content-type")?.includes("application/json")) throw failure(`${label} returned a non-JSON response (${response.status}); the source service may be unavailable.`); try { return JSON.parse(text) as T; } catch (cause) { throw Object.assign(failure(`${label} returned invalid JSON; no empty projection was used.`), { cause }); } }

export async function cpuReviewForDay(request: NextRequest, date: string, oplocId: string) {
  try {
    const summaryResponse = await fetch(`${cpuBase()}/api/delivered-in/review?serviceDate=${encodeURIComponent(date)}&oplocId=${encodeURIComponent(oplocId)}`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
    if (!summaryResponse.ok) return undefined;
    const summary = await readJson<{
      status: "pending" | "signed";
      signatures: Array<{ role: string; printedName: string; signedAt: string }>;
      drivePdfUrl?: string;
      entries: Record<string, { allergens: Record<string, "clear" | "contains" | "may_contain" | "unrecorded">; mayContainNotes?: string }>;
      package?: { packageVersion?: number; contentHash?: string; sourceVersion?: string; contractVersion?: string; recordCount?: number };
    }>(summaryResponse, "CPU Delivered-In review package");
    recordDeliveredInAppReadBudget({ stage: "cpu_review_package", upstreamRequests: 1, recordsInspected: summary.package?.recordCount || Object.keys(summary.entries || {}).length, serviceDate: date, oplocId });
    return {
      entries: new Map(Object.entries(summary.entries || {})),
      cpuReview: { status: summary.status, signatures: summary.signatures, ...(summary.drivePdfUrl ? { drivePdfUrl: summary.drivePdfUrl } : {}) },
      orderIds: [],
      package: summary.package ? { packageVersion: summary.package.packageVersion, contentHash: summary.package.contentHash, sourceVersion: summary.package.sourceVersion, contractVersion: summary.package.contractVersion } : undefined,
    };
  } catch { return undefined; }
}

async function resolveGovernedOplocIds(request: NextRequest) {
  const response = await fetch(`${hubBase()}/api/oplocs`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  const body = await readJson<{ oplocs?: Array<{ canonicalId?: string }>; error?: { message?: string } }>(response, "Integration Hub OPLOC authority");
  if (!response.ok || !body.oplocs) throw failure(body.error?.message || "Integration Hub OPLOC authority could not be loaded.", response.status || 502);
  return new Set(body.oplocs.map(oploc => oploc.canonicalId).filter((id): id is string => Boolean(id)));
}

export async function resolveAccess(request: NextRequest, service: DeliveredInService = "delivered-in"): Promise<{ access: SiteAccess; sites: Site[] }> {
  // Keep the default route URL compatible with older local Hub processes;
  // only Grab & Go needs the explicit service selector.
  const accessUrl = service === "grab-and-go" ? `${hubBase()}/api/delivered-in/access?service=grab-and-go` : `${hubBase()}/api/delivered-in/access`;
  const response = await fetch(accessUrl, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  const body = await readJson<{ access?: SiteAccess; sites?: Site[]; error?: { message?: string } }>(response, "Integration Hub access service");
  if (!response.ok || !body.access || !body.sites) throw failure(body.error?.message || "Delivered-In access could not be resolved.", response.status || 502);
  return { access: body.access, sites: body.sites };
}

export async function projectedWeeks(request: NextRequest, requestedOplocId?: string, options: { usePackages?: boolean } = {}) {
  const resolved = await resolveAccess(request); const access = resolved.access; const sites = resolved.sites;
  if (!access.oplocIds.length) return { access, sites, selectedOplocId: undefined, weeks: [] };
  const selectedOplocId = requestedOplocId || (access.oplocIds.length === 1 ? access.oplocIds[0] : undefined);
  if (!selectedOplocId) return { access, sites, selectedOplocId: undefined, weeks: [] };
  assertAuthorisedOploc(access, selectedOplocId);
  const site = sites.find(candidate => candidate.oplocId === selectedOplocId) || { oplocId: selectedOplocId, label: selectedOplocId };
  if (options.usePackages !== false) {
    const discovered = await readProjectionWindow(selectedOplocId);
    return {
      access,
      sites,
      selectedOplocId,
      weeks: weeksFromProjectionDays(discovered.days),
      withdrawnServiceDates: discovered.withdrawnServiceDates,
      projectionState: discovered.state,
      unavailableServiceDates: discovered.unavailableServiceDates,
    };
  }
  const fromWeek = mondayOf(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()));
  const response = await fetch(`${menuBase()}/api/rolling-menu/publications?fromWeek=${encodeURIComponent(fromWeek)}&toWeek=${encodeURIComponent(addDays(fromWeek, 49))}`, { cache: "no-store" });
  const body = await readJson<{ publications?: SourcePublication[]; error?: { message?: string } }>(response, "Menu Planning publication service");
  if (!response.ok) throw failure(body.error?.message || "Published Delivered-In menus could not be loaded.");
  const governedOplocIds = await resolveGovernedOplocIds(request);
  const projected = projectPublishedWeeks(body.publications || [], selectedOplocId, governedOplocIds);
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

async function readProjectionWindow(oplocId: string, asOf = operationalDateLondon()) {
  const index = await readDeliveredInProjectionIndex(oplocId).catch(() => undefined);
  if (!index) return { days: [] as DeliveredInDayProjection[], withdrawnServiceDates: [] as string[], unavailableServiceDates: [] as string[], state: "unavailable" as const };
  const inWindow = boundedProjectionIndexEntries(index.value.entries, asOf);
  const withdrawnServiceDates = inWindow.filter(entry => entry.state === "withdrawn").map(entry => entry.serviceDate);
  const entries = inWindow.filter(entry => entry.state !== "withdrawn").slice(0, DELIVERED_IN_MAX_DAY_PACKAGES);
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
  const state: "current" | "partial" | "unavailable" = unavailableServiceDates.length ? (days.length ? "partial" : "unavailable") : "current";
  return { days, withdrawnServiceDates, unavailableServiceDates, state };
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
