"use client";

import { useId } from "react";
import styles from "./DashboardQueueFilters.module.css";
import { describeFilters, emptyQueueFilters, hasActiveFilters, queueSortOptions, type QueueFilters, type QueueSort } from "../../lib/dashboard-queue-filters";

type Props = {
  filters: QueueFilters;
  onChange: (filters: QueueFilters) => void;
  statuses: readonly string[];
  shown: number;
  total: number;
  loading: boolean;
};

const toggle = (values: readonly string[], value: string) => (values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);

export function DashboardQueueFilters({ filters, onChange, statuses, shown, total, loading }: Props) {
  const id = useId();
  const active = hasActiveFilters(filters);
  const chips = describeFilters(filters);
  const dateOrderError = Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo);
  const set = (patch: Partial<QueueFilters>) => onChange({ ...filters, ...patch });
  const removeChip = (key: string) => {
    if (key === "search") set({ search: "" });
    else if (key === "date") set({ dateFrom: "", dateTo: "" });
    else if (key.startsWith("status:")) set({ statuses: filters.statuses.filter((status) => status !== key.slice(7)) });
  };

  return (
    <form
      className={styles.filters}
      role="search"
      aria-label="Search and filter bookings"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className={styles.row}>
        <label className={styles.field} htmlFor={`${id}-search`}>
          <span>Search bookings</span>
          <input
            id={`${id}-search`}
            type="search"
            value={filters.search}
            placeholder="Booker, company, site or booking reference"
            autoComplete="off"
            onChange={(event) => set({ search: event.target.value })}
          />
        </label>
        <label className={styles.field} htmlFor={`${id}-from`}>
          <span>Service date from</span>
          <input id={`${id}-from`} type="date" value={filters.dateFrom} max={filters.dateTo || undefined} aria-invalid={dateOrderError || undefined} onChange={(event) => set({ dateFrom: event.target.value })} />
        </label>
        <label className={styles.field} htmlFor={`${id}-to`}>
          <span>Service date to</span>
          <input id={`${id}-to`} type="date" value={filters.dateTo} min={filters.dateFrom || undefined} aria-invalid={dateOrderError || undefined} onChange={(event) => set({ dateTo: event.target.value })} />
        </label>
        <label className={styles.field} htmlFor={`${id}-sort`}>
          <span>Sort by</span>
          <select id={`${id}-sort`} value={filters.sort} onChange={(event) => set({ sort: event.target.value as QueueSort })}>
            {queueSortOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {dateOrderError && (
        <p className={styles.error} role="alert">The end date is before the start date, so no bookings can match.</p>
      )}

      {statuses.length > 0 && (
        <div className={styles.row}>
          {statuses.length > 0 && (
            <fieldset className={styles.group}>
              <legend>Status</legend>
              <div className={styles.checks}>
                {statuses.map((status) => (
                  <label key={status} className={styles.check}>
                    <input type="checkbox" checked={filters.statuses.includes(status)} onChange={() => set({ statuses: toggle(filters.statuses, status) })} />
                    <span>{status}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      <div className={styles.summary}>
        <p role="status" aria-live="polite" aria-atomic="true">
          {loading ? "Loading bookings…" : active ? `Showing ${shown} of ${total} booking${total === 1 ? "" : "s"}` : `${total} booking${total === 1 ? "" : "s"}`}
        </p>
        {chips.length > 0 && (
          <ul className={styles.chips} aria-label="Active filters">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button type="button" className={styles.chip} onClick={() => removeChip(chip.key)} aria-label={`Remove filter ${chip.label}`}>
                  {chip.label}
                  <span aria-hidden="true"> ×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={styles.reset} disabled={!active && filters.sort === emptyQueueFilters.sort} onClick={() => onChange(emptyQueueFilters)}>
          Reset filters
        </button>
      </div>
    </form>
  );
}
