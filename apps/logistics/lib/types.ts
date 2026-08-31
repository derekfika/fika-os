import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";

export type MovementType = "delivery" | "collection" | "transfer";
export type MovementRequest = {
  canonicalId: string;
  entityType: "Movement Request";
  type: MovementType;
  serviceDate: string;
  fromOplocId?: string;
  fromAddress?: string;
  toOplocId?: string;
  toAddress?: string;
  requiredTime?: string;
  window?: { startTime: string; endTime?: string };
  items: { description: string; quantity: number; unit?: string }[];
  notes?: string;
  createdBy: string;
  status: "open" | "planned" | "completed" | "cancelled";
  version: number;
  createdAt: string;
  updatedAt: string;
  audit: { action: string; at: string; by: string; version: number }[];
};
export type StopIssue = {
  id: string;
  stopId: string;
  reportedAt: string;
  reportedBy: string;
  description: string;
  category?: "Cannot access building" | "Customer unavailable" | "Missing / incorrect load" | "Running late" | "Vehicle issue" | "Other" | "Access" | "Delay" | "Missing item" | "Vehicle";
  status: "open" | "resolved";
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
};
export type RequirementRef = { requirementId: string; sourceVersion: number };
export type DeliveryStop = {
  canonicalId: string;
  runId: string;
  sequence: number;
  locationOplocId: string;
  locationLabelSnapshot: string;
  requirementRefs: RequirementRef[];
  movementRequestIds: string[];
  /** Legacy prototype field; normalized into movementRequestIds on read. */ movementRequestId?: string;
  movementType?: MovementType;
  /** Logistics-owned planning choice; never mutates the upstream requirement. */
  collectionRequired?: boolean;
  linkedStopId?: string;
  linkedOperation?: "delivery" | "collection";
  originatingLoadKey?: string;
  requiredTime?: string;
  window?: { startTime: string; endTime?: string };
  /** Logistics' intended operating time; never replaces upstream required timing. */
  plannedArrivalTime?: string;
  plannedWindow?: { startTime: string; endTime?: string };
  loaded?: boolean;
  loadedRequirementIds?: string[];
  deliveredRequirementIds?: string[];
  completedFromStatus?: "planned" | "arrived";
  postponedFromServiceDate?: string;
  postponedAt?: string;
  postponedBy?: string;
  status: "planned" | "arrived" | "completed" | "issue";
  issues?: StopIssue[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  audit: { action: string; at: string; by: string; version: number }[];
};
export type DeliveryRun = {
  canonicalId: string;
  serviceDate: string;
  status: "draft" | "planned" | "ready" | "dispatched" | "completed";
  returnToCpuRequired?: boolean;
  returnToCpuPending?: boolean;
  returnedToCpuAt?: string;
  returnedToCpuBy?: string;
  driverId?: string;
  driverLabel?: string;
  vehicleLabel?: string;
  orderedStopIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  audit: { action: string; at: string; by: string; version: number }[];
};
export type PlanningItem =
  | { kind: "fulfilment"; requirement: FulfilmentRequirement }
  | { kind: "movement"; movement: MovementRequest };
export type UpstreamHealth = { available: boolean; error?: string };
export type LogisticsHealth = {
  fulfilment: UpstreamHealth;
  oplocs: UpstreamHealth;
};

/** A logistics-owned projection of one independently trackable fulfilment job. */
export type LogisticsJob = {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: number;
  serviceDate: string;
  originOplocId?: string;
  destinationOplocId?: string;
  destinationLabelSnapshot?: string;
  requestedWindow?: { startTime: string; endTime?: string };
  productionReadiness: "pending" | "ready" | "attention";
  collectionStatus: "awaiting" | "collected";
  contents: { description: string; quantity: number; unit: string }[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  audit: { action: string; at: string; by: string; version: number }[];
};

export type DeliveryLoad = {
  id: string;
  serviceDate: string;
  originOplocId: string;
  destinationOplocId: string;
  destinationLabelSnapshot?: string;
  scheduledTime: string;
  scheduledEnd?: string;
  collectionRequired?: boolean;
  collectionScheduledTime?: string;
  collectionScheduledEnd?: string;
  collectionRunId?: string;
  loaded?: boolean;
  status: "planned" | "ready" | "dispatched" | "delivered" | "cancelled";
  driverId?: string;
  vehicleId?: string;
  runId?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  audit: { action: string; at: string; by: string; version: number }[];
};

export type LogisticsAssignment = {
  jobId: string;
  loadId: string;
  serviceDate?: string;
  assignedAt: string;
  assignedBy: string;
  audit: { action: string; at: string; by: string }[];
};

export type LogisticsChangeEvent = {
  sequence: number;
  serviceDate?: string;
  entityType: "logisticsJob" | "deliveryLoad" | "assignment";
  entityId: string;
  changeType: string;
  revision: number;
  changedAt: string;
  actorId: string;
  relatedEntityId?: string;
};

export type LogisticsProjectionJob = Pick<LogisticsJob, "id" | "sourceType" | "sourceId" | "serviceDate" | "originOplocId" | "destinationOplocId" | "destinationLabelSnapshot" | "requestedWindow" | "productionReadiness" | "collectionStatus" | "contents" | "notes"> & { totalUnits: number; assignedLoadId?: string };
export type LogisticsProjectionLoad = Pick<DeliveryLoad, "id" | "serviceDate" | "originOplocId" | "destinationOplocId" | "destinationLabelSnapshot" | "scheduledTime" | "scheduledEnd" | "collectionRequired" | "collectionScheduledTime" | "collectionScheduledEnd" | "collectionRunId" | "loaded" | "status" | "driverId" | "vehicleId" | "runId"> & { loadIds?: string[]; jobs: Array<Pick<LogisticsJob, "id" | "sourceType" | "sourceId" | "collectionStatus" | "productionReadiness" | "contents" | "notes"> & { totalUnits: number }>; jobCount: number; totalUnits: number; collectedCount: number; readiness: "ready" | "attention" | "awaiting_collection" };
export type LogisticsProjectionState = "CURRENT" | "STALE" | "PARTIAL" | "UNAVAILABLE" | "MISSING" | "VALID_EMPTY";
export type LogisticsProjectionCompleteness = { fulfilment: "complete" | "unavailable"; cpu: "complete" | "unavailable" | "not_required"; oploc: "complete" | "unavailable" };
export type LogisticsDayProjection = { serviceDate: string; revision: number; lastChangeSequence: number; state?: LogisticsProjectionState; completeness?: LogisticsProjectionCompleteness; sourceVersions?: { fulfilment?: string; cpu?: string; oplocManifest?: number }; reconciliation?: { status: "never" | "current" | "pending" | "failed"; checkedAt?: string; errorCode?: string }; planningQueue: LogisticsProjectionJob[]; deliveryLoads: LogisticsProjectionLoad[]; runs: Array<Pick<DeliveryRun, "canonicalId" | "status" | "driverId" | "driverLabel" | "vehicleLabel">>; exceptions: string[]; summary: { queuedJobs: number; loads: number; assignedJobs: number; collectedJobs: number }; rebuiltAt: string };
