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

export function logisticsProjectionEventId(change: Pick<LogisticsProjectionInvalidation, "sourceDomain" | "sourceEntityId" | "sourceVersion" | "serviceDate"> & { destinationOplocId?: string }) {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9:_-]+/g, "_");
  return `logistics-projection:${safe(change.serviceDate)}:${safe(change.sourceDomain)}:${safe(change.sourceEntityId)}:${safe(change.destinationOplocId || "destination-unknown")}:v${change.sourceVersion}`;
}
