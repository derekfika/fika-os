import type { NextRequest } from "next/server";
import { buildDeliveredInDayProjection, type ReviewLoader } from "./delivered-in-projection-materialiser";
import { readDeliveredInProjection, writeDeliveredInProjection, withdrawDeliveredInProjectionDay } from "./delivered-in-projection-store";
import { assertAuthorisedOploc, projectPublishedWeeks, type Site, type SourcePublication } from "./projection";
import { resolveAccess, cpuReviewForDay } from "./server";

const menuBase = () => (process.env.MENU_PLANNING_BASE_URL || "http://localhost:3500").replace(/\/$/, "");
const addDays = (date: string, days: number) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const mondayOf = (date: string) => { const value = new Date(`${date}T00:00:00Z`); const day = value.getUTCDay(); value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1)); return value.toISOString().slice(0, 10); };

async function menuForDate(request: NextRequest, oplocId: string, serviceDate: string) {
  const fromWeek = mondayOf(serviceDate);
  const response = await fetch(`${menuBase()}/api/rolling-menu/publications?fromWeek=${encodeURIComponent(fromWeek)}&toWeek=${encodeURIComponent(addDays(fromWeek, 7))}`, { cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error(`Menu Planning publication service is unavailable (${response.status}).`), { status: 503, code: "MENU_SOURCE_UNAVAILABLE" });
  const body = await response.json() as { publications?: SourcePublication[] };
  for (const publication of body.publications || []) {
    const sourceDay = publication.days.find(candidate => candidate.date === serviceDate);
    if (!sourceDay) continue;
    if (sourceDay.status === "withdrawn") return { withdrawn: true as const };
    const projected = projectPublishedWeeks([publication], oplocId, new Set([oplocId]), serviceDate).find(week => week.days.some(candidate => candidate.date === serviceDate));
    if (projected) return { day: projected.days.find(candidate => candidate.date === serviceDate), withdrawn: false as const };
  }
  return undefined;
}

export async function reconcileDeliveredInDay(request: NextRequest, oplocId: string, serviceDate: string, options: { loadReview?: ReviewLoader } = {}) {
  const resolved = await resolveAccess(request); assertAuthorisedOploc(resolved.access, oplocId);
  const site: Site = resolved.sites.find(candidate => candidate.oplocId === oplocId) || { oplocId, label: oplocId };
  const existing = await readDeliveredInProjection(oplocId, serviceDate).catch(() => undefined);
  const day = await menuForDate(request, oplocId, serviceDate);
  if (!day || day.withdrawn) { await withdrawDeliveredInProjectionDay(oplocId, serviceDate, day ? "menu:withdrawn" : "menu:withdrawn-or-missing"); return { status: "withdrawn", serviceDate, oplocId }; }
  if (!day.day) return { status: "missing", serviceDate, oplocId };
  const candidate = await buildDeliveredInDayProjection({ request, site, day: day.day, loadReview: options.loadReview || cpuReviewForDay, governed: true });
  const comparable = (value: unknown) => JSON.stringify(value, (_key, item) => _key === "generatedAt" || _key === "projectionVersion" ? undefined : item);
  const sourceCertainty = candidate.sourceLineage.cpu.sourceVersion || candidate.sourceLineage.cpu.contentHash ? "CPU review package metadata was read from the authenticated CPU package route." : "CPU review package metadata was not supplied by the current CPU route.";
  if (existing && existing.value.state.completeness === "complete" && comparable(existing.value) === comparable(candidate)) return { status: "current", projection: existing.value, sourceCertainty };
  const written = await writeDeliveredInProjection(candidate);
  return { status: existing ? "rebuilt" : "created", projection: written.projection, sourceCertainty };
}
