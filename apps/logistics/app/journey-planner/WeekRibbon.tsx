"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import styles from "./week.module.css";

export type WeekDayView = {
  /** YYYY-MM-DD */
  date: string;
  weekday: string;
  dayLabel: string;
  /** Real summary counts; undefined while the summary is not current, so nothing is ever invented. */
  runs?: number;
  unplanned?: number;
  attention?: boolean;
  loading?: boolean;
};
export type WeekRibbonView = { label: string; days: WeekDayView[]; selectedDate?: string };

/**
 * Compact Monday–Friday selector. FIKA Logistics runs on working days only, so the weekend never appears here
 * (any historical weekend record stays reachable by date; it is simply not offered as a normal planning day).
 */
export function WeekRibbon({ week, onSelect, onPrevious, onNext }: { week: WeekRibbonView; onSelect: (date: string) => void; onPrevious: () => void; onNext: () => void }) {
  return <nav className={styles.ribbon} aria-label="Working week">
    <button type="button" className={styles.step} onClick={onPrevious} aria-label="Previous working week"><ChevronLeftIcon size={18} /></button>
    <div className={styles.days} role="group" aria-label={`Working days, ${week.label}`}>
      {week.days.map((day) => {
        const selected = day.date === week.selectedDate;
        return <button key={day.date} type="button" className={styles.day} data-selected={selected ? "true" : undefined} data-day={day.date} aria-pressed={selected} aria-current={selected ? "date" : undefined}
          aria-label={`${day.weekday} ${day.dayLabel}: ${day.runs === undefined ? "summary loading" : `${day.runs} ${day.runs === 1 ? "run" : "runs"}, ${day.unplanned} unplanned`}${day.attention ? ", needs attention" : ""}`}
          onClick={() => onSelect(day.date)}>
          <span className={styles.dayHead}><strong>{day.weekday}</strong><span>{day.dayLabel}</span>{day.attention && <i className={styles.flag} title="Needs attention" aria-hidden="true" />}</span>
          <span className={styles.counts}>
            <span><b>{day.runs ?? "—"}</b> {day.runs === 1 ? "run" : "runs"}</span>
            <span data-unplanned={day.unplanned ? "true" : undefined}><b>{day.unplanned ?? "—"}</b> unplanned</span>
          </span>
        </button>;
      })}
    </div>
    <span className={styles.range}>{week.label}</span>
    <button type="button" className={styles.step} onClick={onNext} aria-label="Next working week"><ChevronRightIcon size={18} /></button>
  </nav>;
}
