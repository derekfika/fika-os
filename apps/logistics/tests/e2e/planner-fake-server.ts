import type { Page } from "@playwright/test";
import { emptyRunRetirementBlocker, validateRunStopOrder } from "../../lib/run-stop-order";

/**
 * A stateful, response-shaped stand-in for /api/logistics used by LOCAL browser UAT only.
 * It mirrors the domain rules the real route enforces (run versions, exact-permutation stop
 * order, empty-run retirement, planning-open runs) so persistence across refresh and
 * stale/failed mutations can be exercised through the mounted app. It is NOT the authority:
 * the same commands are covered against the real route by tests/api.integration.ts (emulator).
 */
const stamp = "2026-10-22T08:00:00.000Z";
const pad = (value: number) => String(value).padStart(2, "0");

export type FakeJob = { id: string; destination: string; oploc: string; what: string; quantity: number; unit: string; runId?: string; time?: string; requestedStart?: string };
export type FakeMovement = { id: string; type: "collection" | "delivery" | "transfer"; destination: string; oploc: string; what: string; quantity: number; unit?: string; runId?: string; time?: string; assignedAt?: number };
export type FakeRun = { id: string; vehicleId: "van1" | "van2"; status: "draft" | "planned" | "ready" | "dispatched" | "completed"; dep?: string; ret?: string; version: number; orderedStopIds: string[]; retired?: boolean };
export type FakeState = { serviceDate: string; revision: number; runs: FakeRun[]; jobs: FakeJob[]; movements: FakeMovement[]; clock: number };
export type FailureRule = { action: string; status: number; message: string; once?: boolean };
export type FakeOptions = { serviceDate: string; runs?: Partial<FakeRun>[]; jobs?: FakeJob[]; movements?: FakeMovement[] };

export function ownerSeed(serviceDate = "2026-10-28"): FakeOptions {
  const job = (n: number, destination: string, what: string, quantity: number, unit: string): FakeJob => ({ id: `job:${n}`, destination, oploc: `site:${n}`, what, quantity, unit });
  return {
    serviceDate,
    runs: [
      { id: `run:${serviceDate}:van-1`, vehicleId: "van1", status: "draft" }, { id: `run:${serviceDate}:van-2`, vehicleId: "van2", status: "draft" },
    ],
    jobs: [job(1, "Market Hall", "Hot lunch trays", 8, "trays"), job(2, "Studio Café", "Sandwich platters", 9, "trays"), job(3, "Harbour House", "Breakfast boxes", 12, "boxes"), job(4, "North Kitchen", "Pastry boxes", 6, "boxes")],
    movements: [{ id: "movement:1", type: "collection", destination: "Riverside Centre", oploc: "site:r", what: "Empty insulated crates", quantity: 4 }],
  };
}

export class FakeLogisticsServer {
  state: FakeState;
  commands: Record<string, unknown>[] = [];
  failures: FailureRule[] = [];
  constructor(options: FakeOptions) {
    this.state = {
      serviceDate: options.serviceDate, revision: 10, clock: 0, jobs: structuredClone(options.jobs || []), movements: structuredClone(options.movements || []),
      runs: (options.runs || []).map((run, index) => ({ id: run.id || `run:${options.serviceDate}:seed-${index}`, vehicleId: run.vehicleId || "van1", status: run.status || "draft", version: run.version ?? 1, orderedStopIds: run.orderedStopIds || [], ...(run.dep ? { dep: run.dep, ret: run.ret } : {}), ...(run.retired ? { retired: true } : {}) })),
    };
  }
  run(id: string) { return this.state.runs.find((run) => run.id === id && !run.retired); }
  /** Another operator changes the run: any in-flight expectedRunVersion becomes stale. */
  interfere(runId: string) { const run = this.run(runId); if (run) { run.version += 1; this.state.revision += 1; } }
  failNext(rule: FailureRule) { this.failures.push({ once: true, ...rule }); }

  /**
   * Native stops mirror planning.combineStop: movements assigned to the same Run at the same OPLOC
   * share ONE physical stop (a mixed delivery + collection visit), identified by its first movement.
   */
  private nativeGroups() {
    const groups = new Map<string, FakeMovement[]>();
    for (const movement of [...this.state.movements].filter((item) => item.runId && this.run(item.runId)).sort((a, b) => (a.assignedAt || 0) - (b.assignedAt || 0))) {
      const key = `${movement.runId}|${movement.oploc}`;
      groups.set(key, [...(groups.get(key) || []), movement]);
    }
    return [...groups.values()];
  }
  private nativeStops() {
    return this.nativeGroups().map((group) => ({
      canonicalId: `stop:${group[0].id}`, runId: group[0].runId!, sequence: 1, locationOplocId: group[0].oploc, locationLabelSnapshot: group[0].destination,
      requirementRefs: [], movementRequestIds: group.map((item) => item.id), plannedArrivalTime: group.map((item) => item.time).filter(Boolean).sort()[0], movementType: group[0].type, status: "planned", version: 1, createdAt: stamp, updatedAt: stamp, audit: [],
    }));
  }
  private loadFor(job: FakeJob) {
    const id = `load:${job.id}`;
    return {
      id, serviceDate: this.state.serviceDate, originOplocId: "cpu-main", destinationOplocId: job.oploc, destinationLabelSnapshot: job.destination, scheduledTime: job.time!, status: "planned", vehicleId: this.run(job.runId!)!.vehicleId, runId: job.runId!, version: 3,
      loadVersions: { [id]: 3 }, loadIds: [id], jobs: [{ id: job.id, requirementId: `fulfilment:${job.id}`, sourceVersion: 1, version: 2, sourceType: "cpu-production", sourceId: `production:${job.id}`, serviceDate: this.state.serviceDate, originOplocId: "cpu-main", destinationOplocId: job.oploc, destinationLabelSnapshot: job.destination, productionReadiness: "ready", deliveryStatus: "pending", collectionStatus: "awaiting", workstream: "CPU production", contents: [{ description: job.what, quantity: job.quantity, unit: job.unit }], totalUnits: job.quantity, assignedLoadId: id }],
      jobCount: 1, totalUnits: job.quantity, collectedCount: 0, readiness: "ready",
    };
  }
  /** Mirrors buildLogisticsDayProjection: loads sharing one placement (run + OPLOC + time) are ONE projected stop. */
  private mergedLoads(assigned: FakeJob[]) {
    const groups = new Map<string, FakeJob[]>();
    for (const job of assigned) groups.set(`${job.runId}|${job.oploc}|${job.time}`, [...(groups.get(`${job.runId}|${job.oploc}|${job.time}`) || []), job]);
    return [...groups.values()].map((jobs) => {
      const loads = jobs.map((job) => this.loadFor(job));
      const [first] = loads;
      return { ...first, loadIds: loads.map((load) => load.id), loadVersions: Object.fromEntries(loads.map((load) => [load.id, 3])), jobs: loads.flatMap((load) => load.jobs), jobCount: loads.length, totalUnits: loads.reduce((sum, load) => sum + load.totalUnits, 0) };
    });
  }
  private queueJob(job: FakeJob) {
    return { id: job.id, requirementId: `fulfilment:${job.id}`, sourceVersion: 1, version: 1, sourceType: "cpu-production", sourceId: `production:${job.id}`, serviceDate: this.state.serviceDate, originOplocId: "cpu-main", destinationOplocId: job.oploc, destinationLabelSnapshot: job.destination, ...(job.requestedStart ? { requestedWindow: { startTime: job.requestedStart } } : {}), productionReadiness: "ready", deliveryStatus: "pending", collectionStatus: "awaiting", workstream: "CPU production", contents: [{ description: job.what, quantity: job.quantity, unit: job.unit }], totalUnits: job.quantity };
  }
  projection() {
    const { serviceDate } = this.state;
    const runs = this.state.runs.filter((run) => !run.retired).map((run) => ({
      canonicalId: run.id, vehicleId: run.vehicleId, vehicleLabel: run.vehicleId === "van1" ? "Van 1" : "Van 2", serviceDate, status: run.status, version: run.version, returnToCpuRequired: true,
      orderedStopIds: run.orderedStopIds, createdAt: stamp, updatedAt: stamp, audit: [], ...(run.dep ? { plannedCpuDepartureTime: run.dep, plannedCpuReturnTime: run.ret } : {}),
    }));
    const assigned = this.state.jobs.filter((job) => job.runId && this.run(job.runId));
    const queue = this.state.jobs.filter((job) => !job.runId || !this.run(job.runId));
    const movements = this.state.movements.map((movement) => ({
      canonicalId: movement.id, entityType: "Movement Request", type: movement.type, serviceDate, fromOplocId: "cpu-main", fromLabelSnapshot: "CPU Main Kitchen", toOplocId: movement.oploc, toLabelSnapshot: movement.destination,
      items: [{ description: movement.what, quantity: movement.quantity, unit: movement.unit || "crates" }], createdBy: "fixture:planner", status: movement.runId && this.run(movement.runId) ? "planned" : "open", version: 2, createdAt: stamp, updatedAt: stamp, audit: [],
    }));
    return {
      serviceDate, revision: this.state.revision, lastChangeSequence: this.state.revision, state: "CURRENT", completeness: { fulfilment: "complete", cpu: "complete", oploc: "complete" },
      planningQueue: queue.map((job) => this.queueJob(job)), deliveryLoads: this.mergedLoads(assigned), runs, stops: this.nativeStops(), movements, exceptions: [],
      summary: { queuedJobs: queue.length, loads: assigned.length, assignedJobs: assigned.length, collectedJobs: 0 }, rebuiltAt: stamp,
    };
  }
  weekSummary(monday: string) {
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(`${monday}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + index);
      const date = day.toISOString().slice(0, 10);
      const here = date === this.state.serviceDate;
      return { serviceDate: date, projectionState: "CURRENT", loads: here ? this.state.jobs.filter((job) => job.runId && this.run(job.runId)).length : 0, scheduled: 0, queue: here ? this.state.jobs.filter((job) => !job.runId).length : 0, needsTime: 0, attention: 0 };
    });
  }

  private reject(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
  private bump() { this.state.revision += 1; }
  private requireRun(id: unknown, expected: unknown) {
    const run = typeof id === "string" ? this.run(id) : undefined;
    if (!run) this.reject(404, "Run not found.");
    if (run.version !== expected) this.reject(409, "This run changed elsewhere. Refresh before changing it.");
    return run;
  }
  private groupKey = (load: { destinationOplocId?: string; scheduledTime?: string }) => `${load.destinationOplocId}|${load.scheduledTime}`;
  private work(run: FakeRun) {
    const native = this.nativeStops().filter((stop) => stop.runId === run.id).map((stop) => ({ canonicalId: stop.canonicalId, canonicalLoadIds: [] as string[] }));
    const legs = this.state.jobs.filter((job) => job.runId === run.id).map((job) => ({ load: this.loadFor(job) as never, lane: "delivery" as const }));
    return { native, legs };
  }
  /** Applies one command. Returns the JSON body, or throws {status,message}. */
  apply(body: Record<string, any>) {
    this.commands.push(body);
    const rule = this.failures.findIndex((item) => item.action === body.action);
    if (rule >= 0) { const [failure] = this.failures.splice(rule, 1); this.reject(failure.status, failure.message); }
    const { state } = this;
    switch (body.action) {
      case "ensure-vehicle-day-runs": return { changed: false };
      case "save-movement": {
        const requested = body.movement;
        const oploc = requested.fromOplocId || requested.toOplocId;
        if (!oploc || !requested.items?.[0]?.description || !(requested.items[0].quantity >= 1)) this.reject(422, "A movement needs a governed location and an item with quantity.");
        const destination = state.jobs.find((job) => job.oploc === oploc)?.destination || oploc;
        state.movements.push({ id: requested.canonicalId, type: requested.type, destination, oploc, what: requested.items[0].description, quantity: requested.items[0].quantity, unit: requested.items[0].unit });
        this.bump();
        return { movement: requested };
      }
      case "create-run": {
        const requested = body.run;
        if (state.runs.some((run) => run.id === requested.canonicalId)) this.reject(409, "This run already exists. Refresh before creating another run.");
        if (Boolean(requested.plannedCpuDepartureTime) !== Boolean(requested.plannedCpuReturnTime)) this.reject(422, "Set both planned CPU times, or clear both.");
        if (requested.plannedCpuDepartureTime && requested.plannedCpuDepartureTime >= requested.plannedCpuReturnTime) this.reject(422, "Planned CPU return must be later than departure on the service date.");
        state.runs.push({ id: requested.canonicalId, vehicleId: requested.vehicleId, status: "draft", version: 1, orderedStopIds: [], ...(requested.plannedCpuDepartureTime ? { dep: requested.plannedCpuDepartureTime, ret: requested.plannedCpuReturnTime } : {}) });
        this.bump();
        return { canonicalId: requested.canonicalId, version: 1 };
      }
      case "update-run-timing": {
        const run = this.requireRun(body.runId, body.expectedRunVersion);
        if (!["draft", "planned"].includes(run.status)) this.reject(422, "Journey times cannot change after a run is marked ready or departs.");
        if (body.plannedCpuDepartureTime >= body.plannedCpuReturnTime) this.reject(422, "Planned CPU return must be later than departure on the service date.");
        run.dep = body.plannedCpuDepartureTime; run.ret = body.plannedCpuReturnTime; run.version += 1; this.bump();
        return { canonicalId: run.id, version: run.version };
      }
      case "assign-job-to-load": {
        const job = state.jobs.find((item) => item.id === body.jobId);
        const run = this.run(body.targetRunId);
        if (!job || !run) this.reject(404, "Job or run not found.");
        if (!["draft", "planned"].includes(run.status)) this.reject(422, `Run is ${run.status}; return it to planning before changing assignments.`);
        const time = body.scheduledTime || job.requestedStart;
        if (!time) this.reject(422, "A scheduled arrival is required.");
        job.runId = run.id; job.time = time; if (run.status === "draft") run.status = "planned"; run.version += 1; this.bump();
        return { id: `load:${job.id}` };
      }
      case "remove-job-from-load": {
        const job = state.jobs.find((item) => item.id === body.jobId);
        if (!job?.runId) this.reject(404, "That job is not assigned.");
        const run = this.run(job.runId)!;
        if (!["draft", "planned"].includes(run.status)) this.reject(422, "Return the run to planning first.");
        delete job.runId; delete job.time; run.version += 1; this.bump();
        return { ok: true };
      }
      case "reschedule-delivery-load": case "reschedule-delivery-loads": {
        const ids: string[] = body.loadIds || [body.loadId];
        const target = this.run(body.targetRunId);
        if (!target || !["draft", "planned"].includes(target.status)) this.reject(422, "The target run is not open for planning.");
        for (const id of ids) {
          const job = state.jobs.find((item) => `load:${item.id}` === id);
          if (!job) this.reject(404, "Delivery load not found.");
          const from = this.run(job.runId!); if (from) from.version += 1;
          job.runId = target.id; if (body.scheduledTime) job.time = body.scheduledTime;
        }
        target.version += 1; if (target.status === "draft") target.status = "planned"; this.bump();
        return { id: ids[0] };
      }
      case "assign": {
        const movement = state.movements.find((item) => item.id === body.movementId);
        const run = this.requireRun(body.runId, body.expectedRunVersion);
        if (!movement) this.reject(404, "Movement not found.");
        if (!["draft", "planned"].includes(run.status)) this.reject(422, "Run is not open for planning.");
        const existing = state.movements.find((item) => item.runId === run.id && item.oploc === movement.oploc);
        movement.runId = run.id; movement.time = body.plannedArrivalTime; movement.assignedAt = ++state.clock;
        if (!existing) run.orderedStopIds.push(`stop:${movement.id}`);
        if (run.status === "draft") run.status = "planned"; run.version += 1; this.bump();
        return { ok: true };
      }
      case "return-stop-to-planning": {
        const run = this.requireRun(body.runId, body.expectedRunVersion);
        const group = this.nativeGroups().find((items) => `stop:${items[0].id}` === body.stopId);
        if (!group) this.reject(404, "Stop not found.");
        for (const movement of group) { delete movement.runId; delete movement.time; delete movement.assignedAt; }
        run.orderedStopIds = run.orderedStopIds.filter((id) => id !== body.stopId); run.version += 1; this.bump();
        return { ok: true };
      }
      case "set-run-stop-order": {
        const run = this.requireRun(body.runId, body.expectedRunVersion);
        if (!["draft", "planned"].includes(run.status)) this.reject(422, `Run is ${run.status}; return it to planning before changing its structure.`);
        const problem = validateRunStopOrder(body.stopIds, this.work(run), this.groupKey as never);
        if (problem) this.reject(422, problem);
        if (JSON.stringify(run.orderedStopIds) !== JSON.stringify(body.stopIds)) { run.orderedStopIds = body.stopIds; run.version += 1; this.bump(); }
        return { canonicalId: run.id, version: run.version };
      }
      case "retire-empty-run": {
        const run = this.requireRun(body.runId, body.expectedRunVersion);
        const blocker = emptyRunRetirementBlocker({ status: run.status, orderedStopIds: run.orderedStopIds }, this.work(run));
        if (blocker) this.reject(422, blocker);
        run.retired = true; run.version += 1; this.bump();
        return { canonicalId: run.id, version: run.version };
      }
      case "mark-run-ready": { const run = this.requireRun(body.runId, body.expectedRunVersion); run.status = "ready"; run.version += 1; this.bump(); return { canonicalId: run.id }; }
      default: return { ok: true, changed: false };
    }
  }
}

export async function installStatefulApi(page: Page, server: FakeLogisticsServer, issues?: { network: string[] }) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill({ json: { permittedVehicleIds: ["van1", "van2"] } });
    if (url.pathname === "/api/logistics/locations") return route.fulfill({ json: { oplocs: [{ id: "cpu-main", label: "CPU Main Kitchen" }] } });
    if (url.pathname !== "/api/logistics") { issues?.network.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 404, json: { error: "Unexpected endpoint in fixture" } }); }
    if (request.method() === "POST") {
      try { return await route.fulfill({ status: 200, json: server.apply(request.postDataJSON() as Record<string, any>) }); }
      catch (error) { const failure = error as { status?: number; message: string }; if (failure.status === 0) return route.abort("connectionreset"); return route.fulfill({ status: failure.status || 500, json: { error: failure.message } }); }
    }
    const params = url.searchParams;
    if (params.has("syncHead")) return route.fulfill({ json: { sequence: server.state.revision } });
    if (params.has("weekSummary")) return route.fulfill({ json: { weekCommencing: params.get("weekCommencing"), days: server.weekSummary(params.get("weekCommencing") || "2026-10-26") } });
    if (params.has("planningAttention")) return route.fulfill({ json: { attention: [] } });
    const projection = server.projection();
    if (params.has("changesSince")) return route.fulfill({ json: { hasMore: false, nextCursor: server.state.revision, projection } });
    return route.fulfill({ json: { projection, projectionState: "CURRENT" } });
  });
}
void pad;
