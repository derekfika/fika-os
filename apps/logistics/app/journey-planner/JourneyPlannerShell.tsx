"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, MinusIcon, PlusIcon, SearchIcon } from "./icons";
import { JourneyTimeline } from "./JourneyTimeline";
import { RunInspector, type InspectorTab, type NewCollection } from "./RunInspector";
import { UnassignedWorkQueue } from "./UnassignedWorkQueue";
import type { PlannerEvents, PlannerStatus, PlannerViewModel, VehicleId } from "./model";
import styles from "./shell.module.css";

const ZOOM_STEPS = [0.75, 1, 1.5, 2, 3];

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => { const list = window.matchMedia(query); const update = () => setMatches(list.matches); update(); list.addEventListener("change", update); return () => list.removeEventListener("change", update); }, [query]);
  return matches;
}

export type ShellActions = PlannerEvents & {
  onSaveOrder?: (runId: string, visitKeys: string[]) => void;
  onAddCollection?: (runId: string, collection: NewCollection) => void;
  onRetireRun?: (runId: string) => void;
  onEditTimes?: (runId: string) => void;
  onNewCollection?: () => void;
};

/**
 * The Journey Planner V3 screen. Pure presentation: a typed view model in, typed events out.
 * Local state here is UI-only (filters, zoom, collapsed rows, tab); no operational truth lives here.
 * The preview route and (Phase B) the live planner render this same component.
 */
export function JourneyPlannerShell({ model, status = "ready", actions = {}, saving = false, showPreviewTag = false, initialExpandedKey }: {
  model: PlannerViewModel;
  status?: PlannerStatus;
  actions?: ShellActions;
  saving?: boolean;
  showPreviewTag?: boolean;
  initialExpandedKey?: string;
}) {
  const [vehicle, setVehicle] = useState<"all" | VehicleId>("all");
  const [zoomIndex, setZoomIndex] = useState(1);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [queueOverride, setQueueOverride] = useState<"open" | "rail" | undefined>();
  const [tab, setTab] = useState<InspectorTab>("stops");
  const [expandedKey, setExpandedKey] = useState<string | undefined>(initialExpandedKey);
  const [searchOpen, setSearchOpen] = useState(false);
  const [runTerm, setRunTerm] = useState("");
  const narrow = useMediaQuery("(max-width: 1439px)");
  const inspectorOpen = Boolean(model.inspector);
  const queueRail = queueOverride ? queueOverride === "rail" : narrow && inspectorOpen;
  const needle = runTerm.trim().toLocaleLowerCase("en-GB");
  const runs = useMemo(() => model.runs.filter((run) => (vehicle === "all" || run.vehicleId === vehicle) && (!needle || `${run.title} ${run.vehicleLabel}`.toLocaleLowerCase("en-GB").includes(needle) || run.chips.some((chip) => chip.kind === "visit" && chip.label.toLocaleLowerCase("en-GB").includes(needle)))), [model.runs, vehicle, needle]);
  const toggleCollapsed = (runId: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(runId)) next.delete(runId); else next.add(runId); return next; });
  const select = (runId: string) => { actions.onSelectRun?.(runId); };
  const zoom = ZOOM_STEPS[zoomIndex];
  return <div className={styles.shell} data-journey-planner>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/brand-assets/logos/fika_logo_white_png.png" alt="FIKA" /><span>OS</span></div>
      <div className={styles.context}><span>Operations workspace</span><strong>Logistics</strong></div>
      <div className={styles.spacer} />
      <div className={styles.datePill} role="group" aria-label="Service date">
        <CalendarIcon size={22} /><strong>{model.dateLabel}</strong>
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
          <div className={styles.toolGroup} role="group" aria-label="Show runs for">
            <span className={styles.toolLabel}>Show</span>
            <button type="button" className={styles.pill} aria-pressed={vehicle === "all"} onClick={() => setVehicle("all")}>All runs</button>
            {model.vehicles.map((item) => <button key={item.id} type="button" className={styles.pill} aria-pressed={vehicle === item.id} onClick={() => setVehicle(item.id)}>{item.label}</button>)}
          </div>
          {searchOpen
            ? <label className={styles.runSearch}><SearchIcon size={20} /><span className={styles.srOnly}>Search runs</span><input autoFocus type="search" value={runTerm} onChange={(event) => setRunTerm(event.target.value)} placeholder="Search runs or sites…" onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); setRunTerm(""); } }} /></label>
            : <button type="button" className={styles.iconButton} aria-label="Search runs" aria-expanded="false" onClick={() => setSearchOpen(true)}><SearchIcon size={22} /></button>}
          <div className={styles.zoom} role="group" aria-label="Timeline zoom"><span className={styles.toolLabel}>Zoom</span>
            <div className={styles.segment}>
              <button type="button" aria-label="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}><MinusIcon /></button>
              <button type="button" aria-label="Zoom in" disabled={zoomIndex === ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}><PlusIcon /></button>
            </div>
          </div>
          <div className={styles.toolSpacer} />
          <button type="button" className={styles.primaryButton} onClick={actions.onNewRun}><PlusIcon size={20} />New Run</button>
        </div>
        {status === "error" && <div className={styles.banner} role="alert"><span>The planner could not refresh. Showing nothing unconfirmed.</span>{actions.onRetryLoad && <button type="button" onClick={actions.onRetryLoad}>Try again</button>}</div>}
        <div className={styles.columns} data-collapsed={queueRail ? "true" : "false"}>
          <UnassignedWorkQueue items={model.queue} status={status === "error" ? "ready" : status} collapsed={queueRail} onToggleCollapsed={() => setQueueOverride(queueRail ? "open" : "rail")} onOpen={actions.onQueueOpen} onNewCollection={actions.onNewCollection} />
          <JourneyTimeline runs={runs} status={status} zoom={zoom} selectedRunId={model.selectedRunId} collapsedRunIds={collapsed} nowMinute={model.nowMinute} onToggleCollapsed={toggleCollapsed} onSelectRun={select} onSelectStop={(runId, stopKey) => { actions.onSelectStop?.(runId, stopKey); setTab("stops"); setExpandedKey(stopKey); }} onNewRun={actions.onNewRun} onSetTimes={(runId) => { select(runId); setTab("overview"); actions.onEditTimes?.(runId); }} onRetire={actions.onRetireRun} onRetryLoad={actions.onRetryLoad} />
        </div>
      </main>
      {model.inspector && <RunInspector view={model.inspector} tab={tab} onTab={setTab} expandedKey={expandedKey} onExpand={setExpandedKey} saving={saving} onClose={() => actions.onCloseInspector?.()}
        onSaveOrder={(keys) => actions.onSaveOrder?.(model.inspector!.run.id, keys)} onAddCollection={(collection) => actions.onAddCollection?.(model.inspector!.run.id, collection)} onEditTimes={() => actions.onEditTimes?.(model.inspector!.run.id)} onRetire={() => actions.onRetireRun?.(model.inspector!.run.id)} />}
    </div>
    {showPreviewTag && <span className={styles.previewTag}>Design preview · fictional example data · no live Logistics data</span>}
  </div>;
}
