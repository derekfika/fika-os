"use client";

import type { DeliveryStop } from "../../lib/types";
import { stopIsCollection } from "../../lib/mobile-driver";
import { nextRunVisit, visitLaneCounts, visitProgress, type RunVisit, type RunVisitStatus } from "./run-overview-model";
import styles from "./run-overview.module.css";

export const visitStatusText: Record<RunVisitStatus, string> = { planned: "Upcoming", current: "In progress", attention: "Attention", completed: "Completed" };

export function RunOverview({ title, dateLabel, visits, siteLabel, timeLabel, detailLabel, openLabel, onOpen }: {
  title: string;
  dateLabel: string;
  visits: RunVisit[];
  siteLabel: (stop: DeliveryStop) => string;
  timeLabel: (stop: DeliveryStop) => string;
  /** Real quantity/item summary for one lane stop, from the authoritative load data. */
  detailLabel: (stop: DeliveryStop) => string;
  openLabel: (stop: DeliveryStop) => string;
  onOpen: (trigger: HTMLButtonElement, stop: DeliveryStop) => void;
}) {
  const progress = visitProgress(visits);
  const lanes = visitLaneCounts(visits);
  const next = nextRunVisit(visits);

  return <section className={styles.overview} aria-label="Run overview">
    <header className={styles.header}>
      <p className={styles.kicker}>{title}</p>
      <h2 className={styles.heading}>{dateLabel}</h2>
    </header>

    <div className={styles.progress} role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} aria-valuetext={`${progress.completed} of ${progress.total} stops completed`}>
      <div className={styles.progressText}><span>{progress.completed} of {progress.total} stops completed</span><strong>{progress.percent}%</strong></div>
      <div className={styles.track}><i style={{ width: `${progress.percent}%` }} /></div>
    </div>

    <dl className={styles.counts}>
      <div><dt>Stops</dt><dd>{progress.total}</dd></div>
      <div><dt>Deliveries</dt><dd>{lanes.deliveries}</dd></div>
      <div><dt>Collections</dt><dd>{lanes.collections}</dd></div>
      <div className={lanes.attention ? styles.countAlert : undefined}><dt>Attention</dt><dd>{lanes.attention}</dd></div>
    </dl>

    {visits.length === 0 ? <p className={styles.empty}>No stops are planned for this run yet.</p> : <ol className={styles.visits} aria-label="Stops in run order">
      {visits.map((visit) => {
        const first = visit.stops[0];
        const isNext = visit === next;
        return <li key={visit.key} className={`${styles.visit} ${styles[visit.status] ?? ""}`} aria-current={isNext ? "step" : undefined}>
          <div className={styles.visitHead}>
            <span className={styles.number} aria-hidden="true">{visit.status === "completed" ? "✓" : visit.visitNumber}</span>
            <div className={styles.visitTitle}>
              <strong>{siteLabel(first)}</strong>
              <small>{timeLabel(first)}</small>
            </div>
            <span className={styles.status}>{isNext && visit.status !== "attention" ? "Next" : visitStatusText[visit.status]}</span>
          </div>
          <ul className={styles.lanes}>
            {visit.stops.map((stop) => {
              const collection = stopIsCollection(stop);
              return <li key={stop.canonicalId}>
                <button type="button" className={styles.lane} aria-label={openLabel(stop)} onClick={(event) => onOpen(event.currentTarget, stop)}>
                  <span className={styles.laneKind}>{collection ? "Collection" : "Delivery"}</span>
                  <span className={styles.laneDetail}>{detailLabel(stop)}</span>
                  <span className={styles.laneState}>{stop.status === "completed" ? "Done" : stop.loaded ? "Loaded" : ""}</span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>;
            })}
          </ul>
        </li>;
      })}
    </ol>}
  </section>;
}
