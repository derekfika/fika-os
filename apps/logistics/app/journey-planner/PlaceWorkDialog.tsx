"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./dialog.module.css";

const onQuarter = (time: string) => /^([01]\d|2[0-3]):(00|15|30|45)$/.test(time);

/**
 * Shown when work is dropped on a Run but the work has no requested time. The planned time must come from
 * Franco; it is never guessed from the Run or the drop position.
 */
export function PlaceWorkDialog({ destination, runTitle, kind, busy = false, onPlace, onClose }: {
  destination: string;
  runTitle: string;
  kind: "delivery" | "collection";
  busy?: boolean;
  onPlace: (time: string) => void;
  onClose: () => void;
}) {
  const [time, setTime] = useState("");
  const [touched, setTouched] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("input")?.focus();
    return () => previous?.focus();
  }, []);
  const problem = !time ? "Choose a time." : !onQuarter(time) ? "Use a 15-minute mark (for example 10:15)." : undefined;
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="place-work-title" ref={dialog}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") || []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <h2 id="place-work-title">Choose a {kind} time</h2>
      <p className={styles.lede}>{destination} has no requested time. Choose when this {kind} should be planned on {runTitle}.</p>
      <form onSubmit={(event) => { event.preventDefault(); setTouched(true); if (problem || busy) return; onPlace(time); }}>
        <div className={styles.times} style={{ gridTemplateColumns: "1fr" }}>
          <label>Planned {kind} time<input name="time" type="time" step={900} value={time} onChange={(event) => setTime(event.target.value)} aria-invalid={touched && Boolean(problem)} /></label>
        </div>
        {touched && problem && <p className={styles.problem} role="alert">{problem}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Placing…" : `Add to ${runTitle}`}</button>
        </div>
      </form>
    </div>
  </div>;
}
