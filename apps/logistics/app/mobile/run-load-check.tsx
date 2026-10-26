"use client";

import type { DeliveryStop } from "../../lib/types";
import styles from "./run-load-check.module.css";

export function RunLoadCheck({ deliveries, blockers, pending, pendingLabel, siteLabel, openLabel, onOpen, onDispatch }: {
  deliveries: DeliveryStop[];
  blockers: string[];
  pending: boolean;
  pendingLabel: string;
  siteLabel: (stop: DeliveryStop) => string;
  openLabel: (stop: DeliveryStop) => string;
  onOpen: (trigger: HTMLButtonElement, stop: DeliveryStop) => void;
  onDispatch: () => void;
}) {
  const loaded = deliveries.filter((stop) => stop.loaded).length;
  const percent = deliveries.length ? Math.round((loaded / deliveries.length) * 100) : 0;
  const ready = blockers.length === 0;

  return <section className={styles.check} aria-label="Load check">
    <div className={styles.head}>
      <span className={styles.icon} aria-hidden="true">▣</span>
      <div>
        <h2 className={styles.heading}>Load check</h2>
        <p className={styles.help}>Confirm all deliveries for this run are on the vehicle before leaving.</p>
      </div>
    </div>

    <div className={styles.progressRow}>
      <div className={styles.track} role="progressbar" aria-label="Deliveries loaded" aria-valuemin={0} aria-valuemax={deliveries.length} aria-valuenow={loaded} aria-valuetext={`${loaded} of ${deliveries.length} deliveries loaded`}><i style={{ width: `${percent}%` }} /></div>
      <strong>{percent}%</strong>
    </div>
    <p className={styles.count}>{loaded} of {deliveries.length} deliveries loaded</p>

    {deliveries.length > 0 && <ul className={styles.list} aria-label="Deliveries to load">
      {deliveries.map((stop) => <li key={stop.canonicalId}>
        <button type="button" className={`${styles.row} ${stop.loaded ? styles.rowLoaded : ""}`} aria-label={openLabel(stop)} onClick={(event) => onOpen(event.currentTarget, stop)}>
          <span className={styles.state}>{stop.loaded ? "Loaded" : "Not loaded"}</span>
          <span className={styles.site}>{siteLabel(stop)}</span>
          <span aria-hidden="true">›</span>
        </button>
      </li>)}
    </ul>}

    {!ready && <div className={styles.blockers} role="status"><p>Dispatch is blocked until:</p><ul>{blockers.map((text) => <li key={text}>{text}</li>)}</ul></div>}

    <button type="button" className={`primary-action ${styles.dispatch}`} disabled={pending || !ready} onClick={onDispatch}>{pending ? pendingLabel : "Dispatch vehicle"}</button>
  </section>;
}
