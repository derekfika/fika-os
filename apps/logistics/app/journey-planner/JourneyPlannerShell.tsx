"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, MinusIcon, PlusIcon, SearchIcon } from "./icons";
import { JourneyTimeline } from "./JourneyTimeline";
import { NewRunDialog, type NewRunInput } from "./NewRunDialog";
import { RunInspector, type InspectorTab, type NewCollection } from "./RunInspector";
import { UnassignedWorkQueue } from "./UnassignedWorkQueue";
import type { PlannerStatus, PlannerViewModel, QueueItemView, VehicleId } from "./model";
import styles from "./shell.module.css";

const ZOOM_STEPS = [0.75, 1, 1.5, 2, 3];

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => { const list = window.matchMedia(query); const update = () => setMatches(list.matches); update(); list.addEventListener("change", update); return () => list.removeEventListener("change", update); }, [query]);
  return matches;
}

/** Everything the screen can ask for. The container decides which command (if any) each maps to. */
export type ShellActions = {
  onSelectRun?: (runId: string) => void;
  onSelectStop?: (runId: string, stopKey: string) => void;
  onCloseInspector?: () => void;
  onCreateRun?: (input: NewRunInput) => void;
  /** Proposed planned CPU times (drag, resize, keyboard or the exact-times form). Never "saved" until the host confirms. */
  onRunTiming?: (runId: string, departure: string, returnTime: string) => void;
  onQueueOpen?: (itemId: string) => void;
  /** A queue item was dropped on (or otherwise assigned to) a Run row. */
  onQueueDrop?: (itemId: string, runId: string) => void;
  onNewCollection?: () => void;
  onSaveOrder?: (runId: string, visitKeys: string[]) => void;
  onAddCollection?: (runId: string, collection: NewCollection) => Promise<boolean | void>;
  onReturnStop?: (runId: string, stopKey: string) => void;
  onViewStop?: (runId: string, stopKey: string) => void;
  onRetireRun?: (runId: string) => void;
  onDateStep?: (delta: -1 | 1) => void;
  onDateSet?: (date: string) => void;
  onThisWeek?: () => void;
  onRetryLoad?: () => void;
};

export type ShellNotice = { id: string; tone: "error" | "warning" | "info"; text: ReactNode; action?: { label: string; onClick: () => void } };

/**
 * The Journey Planner V3 screen. A typed view model in, typed events out. Local state here is UI-only
 * (filters, zoom, collapsed rows, tab, drag previews); no operational truth lives here. The preview route and the
 * live planner render this same component.
 */
export function JourneyPlannerShell({ model, status = "ready", actions = {}, saving = false, showPreviewTag = false, initialExpandedKey, dateValue, notices = [], statusLine, sidePanel, modals, creatingRun = false }: {
  model: PlannerViewModel;
  status?: PlannerStatus;
  actions?: ShellActions;
  saving?: boolean;
  showPreviewTag?: boolean;
  initialExpandedKey?: string;
  /** YYYY-MM-DD of the displayed service date, for the date picker. */
  dateValue?: string;
  notices?: ShellNotice[];
  statusLine?: ReactNode;
  /** Replaces the Run inspector (e.g. queue-item or load details) in the docked column. */
  sidePanel?: ReactNode;
  modals?: ReactNode;
  creatingRun?: boolean;
}) {
  const [vehicle, setVehicle] = useState<"all" | VehicleId>("all");
  const [zoomIndex, setZoomIndex] = useState(1);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [queueOverride, setQueueOverride] = useState<"open" | "rail" | undefined>();
  const [peek, setPeek] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("stops");
  const [expandedKey, setExpandedKey] = useState<string | undefined>(initialExpandedKey);
  const [timesOpen, setTimesOpen] = useState(false);
  const [retireConfirm, setRetireConfirm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [runTerm, setRunTerm] = useState("");
  const [newRunOpen, setNewRunOpen] = useState(false);
  const narrow = useMediaQuery("(max-width: 1439px)");
  const inspectorOpen = Boolean(model.inspector || sidePanel);
  const queueRail = queueOverride ? queueOverride === "rail" : narrow && inspectorOpen;
  const needle = runTerm.trim().toLocaleLowerCase("en-GB");
  const runs = useMemo(() => model.runs.filter((run) => (vehicle === "all" || run.vehicleId === vehicle) && (!needle || `${run.title} ${run.vehicleLabel}`.toLocaleLowerCase("en-GB").includes(needle) || run.chips.some((chip) => chip.kind === "visit" && chip.label.toLocaleLowerCase("en-GB").includes(needle)))), [model.runs, vehicle, needle]);
  const toggleCollapsed = (runId: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(runId)) next.delete(runId); else next.add(runId); return next; });
  const zoom = ZOOM_STEPS[zoomIndex];
  const pickerRef = useRef<HTMLInputElement>(null);

  // ----- queue -> Run row drag -----
  type QueueDrag = { item: QueueItemView; pointerId: number; startX: number; startY: number; started: boolean };
  const queueDrag = useRef<QueueDrag | null>(null);
  const suppressQueueClick = useRef(false);
  const [dragView, setDragView] = useState<{ item: QueueItemView; x: number; y: number; runId?: string }>();
  const modelRef = useRef(model); modelRef.current = model;
  const actionsRef = useRef(actions); actionsRef.current = actions;
  const peekRef = useRef(peek); peekRef.current = peek;
  const runUnder = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-run-id]")?.dataset.dropRunId;
  const reasonFor = (runId: string) => {
    const run = modelRef.current.runs.find((candidate) => candidate.id === runId);
    if (!run) return "Not a valid target";
    if (run.pending) return "This run is saving. Try again in a moment.";
    if (!run.editable) return `${run.title} is ${run.status.replace("_", " ")}. Return it to planning before adding work.`;
    return undefined;
  };
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = queueDrag.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started) { if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return; drag.started = true; suppressQueueClick.current = true; }
      setDragView({ item: drag.item, x: event.clientX, y: event.clientY, runId: runUnder(event.clientX, event.clientY) });
      // Page auto-scroll so a Run row further down the day can be reached.
      const edge = 70;
      if (event.clientY < edge + 80) window.scrollBy(0, -14); else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
    };
    const end = (event: PointerEvent, cancelled: boolean) => {
      const drag = queueDrag.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      queueDrag.current = null;
      setDragView(undefined);
      if (!drag.started) return;
      window.setTimeout(() => { suppressQueueClick.current = false; }, 0);
      if (peekRef.current) setPeek(false);
      if (cancelled) return;
      const runId = runUnder(event.clientX, event.clientY);
      if (runId && !reasonFor(runId)) actionsRef.current.onQueueDrop?.(drag.item.id, runId);
    };
    const onUp = (event: PointerEvent) => end(event, false);
    const onCancel = (event: PointerEvent) => end(event, true);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && queueDrag.current) { queueDrag.current = null; setDragView(undefined); suppressQueueClick.current = false; } };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); window.removeEventListener("keydown", onKey); };
  }, []);
  const beginQueueDrag = (event: ReactPointerEvent<HTMLElement>, item: QueueItemView) => {
    if (event.button !== 0) return;
    queueDrag.current = { item, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false };
  };
  const dropTargets = dragView?.runId ? { [dragView.runId]: reasonFor(dragView.runId) ? "invalid" as const : "valid" as const } : undefined;
  const dropReasons = dragView?.runId && reasonFor(dragView.runId) ? { [dragView.runId]: reasonFor(dragView.runId)! } : undefined;

  const queueProps = {
    items: model.queue,
    status: status === "error" ? "ready" as const : status,
    onOpen: (itemId: string) => { if (!suppressQueueClick.current) actions.onQueueOpen?.(itemId); },
    onNewCollection: actions.onNewCollection,
    onItemPointerDown: beginQueueDrag,
  };
  const selectedRun = model.runs.find((run) => run.id === model.selectedRunId);
  const openTimes = (runId: string) => { actions.onSelectRun?.(runId); setTab("overview"); setTimesOpen(true); };
  return <div className={styles.shell} data-journey-planner data-queue-dragging={dragView ? "true" : undefined}>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/brand-assets/logos/fika_logo_white_png.png" alt="FIKA" /><span>OS</span></div>
      <div className={styles.context}><span>Operations workspace</span><strong>Logistics</strong></div>
      <div className={styles.spacer} />
      <div className={styles.datePill} role="group" aria-label="Service date">
        <CalendarIcon size={22} />
        <span className={styles.dateText}><span aria-hidden="true">{model.dateLabel}</span>
          <input ref={pickerRef} className={styles.dateInput} type="date" value={dateValue ?? ""} aria-label={`Service date ${model.dateLabel}. Choose a date`} onClick={() => { try { pickerRef.current?.showPicker?.(); } catch { /* the native field still opens by keyboard */ } }} onChange={(event) => { if (event.target.value) actions.onDateSet?.(event.target.value); }} />
        </span>
        <button type="button" className={styles.dateStep} onClick={() => actions.onDateStep?.(-1)} aria-label="Previous day"><ChevronLeftIcon /></button>
      </div>
      <button type="button" className={`${styles.dateStep} ${styles.dateStepBox}`} onClick={() => actions.onDateStep?.(1)} aria-label="Next day"><ChevronRightIcon /></button>
      <button type="button" className={styles.thisWeek} onClick={actions.onThisWeek}>This week</button>
      <ChevronRightIcon size={22} />
      <div className={styles.user}><span className={styles.avatar} aria-hidden="true">{model.user.initials}</span><span className={styles.userText}><strong>{model.user.name}</strong><span>{model.user.role}</span></span><ChevronDownIcon size={18} /></div>
    </header>
    <div className={styles.body} data-inspector={inspectorOpen ? "open" : "closed"}>
      <main className={styles.workspace}>
        <div className={styles.toolbar}>
          <div className={styles.titleBlock}><h1 className={styles.title}>Journey Planner</h1><p className={styles.subtitle}>Plan and dispatch daily deliveries.</p></div>
          <div className={styles.controls}>
            <div className={styles.toolGroup} role="group" aria-label="Show runs for">
              <span className={styles.toolLabel}>Show</span>
              <button type="button" className={styles.pill} aria-pressed={vehicle === "all"} onClick={() => setVehicle("all")}>All runs</button>
              {model.vehicles.map((item) => <button key={item.id} type="button" className={styles.pill} aria-pressed={vehicle === item.id} onClick={() => setVehicle(item.id)}>{item.label}</button>)}
            </div>
            {searchOpen
              ? <label className={styles.runSearch}><SearchIcon size={20} /><span className={styles.srOnly}>Search runs</span><input autoFocus type="search" value={runTerm} onChange={(event) => setRunTerm(event.target.value)} placeholder="Search runs or sites…" onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); setRunTerm(""); } }} /></label>
              : <button type="button" className={styles.iconButton} aria-label="Search runs" aria-expanded="false" onClick={() => setSearchOpen(true)}><SearchIcon size={22} /></button>}
          </div>
          <div className={styles.actionGroup}>
            <div className={styles.zoom} role="group" aria-label="Timeline zoom"><span className={styles.toolLabel}>Zoom</span>
              <div className={styles.segment}>
                <button type="button" aria-label="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}><MinusIcon /></button>
                <button type="button" aria-label="Zoom in" disabled={zoomIndex === ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}><PlusIcon /></button>
              </div>
            </div>
            <button type="button" className={styles.primaryButton} onClick={() => setNewRunOpen(true)} disabled={creatingRun}><PlusIcon size={20} />New Run</button>
          </div>
        </div>
        {statusLine && <div className={styles.statusLine}>{statusLine}</div>}
        {status === "error" && <div className={styles.banner} role="alert"><span>The planner could not refresh. Showing nothing unconfirmed.</span>{actions.onRetryLoad && <button type="button" onClick={actions.onRetryLoad}>Try again</button>}</div>}
        {notices.map((notice) => <div key={notice.id} className={styles.notice} data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}><span>{notice.text}</span>{notice.action && <button type="button" onClick={notice.action.onClick}>{notice.action.label}</button>}</div>)}
        <div className={styles.columns} data-collapsed={queueRail ? "true" : "false"}>
          {queueRail
            ? <>
              <UnassignedWorkQueue {...queueProps} collapsed onToggleCollapsed={() => setPeek((value) => !value)} />
              {peek && <UnassignedWorkQueue {...queueProps} collapsed={false} peek onToggleCollapsed={() => setPeek(false)} onDock={() => { setPeek(false); setQueueOverride("open"); }} />}
            </>
            : <UnassignedWorkQueue {...queueProps} collapsed={false} onToggleCollapsed={() => { setQueueOverride("rail"); setPeek(false); }} />}
          <JourneyTimeline runs={runs} vehicleIds={model.vehicles.filter(item => (vehicle === "all" || item.id === vehicle) && (!needle || runs.some(run => run.vehicleId === item.id))).map(item => item.id)} status={status} zoom={zoom} selectedRunId={model.selectedRunId} activeStopKey={expandedKey} collapsedRunIds={collapsed} nowMinute={model.nowMinute}
            dropTargets={dropTargets} dropReasons={dropReasons}
            onToggleCollapsed={toggleCollapsed}
            onSelectRun={(runId) => { setTimesOpen(false); setRetireConfirm(false); actions.onSelectRun?.(runId); }}
            onSelectStop={(runId, stopKey) => { setTab("stops"); setExpandedKey(stopKey); actions.onSelectStop?.(runId, stopKey); }}
            onNewRun={() => setNewRunOpen(true)}
            onSetTimes={openTimes}
            onRetire={(runId) => { setTab("stops"); setRetireConfirm(true); actions.onSelectRun?.(runId); }}
            onRunTiming={actions.onRunTiming}
            onRetryLoad={actions.onRetryLoad} />
        </div>
      </main>
      {sidePanel ?? (model.inspector && <RunInspector view={model.inspector} tab={tab} onTab={setTab} expandedKey={expandedKey} onExpand={setExpandedKey} saving={saving || Boolean(selectedRun?.pending)} timesOpen={timesOpen} onTimesOpen={setTimesOpen} retireConfirmOpen={retireConfirm} onRetireConfirmOpen={setRetireConfirm} onClose={() => { setTimesOpen(false); setRetireConfirm(false); actions.onCloseInspector?.(); }}
        onSaveOrder={(keys) => actions.onSaveOrder?.(model.inspector!.run.id, keys)}
        onAddCollection={async (collection) => actions.onAddCollection?.(model.inspector!.run.id, collection)}
        onSaveTimes={(departure, returnTime) => actions.onRunTiming?.(model.inspector!.run.id, departure, returnTime)}
        onReturnStop={(key) => actions.onReturnStop?.(model.inspector!.run.id, key)}
        onViewLoads={(key) => actions.onViewStop?.(model.inspector!.run.id, key)}
        onRetire={() => { setRetireConfirm(false); actions.onRetireRun?.(model.inspector!.run.id); }} />)}
    </div>
    {newRunOpen && <NewRunDialog vehicles={model.vehicles} busy={creatingRun} onClose={() => setNewRunOpen(false)} onCreate={(input) => { setNewRunOpen(false); actions.onCreateRun?.(input); }} />}
    {modals}
    {dragView && !dragView.item.pending && <div className={styles.dragGhost} data-queue-drag-ghost style={{ left: dragView.x + 14, top: dragView.y + 14 }} aria-hidden="true"><strong>{dragView.item.destination}</strong><span>{dragView.item.kind === "delivery" ? "Delivery" : "Collection"} · {dragView.item.description}</span></div>}
    {showPreviewTag && <span className={styles.previewTag}>Design preview · fictional example data · no live Logistics data</span>}
  </div>;
}
