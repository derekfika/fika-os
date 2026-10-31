"use client";

import { addOperationalDays, formatProductionTotalsDateRange, operationalWeekRange, productionTotalsWeekDates } from "../../lib/production-totals-range";

function dayLabel(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  return {
    date,
    weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date),
    label: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date),
  };
}

export function ProductionWeekNavigation({ weekCommencing, onWeekChange }: { weekCommencing: string; onWeekChange: (week: string) => void }) {
  return <div className="cpu-totals-week-navigation" aria-label="Select production week">
    <button type="button" aria-label="Previous week" disabled={!weekCommencing} onClick={() => onWeekChange(addOperationalDays(weekCommencing, -7))}>‹ Previous week</button>
    <strong>{weekCommencing ? formatProductionTotalsDateRange(operationalWeekRange(weekCommencing)) : "Loading week…"}</strong>
    <button type="button" aria-label="Next week" disabled={!weekCommencing} onClick={() => onWeekChange(addOperationalDays(weekCommencing, 7))}>Next week ›</button>
  </div>;
}

export function ProductionWeekDays({ weekCommencing, selectedDays, singleSelect = false, onSelect }: { weekCommencing: string; selectedDays: readonly number[]; singleSelect?: boolean; onSelect: (days: number[]) => void }) {
  return <div className="cpu-totals-day-picker" role="group" aria-label={singleSelect ? "Run sheet production day" : "Production days"}>
    {productionTotalsWeekDates(weekCommencing).map((day, index) => {
      const { date, weekday, label } = dayLabel(day);
      const pressed = selectedDays.includes(index);
      return <button type="button" key={day} className={`${index < 5 ? "cpu-totals-weekday" : "cpu-totals-weekend"}${pressed ? " selected" : ""}`} aria-label={`${label}${index >= 5 ? ", weekend" : ""}`} aria-pressed={pressed} onClick={() => onSelect(singleSelect ? [index] : (pressed ? selectedDays.filter(value => value !== index) : [...selectedDays, index]).sort((a, b) => a - b))}><span>{weekday}</span><strong>{date.getUTCDate()}</strong></button>;
    })}
  </div>;
}

export function ProductionWeekShortcuts({ selectedDays, onSelect }: { selectedDays: readonly number[]; onSelect: (days: number[]) => void }) {
  return <div className="cpu-totals-day-shortcuts" role="group" aria-label="Day selection shortcuts">
    <button type="button" aria-pressed={selectedDays.length === 5 && selectedDays.every((day, index) => day === index)} onClick={() => onSelect([0, 1, 2, 3, 4])}>Weekdays</button>
    <button type="button" aria-pressed={selectedDays.length === 7} onClick={() => onSelect([0, 1, 2, 3, 4, 5, 6])}>All days</button>
  </div>;
}
