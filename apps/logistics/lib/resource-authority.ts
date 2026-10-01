import { LOGISTICS_VEHICLE_IDS, isLogisticsVehicleId, type LogisticsMaintenanceAuthority } from "../../shared/logistics-authority";
import type { LogisticsPrincipal } from "./auth";
import type { DeliveryLoad, DeliveryRun, DeliveryStop, LogisticsDayProjection, LogisticsProjectionLoad, LogisticsProjectionRun } from "./types";

export class LogisticsAuthorityError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const denied = () => new LogisticsAuthorityError(403, "LOGISTICS_RESOURCE_DENIED", "Logistics resource access denied.");
const integrity = () => new LogisticsAuthorityError(409, "LOGISTICS_VEHICLE_IDENTITY_REQUIRED", "Vehicle identity needs administrator review before this resource can be used.");

export function vehicleScope(principal: LogisticsPrincipal, requestedVehicle?: string | null) {
  const ids = principal.permittedVehicleIds;
  if (!Array.isArray(ids) || !ids.length || !ids.every(isLogisticsVehicleId)) throw denied();
  if (requestedVehicle && (!isLogisticsVehicleId(requestedVehicle) || !ids.includes(requestedVehicle))) throw denied();
  return requestedVehicle ? [requestedVehicle] : [...new Set(ids)];
}
export function assertSharedPlannerAccess(principal: LogisticsPrincipal) {
  if (!LOGISTICS_VEHICLE_IDS.every(id => vehicleScope(principal).includes(id))) throw denied();
}
export function assertMaintenanceAccess(principal: LogisticsPrincipal, authority: LogisticsMaintenanceAuthority) {
  if (!principal.maintenanceAuthorities?.includes(authority)) throw denied();
}
export function authorizeRun(principal: LogisticsPrincipal, run: Pick<DeliveryRun, "vehicleId">) {
  if (!isLogisticsVehicleId(run.vehicleId)) throw integrity();
  if (!vehicleScope(principal).includes(run.vehicleId)) throw denied();
  return run.vehicleId;
}
export async function authorizeLoad(principal: LogisticsPrincipal, load: Pick<DeliveryLoad, "vehicleId" | "runId" | "collectionRunId">, getRun: (id: string) => Promise<Pick<DeliveryRun, "vehicleId"> | undefined>) {
  if (load.vehicleId !== undefined && !isLogisticsVehicleId(load.vehicleId)) throw integrity();
  const delivery = load.runId ? await getRun(load.runId) : undefined;
  const collection = load.collectionRunId ? await getRun(load.collectionRunId) : undefined;
  if (load.runId && !delivery || load.collectionRunId && !collection) throw integrity();
  if (delivery && load.vehicleId && delivery.vehicleId !== load.vehicleId) throw integrity();
  if (delivery) authorizeRun(principal, delivery);
  if (collection) authorizeRun(principal, collection);
  if (load.vehicleId) authorizeRun(principal, { vehicleId: load.vehicleId });
  if (!delivery && !collection && !load.vehicleId) assertSharedPlannerAccess(principal);
}

/** Omitted context means permitted union; only both-vehicle principals see shared queue work.
 * Mixed-vehicle loads are withheld unless all their referenced vehicles are in scope.
 * Unknown legacy identity is quarantined, never inferred from labels or run IDs.
 */
export function scopeProjection(projection: LogisticsDayProjection, principal: LogisticsPrincipal, requestedVehicle?: string | null): LogisticsDayProjection {
  const allowed = vehicleScope(principal, requestedVehicle);
  const organisation = LOGISTICS_VEHICLE_IDS.every(id => allowed.includes(id));
  const allRuns = new Map(projection.runs.map(run => [run.canonicalId, run]));
  const visibleRun = (run?: LogisticsProjectionRun) => Boolean(run && isLogisticsVehicleId(run.vehicleId) && allowed.includes(run.vehicleId));
  const runs = projection.runs.filter(run => visibleRun(run));
  const runIds = new Set(runs.map(run => run.canonicalId));
  const visibleLoad = (load: LogisticsProjectionLoad) => {
    if (load.vehicleId !== undefined && (!isLogisticsVehicleId(load.vehicleId) || !allowed.includes(load.vehicleId))) return false;
    const delivery = load.runId ? allRuns.get(load.runId) : undefined;
    const collection = load.collectionRunId ? allRuns.get(load.collectionRunId) : undefined;
    if (load.runId && !visibleRun(delivery) || load.collectionRunId && !visibleRun(collection)) return false;
    if (delivery && load.vehicleId && delivery.vehicleId !== load.vehicleId) return false;
    return Boolean(load.runId || load.collectionRunId || load.vehicleId) || organisation;
  };
  const deliveryLoads = projection.deliveryLoads.filter(visibleLoad);
  const stops = (projection.stops || []).filter(stop => runIds.has(stop.runId) && (!stop.linkedStopId || !(projection.stops || []).some(link => link.canonicalId === stop.linkedStopId && !runIds.has(link.runId))) && !(stop.movementRequestIds || []).some(id => (projection.stops || []).some(other => (other.movementRequestIds || []).includes(id) && !runIds.has(other.runId))));
  const movementIds = new Set(stops.flatMap(stop => stop.movementRequestIds || []));
  const movements = (projection.movements || []).filter(item => organisation || movementIds.has(item.canonicalId));
  const planningQueue = organisation ? projection.planningQueue : [];
  // Lineage, exceptions and preference keys can contain out-of-scope entity IDs.
  return { ...projection, runs: runs.map(run => ({ ...run, orderedStopIds: (run.orderedStopIds || []).filter(id => stops.some(stop => stop.canonicalId === id)), audit: [] })), stops, deliveryLoads, movements, planningQueue,
    sourceLineage: organisation ? projection.sourceLineage : [], exceptions: organisation ? projection.exceptions : [], collectionRequiredKeys: organisation ? projection.collectionRequiredKeys : [],
    summary: { queuedJobs: planningQueue.length, loads: deliveryLoads.length, assignedJobs: deliveryLoads.reduce((n, load) => n + load.jobCount, 0), collectedJobs: deliveryLoads.reduce((n, load) => n + load.collectedCount, 0) } };
}

export type ResourceReader = {
  run(id: string): Promise<DeliveryRun | undefined>;
  stop(id: string): Promise<DeliveryStop | undefined>;
  load(id: string): Promise<DeliveryLoad | undefined>;
  jobLoads(id: string): Promise<DeliveryLoad[]>;
};
export async function authorizeCommand(principal: LogisticsPrincipal, body: Record<string, any>, reader: ResourceReader) {
  const maintenance: Record<string, LogisticsMaintenanceAuthority> = { "reset-planning-day": "logistics.reset", "repair-logistics-assignment-dates": "logistics.repair", "repair-run-vehicle-identity": "logistics.repair", "rebuild-logistics-projection": "logistics.reconcile", "reconcile-logistics-day": "logistics.reconcile", "save-logistics-job": "logistics.reconcile" };
  if (maintenance[body.action]) { assertMaintenanceAccess(principal, maintenance[body.action]); return; }
  vehicleScope(principal);
  const missing = () => new LogisticsAuthorityError(404, "LOGISTICS_RESOURCE_NOT_FOUND", "Logistics resource not found.");
  const checkRun = async (id: string) => { const run = await reader.run(id); if (!run) throw missing(); authorizeRun(principal, run); };
  const checkLoad = async (id: string) => { const load = await reader.load(id); if (!load) throw missing(); await authorizeLoad(principal, load, reader.run); };
  for (const id of [...new Set([body.runId, body.sourceRunId, body.targetRunId, body.collectionRunId, body.action === "update-run" ? body.run?.canonicalId : undefined].filter(Boolean))] as string[]) await checkRun(id);
  if (body.action === "create-run") authorizeRun(principal, body.run || {});
  if (body.run?.vehicleId) authorizeRun(principal, body.run);
  if (body.loadId) await checkLoad(body.loadId);
  for (const id of [...new Set([body.stopId, body.stop?.canonicalId, ...(body.stopIds || [])].filter(Boolean))] as string[]) {
    if (id.startsWith("projection-stop:")) { await checkLoad(id.split(":").slice(2).join(":")); continue; }
    const stop = await reader.stop(id);
    if (!stop) throw missing();
    await checkRun(stop.runId);
    if (stop.linkedStopId) { const linked = await reader.stop(stop.linkedStopId); if (!linked) throw missing(); await checkRun(linked.runId); }
  }
  if (body.jobId || body.job?.id) {
    const loads = await reader.jobLoads(body.jobId || body.job.id);
    for (const load of loads) await authorizeLoad(principal, load, reader.run);
    if (!loads.length && !body.targetRunId) assertSharedPlannerAccess(principal);
    // A supplied job snapshot can affect shared upstream-derived state.
    if (body.job) assertSharedPlannerAccess(principal);
  }
  if (["save-movement", "set-collection-required"].includes(body.action)) assertSharedPlannerAccess(principal);
}
