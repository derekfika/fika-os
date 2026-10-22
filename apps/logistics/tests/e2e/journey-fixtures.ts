import type { Page } from "@playwright/test";

/**
 * Labelled, clearly synthetic LOCAL fixtures for desktop Journey Planner UAT.
 * They mimic the shape of the real /api/logistics projection response but never
 * touch staging or production records. Authenticated staging UAT is separate.
 */
const stamp = "2026-10-22T08:00:00.000Z";

export type FixtureRun = { key: string; vehicleId: "van1" | "van2"; dep?: string; ret?: string; driver?: string; stopsFor?: number };
export type FixtureOptions = {
  serviceDate: string;
  runs: FixtureRun[];
  /** Number of loads already assigned and scheduled onto runs. */
  loads?: number;
  /** Number of unassigned queue jobs. */
  queue?: number;
  /** Include a mixed delivery + collection stop on the first run. */
  mixedStop?: boolean;
  /** Use long, real-world style destination and content labels to stress truncation/wrapping. */
  longLabels?: boolean;
};

/** Owner-observed staging state: Wed 28 Oct, 2 vans, 4 draft runs, 5 queue jobs, 0 scheduled stops. */
export const OWNER_SCENARIO: FixtureOptions = {
  serviceDate: "2026-10-28",
  runs: [
    { key: "van1-a", vehicleId: "van1" }, { key: "van1-b", vehicleId: "van1" },
    { key: "van2-a", vehicleId: "van2" }, { key: "van2-b", vehicleId: "van2" },
  ],
  queue: 5,
  loads: 0,
};

/** Real-response-shaped mix: overlapping + untimed runs, long names, uneven load spread. */
export const REALISTIC_RUNS: FixtureRun[] = [
  { key: "van1-am", vehicleId: "van1", dep: "06:00", ret: "10:30", driver: "A. Driver" },
  { key: "van1-overlap", vehicleId: "van1", dep: "09:30", ret: "12:00", driver: "A. Driver" },
  { key: "van2-am", vehicleId: "van2", dep: "07:15", ret: "11:45", driver: "B. Driver" },
  { key: "van2-draft", vehicleId: "van2" },
];

export const TIMED_RUNS: FixtureRun[] = [
  { key: "van1-am", vehicleId: "van1", dep: "06:30", ret: "09:30", driver: "A. Driver" },
  { key: "van1-pm", vehicleId: "van1", dep: "10:00", ret: "13:00", driver: "A. Driver" },
  { key: "van2-am", vehicleId: "van2", dep: "06:45", ret: "09:45", driver: "B. Driver" },
  { key: "van2-pm", vehicleId: "van2", dep: "10:15", ret: "13:45", driver: "B. Driver" },
];

const LONG_SITES = [
  "Riverside Centre for Community Wellbeing and Learning (Main Entrance, Loading Bay 2)", "North Kitchen & Staff Restaurant, Building C", "Harbour House Conference & Events Suite",
  "Market Hall Food Court — Concession Unit 14", "Studio Café at The Old Print Works Creative Quarter", "Garden Room, Orchard Lodge Hotel and Spa", "The Glasshouse at Kew Road Business Park",
];
const SITES = ["Riverside Centre", "North Kitchen", "Harbour House", "Market Hall", "Studio Café", "Garden Room", "The Glasshouse"];
const pad = (value: number) => String(value).padStart(2, "0");

export function buildProjection(options: FixtureOptions) {
  const { serviceDate } = options;
  const runs = options.runs.map((run, index) => ({
    canonicalId: `run:${serviceDate}:${run.key}`,
    vehicleId: run.vehicleId, vehicleLabel: run.vehicleId === "van1" ? "Van 1" : "Van 2",
    ...(run.driver ? { driverId: `driver:${run.driver}`, driverLabel: run.driver } : {}),
    ...(run.dep ? { plannedCpuDepartureTime: run.dep } : {}),
    ...(run.ret ? { plannedCpuReturnTime: run.ret } : {}),
    serviceDate, status: run.dep ? "planned" : "draft", version: 1 + index, returnToCpuRequired: true,
    orderedStopIds: [] as string[], createdAt: stamp, updatedAt: stamp, audit: [],
  }));
  const loadCount = options.loads ?? 0;
  const assignable = runs.filter((run) => run.plannedCpuDepartureTime);
  const deliveryLoads = assignable.length ? Array.from({ length: loadCount }, (_, index) => {
    const perRun = Math.ceil(loadCount / assignable.length);
    const run = assignable[Math.floor(index / perRun) % assignable.length];
    const id = `load:${serviceDate}:${pad(index + 1)}`;
    const minutes = 7 * 60 + (index % perRun) * 30;
    const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    const label = (options.longLabels ? LONG_SITES : SITES)[index % SITES.length];
    return {
      id, serviceDate, originOplocId: "cpu-main", destinationOplocId: `site:${index + 1}`, destinationLabelSnapshot: label,
      scheduledTime: time, status: "planned", vehicleId: run.vehicleId, runId: run.canonicalId, version: 3,
      loadVersions: { [id]: 3 }, loadIds: [id], jobs: [{
        id: `job:${serviceDate}:${pad(index + 1)}`, requirementId: `fulfilment:${index + 1}`, sourceVersion: 2, version: 5,
        sourceType: "cpu-production", sourceId: `production:${index + 1}`, serviceDate, originOplocId: "cpu-main",
        destinationOplocId: `site:${index + 1}`, destinationLabelSnapshot: label, productionReadiness: "ready",
        deliveryStatus: "pending", collectionStatus: "awaiting", workstream: "CPU production",
        contents: [{ description: `Prepared menu ${index + 1}`, quantity: 4 + index % 5, unit: "trays" }],
        totalUnits: 4 + index % 5, assignedLoadId: id,
      }], jobCount: 1, totalUnits: 4 + index % 5, collectedCount: 0, readiness: "ready",
    };
  }) : [];
  const stops: Record<string, unknown>[] = [];
  const movements: Record<string, unknown>[] = [];
  if (options.mixedStop && deliveryLoads.length) {
    const first = deliveryLoads[0];
    const runId = first.runId;
    const movementIds = [`movement:${serviceDate}:delivery`, `movement:${serviceDate}:collection`];
    stops.push({
      canonicalId: `stop:${serviceDate}:mixed`, runId, sequence: 1, locationOplocId: "site:1", locationLabelSnapshot: "Riverside Centre",
      requirementRefs: [], movementRequestIds: movementIds, canonicalLoadIds: [first.id], canonicalLoadVersions: { [first.id]: 3 },
      plannedArrivalTime: first.scheduledTime, movementType: "delivery", status: "planned", version: 2, createdAt: stamp, updatedAt: stamp, audit: [],
    });
    runs.find((run) => run.canonicalId === runId)!.orderedStopIds.push(`stop:${serviceDate}:mixed`);
    for (const [index, type] of (["delivery", "collection"] as const).entries()) movements.push({
      canonicalId: movementIds[index], entityType: "Movement Request", type, serviceDate, fromOplocId: "cpu-main", fromLabelSnapshot: "CPU Main Kitchen",
      toOplocId: "site:1", toLabelSnapshot: "Riverside Centre", requiredTime: index ? "07:30" : "07:15",
      items: [{ description: index ? "Empty insulated crates" : "Additional chilled items", quantity: 2, unit: "crates" }],
      createdBy: "fixture:planner", status: "planned", version: 2, createdAt: stamp, updatedAt: stamp, audit: [],
    });
  }
  const queueCount = options.queue ?? 0;
  const planningQueue = Array.from({ length: queueCount }, (_, index) => ({
    id: `job:${serviceDate}:queue-${index + 1}`, requirementId: `fulfilment:${serviceDate}:queue-${index + 1}`, sourceVersion: 1, version: 1,
    sourceType: "cpu-production", sourceId: `production:${serviceDate}:queue-${index + 1}`, serviceDate, originOplocId: "cpu-main",
    destinationOplocId: `site:queue-${index + 1}`, destinationLabelSnapshot: (options.longLabels ? LONG_SITES : SITES)[(index + 3) % SITES.length],
    productionReadiness: "ready", deliveryStatus: "pending", collectionStatus: "awaiting", workstream: "CPU production",
    contents: [{ description: options.longLabels
      ? ["Assorted hot breakfast boxes incl. vegan and gluten-free options", "Seasonal hot lunch trays with sides", "Afternoon refreshments, hot drinks and biscuits", "Mixed sandwich platters (allergen labelled)", "Pastry and fruit boxes"][index % 5]
      : ["Unassigned breakfast boxes", "Hot lunch trays", "Afternoon refreshments", "Sandwich platters", "Pastry boxes"][index % 5], quantity: 8 + index, unit: ["boxes", "trays"][index % 2] }],
    totalUnits: 8 + index,
  }));
  return {
    serviceDate, revision: 18, lastChangeSequence: 40, state: "CURRENT",
    completeness: { fulfilment: "complete", cpu: "complete", oploc: "complete" },
    planningQueue, deliveryLoads, runs, stops, movements, exceptions: [],
    summary: { queuedJobs: queueCount, loads: loadCount, assignedJobs: loadCount, collectedJobs: 0 }, rebuiltAt: stamp,
  };
}

export type FixtureResolver = (serviceDate: string) => FixtureOptions;

/** Route-mocks every Logistics API call; returns the recorded POST commands. */
export async function installFixtureApi(page: Page, resolve: FixtureResolver, issues?: { network: string[] }) {
  const commands: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill({ json: { permittedVehicleIds: ["van1", "van2"] } });
    if (url.pathname === "/api/logistics/locations") return route.fulfill({ json: { oplocs: [{ id: "cpu-main", label: "CPU Main Kitchen" }, { id: "site:1", label: "Riverside Centre" }] } });
    if (url.pathname !== "/api/logistics") { issues?.network.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 404, json: { error: "Unexpected endpoint in fixture" } }); }
    if (request.method() === "POST") { commands.push(request.postDataJSON() as Record<string, unknown>); return route.fulfill({ status: 200, json: { ok: true, changed: false } }); }
    const params = url.searchParams;
    const date = params.get("serviceDate") || "2026-10-28";
    if (params.has("syncHead")) return route.fulfill({ json: { sequence: 40 } });
    if (params.has("weekSummary")) {
      const monday = params.get("weekCommencing") || "2026-10-26";
      const days = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(`${monday}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + index);
        const serviceDate = day.toISOString().slice(0, 10); const o = resolve(serviceDate);
        return { serviceDate, projectionState: "CURRENT", loads: o.loads ?? 0, scheduled: o.loads ?? 0, queue: o.queue ?? 0, needsTime: 0, attention: 0 };
      });
      return route.fulfill({ json: { weekCommencing: monday, days } });
    }
    if (params.has("planningAttention")) return route.fulfill({ json: { attention: [] } });
    const projection = buildProjection(resolve(date));
    if (params.has("changesSince")) return route.fulfill({ json: { hasMore: false, nextCursor: 40, projection } });
    return route.fulfill({ json: { projection, projectionState: "CURRENT" } });
  });
  return commands;
}
