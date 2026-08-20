export type SiteAccess = { email: string; oplocIds: string[]; permissions: string[] };
export type Site = { oplocId: string; label: string };
export type SourceAllocation = { destinationId?: string; destinationLabel: string; quantity: number };
export type SourceEntry = { sourceEntryId: string; slot: string; canonicalDishId?: string; dishName: string; portions: number; allocations: SourceAllocation[]; allergens: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string };
export type SourceDay = { publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; status: "published" | "superseded" | "withdrawn"; contentHash: string; entries: SourceEntry[]; allergenSignoff: { productionChef?: { printedName: string; signedAt: string }; headChefSiteManager?: { printedName: string; signedAt: string }; printedName?: string; signedAt?: string }; driveArchive?: { pdfDriveUrl?: string; pdfStatus?: string; pdfFileName?: string } };
export type SourcePublication = { publicationId: string; sourceWeekId: string; weekCommencing: string; weekEnding: string; days: SourceDay[] };
export type ProjectedEntry = { sourceEntryId: string; slot: string; canonicalDishId?: string; dishName: string; quantity: number; allergens: SourceEntry["allergens"]; mayContainNotes?: string };
export type ProjectedDay = { publicationId: string; publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; contentHash: string; weekCommencing?: string; entries: ProjectedEntry[]; allergenSignoff: SourceDay["allergenSignoff"]; drivePdfUrl?: string; drivePdfFileName?: string; siteMenu?: import("./site-menu").SiteMenuState };
export type ProjectedWeek = { publicationId: string; weekCommencing: string; weekEnding: string; days: ProjectedDay[] };
import { GOVERNED_OPLOC_BY_ID } from "../../shared/governed-oplocs";

const OPERATIONAL_TIME_ZONE = "Europe/London";
const OPERATIONAL_WEEK_HORIZON_DAYS = 42;

export function operationalDateLondon(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: OPERATIONAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isRelevantPublishedWeek(publication: SourcePublication, asOf = operationalDateLondon()) {
  const currentWeekCommencing = addDays(asOf, -(new Date(`${asOf}T12:00:00Z`).getUTCDay() || 7) + 1);
  const horizon = addDays(currentWeekCommencing, OPERATIONAL_WEEK_HORIZON_DAYS);
  return publication.weekEnding >= currentWeekCommencing && publication.weekCommencing <= horizon;
}

export function assertAuthorisedOploc(access: SiteAccess, requestedOplocId: string) { if (!access.oplocIds.includes(requestedOplocId)) throw Object.assign(new Error("You are not authorised to view this Delivered-In site."), { status: 403 }); }

export function assertPublishedAllocationIntegrity(publicationId: string, day: SourceDay, entry: SourceEntry, governedOplocIds = new Set(GOVERNED_OPLOC_BY_ID.keys())) {
  for (const allocation of entry.allocations) {
    if (!allocation.destinationId || !governedOplocIds.has(allocation.destinationId)) {
      throw Object.assign(
        new Error(`Published Delivered-In integrity error: ${publicationId} ${day.dayName} contains an unresolved destination for ${entry.dishName}.`),
        { status: 502 },
      );
    }
    if (!Number.isFinite(allocation.quantity) || allocation.quantity <= 0) {
      throw Object.assign(
        new Error(`Published Delivered-In integrity error: ${publicationId} ${day.dayName} contains an invalid quantity for ${entry.dishName}.`),
        { status: 502 },
      );
    }
  }
}

export function projectPublishedWeeks(publications: SourcePublication[], selectedOplocId: string, governedOplocIds?: Set<string>, asOf = operationalDateLondon()): ProjectedWeek[] {
  return publications.filter(publication => isRelevantPublishedWeek(publication, asOf)).map(publication => {
    const latestByDate = new Map<string, SourceDay>();
    for (const day of publication.days) {
      if (day.status !== "published") continue;
      const existing = latestByDate.get(day.date);
      if (!existing || day.version > existing.version) latestByDate.set(day.date, day);
    }
    return {
      publicationId: publication.publicationId,
      weekCommencing: publication.weekCommencing,
      weekEnding: publication.weekEnding,
      days: Array.from(latestByDate.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(day => ({
          publicationId: publication.publicationId,
          publicationDayId: day.publicationDayId,
          sourceDayId: day.sourceDayId,
          date: day.date,
          dayName: day.dayName,
          version: day.version,
          contentHash: day.contentHash,
          weekCommencing: publication.weekCommencing,
          allergenSignoff: day.allergenSignoff,
          ...(day.driveArchive?.pdfDriveUrl ? { drivePdfUrl: day.driveArchive.pdfDriveUrl } : {}),
          ...(day.driveArchive?.pdfFileName ? { drivePdfFileName: day.driveArchive.pdfFileName } : {}),
          entries: day.entries.flatMap(entry => {
            assertPublishedAllocationIntegrity(publication.publicationId, day, entry, governedOplocIds);
            return entry.allocations
              .filter(allocation => allocation.destinationId === selectedOplocId)
              .map(allocation => ({
                sourceEntryId: entry.sourceEntryId,
                slot: entry.slot,
                canonicalDishId: entry.canonicalDishId,
                dishName: entry.dishName,
                quantity: allocation.quantity,
                allergens: entry.allergens,
                mayContainNotes: entry.mayContainNotes,
              }));
          }),
        })),
    };
  }).sort((a, b) => b.weekCommencing.localeCompare(a.weekCommencing));
}

export function siteDayTotal(day: ProjectedDay) { return day.entries.reduce((sum, entry) => sum + entry.quantity, 0); }
