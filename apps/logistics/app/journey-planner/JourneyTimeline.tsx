"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PlusIcon } from "./icons";
import type { PlannerStatus, RunRowView } from "./model";
import { RunTimelineRow } from "./RunTimelineRow";
import styles from "./timeline.module.css";

export const LABEL_WIDTH = 140;
/** Right gutter reserved for the row action buttons so bars never sit underneath them at the default zoom. */
export const ACTIONS_GUTTER = 100;
/** At zoom 1 the visible window is 05:30–18:00 (06:00–18:00 fully shown); other zooms scale around that. */
const WINDOW_START_HOUR = 5.5;
const WINDOW_HOURS = 12.5;
const MIN_PX_PER_HOUR = 30;
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Shared time ruler + one independent row per Run. The label column is sticky; the ruler, bars and
 * "now" marker scroll together in a single horizontal scroll owner so they can never drift apart.
 */
export function JourneyTimeline({ runs, status = "ready", zoom = 1, selectedRunId, collapsedRunIds, nowMinute, dropTargets, onToggleCollapsed, onSelectRun, onSelectStop, onNewRun, onSetTimes, onRetire, onRetryLoad }: {
  runs: RunRowView[];
  status?: PlannerStatus;
  /** Multiplier on the fit-to-window scale (1 = 06:00–18:00 fills the viewport). */
  zoom?: number;
  selectedRunId?: string;
  collapsedRunIds: ReadonlySet<string>;
  nowMinute?: number;
  dropTargets?: Record<string, "valid" | "invalid">;
  onToggleCollapsed: (runId: string) => void;
  onSelectRun: (runId: string) => void;
  onSelectStop?: (runId: string, stopKey: string) => void;
  onNewRun?: () => void;
  onSetTimes?: (runId: string) => void;
  onRetire?: (runId: string) => void;
  onRetryLoad?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const [scrollX, setScrollX] = useState(0);
  const [viewport, setViewport] = useState(0);
  useLayoutEffect(() => {
    const node = scroller.current; if (!node) return;
    const measure = () => setViewport(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const fit = viewport > 0 ? (viewport - LABEL_WIDTH - ACTIONS_GUTTER) / WINDOW_HOURS : 56;
  const pxPerHour = Math.max(MIN_PX_PER_HOUR, fit * zoom);
  // Open on the working window; keep re-anchoring through layout settling/zoom until the user scrolls themselves.
  useEffect(() => { if (!touched.current && viewport > 0 && scroller.current) { scroller.current.scrollLeft = WINDOW_START_HOUR * pxPerHour; setScrollX(scroller.current.scrollLeft); } }, [viewport, pxPerHour]);
  const labelEvery = pxPerHour >= 90 ? 1 : 2;
  const hours = Array.from({ length: 25 }, (_, hour) => hour);
  const cssVars = { "--ph": `${pxPerHour}px`, "--label-w": `${LABEL_WIDTH}px`, "--gutter-w": `${ACTIONS_GUTTER}px` } as React.CSSProperties;
  const showNow = nowMinute !== undefined;
  return <section className={styles.timeline} aria-label="Vehicle journey timeline" style={cssVars}>
    <div className={styles.scroller} ref={scroller} data-testid="journey-timeline-scroller" onScroll={(event) => setScrollX(event.currentTarget.scrollLeft)} onWheel={() => { touched.current = true; }} onPointerDown={() => { touched.current = true; }} onKeyDown={() => { touched.current = true; }}>
      <div className={styles.canvas}>
        <div className={styles.rulerRow}>
          <div className={styles.rulerCorner} />
          <div className={styles.ruler} aria-hidden="true">
            {hours.map((hour) => <div key={hour}><span className={styles.tick} style={{ left: hour * pxPerHour }} />{hour % labelEvery === 0 && hour < 24 && hour * pxPerHour - scrollX > 22 && !(showNow && Math.abs(hour * 60 - nowMinute!) < 36 * 60 / pxPerHour) && <span className={styles.tickLabel} style={{ left: hour * pxPerHour }}>{pad(hour)}:00</span>}</div>)}
            {showNow && <span className={styles.nowPill} style={{ left: (nowMinute! / 60) * pxPerHour }}>{pad(Math.floor(nowMinute! / 60))}:{pad(nowMinute! % 60)}</span>}
          </div>
        </div>
        {status === "loading" && <div aria-busy="true" aria-label="Loading runs">{[0, 1, 2].map((index) => <div key={index} className={styles.skeletonRow} />)}</div>}
        {status === "error" && <div className={styles.empty} role="alert" style={{ position: "sticky", left: 0, width: "calc(100cqw - 2px)" }}><strong>Runs could not be loaded</strong><span>Your planning is safe. Nothing was changed.</span>{onRetryLoad && <button type="button" className={styles.draftSlot} style={{ position: "static", margin: 0 }} onClick={onRetryLoad}>Try again</button>}</div>}
        {status === "ready" && runs.length === 0 && <div className={styles.empty} style={{ position: "sticky", left: 0, width: "calc(100cqw - 2px)" }}><strong>No runs for this day yet</strong><span>Create a run, then drag work onto it from the queue.</span></div>}
        {status === "ready" && <div className={styles.rows}>
          {showNow && <span className={styles.nowLine} style={{ left: LABEL_WIDTH + (nowMinute! / 60) * pxPerHour }} aria-hidden="true" />}
          {runs.map((run) => <RunTimelineRow
          key={run.id}
          run={run}
          pxPerHour={pxPerHour}
          selected={run.id === selectedRunId}
          collapsed={collapsedRunIds.has(run.id)}
          drop={dropTargets?.[run.id]}
          onToggleCollapsed={() => onToggleCollapsed(run.id)}
          onSelect={() => onSelectRun(run.id)}
          onSelectStop={onSelectStop ? (stopKey) => onSelectStop(run.id, stopKey) : undefined}
          onSetTimes={onSetTimes ? () => onSetTimes(run.id) : undefined}
          onRetire={onRetire ? () => onRetire(run.id) : undefined}
        />)}
        </div>}
        {status === "ready" && <button type="button" className={styles.create} onClick={onNewRun}><strong><span className={styles.createCircle}><PlusIcon size={16} /></span>Create another Run</strong><span>Click to add a new run or use the button above</span></button>}
      </div>
    </div>
  </section>;
}
