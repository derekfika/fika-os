import type { NextRequest } from "next/server";
import { buildDeliveredInDayProjection, type ReviewLoader } from "./delivered-in-projection-materialiser";
import { readDeliveredInProjection, readDeliveredInProjectionForReconciliation, writeDeliveredInProjection, withdrawDeliveredInProjectionDay, type DeliveredInInvalidation } from "./delivered-in-projection-store";
import { assertAuthorisedOploc, projectPublishedWeeks, type Site, type SourcePublication } from "./projection";
import { readAuthoritativeMenuPublications, resolveAccess, cpuReviewForDay } from "./server";
import { packetPublicationsForRange, readMenuPlanningWeekPackets, type MenuPlanningWeekPacket } from "./menu-planning-week-packet";

const addDays = (date: string, days: number) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const mondayOf = (date: string) => { const value = new Date(`${date}T00:00:00Z`); const day = value.getUTCDay(); value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1)); return value.toISOString().slice(0, 10); };

type MenuResolutionOptions = {
  authoritativePublications?: SourcePublication[];
  readMenuPackets?: (fromWeek: string, toWeek: string) => Promise<MenuPlanningWeekPacket[]>;
  readAuthoritativePublications?: (request: NextRequest, fromWeek: string, toWeek: string) => Promise<SourcePublication[]>;
};

function menuResultForPublications(publications: SourcePublication[], oplocId: string, serviceDate: string) {
  for (const publication of publications) {
    const sourceDay = publication.days.filter(candidate => candidate.date === serviceDate).sort((a, b) => b.version - a.version)[0];
    if (!sourceDay) continue;
    if (sourceDay.status === "withdrawn" || sourceDay.status === "superseded") return { withdrawn: true as const, sourceVersion: `${sourceDay.publicationDayId}:v${sourceDay.version}:${sourceDay.contentHash}`, sourceSequence: sourceDay.version, sourceLineageKey: [publication.publicationId, sourceDay.publicationDayId, sourceDay.version, sourceDay.contentHash, "none"].join("|") };
    const projected = projectPublishedWeeks([publication], oplocId, new Set([oplocId]), serviceDate).find(week => week.days.some(candidate => candidate.date === serviceDate));
    return { day: projected?.days.find(candidate => candidate.date === serviceDate), withdrawn: false as const, missing: !projected };
  }
  return { withdrawn: false as const, missing: true as const };
}

async function menuForDate(request: NextRequest, oplocId: string, serviceDate: string, options: MenuResolutionOptions = {}) {
  const fromWeek = mondayOf(serviceDate);
  const toWeek = addDays(fromWeek, 7);
  if (options.authoritativePublications) return menuResultForPublications(options.authoritativePublications, oplocId, serviceDate);
  const packets = await (options.readMenuPackets || readMenuPlanningWeekPackets)(fromWeek, toWeek);
  if (packets.length) {
    const packetResult = menuResultForPublications(packetPublicationsForRange(packets, fromWeek, toWeek) as SourcePublication[], oplocId, serviceDate);
    // A packet is a read optimisation, not withdrawal authority. If the
    // requested date is omitted, resolve the bounded authoritative week.
    if (!packetResult.missing) return packetResult;
  }
  return menuResultForPublications(await (options.readAuthoritativePublications || readAuthoritativeMenuPublications)(request, fromWeek, toWeek), oplocId, serviceDate);
}

export async function reconcileDeliveredInDay(request: NextRequest, oplocId: string, serviceDate: string, options: MenuResolutionOptions & { loadReview?: ReviewLoader; invalidation?: DeliveredInInvalidation } = {}) {
  const resolved = await resolveAccess(request); assertAuthorisedOploc(resolved.access, oplocId);
  const site: Site = resolved.sites.find(candidate => candidate.oplocId === oplocId) || { oplocId, label: oplocId };
  const existing = await readDeliveredInProjection(oplocId, serviceDate).catch(() => undefined);
  const existingForReconciliation = await readDeliveredInProjectionForReconciliation(oplocId, serviceDate);
  const day = await menuForDate(request, oplocId, serviceDate, options);
  if (day.withdrawn) {
    await withdrawDeliveredInProjectionDay(oplocId, serviceDate, day?.sourceVersion || "menu:withdrawn-or-missing", { sourceSequence: day?.sourceSequence, sourceLineageKey: day?.sourceLineageKey });
    return { status: "withdrawn", serviceDate, oplocId };
  }
  if (!day.day) return { status: "missing", serviceDate, oplocId };
  const candidate = await buildDeliveredInDayProjection({ request, site, day: day.day, loadReview: options.loadReview || cpuReviewForDay, governed: true });
  const comparable = (value: unknown) => JSON.stringify(value, (_key, item) => _key === "generatedAt" || _key === "projectionVersion" ? undefined : item);
  const sourceCertainty = candidate.sourceLineage.cpu.sourceBundleHash ? "CPU daily signed packet matched the Menu Planning source bundle hash." : "CPU daily signed packet metadata was not supplied.";
  if (existing && existing.value.state.completeness === "complete" && comparable(existing.value) === comparable(candidate)) return { status: "current", projection: existing.value, sourceCertainty };
  const written = await writeDeliveredInProjection(candidate, { invalidation: options.invalidation });
  if (written.status === "superseded") return { status: "superseded", serviceDate, oplocId, sourceCertainty };
  return { status: existing || existingForReconciliation ? "rebuilt" : "created", projection: written.projection, sourceCertainty };
}
