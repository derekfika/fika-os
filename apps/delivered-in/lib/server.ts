import type { NextRequest } from "next/server";
import { assertAuthorisedOploc, projectPublishedWeeks, type Site, type SiteAccess, type SourcePublication } from "./projection";
import { siteMenuState } from "./site-menu";
import { latestSiteMenuArtifact } from "./site-menu-store";

const hubBase = () => (process.env.INTEGRATION_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
const menuBase = () => (process.env.MENU_PLANNING_BASE_URL || "http://localhost:3500").replace(/\/$/, "");
const failure = (message: string, status = 502) => Object.assign(new Error(message), { status });
async function readJson<T>(response: Response, label: string): Promise<T> { const text = await response.text(); if (!response.headers.get("content-type")?.includes("application/json")) throw failure(`${label} returned a non-JSON response (${response.status}); the source service may be unavailable.`); try { return JSON.parse(text) as T; } catch (cause) { throw Object.assign(failure(`${label} returned invalid JSON; no empty projection was used.`), { cause }); } }

async function resolveGovernedOplocIds(request: NextRequest) {
  const response = await fetch(`${hubBase()}/api/oplocs`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  const body = await readJson<{ oplocs?: Array<{ canonicalId?: string }>; error?: { message?: string } }>(response, "Integration Hub OPLOC authority");
  if (!response.ok || !body.oplocs) throw failure(body.error?.message || "Integration Hub OPLOC authority could not be loaded.", response.status || 502);
  return new Set(body.oplocs.map(oploc => oploc.canonicalId).filter((id): id is string => Boolean(id)));
}

export async function resolveAccess(request: NextRequest): Promise<{ access: SiteAccess; sites: Site[] }> {
  const response = await fetch(`${hubBase()}/api/delivered-in/access`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  const body = await readJson<{ access?: SiteAccess; sites?: Site[]; error?: { message?: string } }>(response, "Integration Hub access service");
  if (!response.ok || !body.access || !body.sites) throw failure(body.error?.message || "Delivered-In access could not be resolved.", response.status || 502);
  return { access: body.access, sites: body.sites };
}

export async function projectedWeeks(request: NextRequest, requestedOplocId?: string) {
  const resolved = await resolveAccess(request); const access = resolved.access; const sites = resolved.sites;
  if (!access.oplocIds.length) return { access, sites, selectedOplocId: undefined, weeks: [] };
  const selectedOplocId = requestedOplocId || (access.oplocIds.length === 1 ? access.oplocIds[0] : undefined);
  if (!selectedOplocId) return { access, sites, selectedOplocId: undefined, weeks: [] };
  assertAuthorisedOploc(access, selectedOplocId);
  const response = await fetch(`${menuBase()}/api/rolling-menu/publications`, { cache: "no-store" });
  const body = await readJson<{ publications?: SourcePublication[]; error?: { message?: string } }>(response, "Menu Planning publication service");
  if (!response.ok) throw failure(body.error?.message || "Published Delivered-In menus could not be loaded.");
  const governedOplocIds = await resolveGovernedOplocIds(request);
  const weeks = projectPublishedWeeks(body.publications || [], selectedOplocId, governedOplocIds).map(week => ({ ...week, days: week.days.map(day => ({ ...day, siteMenu: siteMenuState(day, latestSiteMenuArtifact(selectedOplocId, day.sourceDayId)) })) }));
  return { access, sites, selectedOplocId, weeks };
}

export async function projectedAllergenDay(request: NextRequest, requestedOplocId: string, publicationDayId: string) {
  const result = await projectedWeeks(request, requestedOplocId);
  for (const week of result.weeks) {
    const day = week.days.find(candidate => candidate.publicationDayId === publicationDayId);
    if (day) return { ...day, site: result.sites.find(site => site.oplocId === requestedOplocId) };
  }
  throw failure("The signed published day was not found for this site.", 404);
}
