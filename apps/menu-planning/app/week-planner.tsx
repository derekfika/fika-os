"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import MenuPlanningShell from "./menu-planning-shell";
import { slotLabel, useRollingData, type Dish } from "./planner-data";
import { groupedSlots } from "@/lib/week-planner-layout";
import PlanningContextNav from "./planning-context-nav";
import { rankDishPickerItems } from "@/lib/dish-picker";
import { categoryForSlot } from "@/lib/dish-categories";
import { assessDishCopyTarget, compatibleDishCopyTargets, copyableDishForSource } from "@/lib/dish-copy";
import { invalidateCatalogueCache } from "@/lib/menu-catalogue-cache";
import { hasPlannedDishes } from "@/lib/rolling-menu-types";
import PlannerModal from "./planner-modal";
import { CANONICAL_DISH_CATEGORIES } from "@/lib/dish-categories";

function WeekMatrixScroller({ children }: { children: ReactNode }) {
  const topScrollbar = useRef<HTMLDivElement>(null);
  const matrixViewport = useRef<HTMLDivElement>(null);
  const matrix = useRef<HTMLDivElement>(null);

  const handleScrollbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scrollbar = topScrollbar.current;
    const viewport = matrixViewport.current;
    if (!scrollbar || !viewport) return;
    const step = Math.max(80, Math.round(scrollbar.clientWidth * 0.8));
    const max = Math.min(scrollbar.scrollWidth - scrollbar.clientWidth, viewport.scrollWidth - viewport.clientWidth);
    const current = Math.min(scrollbar.scrollLeft, viewport.scrollLeft);
    let next: number;
    if (event.key === "ArrowLeft") next = current - 80;
    else if (event.key === "ArrowRight") next = current + 80;
    else if (event.key === "PageUp") next = current - step;
    else if (event.key === "PageDown") next = current + step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = max;
    else return;
    scrollbar.scrollLeft = viewport.scrollLeft = Math.max(0, Math.min(max, next));
    event.preventDefault();
  };

  useEffect(() => {
    const scrollbar = topScrollbar.current;
    const viewport = matrixViewport.current;
    const content = matrix.current;
    if (!scrollbar || !viewport || !content) return;

    const spacer = scrollbar.firstElementChild as HTMLDivElement | null;
    const syncWidth = () => {
      if (spacer) spacer.style.width = `${content.scrollWidth}px`;
    };
    const resizeObserver = new ResizeObserver(syncWidth);
    resizeObserver.observe(content);
    syncWidth();

    const syncFromTop = () => {
      if (viewport.scrollLeft !== scrollbar.scrollLeft) viewport.scrollLeft = scrollbar.scrollLeft;
    };
    const syncFromMatrix = () => {
      if (scrollbar.scrollLeft !== viewport.scrollLeft) scrollbar.scrollLeft = viewport.scrollLeft;
    };
    scrollbar.addEventListener("scroll", syncFromTop, { passive: true });
    viewport.addEventListener("scroll", syncFromMatrix, { passive: true });
    return () => {
      resizeObserver.disconnect();
      scrollbar.removeEventListener("scroll", syncFromTop);
      viewport.removeEventListener("scroll", syncFromMatrix);
    };
  }, []);

  return <>
    <div className="week-matrix-scrollbar" ref={topScrollbar} role="region" aria-label="Scroll weekdays horizontally" aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown Home End" tabIndex={0} onKeyDown={handleScrollbarKeyDown}>
      <div aria-hidden="true" />
    </div>
    <div className="week-matrix-viewport" ref={matrixViewport} role="region" aria-label="Weekly menu grid">
      <div className="week-matrix" ref={matrix} role="table" aria-label="Weekly menu matrix">{children}</div>
    </div>
  </>;
}

export default function WeekPlanner() {
  const { snapshot, weeks, dishes, message, error, command, selectWeek } = useRollingData();
  const [query, setQuery] = useState(""); const [picker, setPicker] = useState<{ dayId: string; slot: string }>();
  const [dialog, setDialog] = useState<{ title: string; label: string; value: string; inputType?: "text" | "date"; placeholder?: string; submit: (value: string) => Promise<void> }>();
  const [duplicateSourceId, setDuplicateSourceId] = useState<string>();
  const [resetOpen, setResetOpen] = useState(false);
  const [menuRowOpen, setMenuRowOpen] = useState(false);
  const [draggedEntryId, setDraggedEntryId] = useState<string>();
  const [copyDialogSourceId, setCopyDialogSourceId] = useState<string>();
  const [copyFeedback, setCopyFeedback] = useState("");
  const [copyPending, setCopyPending] = useState(false);
  const copyPendingRef = useRef(false);
  if (!snapshot) return <MenuPlanningShell section="Week Planner"><div className="menu-loading">Loading Week Planner…</div></MenuPlanningShell>;
  const choose = async (dish: Dish) => { if (!picker) return; const entry = snapshot.entries.find(item => item.dayId === picker.dayId && item.slot === picker.slot); await command(entry ? "update-entry" : "create-entry", entry ? { weekId: snapshot.week.id, entryId: entry.id, patch: { itemId: dish.id, itemLabel: dish.name } } : { weekId: snapshot.week.id, dayId: picker.dayId, slot: picker.slot, itemId: dish.id, itemLabel: dish.name }); setPicker(undefined); };
  const createDish = async (name: string) => { const response = await fetch("/api/catalogue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create-dish", displayName: name, category: categoryForSlot(picker?.slot || "") }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || body.error || "The dish could not be created."); await invalidateCatalogueCache(); const item = body.item as { canonicalId: string; displayName: string; category: string }; await choose({ id: item.canonicalId, name: item.displayName, category: item.category }); };
  const weekDate = (offset: number) => { const date = new Date(`${snapshot.week.weekCommencing}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
  const populatedWeeks = weeks.filter(hasPlannedDishes);
  const menuGroups = groupedSlots(snapshot);
  const menuSlots = menuGroups.flatMap(([, slots]) => slots);
  const copyTargetsFor = (entryId: string) => compatibleDishCopyTargets(snapshot, dishes, entryId, menuSlots).filter(target => snapshot.days.slice(0, 5).some(day => day.id === target.dayId));
  const copyDish = async (sourceEntryId: string, dayId: string, slot: string) => {
    if (copyPendingRef.current) return false;
    const result = assessDishCopyTarget(snapshot, dishes, sourceEntryId, { dayId, slot });
    if (!result.allowed) { setCopyFeedback(result.reason); return false; }
    const targetDay = snapshot.days.find(day => day.id === dayId)!;
    copyPendingRef.current = true;
    setCopyPending(true);
    setCopyFeedback(`Copying ${result.dish.name} to ${targetDay.dayName}…`);
    try {
      const saved = result.blankTarget
        ? await command("update-entry", { weekId: snapshot.week.id, entryId: result.blankTarget.id, expectedWeekVersion: snapshot.week.version, patch: { itemId: result.dish.id, itemLabel: result.dish.name, portions: 0, allocations: [], allergens: {}, mayContainNotes: "", allergenReviewInvalidated: true } })
        : await command("create-entry", { weekId: snapshot.week.id, dayId, slot, itemId: result.dish.id, itemLabel: result.dish.name, expectedWeekVersion: snapshot.week.version });
      setCopyFeedback(saved ? `${result.dish.name} copied to ${targetDay.dayName} · ${slotLabel(slot)}.` : "The dish was not copied. Review the save error and retry.");
      return saved;
    } catch (cause) {
      setCopyFeedback(cause instanceof Error ? cause.message : "The dish could not be copied. Refresh the week and retry.");
      return false;
    } finally {
      copyPendingRef.current = false;
      setCopyPending(false);
    }
  };
  const duplicate = () => { const source = populatedWeeks.find(item => item.id !== snapshot.week.id); if (source) setDuplicateSourceId(source.id); };
  const blank = async () => { setDialog({ title: "Start blank week", label: "Blank week commencing (Monday)", value: weekDate(7), inputType: "date", submit: async target => { if (await command("create-week", { weekCommencing: target })) { window.history.pushState({}, "", `/?week=${target}`); window.dispatchEvent(new PopStateEvent("popstate")); } } }); };
  const addRow = () => setMenuRowOpen(true);
  const removeRow = async () => { setDialog({ title: "Remove menu row", label: "Menu row to remove", value: "", submit: async slot => { await command("remove-menu-slot", { weekId: snapshot.week.id, slot }); } }); };
  return <MenuPlanningShell section="Week Planner"><section className="workspace-intro planner-intro"><small>Delivered-In</small><h2>Week Planner</h2><p>{snapshot.entries.filter(entry => entry.itemLabel.trim()).length} dishes planned</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} /><div className="planner-toolbar"><span className={`status status--${snapshot.week.status}`}>{snapshot.week.status.replaceAll("_", " ")}</span>{message && <span role="status">{message}</span>}<button className="button button-soft" type="button" onClick={duplicate} disabled={populatedWeeks.filter(item => item.id !== snapshot.week.id).length < 1}>Duplicate week</button><button className="button button-soft" type="button" onClick={() => void blank()}>Start blank week</button><button className="button button-soft" type="button" onClick={addRow}>+ Add menu row</button><button className="button button-soft" type="button" onClick={() => void removeRow()}>Remove menu row</button><button className="button button-danger" type="button" onClick={() => setResetOpen(true)}>Reset week</button></div>{copyFeedback && <p className="menu-copy-feedback" role="status">{copyFeedback}</p>}{error && <div className="menu-error" role="alert">{error}</div>}<section className="workspace-panel week-planner-panel">
      <WeekMatrixScroller>
        <div className="week-matrix-corner">Menu slot</div>
        {snapshot.days.slice(0, 5).map(day => <div className="week-matrix-day" key={day.id}>{day.dayName.slice(0, 3).toUpperCase()}<small>{new Date(`${day.date}T00:00:00Z`).getUTCDate()}</small></div>)}
        {menuGroups.map(([group, slots]) => (
          <div className="week-matrix-group" key={group}>
            <span>{group}</span>
            {slots.map(slot => (
              <div className="week-matrix-row" key={slot}>
                <strong>{slotLabel(slot)}</strong>
                {snapshot.days.slice(0, 5).map(day => {
                  const entry = snapshot.entries.find(item => item.dayId === day.id && item.slot === slot);
                  const dish = entry ? copyableDishForSource(snapshot, dishes, entry.id) : undefined;
                  const drop = draggedEntryId ? assessDishCopyTarget(snapshot, dishes, draggedEntryId, { dayId: day.id, slot }) : undefined;
                  return <div className={`week-menu-cell${drop?.allowed ? " week-menu-cell--copy-target" : ""}`} key={day.id}
                    onDragOver={event => { if (!draggedEntryId) return; event.preventDefault(); event.dataTransfer.dropEffect = drop?.allowed ? "copy" : "none"; }}
                    onDrop={event => {
                      if (!draggedEntryId) return;
                      event.preventDefault();
                      const sourceEntryId = event.dataTransfer.getData("text/plain") || draggedEntryId;
                      setDraggedEntryId(undefined);
                      const assessment = assessDishCopyTarget(snapshot, dishes, sourceEntryId, { dayId: day.id, slot });
                      if (assessment.allowed) void copyDish(sourceEntryId, day.id, slot); else setCopyFeedback(assessment.reason);
                    }}>
                    <button className="week-menu-cell-button" draggable={Boolean(dish)} aria-label={entry ? `Select ${entry.itemLabel}; drag or use Copy to day` : `Select dish for ${day.dayName}, ${slotLabel(slot)}`}
                      onDragStart={event => { if (!entry || !dish) { event.preventDefault(); return; } setDraggedEntryId(entry.id); event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("text/plain", entry.id); }}
                      onDragEnd={() => setDraggedEntryId(undefined)}
                      onClick={() => { setQuery(""); setPicker({ dayId: day.id, slot }); }}>
                      {entry?.itemLabel || "+ Select dish"}{entry && <span className="week-menu-drag-handle" aria-hidden="true" title="Drag to copy">⠿</span>}
                    </button>
                    {entry && <div className="week-menu-cell-actions">
                      <button type="button" className="week-menu-copy-action" disabled={!dish || copyTargetsFor(entry.id).length === 0 || copyPending} onClick={() => setCopyDialogSourceId(entry.id)}>Copy to day</button>
                      <button type="button" className="week-menu-clear" aria-label={`Clear ${entry.itemLabel}`} onClick={() => void command("update-entry", { weekId: snapshot.week.id, entryId: entry.id, patch: { itemId: "", itemLabel: "", allocations: [], portions: 0 } })}>×</button>
                    </div>}
                  </div>;
                })}
              </div>
            ))}
          </div>
        ))}
      </WeekMatrixScroller>
    </section>{picker && <DishPicker dishes={dishes} query={query} setQuery={setQuery} slot={picker.slot} onChoose={choose} onCreate={createDish} onClose={() => setPicker(undefined)} />}{dialog && <PlannerInputDialog dialog={dialog} onClose={() => setDialog(undefined)} />}{menuRowOpen && <AddMenuRowDialog snapshot={snapshot} command={command} onClose={() => setMenuRowOpen(false)} />}{copyDialogSourceId && <CopyDishDialog sourceEntryId={copyDialogSourceId} sourceDish={snapshot.entries.find(entry => entry.id === copyDialogSourceId)?.itemLabel || "dish"} targets={copyTargetsFor(copyDialogSourceId)} onCopy={copyDish} onClose={() => setCopyDialogSourceId(undefined)} />}{duplicateSourceId && <DuplicateWeekDialog weeks={populatedWeeks} currentWeek={snapshot.week} sourceId={duplicateSourceId} command={command} onClose={() => setDuplicateSourceId(undefined)} />}{resetOpen && <ResetWeekDialog currentWeek={snapshot.week} entryCount={snapshot.entries.filter(entry => entry.itemLabel.trim()).length} command={command} onClose={() => setResetOpen(false)} />}</MenuPlanningShell>;
}

function CopyDishDialog({ sourceEntryId, sourceDish, targets, onCopy, onClose }: { sourceEntryId: string; sourceDish: string; targets: Array<{ dayId: string; slot: string; key: string; label: string }>; onCopy: (sourceEntryId: string, dayId: string, slot: string) => Promise<boolean>; onClose: () => void }) {
  const [targetKey, setTargetKey] = useState(targets[0]?.key || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const target = targets.find(item => item.key === targetKey);
    if (!target || saving) return;
    setSaving(true); setError("");
    try {
      const copied = await onCopy(sourceEntryId, target.dayId, target.slot);
      if (copied) onClose();
      else setError("The dish was not copied. Review the Week Planner error and retry.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The dish could not be copied."); } finally { setSaving(false); }
  };
  return <PlannerModal title="Copy dish to day" onClose={onClose} dismissible={!saving} busy={saving} className="item-detail planner-input-dialog copy-dish-dialog"><header><div><small>Week Planner</small><h3>Copy dish to day</h3></div><button type="button" className="modal-close" onClick={onClose} disabled={saving} aria-label="Close copy dialog">Close</button></header><p><strong>{sourceDish}</strong> will be copied as a new menu entry. Portions, destination allocations and allergen reviews will not be copied.</p><label>Target day and menu category<select data-modal-autofocus value={targetKey} onChange={event => setTargetKey(event.target.value)} disabled={saving}><option value="" disabled>Choose an empty compatible cell</option>{targets.map(target => <option value={target.key} key={target.key}>{target.label}</option>)}</select></label>{error && <p className="menu-error" role="alert">{error}</p>}<footer className="form-actions"><button type="button" className="button button-soft" onClick={onClose} disabled={saving}>Cancel</button><button type="button" className="button button-purple" onClick={() => void submit()} disabled={saving || !targets.some(target => target.key === targetKey)}>{saving ? "Copying…" : "Copy dish"}</button></footer></PlannerModal>;
}

function AddMenuRowDialog({ snapshot, command, onClose }: { snapshot: NonNullable<ReturnType<typeof useRollingData>["snapshot"]>; command: (action: string, extra?: Record<string, unknown>) => Promise<boolean>; onClose: () => void }) {
  const [category, setCategory] = useState<string>(CANONICAL_DISH_CATEGORIES[0]);
  const [persistence, setPersistence] = useState<"week" | "template">("week");
  const [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); const ok = await command("add-menu-slot", { weekId: snapshot.week.id, category, persistence }); setSaving(false); if (ok) onClose(); };
  return <PlannerModal title="Add menu row" onClose={onClose} dismissible={!saving} busy={saving} className="item-detail planner-input-dialog menu-row-dialog"><header><div><small>Week Planner · Menu composition</small><h3>Add menu row</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close">Close</button></header><label className="menu-row-field">Dish category<select data-modal-autofocus value={category} onChange={event => setCategory(event.target.value)}>{CANONICAL_DISH_CATEGORIES.map(value => <option value={value} key={value}>{value}</option>)}</select></label><label className="menu-row-field">Save row as<select value={persistence} onChange={event => setPersistence(event.target.value as "week" | "template")}><option value="week">Week-only row</option><option value="template">Permanent template row</option></select></label><p className="menu-row-preview">A new <strong>{category}</strong> menu row will be assigned the next available slot number. {persistence === "week" ? "It will be saved for this week only." : "It will be added to this week and to the standard template for future weeks."} Existing published menus keep their current published version until republished.</p><footer className="form-actions"><button type="button" className="button button-soft" onClick={onClose} disabled={saving}>Cancel</button><button type="button" className="button button-purple" onClick={() => void submit()} disabled={saving}>Add menu row</button></footer></PlannerModal>;
}

function PlannerInputDialog({ dialog, onClose }: { dialog: { title: string; label: string; value: string; inputType?: "text" | "date"; placeholder?: string; submit: (value: string) => Promise<void> }; onClose: () => void }) {
  const [value, setValue] = useState(dialog.value); const [saving, setSaving] = useState(false); const [dateError, setDateError] = useState("");
  const submit = async () => { if (!value.trim()) return; if (dialog.inputType === "date" && new Date(`${value}T00:00:00Z`).getUTCDay() !== 1) { setDateError("Choose a Monday to start the menu week."); return; } setSaving(true); await dialog.submit(value.trim()); setSaving(false); onClose(); };
  return <PlannerModal title={dialog.title} onClose={onClose} dismissible={!saving && value === dialog.value} busy={saving} className="item-detail planner-input-dialog"><header><div><small>Week Planner</small><h3>{dialog.title}</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close">Close</button></header><label>{dialog.label}<input data-modal-autofocus type={dialog.inputType || "text"} value={value} min="1970-01-05" step={dialog.inputType === "date" ? 7 : undefined} onChange={event => { setValue(event.target.value); setDateError(""); }} placeholder={dialog.placeholder} onKeyDown={event => { if (event.key === "Enter") void submit(); }} /></label>{dialog.inputType === "date" && <p className={`form-help planner-date-help${dateError ? " planner-date-help--error" : ""}`}>{dateError || "Choose the Monday that starts this menu week."}</p>}<footer className="form-actions"><button type="button" className="button button-soft" onClick={onClose}>Cancel</button><button type="button" className="button button-mint" disabled={saving || !value.trim()} onClick={() => void submit()}>{saving ? "Saving…" : "Continue"}</button></footer></PlannerModal>;
}

function DuplicateWeekDialog({ weeks, currentWeek, sourceId, command, onClose }: { weeks: Array<{ id: string; weekCommencing: string }>; currentWeek: { id: string; weekCommencing: string }; sourceId: string; command: (action: string, extra?: Record<string, unknown>) => Promise<boolean>; onClose: () => void }) {
  const [source, setSource] = useState(sourceId);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const formatWeek = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const copy = async () => { setSaving(true); const ok = await command("copy-week-into-current", { sourceWeekId: source, targetWeekId: currentWeek.id }); setSaving(false); if (ok) onClose(); };
  return <PlannerModal title="Copy a planned week" onClose={onClose} dismissible={false} busy={saving} className="item-detail planner-input-dialog duplicate-week-dialog"><header><div><small>Week Planner</small><h3>Copy a planned week</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close">Close</button></header><div className="duplicate-week-summary"><div><small>Current week · will be replaced</small><strong>WC {formatWeek(currentWeek.weekCommencing)}</strong></div><div><small>Copy dishes from</small><select data-modal-autofocus value={source} onChange={event => { setSource(event.target.value); setConfirmed(false); }}>{weeks.filter(week => week.id !== currentWeek.id).map(week => <option value={week.id} key={week.id}>WC {formatWeek(week.weekCommencing)}</option>)}</select></div></div><div className="duplicate-week-warning" role="alert"><strong>Warning: this will replace the current week’s menu.</strong><span>All dishes and menu rows currently planned for WC {formatWeek(currentWeek.weekCommencing)} will be removed and replaced with the selected week.</span></div><label className="duplicate-week-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I understand that the current week’s data will be replaced.</label><footer className="form-actions"><button type="button" className="button button-soft" onClick={onClose}>Cancel</button><button type="button" className="button button-danger" disabled={!confirmed || saving} onClick={() => void copy()}>{saving ? "Copying…" : "Copy and replace week"}</button></footer></PlannerModal>;
}

function ResetWeekDialog({ currentWeek, entryCount, command, onClose }: { currentWeek: { id: string; weekCommencing: string }; entryCount: number; command: (action: string, extra?: Record<string, unknown>) => Promise<boolean>; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const formatWeek = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const reset = async () => { setSaving(true); const ok = await command("reset-week", { weekId: currentWeek.id }); setSaving(false); if (ok) onClose(); };
  return <PlannerModal title="Reset current week?" onClose={onClose} dismissible={false} busy={saving} className="item-detail planner-input-dialog reset-week-dialog"><header><div><small>Week Planner · Safety action</small><h3>Reset current week?</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close">Close</button></header><div className="duplicate-week-warning reset-week-warning" role="alert"><strong>This will clear WC {formatWeek(currentWeek.weekCommencing)}.</strong><span>{entryCount ? `${entryCount} planned dish${entryCount === 1 ? "" : "es"}, allocations, one-off destinations, and custom menu rows will be removed.` : "Any planned dishes, allocations, one-off destinations, and custom menu rows will be removed."}</span></div><label className="duplicate-week-confirm"><input data-modal-autofocus type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I understand that this week’s planned data will be permanently cleared.</label><footer className="form-actions"><button type="button" className="button button-soft" onClick={onClose}>Cancel</button><button type="button" className="button button-danger" disabled={!confirmed || saving} onClick={() => void reset()}>{saving ? "Resetting…" : "Reset week"}</button></footer></PlannerModal>;
}

function DishPicker({ dishes, query, setQuery, slot, onChoose, onCreate, onClose }: { dishes: Dish[]; query: string; setQuery: (value: string) => void; slot: string; onChoose: (dish: Dish) => void; onCreate: (name: string) => Promise<void>; onClose: () => void }) {
  const filtered = rankDishPickerItems(dishes, query, slot); const [creating, setCreating] = useState(false); const [name, setName] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const canCreate = Boolean(query.trim()) && filtered.length === 0;
  const saveNewDish = async () => { if (!name.trim()) return; setSaving(true); setError(""); try { await onCreate(name); } catch (cause) { setError(cause instanceof Error ? cause.message : "The dish could not be created."); setSaving(false); } };
  return <PlannerModal title="Select dish" onClose={onClose} dismissible={!creating && !saving && !name.trim()} busy={saving}><aside className="dish-picker"><header><div><small>{slotLabel(slot)}</small><h3>Select dish</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close dish picker">Close</button></header><p className="dish-picker-category">Showing {slotLabel(slot).toLocaleLowerCase()} dishes only</p>{!creating ? <><input data-modal-autofocus value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${slotLabel(slot).toLocaleLowerCase()} dishes`} /><div className="dish-picker-list">{filtered.map(dish => <button key={dish.id} onClick={() => onChoose(dish)}><strong>{dish.name}</strong><small>{dish.category || "Uncategorised"}{dish.usage?.length ? ` · used for ${dish.usage.join(", ")}` : ""}</small></button>)}{!filtered.length && <p className="dish-picker-empty">No {slotLabel(slot).toLocaleLowerCase()} dishes match your search.</p>}</div>{canCreate && <button type="button" className="dish-picker-create" onClick={() => { setName(query.trim()); setCreating(true); }}>＋ Create “{query.trim()}” as a new {slotLabel(slot).toLocaleLowerCase()} dish</button>}</> : <div className="dish-picker-create-form"><label>New {slotLabel(slot).toLocaleLowerCase()} dish name<input data-modal-autofocus value={name} onChange={event => setName(event.target.value)} placeholder="Type a dish title" /></label>{error && <p className="menu-error" role="alert">{error}</p>}<div><button type="button" className="button button-soft" onClick={() => setCreating(false)}>Back to search</button><button type="button" className="button button-mint" disabled={saving || !name.trim()} onClick={() => void saveNewDish()}>{saving ? "Creating…" : "Create and add to planner"}</button></div></div>}</aside></PlannerModal>;
}
