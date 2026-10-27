"use client";

import type { DeliveryStop } from "../../lib/types";
import { BoxIcon, PlayIcon } from "./icons";
import styles from "./run-load-check.module.css";

export function RunLoadCheck({ deliveries, blockers, pending, pendingLabel, onDispatch }: {
  deliveries: DeliveryStop[];
  blockers: string[];
  pending: boolean;
  pendingLabel: string;
  onDispatch: () => void;
}) {
  const loaded = deliveries.filter((stop) => stop.loaded).length;
  const percent = deliveries.length ? Math.round((loaded / deliveries.length) * 100) : 0;
  const ready = blockers.length === 0;

  return <section className={styles.check} aria-label="Load check">
    <div className={styles.head}>
      <span className={styles.icon}><BoxIcon size={34} /></span>
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

    {!ready && <div className={styles.blockers} role="status"><p>Dispatch is blocked until:</p><ul>{blockers.map((text) => <li key={text}>{text}</li>)}</ul></div>}

    <button type="button" className={`primary-action ${styles.dispatch}`} disabled={pending || !ready} onClick={onDispatch}><PlayIcon size={18} /><span>{pending ? pendingLabel : "Dispatch vehicle"}</span></button>
  </section>;
}
