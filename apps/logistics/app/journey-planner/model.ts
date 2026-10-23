/**
 * Presentation model for the Journey Planner V3 UI.
 *
 * These types are what the visual components render. They deliberately carry NO persistence
 * concerns: the preview route fills them with labelled fictional fixtures, and the real planner
 * fills them from the canonical projection through `adapter.ts`. Components never fetch,
 * mutate, or derive operational truth; they receive a model and raise typed events.
 */

export type VehicleId = "van1" | "van2";
export type WorkKind = "delivery" | "collection";

export type RunStatusView = "draft" | "planned" | "ready" | "dispatched" | "in_progress" | "completed" | "attention";

export type QueueItemView = {
  /** Canonical queue identity (work group key / movement id). */
  id: string;
  kind: WorkKind;
  destination: string;
  /** Workstream or short description, e.g. "Hospitality order". */
  description: string;
  /** Requested time / window when the source states one ("08:00 – 10:00"). Advisory only. */
  window?: string;
  /** "36 portions · 2 loads". */
  quantity?: string;
  attention?: string;
  /** True while a placement command for this item is unresolved. */
  pending?: boolean;
  /** False when the item cannot be dragged (placement in flight). It can still be opened. */
  draggable?: boolean;
  /** Short operational state, e.g. "Needs time". Presentation only. */
  stateLabel?: string;
};

/** One compact chip in a Run's visiting sequence. */
export type SequenceChipView =
  | { key: string; kind: "cpu-departure" | "cpu-return"; label: "CPU" }
  | { key: string; kind: "visit"; /** Stable key of the physical stop, e.g. `projection-visit:…`. */ stopKey: string; label: string; deliveries: number; collections: number };

export type RunRowView = {
  id: string;
  title: string;
  vehicleId: VehicleId;
  vehicleLabel: string;
  status: RunStatusView;
  /** HH:MM. Both absent = a draft that still needs journey times. */
  departure?: string;
  return?: string;
  stopCount: number;
  loadCount: number;
  chips: SequenceChipView[];
  /** True while a time/move/create command is unresolved. */
  pending?: boolean;
  /** Human-readable reason when the Run overlaps another on the same vehicle. */
  overlapWarning?: string;
  attention?: string;
  canRetire: boolean;
  /** Reason shown when retirement is not offered. */
  retireBlocker?: string;
  /** Lifecycle permits time/order edits. */
  editable: boolean;
  /** Driver app link for this run (preview only; execution happens in the driver app). */
  driverHref?: string;
};

export type StopPieceView = {
  key: string;
  kind: WorkKind;
  title: string;
  detail: string;
  status?: string;
};

export type InspectorStopView =
  | { key: string; kind: "cpu-departure" | "cpu-return"; time?: string }
  | { key: string; kind: "visit"; name: string; deliveries: number; collections: number; pieces: StopPieceView[]; canAddCollection: boolean };

export type RunInspectorView = {
  run: RunRowView;
  stops: InspectorStopView[];
  /** Order conflicts with planned times: surfaced, never auto-corrected. */
  orderWarnings: string[];
};

export type PlannerViewModel = {
  /** "Wed 28 Oct 2026". */
  dateLabel: string;
  vehicles: Array<{ id: VehicleId; label: string }>;
  queue: QueueItemView[];
  runs: RunRowView[];
  selectedRunId?: string;
  /** Minutes after midnight for the "now" marker (today only). */
  nowMinute?: number;
  user: { initials: string; name: string; role: string };
  inspector?: RunInspectorView;
};

export type PlannerStatus = "ready" | "loading" | "error";

/** Everything the UI can ask for. The container decides which command (if any) each maps to. */
export type PlannerEvents = {
  onSelectRun?: (runId: string) => void;
  onSelectStop?: (runId: string, stopKey: string) => void;
  onNewRun?: () => void;
  onQueueOpen?: (itemId: string) => void;
  onDateStep?: (delta: -1 | 1) => void;
  onThisWeek?: () => void;
  onCloseInspector?: () => void;
  onRetryLoad?: () => void;
};

export const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };
export const durationOf = (run: Pick<RunRowView, "departure" | "return">) => run.departure && run.return ? minutesOf(run.return) - minutesOf(run.departure) : undefined;
export const statusLabel = (status: RunStatusView) => ({ draft: "Draft", planned: "Planned", ready: "Ready", dispatched: "Dispatched", in_progress: "In progress", completed: "Completed", attention: "Attention" })[status];
