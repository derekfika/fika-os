export const LOGISTICS_PROJECTION_CHANGE_TYPES = [
  "created",
  "amended",
  "cancelled",
  "withdrawn",
  "superseded",
  "status-changed",
] as const;

export type LogisticsProjectionChangeType =
  (typeof LOGISTICS_PROJECTION_CHANGE_TYPES)[number];

export type LogisticsProjectionInvalidation = {
  serviceDate: string;
  sourceDomain: string;
  sourceEntityId: string;
  sourceVersion: number;
  sourceContentHash?: string;
  changedAt: string;
  changeType: LogisticsProjectionChangeType;
};

/**
 * The first Fulfilment revision of a source version keeps the original
 * `...:v{sourceVersion}` identity so existing events and delivery callers stay
 * valid. A later requirement revision at the same source version (for example a
 * governed withdrawal) is a distinct durable transition and carries
 * `requirementRevision`, which yields `...:v{sourceVersion}:r{revision}`.
 */
export function logisticsProjectionEventId(change: Pick<LogisticsProjectionInvalidation, "sourceDomain" | "sourceEntityId" | "sourceVersion" | "serviceDate"> & { destinationOplocId?: string; requirementRevision?: number }) {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9:_-]+/g, "_");
  const base = `logistics-projection:${safe(change.serviceDate)}:${safe(change.sourceDomain)}:${safe(change.sourceEntityId)}:${safe(change.destinationOplocId || "destination-unknown")}:v${change.sourceVersion}`;
  return change.requirementRevision === undefined ? base : `${base}:r${change.requirementRevision}`;
}
