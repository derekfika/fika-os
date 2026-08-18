import type { HubState } from "./types";
import type { StagingRecord } from "./schemas";

export type CoverageCheck = { label: string; met: number; total: number };
export type BaselineCoverage = { entityType: string; staged: number; approved: number; blocked: number; awaitingReview: number; checks: CoverageCheck[] };

export function baselineCoverage(state: HubState): BaselineCoverage[] {
  const types = [...new Set([...state.staging.map(record => record.entityType), ...state.canonical.map(record => record.entityType)])].sort();
  return types.map(entityType => {
    const staged = state.staging.filter(record => record.entityType === entityType);
    const approved = state.canonical.filter(record => record.entityType === entityType).length;
    return {
      entityType,
      staged: staged.length,
      approved,
      blocked: staged.filter(record => record.issues.some(issue => issue.severity === "blocking") || ["invalid", "conflict"].includes(record.state)).length,
      awaitingReview: staged.filter(record => ["ready", "possible-duplicate", "unresolved"].includes(record.state)).length,
      checks: coverageChecks(entityType, staged),
    };
  });
}

function coverageChecks(entityType: string, records: StagingRecord[]): CoverageCheck[] {
  const check = (label: string, predicate: (record: StagingRecord) => boolean): CoverageCheck => ({ label, met: records.filter(predicate).length, total: records.length });
  const identity = (record: StagingRecord) => Array.isArray(record.normalised.externalIdentities) && record.normalised.externalIdentities.length > 0;
  if (entityType === "Legend") return [
    check("Employment source identity", identity),
    check("Employment state", record => Boolean(record.normalised.employmentState)),
    check("Workplace evidence", record => Boolean((Array.isArray(record.normalised.workLocationReferences) && record.normalised.workLocationReferences.length) || (Array.isArray(record.normalised.rotaSiteReferences) && record.normalised.rotaSiteReferences.length))),
  ];
  if (entityType === "Absence") return [check("Legend source reference", record => Boolean(record.normalised.legendExternalId || record.normalised.legendId)), check("Date range", record => Boolean(record.normalised.startDate && record.normalised.endDate))];
  if (entityType === "Site") return [check("Provider identity", identity), check("Address evidence", record => Boolean(record.normalised.address)), check("Canonical OPLOC assignment", record => Boolean(record.normalised.operationalLocationId))];
  if (entityType === "Product Category") return [check("Provider identity", identity), check("Category name", record => Boolean(record.normalised.name))];
  if (entityType === "Till Item") return [check("Provider identity", identity), check("Category evidence", record => Boolean(record.normalised.categoryExternalId || (Array.isArray(record.normalised.categoryExternalIds) && record.normalised.categoryExternalIds.length))), check("Location availability", record => hasLocationEvidence(record.normalised.locationAvailability))];
  if (entityType === "Till Item Variation") return [check("Parent Till Item reference", record => Boolean(record.normalised.tillItemExternalId || record.normalised.tillItemId)), check("Price evidence", record => Boolean(record.normalised.basePrice || (Array.isArray(record.normalised.locationPrices) && record.normalised.locationPrices.length))), check("Location availability", record => hasLocationEvidence(record.normalised.locationAvailability))];
  return [check("Source identity", identity)];
}

function hasLocationEvidence(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const availability = value as Record<string, unknown>;
  return availability.presentAtAllLocations === true || (Array.isArray(availability.presentAtLocations) && availability.presentAtLocations.length > 0) || (Array.isArray(availability.absentAtLocations) && availability.absentAtLocations.length > 0);
}
