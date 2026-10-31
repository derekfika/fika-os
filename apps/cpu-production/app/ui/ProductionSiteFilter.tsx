"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./ProductionSiteFilter.module.css";
import {
  searchSiteOptions,
  selectShown,
  siteSelectionSummary,
  toggleSite,
  type FilterChip,
  type SiteOption,
  type ViewState,
} from "../../lib/production-view-filters";

/**
 * Searchable multi-select over canonical OPLOC identities. An empty selection means
 * all sites. Selections persist across view switches and date changes; the options
 * list only reflects sites present in the currently loaded orders.
 */
export function ProductionSiteFilter({ options, selected, onChange }: { options: readonly SiteOption[]; selected: readonly string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const searchId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shown = useMemo(() => searchSiteOptions(options, query), [options, query]);
  const missing = selected.filter((id) => !options.some((option) => option.id === id));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      className={styles.root}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.label}>Site</span>
        <span>{siteSelectionSummary(selected, options)}</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className={styles.panel} id={panelId} role="group" aria-label="Filter by site">
          <label className={styles.search} htmlFor={searchId}>
            <span>Search sites</span>
            <input id={searchId} type="search" value={query} autoComplete="off" placeholder="Type a site name" onChange={(event) => setQuery(event.target.value)} autoFocus />
          </label>
          <div className={styles.actions}>
            <button type="button" disabled={!shown.length} onClick={() => onChange(selectShown(selected, shown))}>
              {query.trim() ? "Select all shown" : "Select all"}
            </button>
            <button type="button" disabled={!selected.length} onClick={() => onChange([])}>Clear</button>
            <button type="button" onClick={close}>Done</button>
          </div>
          <p className={styles.count} role="status" aria-live="polite">
            {selected.length ? `${selected.length} selected` : "All sites"} · {shown.length} of {options.length} shown
          </p>
          {shown.length ? (
            <ul className={styles.list}>
              {shown.map((option) => (
                <li key={option.id}>
                  <label className={styles.option}>
                    <input type="checkbox" checked={selected.includes(option.id)} onChange={() => onChange(toggleSite(selected, option.id))} />
                    <span>{option.label}</span>
                    <small>{option.count} order{option.count === 1 ? "" : "s"}</small>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.none}>{options.length ? "No site matches that search." : "No sites in the loaded orders."}</p>
          )}
          {missing.length > 0 && (
            <p className={styles.none}>{missing.length} selected site{missing.length === 1 ? " has" : "s have"} no orders in this view.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One visible summary of every active filter, with counts, state messages and a single reset. */
export function ProductionFilterSummary({
  chips,
  onRemove,
  onReset,
  state,
  shownCount,
  eligibleCount,
  allSitesCount,
  unscopedCount,
  siteFiltered,
  noun = "production order",
}: {
  chips: readonly FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onReset: () => void;
  state: ViewState;
  shownCount: number;
  eligibleCount: number;
  allSitesCount: number;
  unscopedCount: number;
  siteFiltered: boolean;
  noun?: string;
}) {
  const plural = (count: number) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const filtered = chips.length > 0;
  return (
    <section className={styles.summary} aria-label="Active production filters">
      {filtered && (
        <ul className={styles.chips}>
          {chips.map((chip) => (
            <li key={chip.key}>
              <button type="button" className={styles.chip} onClick={() => onRemove(chip)} aria-label={`Remove filter ${chip.label}`}>
                {chip.label}
                <span aria-hidden="true"> ×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.line} role="status" aria-live="polite" aria-atomic="true">
        {state === "loading" && "Loading production orders…"}
        {state === "verified-empty" && "No production orders are due for this period. The current data loaded successfully and contains none."}
        {state === "filtered-empty" && `No production orders match these filters. ${plural(eligibleCount)} ${eligibleCount === 1 ? "is" : "are"} hidden by them.`}
        {state === "ready" && (filtered
          ? `Showing ${plural(shownCount)} ${siteFiltered ? "for the selected sites" : "matching the filters"}. All sites: ${plural(allSitesCount)}.`
          : `${plural(shownCount)} across all sites.`)}
        {state === "error" && "Production orders could not be shown. See the error message."}
      </p>
      {siteFiltered && unscopedCount > 0 && (
        <p className={styles.note}>{plural(unscopedCount)} without a site identity {unscopedCount === 1 ? "is" : "are"} only shown under All sites.</p>
      )}
      {filtered && (
        <button type="button" className={styles.reset} onClick={onReset}>Reset filters</button>
      )}
    </section>
  );
}
