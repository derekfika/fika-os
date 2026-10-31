"use client";

import { useId, useMemo, useState } from "react";
import "./dish-picker-filters.css";
import {
  emptyPickerFilters,
  hasPickerFilters,
  pickerChips,
  removeChip,
  searchFilterOptions,
  toggleValue,
  type FilterOption,
  type PickerChip,
  type PickerFilters,
} from "@/lib/dish-picker-filters";

type Props = {
  filters: PickerFilters;
  onChange: (filters: PickerFilters) => void;
  tagOptions: readonly FilterOption[];
  categoryOptions: readonly FilterOption[];
  subtypeOptions: readonly FilterOption[];
  tagLabels: ReadonlyMap<string, string>;
  shown: number;
  offered: number;
  tagsUnavailable?: boolean;
};

/**
 * Tag / category / salad-slot filters for the Week Planner picker. Values within a group match any;
 * groups combine with AND. Options come from the shared registry and from what the slot offers, so
 * nothing is hard-coded and no filter lists a choice that would return nothing.
 */
export default function DishPickerFilters({ filters, onChange, tagOptions, categoryOptions, subtypeOptions, tagLabels, shown, offered, tagsUnavailable }: Props) {
  const [open, setOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const panelId = useId();
  const searchId = useId();
  const active = hasPickerFilters(filters);
  const count = filters.tagIds.length + filters.categories.length + filters.subtypes.length;
  const chips = useMemo(() => pickerChips(filters, { tags: tagLabels }), [filters, tagLabels]);
  const visibleTags = useMemo(() => searchFilterOptions(tagOptions, tagQuery), [tagOptions, tagQuery]);
  const showCategory = categoryOptions.length > 1 || filters.categories.length > 0;
  const showSubtype = subtypeOptions.length > 0;
  const nothingToFilter = !tagOptions.length && !showCategory && !showSubtype;

  const group = (legend: string, options: readonly FilterOption[], selected: readonly string[], toggle: (value: string) => void) => (
    <fieldset className="picker-filters__group">
      <legend>{legend}</legend>
      <div className="picker-filters__checks">
        {options.map((option) => (
          <label key={option.value} className="picker-filters__check">
            <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
            <span>{option.label}</span>
            <small>{option.count}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <section className="picker-filters" aria-label="Filter dishes">
      <div className="picker-filters__bar">
        <button type="button" className="picker-filters__toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
          Filters{count ? ` (${count})` : ""}
        </button>
        <p className="picker-filters__count" role="status" aria-live="polite" aria-atomic="true">
          {active ? `Showing ${shown} of ${offered} dish${offered === 1 ? "" : "es"}` : `${offered} dish${offered === 1 ? "" : "es"}`}
        </p>
        {active && <button type="button" className="picker-filters__reset" onClick={() => onChange(emptyPickerFilters)}>Reset filters</button>}
      </div>
      {chips.length > 0 && (
        <ul className="picker-filters__chips" aria-label="Active filters">
          {chips.map((chip: PickerChip) => (
            <li key={chip.key}>
              <button type="button" className="picker-filters__chip" onClick={() => onChange(removeChip(filters, chip))} aria-label={`Remove filter ${chip.label}`}>{chip.label} <span aria-hidden="true">×</span></button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="picker-filters__panel" id={panelId}>
          {nothingToFilter && <p className="picker-filters__note">{tagsUnavailable ? "Tags could not be loaded, so there is nothing to filter by yet." : "No dish in this slot has tags yet. Add tags when you create or edit a dish to filter by them."}</p>}
          {tagOptions.length > 0 && (
            <div>
              <label className="picker-filters__search" htmlFor={searchId}>Search tags
                <input id={searchId} type="search" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="Type a tag name" autoComplete="off" />
              </label>
              {visibleTags.length ? group("Tags", visibleTags, filters.tagIds, (value) => onChange({ ...filters, tagIds: toggleValue(filters.tagIds, value) })) : <p className="picker-filters__note">No tag matches that search.</p>}
            </div>
          )}
          {showCategory && group("Category", categoryOptions, filters.categories, (value) => onChange({ ...filters, categories: toggleValue(filters.categories, value) }))}
          {showSubtype && group("Salad slot", subtypeOptions, filters.subtypes, (value) => onChange({ ...filters, subtypes: toggleValue(filters.subtypes, value) }))}
        </div>
      )}
    </section>
  );
}
