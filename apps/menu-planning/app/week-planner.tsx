"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import MenuPlanningShell from "./menu-planning-shell";
import { slotLabel, useRollingData, type Dish } from "./planner-data";
import { dishReferenceForEntry, groupedSlots, selectableDishIds } from "@/lib/week-planner-layout";
import PlanningContextNav from "./planning-context-nav";
import { rankDishPickerItems } from "@/lib/dish-picker";
import { categoryForSlot } from "@/lib/dish-categories";
import { assessDishCopyTarget, compatibleDishCopyTargets, copyableDishForSource, dishCopyUnavailableReason } from "@/lib/dish-copy";
import { invalidateCatalogueCache } from "@/lib/menu-catalogue-cache";
import PlannerModal from "./planner-modal";
import DuplicatePlanningModal from "./duplicate-planning-modal";
import { InlineSpellPopover, SpellUnderlinedText, SpellcheckPanel, useSpellcheckLists, useSpellingDictionary, type SpellPanelItem } from "./spellcheck-panel";
import { findSpellingIssues, replaceSpellingFinding, type SpellFinding } from "@/lib/menu-spellcheck";
import { CANONICAL_DISH_CATEGORIES } from "@/lib/dish-categories";
import DishEditorModal from "./dish-editor-modal";
import { normaliseSaladSubtype, resolveEnter, saladNeedsSlot, saladSubtypeForSlot } from "@/lib/dish-editor";
import DishPickerFilters from "./dish-picker-filters";
import PlannerCellMenu from "./planner-cell-menu";
import { LONG_PRESS_MS, cellMenuActions, isMenuOpenKey, movedTooFar, shouldIgnoreClick, suppressClickUntil, type CellMenuActionId } from "@/lib/planner-cell-menu";
import { dishesForSlot, emptyPickerFilters, emptyPickerMessage, filterOptions, filterPickerDishes, type PickerFilters } from "@/lib/dish-picker-filters";
import { dishSlotRecommendation, saladRecommendationOptions, saladSlotMatches } from "@/lib/dish-slot-recommendations";
import { weekPlannerSlotLabel } from "@/lib/week-planner-slot-label";
import type { DishTag } from "@/lib/dish-tags";
import { dishDisplayName, dishDisplayNameOffset } from "@/lib/dish-display-name";

const plannerSlotLabel = (slot: string) => weekPlannerSlotLabel(slot, slotLabel(slot));

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
  const { snapshot, weeks, dishes, dishReferences, refreshDishes, message, error, command, selectWeek, refreshWeek } = useRollingData();
  const [query, setQuery] = useState(""); const [picker, setPicker] = useState<{ dayId: string; slot: string }>();
  // The Create/Edit Dish modal sits over the picker; Cancel returns to the same picker, query and cell.
  // Picker filters live here (like the search text) so Cancel from the Create/Edit modal returns to the same filtered picker.
  const [pickerFilters, setPickerFilters] = useState<PickerFilters>(emptyPickerFilters);
  const [pickerMode, setPickerMode] = useState<"recommended" | "all">("recommended");
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; name: string; dishId?: string; category: string; subcategory?: string }>();
  // Right-click / Shift+F10 / long-press menu for one populated cell (#186). It only reports a choice; nothing is written until an explicit activation.
  const [cellMenu, setCellMenu] = useState<{ dayId: string; slot: string; x: number; y: number }>();
  const cellMenuOpenerRef = useRef<HTMLElement | null>(null);
  const ignoreClickUntilRef = useRef(0);
  const longPressRef = useRef<{ timer: number; x: number; y: number } | undefined>(undefined);
  const [dialog, setDialog] = useState<{ title: string; label: string; value: string; inputType?: "text" | "date"; placeholder?: string; submit: (value: string) => Promise<void> }>();
  const [duplicatePlanningOpen, setDuplicatePlanningOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [menuRowOpen, setMenuRowOpen] = useState(false);
  const [draggedEntryId, setDraggedEntryId] = useState<string>();
  const [copyDialogSourceId, setCopyDialogSourceId] = useState<string>();
  const [copyFeedback, setCopyFeedback] = useState("");
  const [copyPending, setCopyPending] = useState(false);
  const [openDishReferenceId, setOpenDishReferenceId] = useState<string>();
  const selectableDishes = useMemo(() => selectableDishIds(dishes, dishReferences, snapshot?.entries || []), [dishes, dishReferences, snapshot]);
  const spell = useSpellcheckLists();
  const dictionary = useSpellingDictionary();
  const [spellOpen, setSpellOpen] = useState(false);
  const spellItems = useMemo(() => (snapshot?.entries || []).filter(entry => entry.itemLabel.trim()).map(entry => ({ entryId: entry.id, dayId: entry.dayId, dishLabel: dishDisplayName(entry.itemLabel), dayName: snapshot?.days.find(day => day.id === entry.dayId)?.dayName || "", slot: plannerSlotLabel(entry.slot), replaceable: snapshot?.week.dayStatuses?.[entry.dayId] ? snapshot.week.dayStatuses[entry.dayId] === "draft" : snapshot?.week.status === "draft" })), [snapshot]);
  const spellCount = useMemo(() => spellItems.reduce((total, item) => total + findSpellingIssues(item.dishLabel, { ignored: spell.ignored, addedWords: spell.added, speller: dictionary.speller }).length, 0), [spellItems, spell.ignored, spell.added, dictionary.speller]);
  const copyPendingRef = useRef(false);
  if (!snapshot) return <MenuPlanningShell section="Week Planner"><div className="menu-loading">Loading Week Planner…</div></MenuPlanningShell>;
  const replaceDraftSpelling = async (item: SpellPanelItem, finding: SpellFinding, replacement: string) => {
    const current = snapshot.entries.find(entry => entry.id === item.entryId && entry.dayId === item.dayId);
    const dayStatus = snapshot.week.dayStatuses?.[item.dayId];
    const replaceable = dayStatus ? dayStatus === "draft" : snapshot.week.status === "draft";
    const sourceOffset = current ? dishDisplayNameOffset(current.itemLabel) : 0;
    const sourceStart = finding.start + sourceOffset;
    const sourceEnd = finding.end + sourceOffset;
    if (!current || !replaceable || current.itemLabel.slice(sourceStart, sourceEnd) !== finding.word) {
      setCopyFeedback("This draft row changed or is no longer editable. Refresh the week before replacing the spelling.");
      return false;
    }
    const corrected = replaceSpellingFinding(current.itemLabel, { ...finding, start: sourceStart, end: sourceEnd }, replacement);
    if (!corrected) return false;
    return command("update-entry", { weekId: snapshot.week.id, entryId: current.id, dayId: current.dayId, expectedWeekVersion: snapshot.week.version, patch: { itemLabel: corrected } });
  };
  const choose = async (dish: Dish) => { if (!picker) return; const entry = snapshot.entries.find(item => item.dayId === picker.dayId && item.slot === picker.slot); await command(entry ? "update-entry" : "create-entry", entry ? { weekId: snapshot.week.id, entryId: entry.id, patch: { itemId: dish.id, itemLabel: dish.name } } : { weekId: snapshot.week.id, dayId: picker.dayId, slot: picker.slot, itemId: dish.id, itemLabel: dish.name }); setPicker(undefined); };
  const openCreateDish = (name: string) => { const slot = picker?.slot || ""; setEditor({ mode: "create", name, category: categoryForSlot(slot), subcategory: saladSubtypeForSlot(slot) }); };
  const openEditDish = (dish: Dish, slot = picker?.slot || "") => setEditor({ mode: "edit", name: dish.name, dishId: dish.id, category: dish.category && (CANONICAL_DISH_CATEGORIES as readonly string[]).includes(dish.category) ? dish.category : categoryForSlot(slot) });
  const clearEntry = (entry: { id: string }) => command("update-entry", { weekId: snapshot.week.id, entryId: entry.id, patch: { itemId: "", itemLabel: "", allocations: [], portions: 0 } });
  const cancelLongPress = () => { if (longPressRef.current) { window.clearTimeout(longPressRef.current.timer); longPressRef.current = undefined; } };
  const openCellMenu = (dayId: string, slot: string, point: { x: number; y: number }, opener: HTMLElement) => { cancelLongPress(); ignoreClickUntilRef.current = suppressClickUntil(Date.now()); cellMenuOpenerRef.current = opener; setCellMenu({ dayId, slot, x: point.x, y: point.y }); };
  const closeCellMenu = () => { setCellMenu(undefined); const opener = cellMenuOpenerRef.current; if (opener) window.setTimeout(() => opener.focus(), 0); };
  const runCellAction = (id: CellMenuActionId) => {
    const target = cellMenu; if (!target) return;
    const entry = snapshot.entries.find(item => item.dayId === target.dayId && item.slot === target.slot);
    closeCellMenu();
    // Act on the next tick so focus has returned to the cell first and the dialogs restore focus there on close.
    window.setTimeout(() => {
      if (id === "select" || id === "change") { setQuery(""); setPickerFilters(emptyPickerFilters); setPickerMode("recommended"); setPicker({ dayId: target.dayId, slot: target.slot }); return; }
      if (!entry) return;
      if (id === "edit") { const dish = selectableDishes.find(item => item.id === entry.itemId); if (dish) openEditDish(dish, target.slot); return; }
      if (id === "copy") { setCopyDialogSourceId(entry.id); return; }
      if (id === "clear") void clearEntry(entry);
    }, 0);
  };
  const weekDate = (offset: number) => { const date = new Date(`${snapshot.week.weekCommencing}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
  const menuGroups = groupedSlots(snapshot);
  const menuSlots = menuGroups.flatMap(([, slots]) => slots);
  const copyTargetsFor = (entryId: string) => compatibleDishCopyTargets(snapshot, selectableDishes, entryId, menuSlots);
  const copyDish = async (sourceEntryId: string, dayId: string, slot: string) => {
    if (copyPendingRef.current) return false;
    const result = assessDishCopyTarget(snapshot, selectableDishes, sourceEntryId, { dayId, slot });
    if (!result.allowed) { setCopyFeedback(result.reason); return false; }
    const targetDay = snapshot.days.find(day => day.id === dayId)!;
    copyPendingRef.current = true;
    setCopyPending(true);
    setCopyFeedback(`Copying ${result.dish.name} to ${targetDay.dayName}…`);
    try {
      const saved = result.blankTarget
        ? await command("update-entry", { weekId: snapshot.week.id, entryId: result.blankTarget.id, expectedWeekVersion: snapshot.week.version, patch: { itemId: result.dish.id, itemLabel: result.dish.name, portions: 0, allocations: [], allergens: {}, mayContainNotes: "", allergenReviewInvalidated: true } })
        : await command("create-entry", { weekId: snapshot.week.id, dayId, slot, itemId: result.dish.id, itemLabel: result.dish.name, expectedWeekVersion: snapshot.week.version });
      setCopyFeedback(saved ? `${result.dish.name} copied to ${targetDay.dayName} · ${plannerSlotLabel(slot)}.` : "The dish was not copied. Review the save error and retry.");
      return saved;
    } catch (cause) {
      setCopyFeedback(cause instanceof Error ? cause.message : "The dish could not be copied. Refresh the week and retry.");
      return false;
    } finally {
      copyPendingRef.current = false;
      setCopyPending(false);
    }
  };
  const duplicate = () => setDuplicatePlanningOpen(true);
  const blank = async () => { setDialog({ title: "Start blank week", label: "Blank week commencing (Monday)", value: weekDate(7), inputType: "date", submit: async target => { if (await command("create-week", { weekCommencing: target })) { window.history.pushState({}, "", `/?week=${target}`); window.dispatchEvent(new PopStateEvent("popstate")); } } }); };
  const addRow = () => setMenuRowOpen(true);
  const removeRow = async () => { setDialog({ title: "Remove menu row", label: "Menu row to remove", value: "", submit: async slot => { await command("remove-menu-slot", { weekId: snapshot.week.id, slot }); } }); };
  return <MenuPlanningShell section="Week Planner"><section className="workspace-intro planner-intro"><small>Delivered-In</small><h2>Week Planner</h2><p>{snapshot.entries.filter(entry => entry.itemLabel.trim()).length} dishes planned</p></section><PlanningContextNav weeks={weeks} currentWeek={snapshot.week.id} /><div className="planner-toolbar"><span className={`status status--${snapshot.week.status}`}>{snapshot.week.status.replaceAll("_", " ")}</span>{message && <span role="status">{message}</span>}<button className="button button-soft" type="button" onClick={() => setSpellOpen(open => !open)} aria-expanded={spellOpen}>Check spelling{spellCount > 0 && <span className="spell-count" aria-label={`${spellCount} suggestions`}>{spellCount}</span>}</button><button className="button button-soft" type="button" onClick={duplicate}>Duplicate planning</button><button className="button button-soft" type="button" onClick={() => void blank()}>Start blank week</button><button className="button button-soft" type="button" onClick={addRow}>+ Add menu row</button><button className="button button-soft" type="button" onClick={() => void removeRow()}>Remove menu row</button><button className="button button-danger" type="button" onClick={() => setResetOpen(true)}>Reset week</button></div>{copyFeedback && <p className="menu-copy-feedback" role="status">{copyFeedback}</p>}{error && <div className="menu-error" role="alert">{error}</div>}<section className="workspace-panel week-planner-panel">
      <WeekMatrixScroller>
        <div className="week-matrix-corner">Menu slot</div>
        {snapshot.days.slice(0, 5).map(day => <div className="week-matrix-day" key={day.id}>{day.dayName.slice(0, 3).toUpperCase()}<small>{new Date(`${day.date}T00:00:00Z`).getUTCDate()}</small></div>)}
        {menuGroups.map(([group, slots]) => (
          <div className="week-matrix-group" key={group}>
            <span className="week-matrix-group-title"><MenuGroupIcon group={group} /><span>{group}</span></span>
            {slots.map(slot => (
              <div className="week-matrix-row" key={slot}>
                <strong>{plannerSlotLabel(slot)}</strong>
                {snapshot.days.slice(0, 5).map(day => {
                  const entry = snapshot.entries.find(item => item.dayId === day.id && item.slot === slot);
                  const dish = entry ? copyableDishForSource(snapshot, selectableDishes, entry.id) : undefined;
                  const referenceNotice = entry ? dishReferenceForEntry(entry, dishReferences, { id: snapshot.week.id, version: Number(snapshot.week.version) }) : undefined;
                  const referenceId = entry ? `dish-reference-${entry.id}` : "";
                  const drop = draggedEntryId ? assessDishCopyTarget(snapshot, selectableDishes, draggedEntryId, { dayId: day.id, slot }) : undefined;
                  return <div className={`week-menu-cell${drop?.allowed ? " week-menu-cell--copy-target" : ""}${referenceNotice ? ` week-menu-cell--${referenceNotice.state}` : ""}`} key={day.id}
                    onDragOver={event => { if (!draggedEntryId) return; event.preventDefault(); event.dataTransfer.dropEffect = drop?.allowed ? "copy" : "none"; }}
                    onDrop={event => {
                      if (!draggedEntryId) return;
                      event.preventDefault();
                      const sourceEntryId = event.dataTransfer.getData("text/plain") || draggedEntryId;
                      setDraggedEntryId(undefined);
                      const assessment = assessDishCopyTarget(snapshot, selectableDishes, sourceEntryId, { dayId: day.id, slot });
                      if (assessment.allowed) void copyDish(sourceEntryId, day.id, slot); else setCopyFeedback(assessment.reason);
                    }}>
                    <button className="week-menu-cell-button" draggable={Boolean(dish)} aria-label={entry ? `Select ${dishDisplayName(entry.itemLabel)}; drag or use Copy to day` : `Select dish for ${day.dayName}, ${plannerSlotLabel(slot)}`} aria-haspopup={entry ? "menu" : undefined} aria-keyshortcuts={entry ? "Shift+F10" : undefined} title={entry ? "Right-click or press Shift+F10 for more actions" : undefined}
                      onContextMenu={entry ? event => { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); const fromKeyboard = event.clientX === 0 && event.clientY === 0; openCellMenu(day.id, slot, fromKeyboard ? { x: box.left + 12, y: box.bottom - 4 } : { x: event.clientX, y: event.clientY }, event.currentTarget); } : undefined}
                      onKeyDown={entry ? event => { if (isMenuOpenKey(event)) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); openCellMenu(day.id, slot, { x: box.left + 12, y: box.bottom - 4 }, event.currentTarget); } } : undefined}
                      onPointerDown={entry ? event => { if (event.pointerType !== "touch") return; const start = { x: event.clientX, y: event.clientY }; const opener = event.currentTarget; cancelLongPress(); longPressRef.current = { ...start, timer: window.setTimeout(() => openCellMenu(day.id, slot, start, opener), LONG_PRESS_MS) }; } : undefined}
                      onPointerMove={entry ? event => { const press = longPressRef.current; if (press && movedTooFar(press, { x: event.clientX, y: event.clientY })) cancelLongPress(); } : undefined}
                      onPointerUp={entry ? cancelLongPress : undefined} onPointerCancel={entry ? cancelLongPress : undefined}
                      onDragStart={event => { if (!entry || !dish) { event.preventDefault(); return; } setDraggedEntryId(entry.id); event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("text/plain", entry.id); }}
                      onDragEnd={() => setDraggedEntryId(undefined)}
                      onClick={() => { if (shouldIgnoreClick(Date.now(), ignoreClickUntilRef.current)) return; setQuery(""); setPickerFilters(emptyPickerFilters); setPickerMode("recommended"); setPicker({ dayId: day.id, slot }); }}>
                      {entry ? <SpellUnderlinedText text={dishDisplayName(entry.itemLabel)} ignored={spell.ignored} added={spell.added} speller={dictionary.speller} /> : "+ Select dish"}{entry && <span className="week-menu-drag-handle" aria-hidden="true" title="Drag to copy">⠿</span>}
                    </button>
                    {entry && <div className="week-menu-cell-actions">
                      {referenceNotice && <div className={`week-dish-reference week-dish-reference--${referenceNotice.state}`}>
                        <button type="button" className="week-dish-reference-trigger" aria-describedby={`${referenceId}-description`} aria-expanded={openDishReferenceId === entry.id} onClick={() => setOpenDishReferenceId(current => current === entry.id ? undefined : entry.id)}>{referenceNotice.label}</button>
                        <span id={`${referenceId}-description`} className="week-dish-reference-sr-only">{referenceNotice.message}</span>
                        <span className="week-dish-reference-tooltip" role="tooltip" aria-hidden="true">{referenceNotice.message}</span>
                      </div>}
                      {findSpellingIssues(dishDisplayName(entry.itemLabel), { ignored: spell.ignored, addedWords: spell.added, speller: dictionary.speller }).length > 0 && <InlineSpellPopover item={spellItems.find(item => item.entryId === entry.id)!} ignored={spell.ignored} added={spell.added} dictionary={dictionary.speller} onReplace={replaceDraftSpelling} onIgnore={spell.ignore} onAddWord={spell.addWord} />}
                      <button type="button" className="week-menu-copy-action" aria-label={`Copy ${dishDisplayName(entry.itemLabel)} to another day`} title="Copy to another day" disabled={!dish || copyTargetsFor(entry.id).length === 0 || copyPending} onClick={() => setCopyDialogSourceId(entry.id)}><CopyGlyph /></button>
                      <button type="button" className="week-menu-copy-action week-menu-more" aria-haspopup="menu" aria-label={`More actions for ${entry.itemLabel}`} title="More actions" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); openCellMenu(day.id, slot, { x: box.left, y: box.bottom + 4 }, event.currentTarget); }}>⋯</button>
                      <button type="button" className="week-menu-clear" aria-label={`Clear ${dishDisplayName(entry.itemLabel)}`} onClick={() => void clearEntry(entry)}>×</button>
                    </div>}
                  </div>;
                })}
              </div>
            ))}
          </div>
        ))}
      </WeekMatrixScroller>
    </section>{picker && !editor && <DishPicker dishes={selectableDishes} query={query} setQuery={setQuery} filters={pickerFilters} setFilters={setPickerFilters} mode={pickerMode} setMode={setPickerMode} slot={picker.slot} onChoose={choose} onCreate={openCreateDish} onClose={() => setPicker(undefined)} />}{picker && editor && <DishEditorModal mode={editor.mode} initialName={editor.name} initialCategory={editor.category} initialSubcategory={editor.subcategory} dishId={editor.dishId} dishes={selectableDishes} onCancel={() => setEditor(undefined)} onSaved={async saved => { setEditor(undefined); await refreshDishes(); if (saved.outcome !== "updated") await choose({ id: saved.id, name: saved.name, category: saved.category }); }} />}{!picker && editor && <DishEditorModal mode={editor.mode} initialName={editor.name} initialCategory={editor.category} initialSubcategory={editor.subcategory} dishId={editor.dishId} dishes={selectableDishes} onCancel={() => setEditor(undefined)} onSaved={async () => { setEditor(undefined); await refreshDishes(); }} />}{cellMenu && (() => { const entry = snapshot.entries.find(item => item.dayId === cellMenu.dayId && item.slot === cellMenu.slot); const dish = entry ? copyableDishForSource(snapshot, selectableDishes, entry.id) : undefined; const actions = cellMenuActions({ entry: entry ? { id: entry.id, itemId: entry.itemId, itemLabel: dishDisplayName(entry.itemLabel) } : undefined, dishResolved: Boolean(entry && selectableDishes.some(item => item.id === entry.itemId)), copyAvailable: Boolean(entry && dish && copyTargetsFor(entry.id).length > 0), copyDisabledReason: entry ? dishCopyUnavailableReason(snapshot, selectableDishes, entry.id, menuSlots) : undefined, copyPending }); return <PlannerCellMenu anchor={{ x: cellMenu.x, y: cellMenu.y }} label={entry ? `Actions for ${dishDisplayName(entry.itemLabel)}` : "Cell actions"} actions={actions} onSelect={runCellAction} onClose={closeCellMenu} />; })()}{dialog && <PlannerInputDialog dialog={dialog} onClose={() => setDialog(undefined)} />}{menuRowOpen && <AddMenuRowDialog snapshot={snapshot} command={command} onClose={() => setMenuRowOpen(false)} />}{copyDialogSourceId && <CopyDishDialog sourceEntryId={copyDialogSourceId} sourceDish={dishDisplayName(snapshot.entries.find(entry => entry.id === copyDialogSourceId)?.itemLabel || "dish")} targets={copyTargetsFor(copyDialogSourceId)} onCopy={copyDish} onClose={() => setCopyDialogSourceId(undefined)} />}{spellOpen && <SpellcheckPanel items={spellItems} ignored={spell.ignored} added={spell.added} dictionary={dictionary} onIgnore={spell.ignore} onAddWord={spell.addWord} onReplace={replaceDraftSpelling} onClose={() => setSpellOpen(false)} />}{duplicatePlanningOpen && <DuplicatePlanningModal origin="week" weeks={weeks} currentWeek={{ id: snapshot.week.id, weekCommencing: snapshot.week.weekCommencing, version: snapshot.week.version }} dayNames={snapshot.days.slice(0, 5).map(day => day.dayName)} onApplied={() => refreshWeek(snapshot.week.id)} onClose={() => setDuplicatePlanningOpen(false)} />}</MenuPlanningShell>;
}

const GROUP_GLYPHS: Record<string, string> = {
  SALADS: "M4 14c0-5 4-9 10-10 0 6-4 10-10 10zM4 14l7-7",
  "COLD PROTEIN": "M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9",
  "HOT MAINS": "M12 3c3 4 4 6 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z",
  FISH: "M3 12c3-4 7-5 11-2l4-3v10l-4-3c-4 3-8 2-11-2zM7 11.5h.01",
  "VEGAN MAIN": "M12 21V11M12 11c-4 0-6-3-6-6 4 0 6 2 6 6zM12 11c4 0 6-3 6-6-4 0-6 2-6 6z",
  SOUP: "M4 11h16a8 8 0 0 1-16 0zM8 7c0-1 1-1 1-2M12 7c0-1 1-1 1-2",
  "STARCH/SIDE": "M4 9h16v3a8 8 0 0 1-16 0zM7 6h10",
  GARNISH: "M12 4l2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1z",
  SAUCE: "M12 3c3 5 5 8 5 11a5 5 0 0 1-10 0c0-3 2-6 5-11z",
  OTHER: "M5 12h14M12 5v14",
  DESSERTS: "M5 14h14l-2 6H7zM8 10h8l-1-4H9zM12 4v0",
};
function MenuGroupIcon({ group }: { group: string }) {
  return <svg className="week-matrix-group-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={GROUP_GLYPHS[group] || GROUP_GLYPHS.OTHER} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function CopyGlyph() {
  return <svg className="week-menu-copy-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
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

function ResetWeekDialog({ currentWeek, entryCount, command, onClose }: { currentWeek: { id: string; weekCommencing: string }; entryCount: number; command: (action: string, extra?: Record<string, unknown>) => Promise<boolean>; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const formatWeek = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const reset = async () => { setSaving(true); const ok = await command("reset-week", { weekId: currentWeek.id }); setSaving(false); if (ok) onClose(); };
  return <PlannerModal title="Reset current week?" onClose={onClose} dismissible={false} busy={saving} className="item-detail planner-input-dialog reset-week-dialog"><header><div><small>Week Planner · Safety action</small><h3>Reset current week?</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close">Close</button></header><div className="duplicate-week-warning reset-week-warning" role="alert"><strong>This will clear WC {formatWeek(currentWeek.weekCommencing)}.</strong><span>{entryCount ? `${entryCount} planned dish${entryCount === 1 ? "" : "es"}, allocations, one-off destinations, and custom menu rows will be removed.` : "Any planned dishes, allocations, one-off destinations, and custom menu rows will be removed."}</span></div><label className="duplicate-week-confirm"><input data-modal-autofocus type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I understand that this week’s planned data will be permanently cleared.</label><footer className="form-actions"><button type="button" className="button button-soft" onClick={onClose}>Cancel</button><button type="button" className="button button-danger" disabled={!confirmed || saving} onClick={() => void reset()}>{saving ? "Resetting…" : "Reset week"}</button></footer></PlannerModal>;
}

function DishPicker({ dishes, query, setQuery, filters, setFilters, mode, setMode, slot, onChoose, onCreate, onClose }: { dishes: Dish[]; query: string; setQuery: (value: string) => void; filters: PickerFilters; setFilters: (filters: PickerFilters) => void; mode: "recommended" | "all"; setMode: (mode: "recommended" | "all") => void; slot: string; onChoose: (dish: Dish) => void; onCreate: (name: string) => void; onClose: () => void }) {
  // The slot category is the hard eligibility boundary. Salad subtype/tag matches recommend; the explicit all-compatible mode keeps manual choice available.
  const [tags, setTags] = useState<DishTag[]>([]); const [tagsUnavailable, setTagsUnavailable] = useState(false);
  useEffect(() => { let active = true; void fetch("/api/dish-tags", { cache: "no-store" }).then(async response => { const body = await response.json().catch(() => ({})); if (!active) return; if (!response.ok) setTagsUnavailable(true); else setTags(body.tags || []); }).catch(() => { if (active) setTagsUnavailable(true); }); return () => { active = false; }; }, []);
  // Category is the eligibility gate. Subtypes and registry tags create contextual suggestions;
  // All compatible dishes remains available when older or multi-purpose records do not match.
  const result = filterPickerDishes(dishes, slot, query, filters);
  const saladSlot = Boolean(saladSubtypeForSlot(slot));
  const compatible = dishesForSlot(dishes, slot);
  const allRecommendations = compatible.filter(dish => saladSlotMatches(dish, slot, tags));
  const saladOptions = saladRecommendationOptions(result.dishes, new Set(allRecommendations.map(dish => dish.id)));
  const recommendedMode = mode === "recommended" && saladSlot;
  const candidates = recommendedMode ? saladOptions.items : result.dishes;
  const ranked = rankDishPickerItems(candidates, query, slot, tags);
  const filtered = [...ranked, ...candidates.filter(dish => !ranked.some(entry => entry.id === dish.id))];
  const options = filterOptions(compatible, tags);
  const tagLabels = new Map(tags.map(tag => [tag.id, tag.label]));
  const recommendationStatus = recommendedMode && saladOptions.usingFallback && compatible.length
    ? "No slot-specific recommendations yet. Showing all category-compatible salads."
    : "";
  const emptyMessage = emptyPickerMessage({ offered: recommendedMode && !saladOptions.usingFallback ? allRecommendations.length : result.offered, shown: filtered.length }, query, filters);
  const typed = query.trim();
  const canCreate = Boolean(typed) && resolveEnter(dishes.map(dish => ({ id: dish.id, name: dish.name, aliases: dish.aliases })), typed).kind === "create";
  // Enter on a typed name selects an exact existing dish/alias, otherwise opens the prefilled Create dish modal.
  const onEnter = () => {
    const result = resolveEnter(dishes.map(dish => ({ id: dish.id, name: dish.name, aliases: dish.aliases })), query);
    if (result.kind === "existing") { const dish = dishes.find(entry => entry.id === result.dish.id); if (dish) onChoose(dish); }
    else if (result.kind === "create") onCreate(result.name);
  };
  return <PlannerModal title="Select dish" onClose={onClose}><aside className="dish-picker"><header><div><small>{plannerSlotLabel(slot)}</small><h3>Select dish</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close dish picker">Close</button></header><p className="dish-picker-category">Showing {plannerSlotLabel(slot).toLocaleLowerCase()} dishes only</p><input data-modal-autofocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onEnter(); } }} placeholder={`Search ${plannerSlotLabel(slot).toLocaleLowerCase()} dishes, or type a new name and press Enter`} aria-label={`Search ${plannerSlotLabel(slot).toLocaleLowerCase()} dishes`} />{saladSlot && <div className="dish-picker-mode" role="group" aria-label="Salad dish suggestions"><button type="button" aria-pressed={mode === "recommended"} onClick={() => setMode("recommended")}>Recommended for {plannerSlotLabel(slot)}</button><button type="button" aria-pressed={mode === "all"} onClick={() => setMode("all")}>All compatible dishes</button></div>}<DishPickerFilters filters={filters} onChange={setFilters} tagOptions={options.tagOptions} categoryOptions={options.categoryOptions} subtypeOptions={options.subtypeOptions} tagLabels={tagLabels} shown={filtered.length} offered={recommendedMode && !saladOptions.usingFallback ? allRecommendations.length : result.offered} tagsUnavailable={tagsUnavailable} />{recommendationStatus && <p className="dish-picker-empty" role="status">{recommendationStatus}</p>}<div className="dish-picker-list">{filtered.map(dish => { const recommendation = dishSlotRecommendation(dish, slot, tags); return <div className="dish-picker-row" key={dish.id}><button type="button" onClick={() => onChoose(dish)}><strong>{dish.name}</strong><small>{dish.category || "Uncategorised"}{normaliseSaladSubtype(dish.subcategory) ? ` · ${normaliseSaladSubtype(dish.subcategory)}` : saladNeedsSlot(dish) ? " · needs a salad slot" : ""}{mode === "all" && saladSlot && recommendation.reason ? ` · recommended: ${recommendation.reason}` : ""}{dish.usage?.length ? ` · used for ${dish.usage.join(", ")}` : ""}</small></button></div>; })}{emptyMessage && <p className="dish-picker-empty" role="status">{emptyMessage}</p>}</div>{canCreate && <button type="button" className="dish-picker-create" onClick={() => onCreate(typed)}>＋ Create “{typed}” as a new dish (or press Enter)</button>}</aside></PlannerModal>;
}
