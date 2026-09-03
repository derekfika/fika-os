export type SiteAccess = { email: string; oplocIds: string[]; permissions: string[] };
export type Site = { oplocId: string; label: string };
export type SourceAllocation = { destinationId?: string; destinationLabel: string; quantity: number };
export type SourceEntry = { sourceEntryId: string; slot: string; canonicalDishId?: string; dishName: string; portions: number; allocations: SourceAllocation[]; allergens: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string };
export type SourceDay = { publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; status: "published" | "superseded" | "withdrawn"; contentHash: string; entries: SourceEntry[]; allergenSignoff: { productionChef?: { printedName: string; signedAt: string }; headChefSiteManager?: { printedName: string; signedAt: string }; printedName?: string; signedAt?: string }; driveArchive?: { pdfDriveUrl?: string; pdfStatus?: string; pdfFileName?: string } };
export type SourcePublication = { publicationId: string; sourceWeekId: string; weekCommencing: string; weekEnding: string; days: SourceDay[] };
export type ProjectedEntry = { sourceEntryId: string; slot: string; canonicalDishId?: string; dishName: string; quantity: number; allergens: Record<string, "clear" | "contains" | "may_contain" | "unrecorded">; mayContainNotes?: string; allergensVisible?: boolean };
export type ProjectedDestination = { oplocId: string; label: string; portions: number };
export type ProjectedDay = { projectionVersion?: number; publicationId: string; publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; contentHash: string; weekCommencing?: string; entries: ProjectedEntry[]; destinations?: ProjectedDestination[]; allergenSignoff: SourceDay["allergenSignoff"]; cpuReview?: { status: "pending" | "signed"; signatures: Array<{ role: string; printedName: string; signedAt: string }>; drivePdfUrl?: string }; drivePdfUrl?: string; drivePdfFileName?: string; siteMenu?: import("./site-menu").SiteMenuState };
export type ProjectedWeek = { publicationId: string; weekCommencing: string; weekEnding: string; days: ProjectedDay[] };
import { canonicalOplocId, GOVERNED_OPLOC_BY_ID, oplocIdsMatch } from "@fika/server-shared/governed-oplocs";
import { titleCase } from "./text";

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

export function assertAuthorisedOploc(access: SiteAccess, requestedOplocId: string) { if (!access.oplocIds.some(allowed => oplocIdsMatch(allowed, requestedOplocId))) throw Object.assign(new Error("You are not authorised to view this Delivered-In site."), { status: 403 }); }

export function assertPublishedAllocationIntegrity(publicationId: string, day: SourceDay, entry: SourceEntry, governedOplocIds = new Set(GOVERNED_OPLOC_BY_ID.keys()), selectedOplocId?: string) {
  const governed = new Set([...governedOplocIds].map(canonicalOplocId));
  for (const allocation of entry.allocations.filter(candidate => !selectedOplocId || oplocIdsMatch(candidate.destinationId, selectedOplocId))) {
    if (!allocation.destinationId || !governed.has(canonicalOplocId(allocation.destinationId))) {
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
  const selectedCanonicalOplocId = canonicalOplocId(selectedOplocId);
  return publications.filter(publication => isRelevantPublishedWeek(publication, asOf)).map(publication => {
    const latestByDate = new Map<string, SourceDay>();
    for (const day of publication.days) {
      const existing = latestByDate.get(day.date);
      if (!existing || day.version > existing.version) latestByDate.set(day.date, day);
    }
    return {
      publicationId: publication.publicationId,
      weekCommencing: publication.weekCommencing,
      weekEnding: publication.weekEnding,
      // A newer withdrawn amendment is authoritative for the date. Never
      // re-expose the older immutable published bytes in a weekly view.
      days: Array.from(latestByDate.values()).filter(day => day.status === "published")
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(day => {
          const destinations = new Map<string, ProjectedDestination>();
          for (const entry of day.entries) for (const allocation of entry.allocations) {
            if (!allocation.destinationId) continue;
            const canonicalId = canonicalOplocId(allocation.destinationId)!;
            const current = destinations.get(canonicalId);
            destinations.set(canonicalId, { oplocId: canonicalId, label: allocation.destinationLabel, portions: (current?.portions || 0) + allocation.quantity });
          }
          return {
          publicationId: publication.publicationId,
          publicationDayId: day.publicationDayId,
          sourceDayId: day.sourceDayId,
          date: day.date,
          dayName: day.dayName,
          version: day.version,
          contentHash: day.contentHash,
          weekCommencing: publication.weekCommencing,
          destinations: [...destinations.values()].sort((a, b) => a.label.localeCompare(b.label)),
          allergenSignoff: day.allergenSignoff,
          ...(day.driveArchive?.pdfDriveUrl ? { drivePdfUrl: day.driveArchive.pdfDriveUrl } : {}),
          ...(day.driveArchive?.pdfFileName ? { drivePdfFileName: day.driveArchive.pdfFileName } : {}),
          entries: day.entries.flatMap(entry => {
            // A stale destination elsewhere in the publication must not hide
            // a valid site's published menu.
            assertPublishedAllocationIntegrity(publication.publicationId, day, entry, governedOplocIds, selectedOplocId);
            return entry.allocations
              .filter(allocation => oplocIdsMatch(allocation.destinationId, selectedCanonicalOplocId))
              .map(allocation => ({
                sourceEntryId: entry.sourceEntryId,
                slot: entry.slot,
                canonicalDishId: entry.canonicalDishId,
                dishName: titleCase(entry.dishName),
                quantity: allocation.quantity,
                allergens: entry.allergens,
                mayContainNotes: entry.mayContainNotes,
              }));
          }),
        }; }),
    };
  }).sort((a, b) => b.weekCommencing.localeCompare(a.weekCommencing));
}

export function siteDayTotal(day: ProjectedDay) { return day.entries.reduce((sum, entry) => sum + entry.quantity, 0); }
