import type { SequenceChipView } from "./model";
import styles from "./timeline.module.css";

/**
 * Compact visiting sequence: CPU → customer visits → CPU. Order is the persisted canonical visiting
 * order. Spacing carries NO time meaning; arrival times are never inferred from it.
 *
 * Each chip is followed by its own arrow (except the last), so when the list wraps a line always ends
 * with an arrow pointing on to the next chip, never starts with a dangling one.
 */
export function RunStopSequence({ runId, selected, runTitle, chips, onSelectStop, offset = 0, activeKey }: { /** Stable run identity, exposed as data-run-stops so the sequence can be located under its own run. */ runId?: string; selected?: boolean; runTitle: string; chips: SequenceChipView[]; onSelectStop?: (stopKey: string) => void; /** Starting inset (px) so the sequence sits under its bar; the list may slide left to stay fully visible. */ offset?: number; activeKey?: string }) {
  const visits = chips.filter((chip) => chip.kind === "visit");
  return <div className={styles.sequenceRow} data-run-stops={runId} data-drop-run-id={runId} data-selected={selected ? "true" : undefined}><span className={styles.sequenceSpacer} style={{ width: offset }} aria-hidden="true" /><ol className={styles.sequence} aria-label={`Visiting sequence for ${runTitle}`}>
    {chips.map((chip, index) => {
      const last = index === chips.length - 1;
      const ordinal = chip.kind === "visit" ? visits.findIndex((visit) => visit.key === chip.key) + 1 : 0;
      return <li key={chip.key}>
        {chip.kind === "visit"
          ? <button type="button" className={styles.chip} data-kind="visit" data-stop-chip={chip.stopKey} data-active={activeKey === chip.stopKey ? "true" : undefined} data-collection-only={chip.collections > 0 && chip.deliveries === 0 ? "true" : undefined} title={`Stop ${ordinal}: ${chip.label}${chip.deliveries ? ` · ${chip.deliveries} deliver${chip.deliveries === 1 ? "y" : "ies"}` : ""}${chip.collections ? ` · ${chip.collections} collection${chip.collections === 1 ? "" : "s"}` : ""}`} onClick={() => onSelectStop?.(chip.stopKey)} aria-label={`Stop ${ordinal}, ${chip.label}: ${chip.deliveries} deliver${chip.deliveries === 1 ? "y" : "ies"}, ${chip.collections} collection${chip.collections === 1 ? "" : "s"}. Open stop`}>
            <span className={styles.chipName}>{chip.label}</span>
            <small>{chip.deliveries > 0 && <>D{chip.deliveries}</>}{chip.deliveries > 0 && chip.collections > 0 && " "}{chip.collections > 0 && <b>C{chip.collections}</b>}</small>
          </button>
          : <span className={styles.chip} data-kind={chip.kind} title={chip.kind === "cpu-departure" ? "Departs CPU" : "Returns to CPU"}>CPU</span>}
        {!last && <span className={styles.arrow} aria-hidden="true">→</span>}
      </li>;
    })}
  </ol></div>;
}
