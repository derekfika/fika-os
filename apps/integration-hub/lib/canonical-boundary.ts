import type { CanonicalRecord } from "./types";
import { AcceptedCanonicalEntityTypes } from "./schemas";

export type CanonicalBoundaryQuery = { entityType?: string; locationType?: "Site" | "Venue"; limit: number; after?: string };

export function acceptedPublishedOplocPage(records: CanonicalRecord[], input: CanonicalBoundaryQuery) {
  return acceptedPublishedCanonicalPage(records, { ...input, entityType: "OPLOC" });
}

export function acceptedPublishedCanonicalPage(records: CanonicalRecord[], input: CanonicalBoundaryQuery) {
  const entityType = input.entityType || "OPLOC";
  if (!AcceptedCanonicalEntityTypes.includes(entityType as typeof AcceptedCanonicalEntityTypes[number])) throw Object.assign(new Error(`${entityType} is not an Accepted Canon entity type available from this boundary.`), { status: 400 });
  if (input.locationType && entityType !== "OPLOC") throw Object.assign(new Error("locationType applies only to OPLOC queries."), { status: 400 });
  const publishedIds = new Set(records.filter(record => record.lifecycleStatus === "published").map(record => record.canonicalId));
  const selected = records.filter(record => record.entityType === entityType && record.lifecycleStatus === "published" && (entityType !== "OPLOC" || record.record.lifecycleState === "active"));
  const brokenReferences = selected.flatMap(record => referenceIds(record.record).filter(reference => !publishedIds.has(reference)).map(reference => ({ canonicalId: record.canonicalId, reference })));
  const brokenIds = new Set(brokenReferences.map(item => item.canonicalId));
  let eligible = selected.filter(record => !brokenIds.has(record.canonicalId)).sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
  if (input.locationType) eligible = eligible.filter(record => record.record.primaryLocationType === input.locationType);
  if (input.after) eligible = eligible.filter(record => record.canonicalId > input.after!);
  const page = eligible.slice(0, input.limit);
  return { records: page, nextCursor: eligible.length > input.limit ? page.at(-1)?.canonicalId : undefined, brokenReferences };
}

function referenceIds(record: Record<string, unknown>) { return Object.entries(record).filter(([key]) => ["legendId", "oplocId", "capabilityId", "mergedIntoOplocId", "addressReference"].includes(key)).flatMap(([, value]) => value ? [String(value)] : []); }
