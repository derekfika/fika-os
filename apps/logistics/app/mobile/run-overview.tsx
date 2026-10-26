"use client";

import { useState } from "react";
import type { DeliveryStop } from "../../lib/types";
import { stopIsCollection } from "../../lib/mobile-driver";
import { nextRunVisit, visitProgress, type RunVisit, type RunVisitStatus } from "./run-overview-model";
import styles from "./run-overview.module.css";

export const visitStatusText: Record<RunVisitStatus, string> = { planned: "Upcoming", current: "In progress", attention: "Attention", completed: "Completed" };

type Filter = "all" | "completed" | "remaining";

export function RunOverview({ visits, siteLabel, timeLabel, openLabel, onOpen }: {
  visits: RunVisit[];
  siteLabel: (stop: DeliveryStop) => string;
  timeLabel: (stop: DeliveryStop) => string;
  openLabel: (stop: DeliveryStop) => string;
  onOpen: (trigger: HTMLButtonElement, stop: DeliveryStop) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const progress = visitProgress(visits);
  const next = nextRunVisit(visits);
  const remaining = visits.filter((visit) => visit.status !== "completed");
  const completed = visits.filter((visit) => visit.status === "completed");
  const shown = filter === "completed" ? completed : filter === "remaining" ? remaining : visits;

  return <section className={styles.overview} aria-label="Run overview">
    <div className={styles.progress} role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} aria-valuetext={`${progress.completed} of ${progress.total} stops completed`}>
      <div className={styles.progressText}><span>{progress.completed} of {progress.total} stops completed</span><strong>{progress.percent}%</strong></div>
      <div className={styles.track}><i style={{ width: `${progress.percent}%` }} /></div>
    </div>

    <div className={styles.segments} role="group" aria-label="Filter stops">
      <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All stops <b>{visits.length}</b></button>
      <button type="button" aria-pressed={filter === "completed"} onClick={() => setFilter("completed")}>Completed <b>{completed.length}</b></button>
      <button type="button" aria-pressed={filter === "remaining"} onClick={() => setFilter("remaining")}>Remaining <b>{remaining.length}</b></button>
    </div>

    {visits.length === 0 ? <p className={styles.empty}>No stops are planned for this run yet.</p> : shown.length === 0 ? <p className={styles.empty}>No stops in this view.</p> : <ol className={styles.visits} aria-label="Stops in run order">
      {shown.map((visit) => {
        const stop = visit.stops[0];
        const isNext = visit === next;
        const deliveries = visit.stops.filter((lane) => !stopIsCollection(lane)).length;
        const collections = visit.stops.length - deliveries;
        const label = isNext && visit.status !== "attention" ? "Next" : visitStatusText[visit.status];
        return <li key={visit.key} className={`${styles.visit} ${styles[visit.status] ?? ""} ${isNext ? styles.isNext : ""}`} aria-current={isNext ? "step" : undefined}>
          <button type="button" className={styles.card} aria-label={openLabel(stop)} onClick={(event) => onOpen(event.currentTarget, stop)}>
            <span className={styles.number} aria-hidden="true">{visit.status === "completed" ? "✓" : visit.visitNumber}</span>
            <span className={styles.body}>
              <strong className={styles.site}>{siteLabel(stop)}</strong>
              <small className={styles.time}>{timeLabel(stop)}</small>
              <span className={styles.counts}>
                <span aria-label={`${deliveries} ${deliveries === 1 ? "delivery" : "deliveries"}`}><span aria-hidden="true">▣</span> {deliveries}</span>
                <span aria-label={`${collections} ${collections === 1 ? "collection" : "collections"}`}><span aria-hidden="true">↗</span> {collections}</span>
              </span>
            </span>
            <span className={styles.status}>{label}</span>
            <span className={styles.chevron} aria-hidden="true">›</span>
          </button>
        </li>;
      })}
    </ol>}

    {next && <button type="button" className={`primary-action ${styles.startNext}`} onClick={(event) => onOpen(event.currentTarget, next.stops[0])}>Start next stop <span aria-hidden="true">→</span></button>}
  </section>;
}
