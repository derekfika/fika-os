import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import type { FulfilmentWorkstream } from "../../shared/fulfilment-workstream";

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
export type RequirementRef = { requirementId: string; sourceVersion: number; sourceDomain?: FulfilmentRequirement["sourceDomain"]; workstream?: FulfilmentWorkstream };
export type DeliveryStop = {
  /** Stable identity for a one-off movement endpoint; never derived from address text. */
  oneOffEndpointId?: string;
  canonicalLoadIds?: string[];
  canUndoCompletion?: boolean;
  collectedRequirementIds?: string[];
  completionSnapshot?: { status: "planned" | "arrived"; loaded?: boolean; loadedRequirementIds?: string[]; deliveredRequirementIds?: string[]; collectedRequirementIds?: string[] };
  canonicalLoadVersions?: Record<string, number>;
  canonicalJobVersions?: Record<string, number>;
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
  vehicleId?: import("../../shared/logistics-authority").LogisticsVehicleId;
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
  requirementId?: string;
  sourceStatus?: FulfilmentRequirement["status"];
  /** Transactional job lock and current assignment pointer; legacy rows are read on demand. */
  activeLoadId?: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: number;
  sourceContentHash?: string;
  workstream?: FulfilmentWorkstream;
  serviceDate: string;
  originOplocId?: string;
  destinationOplocId?: string;
  destinationLabelSnapshot?: string;
  requestedWindow?: { startTime: string; endTime?: string };
  productionReadiness: "pending" | "ready" | "attention";
  deliveryStatus?: "pending" | "loaded" | "delivered";
  deliveredAt?: string;
  collectionStatus: "awaiting" | "collected";
  contents: { description: string; quantity: number; unit: string }[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  audit: { action: string; at: string; by: string; version: number }[];
};

export type LoadLegExecution = { arrivedAt?: string; issues?: StopIssue[]; completion?: { id: string; jobs: Record<string, { deliveryStatus: "pending" | "loaded" | "delivered"; collectionStatus: "awaiting" | "collected"; deliveredAt?: string; version: number }> } };

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
  deliveryExecution?: LoadLegExecution;
  collectionExecution?: LoadLegExecution;
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
  entityType: "logisticsJob" | "deliveryLoad" | "assignment" | "run" | "stop" | "movement" | "upstream";
  entityId: string;
  changeType: string;
  revision: number;
  changedAt: string;
  actorId: string;
  relatedEntityId?: string;
};

export type LogisticsProjectionJob = Pick<LogisticsJob, "sourceVersion" | "requirementId" | "id" | "sourceType" | "sourceId" | "serviceDate" | "originOplocId" | "destinationOplocId" | "destinationLabelSnapshot" | "requestedWindow" | "productionReadiness" | "deliveryStatus" | "collectionStatus" | "contents" | "notes" | "workstream"> & { version?: number; totalUnits: number; assignedLoadId?: string };
export type LogisticsProjectionLoad = Pick<DeliveryLoad, "id" | "serviceDate" | "originOplocId" | "destinationOplocId" | "destinationLabelSnapshot" | "scheduledTime" | "scheduledEnd" | "collectionRequired" | "collectionScheduledTime" | "collectionScheduledEnd" | "collectionRunId" | "loaded" | "status" | "driverId" | "vehicleId" | "runId" | "deliveryExecution" | "collectionExecution"> & { version?: number; loadVersions?: Record<string, number>; loadIds?: string[]; jobs: Array<Pick<LogisticsJob, "sourceVersion" | "requirementId" | "version" | "id" | "sourceType" | "sourceId" | "collectionStatus" | "deliveryStatus" | "productionReadiness" | "contents" | "notes" | "workstream"> & { totalUnits: number }>; jobCount: number; totalUnits: number; collectedCount: number; readiness: "ready" | "attention" | "awaiting_collection" };
export type LogisticsProjectionRun = Pick<DeliveryRun, "canonicalId" | "status" | "driverId" | "driverLabel" | "vehicleLabel" | "vehicleId"> & Partial<Pick<DeliveryRun, "serviceDate" | "returnToCpuRequired" | "returnToCpuPending" | "returnedToCpuAt" | "returnedToCpuBy" | "orderedStopIds" | "version" | "createdAt" | "updatedAt" | "audit">>;
export type LogisticsProjectionState = "CURRENT" | "STALE" | "PARTIAL" | "UNAVAILABLE" | "MISSING" | "VALID_EMPTY";
export type LogisticsProjectionCompleteness = { fulfilment: "complete" | "unavailable"; cpu: "complete" | "unavailable" | "not_required"; oploc: "complete" | "unavailable" };
export type LogisticsSourceLineage = { sourceDomain: string; sourceEntityId: string; sourceVersion: number; sourceContentHash?: string; changedAt?: string };
export type LogisticsDayProjection = { serviceDate: string; revision: number; lastChangeSequence: number; state?: LogisticsProjectionState; completeness?: LogisticsProjectionCompleteness; sourceVersions?: { fulfilment?: string; cpu?: string; oplocManifest?: number }; sourceLineage?: LogisticsSourceLineage[]; reconciliation?: { status: "never" | "current" | "pending" | "failed"; checkedAt?: string; errorCode?: string }; planningQueue: LogisticsProjectionJob[]; deliveryLoads: LogisticsProjectionLoad[]; runs: LogisticsProjectionRun[]; stops?: DeliveryStop[]; movements?: MovementRequest[]; collectionRequiredKeys?: string[]; exceptions: string[]; summary: { queuedJobs: number; loads: number; assignedJobs: number; collectedJobs: number }; rebuiltAt: string };
