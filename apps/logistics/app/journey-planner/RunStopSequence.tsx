import type { SequenceChipView } from "./model";
import styles from "./timeline.module.css";

/**
 * Compact visiting sequence: CPU → customer visits → CPU. Order is the persisted canonical visiting
 * order. Spacing carries NO time meaning; arrival times are never inferred from it.
 */
export function RunStopSequence({ runTitle, chips, onSelectStop, offset = 0 }: { runTitle: string; chips: SequenceChipView[]; onSelectStop?: (stopKey: string) => void; /** Starting inset (px) so the sequence sits under its bar; the list may slide left to stay fully visible. */ offset?: number }) {
  return <div className={styles.sequenceRow}><span className={styles.sequenceSpacer} style={{ width: offset }} aria-hidden="true" /><ol className={styles.sequence} aria-label={`Visiting sequence for ${runTitle}`}>
    {chips.map((chip, index) => <li key={chip.key}>
      {index > 0 && <span className={styles.arrow} aria-hidden="true">→</span>}
      {chip.kind === "visit"
        ? <button type="button" className={styles.chip} data-kind="visit" data-collection-only={chip.collections > 0 && chip.deliveries === 0 ? "true" : undefined} title={`${chip.label}${chip.deliveries ? ` · ${chip.deliveries} deliver${chip.deliveries === 1 ? "y" : "ies"}` : ""}${chip.collections ? ` · ${chip.collections} collection${chip.collections === 1 ? "" : "s"}` : ""}`} onClick={() => onSelectStop?.(chip.stopKey)} aria-label={`${chip.label}: ${chip.deliveries} delivery, ${chip.collections} collection. Open stop`}>
            <span className={styles.chipName}>{chip.label}</span>
            <small>{chip.deliveries > 0 && <>D{chip.deliveries}</>}{chip.deliveries > 0 && chip.collections > 0 && " "}{chip.collections > 0 && <b>C{chip.collections}</b>}</small>
          </button>
        : <span className={styles.chip} data-kind={chip.kind} title={chip.kind === "cpu-departure" ? "Departs CPU" : "Returns to CPU"}>CPU</span>}
    </li>)}
  </ol></div>;
}
