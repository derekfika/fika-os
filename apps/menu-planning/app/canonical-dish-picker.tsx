"use client";

import { useEffect, useMemo, useState } from "react";
import PlannerModal from "./planner-modal";
import DishPickerFilters from "./dish-picker-filters";
import { rankDishPickerItems } from "@/lib/dish-picker";
import { categoryForSlot } from "@/lib/dish-categories";
import { loadDishTagRegistry } from "@/lib/dish-tag-client";
import type { DishTag } from "@/lib/dish-tags";
import { dishSlotRecommendation } from "@/lib/dish-slot-recommendations";
import { resolveEnter } from "@/lib/dish-editor";
import { emptyPickerFilters, filterOptions, filterPickerDishes, type PickerFilters } from "@/lib/dish-picker-filters";
import type { Dish } from "./planner-data";

type Props = {
  dishes: Dish[];
  initialQuery: string;
  onQueryChange: (value: string) => void;
  filters: PickerFilters;
  setFilters: (filters: PickerFilters) => void;
  mode: "recommended" | "all";
  setMode: (mode: "recommended" | "all") => void;
  slot: string;
  displaySlotLabel?: string;
  onChoose: (dish: Dish) => void;
  onCreate: (name: string) => void;
  canCreate?: boolean;
  onClose: () => void;
};

/** The planner's canonical Dish Library picker, shared with saved daily menu editing. */
export default function CanonicalDishPicker({ dishes, initialQuery, onQueryChange, filters, setFilters, mode, setMode, slot, displaySlotLabel, onChoose, onCreate, canCreate = true, onClose }: Props) {
  const [query, setLocalQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [tags, setTags] = useState<DishTag[]>([]);
  const [tagsUnavailable, setTagsUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDishTagRegistry().then(body => { if (active) setTags(body.tags); }).catch(() => { if (active) setTagsUnavailable(true); });
    return () => { active = false; };
  }, []);

  const setQuery = (value: string) => { setLocalQuery(value); onQueryChange(value); setActiveIndex(-1); };
  const result = useMemo(() => filterPickerDishes(dishes, slot, query, filters), [dishes, slot, query, filters]);
  const filtered = useMemo(() => rankDishPickerItems(result.dishes, "", slot, tags), [result.dishes, slot, tags]);
  const options = useMemo(() => filterOptions(dishes, tags), [dishes, tags]);
  const tagLabels = useMemo(() => new Map(tags.map(tag => [tag.id, tag.label])), [tags]);
  const typed = query.trim();
  const enterResult = useMemo(() => resolveEnter(dishes.map(dish => ({ id: dish.id, name: dish.name, aliases: dish.aliases })), typed), [dishes, typed]);
  const canCreateDish = canCreate && Boolean(typed) && enterResult.kind === "create";
  const onEnter = () => {
    if (activeIndex >= 0 && filtered[activeIndex]) { onChoose(filtered[activeIndex]); return; }
    if (enterResult.kind === "existing") { const dish = dishes.find(entry => entry.id === enterResult.dish.id); if (dish) onChoose(dish); }
    else if (enterResult.kind === "create") onCreate(enterResult.name);
  };

  return <PlannerModal title="Select dish" onClose={onClose} className="dish-picker-dialog">
    <aside className="dish-picker">
      <header><div><small>{displaySlotLabel || slot}</small><h3>Select dish</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close dish picker">Close</button></header>
      <p className="dish-picker-category">Search the entire Dish Library. Recommended dishes for this row appear first.</p>
      <label htmlFor="canonical-dish-search">Search all dishes</label>
      <input id="canonical-dish-search" data-modal-autofocus role="combobox" aria-expanded="true" aria-controls="canonical-dish-results" aria-activedescendant={activeIndex >= 0 && filtered[activeIndex] ? `canonical-dish-option-${activeIndex}` : undefined} aria-autocomplete="list" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => Math.max(0, Math.min(filtered.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
        else if (event.key === "Enter") { event.preventDefault(); onEnter(); }
      }} placeholder="Search any dish, or type a new name and press Enter" />
      <DishPickerFilters filters={filters} onChange={value => { setFilters(value); setActiveIndex(-1); }} tagOptions={options.tagOptions} categoryOptions={options.categoryOptions} subtypeOptions={options.subtypeOptions} tagLabels={tagLabels} shown={filtered.length} offered={result.offered} tagsUnavailable={tagsUnavailable} />
      <div className="dish-picker-list" role="listbox" id="canonical-dish-results" aria-label="Existing dishes">
        {filtered.map((dish, index) => {
          const recommendation = dishSlotRecommendation(dish, slot, tags);
          const recommended = dish.category === categoryForSlot(slot) || dish.tagIds?.some(id => id === `dish-tag:type:menu-use-${categoryForSlot(slot).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`);
          return <div className="dish-picker-row" key={dish.id}><button type="button" id={`canonical-dish-option-${index}`} role="option" aria-selected={activeIndex === index} onClick={() => onChoose(dish)}><strong>{dish.name}</strong><small>Existing dish · {dish.category || "Uncategorised"}{recommended ? " · Recommended for this row" : " · Available for this row"}{recommendation.reason ? ` · ${recommendation.reason}` : ""}</small></button></div>;
        })}
        {!filtered.length && <p className="dish-picker-empty" role="status">No existing dishes match this search and the selected filters.</p>}
      </div>
      {canCreateDish && <button type="button" className="dish-picker-create" onClick={() => onCreate(typed)}>＋ Create “{typed}” as a new dish (or press Enter)</button>}
      {enterResult.kind === "existing" && !filtered.some(dish => dish.id === enterResult.dish.id) && <button type="button" className="dish-picker-create" onClick={onEnter}>Use existing dish “{enterResult.dish.name}” (hidden by selected filters)</button>}
      <p>Creating a new dish saves it immediately to the Dish Library. Its placement in this week is saved with Save Week.</p>
    </aside>
  </PlannerModal>;
}

export const initialCanonicalDishPickerFilters = emptyPickerFilters;
