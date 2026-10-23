/**
 * EXPLICITLY FICTIONAL preview fixtures for the Journey Planner V3 design preview.
 * None of this is Logistics data: names, sites and quantities are invented for visual review only
 * and must never be imported by the live planner.
 */
import type { InspectorStopView, PlannerViewModel, QueueItemView, RunInspectorView, RunRowView, SequenceChipView, StopPieceView, WorkKind } from "../../journey-planner/model";

export const SCENARIOS = ["full-day", "queue-7", "two-vans", "mixed-stop", "standalone-collection", "draft-run", "long-name", "busy", "empty", "loading", "error"] as const;
export type Scenario = (typeof SCENARIOS)[number];

type VisitSpec = { key: string; name: string; d: number; c: number; pieces?: StopPieceView[] };

const piece = (key: string, kind: WorkKind, title: string, detail: string, status?: string): StopPieceView => ({ key, kind, title, detail, status });

function chipsFor(visits: VisitSpec[]): SequenceChipView[] {
  return [
    { key: "cpu-out", kind: "cpu-departure", label: "CPU" },
    ...visits.map((visit): SequenceChipView => ({ key: visit.key, kind: "visit", stopKey: visit.key, label: visit.name, deliveries: visit.d, collections: visit.c })),
    { key: "cpu-back", kind: "cpu-return", label: "CPU" },
  ];
}

function run(id: number, vehicle: 1 | 2, departure: string | undefined, ret: string | undefined, visits: VisitSpec[], extra: Partial<RunRowView> = {}): RunRowView {
  const loads = visits.reduce((sum, visit) => sum + visit.d + visit.c, 0);
  return {
    id: `fx-run-${id}`, title: `Run ${id}`, vehicleId: vehicle === 1 ? "van1" : "van2", vehicleLabel: `Van ${vehicle}`, status: "planned",
    departure, return: ret, stopCount: visits.length, loadCount: loads, chips: chipsFor(visits), canRetire: visits.length === 0, editable: true, ...extra,
  };
}

const V = {
  harbour: { key: "fx-visit-1", name: "Harbourside Studios", d: 1, c: 0 },
  quay: { key: "fx-visit-2", name: "Quay Street Offices", d: 2, c: 1, pieces: [piece("p1", "delivery", "Lunch boxes", "36 portions · Hospitality order", "Planned"), piece("p2", "delivery", "Hot drinks set", "2 urns · Ad-hoc", "Planned"), piece("p3", "collection", "Empty crates", "4 crates to return to CPU", "Planned")] },
  mill: { key: "fx-visit-3", name: "Millbrook Community Hall", d: 1, c: 0 },
  orchard: { key: "fx-visit-4", name: "Orchard Lane School", d: 0, c: 1 },
  tower: { key: "fx-visit-5", name: "Tower Wharf Conference Centre", d: 3, c: 0 },
  green: { key: "fx-visit-6", name: "Greenway Depot", d: 1, c: 1 },
  long: { key: "fx-visit-7", name: "The Imaginary Royal Institute for Applied Hospitality Research and Catering Sciences", d: 1, c: 0 },
} satisfies Record<string, VisitSpec>;

const queue = (kind: WorkKind, destination: string, description: string, window: string | undefined, quantity: string, extra: Partial<QueueItemView> = {}): QueueItemView => ({ id: `fx-q-${destination}-${kind}`.replace(/\s+/g, "-").toLowerCase(), kind, destination, description, window, quantity, ...extra });

export const QUEUE_7: QueueItemView[] = [
  queue("delivery", "Riverside Gallery", "Hospitality order", "08:00 – 10:00", "24 portions · 1 load"),
  queue("delivery", "Fernhill Library", "Menu planning", "11:30", "40 portions · 2 loads"),
  queue("collection", "Quay Street Offices", "Return empty crates", undefined, "4 crates"),
  queue("delivery", "Northgate Surgery", "Ad-hoc production", "09:00 – 11:00", "12 portions · 1 load"),
  queue("delivery", "Ashdown Primary", "Menu planning", undefined, "58 portions · 3 loads", { attention: "Allergen sign-off pending" }),
  queue("collection", "Millbrook Community Hall", "Collect urns", undefined, "2 urns"),
  queue("delivery", "Salt Yard Market", "Grab & go", "13:00 – 14:00", "30 portions · 1 load"),
];

const FULL_RUNS: RunRowView[] = [
  run(1, 1, "07:30", "10:15", [V.harbour, V.quay, V.mill]),
  run(2, 2, "08:00", "12:30", [V.tower, V.orchard, V.green], { status: "ready" }),
  run(3, 1, "11:00", "15:00", [V.mill, V.orchard], {}),
  run(4, 2, "13:30", "17:00", [], { canRetire: true }),
];

const stopsOf = (visits: VisitSpec[], dep?: string, ret?: string): InspectorStopView[] => [
  { key: "cpu-out", kind: "cpu-departure", time: dep },
  ...visits.map((visit): InspectorStopView => ({ key: visit.key, kind: "visit", name: visit.name, deliveries: visit.d, collections: visit.c, canAddCollection: true,
    pieces: visit.pieces ?? [...Array.from({ length: visit.d }, (_, i) => piece(`${visit.key}-d${i}`, "delivery", `Delivery ${i + 1}`, "Hospitality order · Planned", "Planned")), ...Array.from({ length: visit.c }, (_, i) => piece(`${visit.key}-c${i}`, "collection", `Collection ${i + 1}`, "Collect from customer · Planned", "Planned"))] })),
  { key: "cpu-back", kind: "cpu-return", time: ret },
];

export function inspectorFixture(row: RunRowView, visits: VisitSpec[]): RunInspectorView {
  return { run: row, stops: stopsOf(visits, row.departure, row.return), orderWarnings: [] };
}

const user = { initials: "AL", name: "Alex Example", role: "Logistics planner (fictional)" };
const base = { dateLabel: "Wed 28 Oct 2026", vehicles: [{ id: "van1" as const, label: "Van 1" }, { id: "van2" as const, label: "Van 2" }], user, nowMinute: 9 * 60 + 12 };

export function scenarioModel(scenario: Scenario, selectedRunId?: string): PlannerViewModel {
  const make = (runs: RunRowView[], visitsByRun: Record<string, VisitSpec[]>, q: QueueItemView[] = QUEUE_7): PlannerViewModel => {
    const selected = runs.find((item) => item.id === selectedRunId);
    return { ...base, queue: q, runs, selectedRunId: selected?.id, inspector: selected ? inspectorFixture(selected, visitsByRun[selected.id] ?? []) : undefined };
  };
  const full = { "fx-run-1": [V.harbour, V.quay, V.mill], "fx-run-2": [V.tower, V.orchard, V.green], "fx-run-3": [V.mill, V.orchard], "fx-run-4": [] };
  switch (scenario) {
    case "queue-7": return make([], {});
    case "two-vans": return make(FULL_RUNS.slice(0, 3), full);
    case "mixed-stop": return make([FULL_RUNS[0]], full);
    case "standalone-collection": return make([run(1, 1, "09:00", "11:00", [V.orchard], { id: "fx-run-1" })], { "fx-run-1": [V.orchard] }, QUEUE_7.filter((item) => item.kind === "collection"));
    case "draft-run": return make([run(1, 1, undefined, undefined, [], { id: "fx-run-1", status: "draft", canRetire: true }), FULL_RUNS[1]], { "fx-run-1": [], "fx-run-2": [V.tower, V.orchard, V.green] });
    case "long-name": return make([run(1, 1, "08:00", "11:30", [V.long, V.harbour], { id: "fx-run-1" })], { "fx-run-1": [V.long, V.harbour] }, [queue("delivery", V.long.name, "Hospitality order", "10:00", "120 portions · 4 loads"), ...QUEUE_7.slice(0, 2)]);
    case "busy": {
      const runs = Array.from({ length: 9 }, (_, i) => run(i + 1, (i % 2 ? 2 : 1) as 1 | 2, `${String(6 + Math.floor(i / 2) * 2 + (i % 2)).padStart(2, "0")}:${i % 3 === 0 ? "00" : "30"}`, `${String(8 + Math.floor(i / 2) * 2 + (i % 2)).padStart(2, "0")}:${i % 3 === 0 ? "45" : "15"}`, [V.harbour, V.quay, V.mill].slice(0, 1 + (i % 3)), { id: `fx-run-${i + 1}`, status: i === 2 ? "attention" : "planned", attention: i === 2 ? "Needs allergen review" : undefined }));
      return make(runs, Object.fromEntries(runs.map((item, i) => [item.id, [V.harbour, V.quay, V.mill].slice(0, 1 + (i % 3))])));
    }
    case "empty": case "loading": case "error": return make([], {}, scenario === "empty" ? [] : QUEUE_7);
    default: return make(FULL_RUNS, full);
  }
}

export const STATUS_FOR: Record<Scenario, "ready" | "loading" | "error"> = Object.fromEntries(SCENARIOS.map((name) => [name, name === "loading" ? "loading" : name === "error" ? "error" : "ready"])) as never;
export const QUEUE_ITEM_COUNT = QUEUE_7.length;
