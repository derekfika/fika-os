"use client";

import type { MenuStructureCategory, MenuStructureSnapshot } from "@/lib/menu-structure-library";
import { CANONICAL_MENU_SLOTS } from "../../shared/menu-section-order";

type Props = {
  structure: MenuStructureSnapshot;
  onChange: (structure: MenuStructureSnapshot) => void;
  disabled?: boolean;
};

const nextPlacement = (structure: MenuStructureSnapshot) => {
  const used = new Set(structure.categories.flatMap(category => category.rows.map(row => row.slot)));
  return CANONICAL_MENU_SLOTS.find(slot => !used.has(slot.id))?.id;
};

function move<T>(items: T[], index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export default function MenuStructureEditor({ structure, onChange, disabled = false }: Props) {
  const updateCategory = (categoryIndex: number, update: (category: MenuStructureCategory) => MenuStructureCategory) => {
    onChange({ ...structure, categories: structure.categories.map((category, index) => index === categoryIndex ? update(category) : category) });
  };
  const addCategory = () => {
    const slot = nextPlacement(structure);
    if (!slot) return;
    onChange({ ...structure, categories: [...structure.categories, { id: crypto.randomUUID(), name: "New category", rows: [{ id: crypto.randomUUID(), slot, name: "New row" }] }] });
  };
  const addRow = (categoryIndex: number) => {
    const slot = nextPlacement(structure);
    if (!slot) return;
    updateCategory(categoryIndex, category => ({ ...category, rows: [...category.rows, { id: crypto.randomUUID(), slot, name: "New row" }] }));
  };

  return <section className="menu-structure-editor" aria-label="Menu categories and rows">
    <div className="menu-structure-editor__heading"><div><h4>Menu structure</h4><p>Set category names and row order. Dishes and service details stay with each menu instance.</p></div><button type="button" className="button button-soft" disabled={disabled || !nextPlacement(structure)} onClick={addCategory}>Add category</button></div>
    {structure.categories.map((category, categoryIndex) => <section className="menu-structure-category" key={category.id} aria-label={`Category ${categoryIndex + 1}`}>
      <div className="menu-structure-category__heading">
        <label className="fika-field"><span>Category name</span><input className="fika-input" maxLength={60} value={category.name} onChange={event => updateCategory(categoryIndex, value => ({ ...value, name: event.target.value }))} /></label>
        <div className="menu-structure-order" aria-label={`Reorder ${category.name || "category"}`}>
          <button type="button" className="button button-soft" aria-label={`Move ${category.name || "category"} up`} disabled={disabled || categoryIndex === 0} onClick={() => onChange({ ...structure, categories: move(structure.categories, categoryIndex, -1) })}>↑</button>
          <button type="button" className="button button-soft" aria-label={`Move ${category.name || "category"} down`} disabled={disabled || categoryIndex === structure.categories.length - 1} onClick={() => onChange({ ...structure, categories: move(structure.categories, categoryIndex, 1) })}>↓</button>
          <button type="button" className="button button-soft" disabled={disabled || structure.categories.length <= 1} onClick={() => onChange({ ...structure, categories: structure.categories.filter((_, index) => index !== categoryIndex) })}>Remove</button>
        </div>
      </div>
      <ol className="menu-structure-rows" aria-label={`${category.name || "Category"} rows`}>
        {category.rows.map((row, rowIndex) => <li className="menu-structure-row" key={row.id}>
          <span className="menu-structure-row__number">{rowIndex + 1}</span>
          <label className="fika-field"><span>Row name</span><input className="fika-input" maxLength={60} value={row.name} onChange={event => updateCategory(categoryIndex, value => ({ ...value, rows: value.rows.map((current, index) => index === rowIndex ? { ...current, name: event.target.value } : current) }))} /></label>
          <div className="menu-structure-order" aria-label={`Reorder ${row.name || "row"}`}>
            <button type="button" className="button button-soft" aria-label={`Move ${row.name || "row"} up`} disabled={disabled || rowIndex === 0} onClick={() => updateCategory(categoryIndex, value => ({ ...value, rows: move(value.rows, rowIndex, -1) }))}>↑</button>
            <button type="button" className="button button-soft" aria-label={`Move ${row.name || "row"} down`} disabled={disabled || rowIndex === category.rows.length - 1} onClick={() => updateCategory(categoryIndex, value => ({ ...value, rows: move(value.rows, rowIndex, 1) }))}>↓</button>
            <button type="button" className="button button-soft" disabled={disabled || category.rows.length <= 1} onClick={() => updateCategory(categoryIndex, value => ({ ...value, rows: value.rows.filter((_, index) => index !== rowIndex) }))}>Remove</button>
          </div>
        </li>)}
      </ol>
      <button type="button" className="button button-soft menu-structure-add-row" disabled={disabled || !nextPlacement(structure)} onClick={() => addRow(categoryIndex)}>Add row</button>
    </section>)}
    {!nextPlacement(structure) && <p className="fika-help">This layout uses all available menu placements.</p>}
  </section>;
}
