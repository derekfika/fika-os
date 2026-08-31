import type { NextRequest } from "next/server";
import { assertAuthorisedOploc, projectPublishedWeeks, type ProjectedDay, type Site, type SiteAccess, type SourcePublication } from "./projection";
import type { DeliveredInService } from "@fika/server-shared/delivered-in-access";
import { recordDeliveredInAppReadBudget } from "./delivered-in-read-budget";
import { materialiseDeliveredInDay } from "./delivered-in-projection-materialiser";
import { readDeliveredInProjection, readDeliveredInProjectionIndex } from "./delivered-in-projection-store";
import type { DeliveredInDayProjection } from "./delivered-in-day-projection";

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
    if (summaryResponse.ok) {
      const summary = await readJson<{ status: "pending" | "signed"; signatures: Array<{ role: string; printedName: string; signedAt: string }>; drivePdfUrl?: string; entries: Record<string, { allergens: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string }> }>(summaryResponse, "CPU Delivered-In review summary");
      return { entries: new Map(Object.entries(summary.entries || {})), cpuReview: { status: summary.status, signatures: summary.signatures, ...(summary.drivePdfUrl ? { drivePdfUrl: summary.drivePdfUrl } : {}) }, orderIds: [] };
    }
    const headers = { cookie: request.headers.get("cookie") || "" };
    const ordersResponse = await fetch(`${cpuBase()}/api/production?scope=all&serviceDate=${encodeURIComponent(date)}`, { headers, cache: "no-store" });
    const ordersBody = await readJson<{ orders?: Array<{ canonicalId: string; origin: string; destinationOplocId?: string; lines?: Array<{ canonicalId: string; sourceBookingLineId?: string; sourceMenuItemId?: string; approvedAllergenSnapshot?: { allergens: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string } }> }> }>(ordersResponse, "CPU production orders");
    if (!ordersResponse.ok) return undefined;
    // Signatures belong to one shared Delivered-In matrix for the day. The
    // selected OPLOC only controls which projected dishes are returned below.
    const orders = (ordersBody.orders || []).filter(order => order.origin === "menu_planning");
    const orderIds = [...new Set(orders.map(order => order.canonicalId))];
    const matrixResponse = await fetch(`${cpuBase()}/api/production-plan?matrixStatus=1&orderIds=${encodeURIComponent(orderIds.join(","))}`, { headers, cache: "no-store" });
    if (!matrixResponse.ok) return undefined;
    const matrixBody = await readJson<{ matrixStatuses?: Array<{ orderId: string; signatureRoles?: string[]; matrixArtifact?: { driveUrl?: string; localUrl?: string }; matrixItems?: Array<{ sourceLineId: string; allergens?: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string }> }> }>(matrixResponse, "CPU allergen review");
    recordDeliveredInAppReadBudget({ stage: "cpu_review_fallback_batch", upstreamRequests: 2, recordsInspected: orderIds.length, serviceDate: date, oplocId });
    const plans = matrixBody.matrixStatuses || [];
    const entries = new Map<string, { allergens: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string }>(); const signatures = new Map<string, { role: string; printedName: string; signedAt: string }>(); let candidatePdfUrl: string | undefined;
    for (const status of plans) { for (const role of status.signatureRoles || []) signatures.set(role, { role, printedName: "", signedAt: "" }); candidatePdfUrl ||= status.matrixArtifact?.driveUrl || status.matrixArtifact?.localUrl; }
    const signatureList = [...signatures.values()]; const signed = signatureList.some(signature => signature.role === "production_chef") && signatureList.some(signature => signature.role === "head_chef_site_manager");
    if (signed) for (const status of plans) { const order = orders.find(candidate => candidate.canonicalId === status.orderId); for (const item of status.matrixItems || []) { const line = order?.lines?.find(candidate => candidate.canonicalId === item.sourceLineId); const projectionLineId = line?.sourceBookingLineId || item.sourceLineId; if (projectionLineId && order?.destinationOplocId === oplocId) entries.set(projectionLineId, { allergens: Object.keys(item.allergens || {}).length ? item.allergens! : line?.approvedAllergenSnapshot?.allergens || {}, mayContainNotes: item.mayContainNotes || line?.approvedAllergenSnapshot?.mayContainNotes }); } }
    return { entries, cpuReview: { status: signed ? "signed" as const : "pending" as const, signatures: signatureList, ...(signed && candidatePdfUrl ? { drivePdfUrl: candidatePdfUrl } : {}) }, orderIds };
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
    if (discovered.days.length && discovered.days.every(day => day.state.completeness !== "missing")) return { access, sites, selectedOplocId, weeks: weeksFromProjectionDays(discovered.days), withdrawnServiceDates: discovered.withdrawnServiceDates };
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
      } catch { /* A corrupt/missing package enters the controlled rebuild path. */ }
      try {
        return await materialiseDeliveredInDay({ request, site, day, loadReview: cpuReviewForDay, governed: governedOplocIds.has(selectedOplocId) });
      } catch (error) {
        recordDeliveredInAppReadBudget({ stage: "day_projection_unavailable", upstreamRequests: 1, serviceDate: day.date, oplocId: selectedOplocId });
        return unavailableDayProjection(day, site, error);
      }
    }));
    return { ...week, days };
  }));
  return { access, sites, selectedOplocId, weeks, withdrawnServiceDates: [] as string[] };
}

async function readProjectionWindow(oplocId: string) {
  const index = await readDeliveredInProjectionIndex(oplocId).catch(() => undefined);
  if (!index) return { days: [] as DeliveredInDayProjection[], withdrawnServiceDates: [] as string[] };
  const withdrawnServiceDates = index.value.entries.filter(entry => entry.state === "withdrawn").map(entry => entry.serviceDate);
  const results = await Promise.all(index.value.entries.filter(entry => entry.state !== "withdrawn").map(async entry => { try { return (await readDeliveredInProjection(oplocId, entry.serviceDate))?.value; } catch { return undefined; } }));
  return { days: results.filter((day): day is DeliveredInDayProjection => Boolean(day)), withdrawnServiceDates };
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
