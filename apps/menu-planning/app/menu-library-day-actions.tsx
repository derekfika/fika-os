"use client";

import { useEffect, useMemo, useState } from "react";
import { captureDayAsSavedMenuContent, savedMenuCompatibilityReason, type SavedDailyMenu } from "@/lib/menu-library";
import type { RollingSnapshot } from "@/lib/rolling-menu-types";
import PlannerModal from "./planner-modal";
import "./menu-library.css";

type ApiMenuResponse = { menus?: SavedDailyMenu[]; error?: { message?: string } };
type Props = { snapshot: RollingSnapshot; dayId: string; onClose: () => void };

async function readMenus(): Promise<SavedDailyMenu[]> {
  const response = await fetch("/api/menu-library", { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as ApiMenuResponse;
  if (!response.ok) throw new Error(body.error?.message || "The Menu Library could not be loaded.");
  return (body.menus || []).filter(menu => !menu.archivedAt);
}

export function SaveDayToMenuLibraryDialog({ snapshot, dayId, onClose }: Props) {
  const day = snapshot.days.find(candidate => candidate.id === dayId);
  const [name, setName] = useState(day ? `${snapshot.week.supplementaryMenu?.serviceType || "Lunch"} · ${day.dayName}` : "");
  const [category, setCategory] = useState("regular");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const save = async () => {
    setSaving(true); setError(""); setSaved("");
    try {
      const menu = captureDayAsSavedMenuContent(snapshot, dayId, { name, category: category as "regular" | "seasonal" | "themed" | "other", tags: tags.split(",").map(value => value.trim()).filter(Boolean) });
      const response = await fetch("/api/menu-library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", menu }) });
      const body = await response.json().catch(() => ({})) as ApiMenuResponse;
      if (!response.ok) throw new Error(body.error?.message || "The day could not be saved to the Menu Library.");
      setSaved("Day saved to Menu Library. Its planner quantities and publication state stay with this service.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The day could not be saved to the Menu Library."); }
    finally { setSaving(false); }
  };

  return <PlannerModal title="Save day to Menu Library" onClose={onClose} busy={saving} className="item-detail menu-library-dialog">
    <div className="fika-ui menu-library-ui menu-library-day-action">
      <header><div><small>{day?.dayName} · {day?.date} · {snapshot.week.supplementaryMenu?.serviceType || "Lunch"}</small><h3>Save day to Menu Library</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close">Close</button></header>
      <p>Save the canonical dishes and layout. The saved menu will not include portions, site allocations, PAX, publication state or allergen reviews.</p>
      <label className="fika-field"><span>Menu name</span><input className="fika-input" maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
      <div className="menu-library-day-action__fields">
        <label className="fika-field"><span>Category</span><select className="fika-select" value={category} onChange={event => setCategory(event.target.value)}><option value="regular">Regular service</option><option value="seasonal">Seasonal</option><option value="themed">Themed</option><option value="other">Other</option></select></label>
        <label className="fika-field"><span>Tags <small>(comma separated)</small></span><input className="fika-input" value={tags} onChange={event => setTags(event.target.value)} placeholder="e.g. seasonal, Christmas" /></label>
      </div>
      {error && <p className="fika-notice fika-notice--danger" role="alert">{error}</p>}{saved && <p className="fika-notice menu-library-success" role="status">{saved}</p>}
      <footer><button type="button" className="button button-soft" disabled={saving} onClick={onClose}>Close</button><button type="button" className="button button-purple" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? "Saving…" : saved ? "Save another copy" : "Save to Menu Library"}</button></footer>
    </div>
  </PlannerModal>;
}

export function LoadFromMenuLibraryDialog({ snapshot, dayId, onClose, onLoad }: Props & { onLoad: (menu: SavedDailyMenu) => Promise<boolean> }) {
  const [menus, setMenus] = useState<SavedDailyMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [applying, setApplying] = useState(false);
  const day = snapshot.days.find(candidate => candidate.id === dayId);

  useEffect(() => { let active = true; void readMenus().then(value => { if (active) setMenus(value); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "The Menu Library could not be loaded."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const choices = useMemo(() => {
    const cleanQuery = query.trim().toLocaleLowerCase();
    return menus.filter(menu => !cleanQuery || [menu.name, menu.serviceType, ...menu.tags, ...menu.dishes.map(dish => dish.dishName)].some(value => value.toLocaleLowerCase().includes(cleanQuery)))
      .map(menu => ({ menu, reason: savedMenuCompatibilityReason(menu, snapshot) }));
  }, [menus, query, snapshot]);
  const selected = menus.find(menu => menu.id === selectedId);
  const reason = selected && savedMenuCompatibilityReason(selected, snapshot);
  const targetEntries = snapshot.entries.filter(entry => entry.dayId === dayId && entry.itemId);
  const changedDishCount = selected ? targetEntries.filter(entry => {
    const dish = selected.dishes.find(item => item.slot === entry.slot);
    const isInSavedStructure = selected.structure.categories.some(category => category.rows.some(row => row.slot === entry.slot));
    return !isInSavedStructure || !dish || dish.dishId !== entry.itemId;
  }).length : 0;

  const apply = async () => {
    if (!selected || reason || (changedDishCount > 0 && !acknowledged)) return;
    setApplying(true); setError("");
    try { if (await onLoad(selected)) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The saved menu could not be loaded into this day."); }
    finally { setApplying(false); }
  };

  return <PlannerModal title="Load from Menu Library" onClose={onClose} busy={applying} className="item-detail menu-library-dialog">
    <div className="fika-ui menu-library-ui menu-library-day-action">
      <header><div><small>{day?.dayName} · {day?.date} · {snapshot.week.supplementaryMenu?.serviceType || "Lunch"}</small><h3>Load from Menu Library</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close">Close</button></header>
      <p>Choose a compatible menu and preview it before applying. The target date, PAX and service details stay with this planner day.</p>
      <label className="fika-field"><span>Search saved menus</span><input className="fika-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, dishes or tags" /></label>
      {loading ? <p role="status">Loading saved menus…</p> : <div className="menu-library-load-list" role="listbox" aria-label="Saved daily menus">{choices.map(({ menu, reason: incompatibility }) => <button type="button" role="option" aria-selected={selectedId === menu.id} className="menu-library-load-option" key={menu.id} disabled={Boolean(incompatibility)} onClick={() => { setSelectedId(menu.id); setAcknowledged(false); }}><span><strong>{menu.name}</strong><small>{menu.serviceType} · {menu.category} · {menu.dishes.length} dishes</small>{incompatibility && <small className="menu-library-load-option__reason">Unavailable: {incompatibility}</small>}</span>{selectedId === menu.id && <span aria-hidden="true">✓</span>}</button>)}{!choices.length && <p>No saved menus match this search.</p>}</div>}
      {selected && <section className="menu-library-load-preview" aria-label={`Preview ${selected.name}`}><h4>Preview · {selected.name}</h4>{selected.structure.categories.map(category => <div key={category.id}><strong>{category.name}</strong><ul>{category.rows.map(row => { const dish = selected.dishes.find(item => item.slot === row.slot); return <li key={row.id}><span>{row.name}</span><span>{dish?.dishName || "No dish saved"}</span></li>; })}</ul></div>)}</section>}
      {changedDishCount > 0 && selected && <label className="menu-library-load-warning"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span><strong>{changedDishCount} populated row{changedDishCount === 1 ? " will" : "s will"} change.</strong> Portions and destination allocations on changed dishes will be reset so quantities cannot carry to different food. PAX and service details stay unchanged. The loaded menu remains a local planner draft until Save Week.</span></label>}
      {error && <p className="fika-notice fika-notice--danger" role="alert">{error}</p>}
      <footer><button type="button" className="button button-soft" disabled={applying} onClick={onClose}>Cancel</button><button type="button" className="button button-purple" disabled={applying || loading || !selected || Boolean(reason) || Boolean(changedDishCount && !acknowledged)} onClick={() => void apply()}>{applying ? "Loading menu…" : "Load into day"}</button></footer>
    </div>
  </PlannerModal>;
}
