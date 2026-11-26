"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { productMenuConfiguration, productMenuDraft, type ProductMenuChoices, type ProductMenuConfiguration, type ProductMenuDraft, type ProductMenuListing, type ProductMenuSummary } from "../../shared/hospitality-menu-studio-product-content";
import { categories, type Dish } from "../lib/contract";
import { dishSchema } from "../../shared/hospitality-menu-studio-content";
import { DishAssortment } from "./studio-dishes";
import { DishSafety } from "./studio-dish-safety";
import type { StudioPublicationPilot } from "../lib/hub-publication";
import { productMenuDishKey, type ProductMenuDish, type ProductMenuDishReference } from "../lib/product-menu-dishes";
import { MenuBuilderHome, type ProductMenuSetup } from "./menu-builder-home";
import { filterPickerDishes } from "./product-menu-picker-model";
import { menuChoiceReferences, removeProductMenuGroup, reconfigureProductMenu, copyProductMenuWeeks, moveProductMenuDish } from "./product-menu-editor-model";
import { ProductMenuPreview } from "./product-menu-preview";
import { ProductMenuReview } from "./product-menu-review";
import { StudioButton, StudioEditorLayout, StudioField, StudioHeaderActions, StudioIcon, StudioPanel, StudioSegmentedControl, StudioShell, StudioStatus, type StudioDestination } from "./studio-design-system";
import { useStudioRequest } from "./use-studio-draft";
import { useProductMenuEditorDraft } from "./use-product-menu-editor-draft";
import { useStudioRead, useStudioReads } from "./studio-reads";
import { useProductMenuDishes } from "./use-product-menu-dishes";
import styles from "./product-menu-builder.module.css";

type PendingExit = { kind: "product"; itemId: string } | { kind: "destination"; destination: StudioDestination } | { kind: "home" };
type Notice = { kind: "neutral" | "info" | "success" | "warning" | "danger"; message: string };

async function sendStudioProduct<T>(read: typeof fetch, endpoint: "product-menus" | "product-publication", body: unknown): Promise<T> {
  const response = await read("/api/studio/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || "The product request could not be completed.") as Error & { status: number }; error.status = response.status; throw error; }
  return result as T;
}

function choicesAt(configuration: ProductMenuConfiguration, week: number): ProductMenuChoices {
  return configuration.schedule.kind === "fixed"
    ? configuration.schedule.choices
    : configuration.schedule.weeks[week] || { dishes: [], groups: [] };
}

function withChoices(configuration: ProductMenuConfiguration, week: number, update: (value: ProductMenuChoices) => ProductMenuChoices): ProductMenuConfiguration {
  if (configuration.schedule.kind === "fixed") return { ...configuration, schedule: { ...configuration.schedule, choices: update(configuration.schedule.choices) } };
  return { ...configuration, schedule: { ...configuration.schedule, weeks: configuration.schedule.weeks.map((value, index) => index === week ? update(value) : value) } };
}

function orderedDishes(choices: ProductMenuChoices, groupId?: string) {
  return groupId ? choices.groups.find((group) => group.groupId === groupId)?.dishes || [] : choices.dishes;
}

function summarizeDraft(draft: ProductMenuDraft, previous?: ProductMenuListing): ProductMenuListing {
  const { configuration } = draft;
  const summary: ProductMenuSummary = configuration.schedule.kind === "fixed"
    ? { itemId: draft.itemId, version: draft.version, updatedAt: draft.updatedAt, kind: "fixed", dishCount: configuration.schedule.choices.dishes.length + configuration.schedule.choices.groups.reduce((count, group) => count + group.dishes.length, 0) }
    : { itemId: draft.itemId, version: draft.version, updatedAt: draft.updatedAt, kind: "rotation", cycleWeeks: configuration.schedule.weeks.length };
  const unchanged = previous?.version === draft.version;
  return { ...summary, publicationStatus: unchanged ? previous.publicationStatus : "draft",
    hasPublishedRevision: unchanged ? previous.hasPublishedRevision : previous?.hasPublishedRevision ?? false };
}

type DishDisplay = (reference: ProductMenuDishReference) => string;

function ProductMenuEditor({ draft, productName, hasPublishedRevision, dishes, dishCursor, loadingDishes, dishError, canManage, onLoadDishes, onLoadMoreDishes, onDishCreated, onSave, onLoadLatest, onRegisterDiscard, recoveryScope, safetyAvailable, checkerOrigin, onReview, onDirtyChange, onBack }: {
  draft: ProductMenuDraft;
  productName: string;
  hasPublishedRevision: boolean;
  dishes: Dish[];
  dishCursor: string | null;
  loadingDishes: boolean;
  dishError?: string;
  canManage: boolean;
  onLoadDishes: () => void;
  onLoadMoreDishes: () => void;
  onDishCreated: (dish: Dish) => void;
  onSave: (snapshot: ProductMenuDraft) => Promise<ProductMenuDraft>;
  onLoadLatest: () => Promise<ProductMenuDraft>;
  onRegisterDiscard: (discard: (() => boolean) | null) => void;
  recoveryScope: string;
  safetyAvailable: boolean;
  checkerOrigin?: string;
  onReview: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
}) {
  const request = useStudioRequest();
  const reads = useStudioReads();
  const editor = useProductMenuEditorDraft({ draft, canManage, recoveryScope, onSave, onLoadLatest });
  const { configuration, dirty, status, error: saveError, change, save, recovery } = editor;
  const [week, setWeek] = useState(0);
  const [dishQuery, setDishQuery] = useState("");
  const [dishCategory, setDishCategory] = useState("all");
  const [selectedDishIds, setSelectedDishIds] = useState<string[]>([]);
  const [pickerWeeks, setPickerWeeks] = useState<number[]>([]);
  const [creatingDish, setCreatingDish] = useState(false);
  const [creatingDishBusy, setCreatingDishBusy] = useState(false);
  const [creatingDishError, setCreatingDishError] = useState("");
  const blankDish = (): Dish => ({ id: crypto.randomUUID(), version: 0, updatedAt: "", name: "", category: "other", temperature: null, customerDescription: "", kitchenDescription: "", assortment: null });
  const [newDish, setNewDish] = useState<Dish | null>(null);
  const [savedDish, setSavedDish] = useState<Dish | null>(null);
  const [dishBaseline, setDishBaseline] = useState<Dish | null>(null);
  const [fromAssigned, setFromAssigned] = useState(false);
  const [dishExit, setDishExit] = useState<"close" | "list">("close");
  const dishExitDialog = useRef<HTMLDialogElement>(null);
  const [dishLoading, setDishLoading] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const scheduleDialog = useRef<HTMLDialogElement>(null);
  const copyDialog = useRef<HTMLDialogElement>(null);
  const removeGroupDialog = useRef<HTMLDialogElement>(null);
  const [removingGroupId, setRemovingGroupId] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"fixed" | "rotation">(draft.configuration.schedule.kind);
  const [cycleWeeks, setCycleWeeks] = useState(String(draft.configuration.schedule.kind === "rotation" ? draft.configuration.schedule.weeks.length : 1));
  const [anchorMonday, setAnchorMonday] = useState(draft.configuration.schedule.kind === "rotation" ? draft.configuration.schedule.anchorMonday : "");
  const [scheduleError, setScheduleError] = useState("");
  const [loss, setLoss] = useState<Array<{ weekIndex: number; dishCount: number }>>([]);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const [copyMode, setCopyMode] = useState<"append" | "replace">("append");
  const [copyLoss, setCopyLoss] = useState<Array<{ weekIndex: number; dishCount: number }>>([]);
  const currentChoices = choicesAt(configuration, week);
  const references = useMemo(() => menuChoiceReferences(currentChoices), [currentChoices]);
  const allAssigned = useMemo(() => new Set(references.map(dish => dish.dishId)), [references]);
  const assigned = useProductMenuDishes(references, dishes);
  const dishName = (reference: ProductMenuDishReference) => archivedDishName(assigned, reference);
  const visibleDishes = useMemo(() => filterPickerDishes(dishes, dishQuery, dishCategory, allAssigned), [allAssigned, dishes, dishQuery, dishCategory]);
  const dishById = useMemo(() => new Map(dishes.map((dish) => [dish.id, dish])), [dishes]);

  useEffect(() => {
    const schedule = configuration.schedule;
    setScheduleKind(schedule.kind);
    if (schedule.kind === "rotation") { setCycleWeeks(String(schedule.weeks.length)); setAnchorMonday(schedule.anchorMonday); setWeek(current => Math.min(current, schedule.weeks.length - 1)); }
    else setWeek(0);
  }, [configuration.schedule]);
  useEffect(() => { onDirtyChange(dirty || Boolean(recovery) || status === "saving"); }, [dirty, recovery, status, onDirtyChange]);
  useEffect(() => { onRegisterDiscard(editor.discard); return () => onRegisterDiscard(null); }, [editor.discard, onRegisterDiscard]);
  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [dirty]);

  function addGroup() {
    const id = `group-${crypto.randomUUID()}`;
    change((current) => {
      const groups = [...current.groups, { id, name: newGroupName.trim() || `Group ${current.groups.length + 1}` }];
      const schedule = current.schedule.kind === "fixed"
        ? { ...current.schedule, choices: { dishes: [], groups: [...current.schedule.choices.groups, ...(current.schedule.choices.dishes.length ? [{ groupId: id, dishes: current.schedule.choices.dishes }] : [])] } }
        : { ...current.schedule, weeks: current.schedule.weeks.map((slot) => ({ dishes: [], groups: [...slot.groups, ...(slot.dishes.length ? [{ groupId: id, dishes: slot.dishes }] : [])] })) };
      return { ...current, groups, schedule };
    });
    setNewGroupName("");
  }

  function moveGroup(groupId: string, direction: -1 | 1) {
    change((current) => {
      const index = current.groups.findIndex((group) => group.id === groupId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.groups.length) return current;
      const groups = [...current.groups];
      [groups[index], groups[nextIndex]] = [groups[nextIndex]!, groups[index]!];
      return { ...current, groups };
    });
  }

  function moveDish(groupId: string | undefined, index: number, direction: -1 | 1) {
    change((current) => withChoices(current, week, (slot) => {
      const target = orderedDishes(slot, groupId);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= target.length) return slot;
      const reordered = [...target];
      [reordered[index], reordered[nextIndex]] = [reordered[nextIndex]!, reordered[index]!];
      if (!groupId) return { ...slot, dishes: reordered };
      return { ...slot, groups: slot.groups.map((group) => group.groupId === groupId ? { ...group, dishes: reordered } : group) };
    }));
  }

  function removeDish(groupId: string | undefined, dishId: string) {
    change((current) => withChoices(current, week, (slot) => !groupId
      ? { ...slot, dishes: slot.dishes.filter((dish) => dish.dishId !== dishId) }
      : { ...slot, groups: slot.groups.map((group) => group.groupId === groupId ? { ...group, dishes: group.dishes.filter((dish) => dish.dishId !== dishId) } : group) }));
  }

  function openDishPicker(groupId?: string) {
    onLoadDishes();
    setTargetGroupId(groupId || configuration.groups[0]?.id || "");
    setSelectedDishIds([]);
    setPickerWeeks([week]);
    setDishQuery("");
    setDishCategory("all");
    setCreatingDish(false);
    setCreatingDishError("");
    setNewDish(null); setSavedDish(null); setDishBaseline(null); setFromAssigned(false);
    dialog.current?.showModal();
  }

  async function editDish(reference: ProductMenuDishReference) {
    setDishLoading(true); setCreatingDishError(""); setCreatingDish(true); setNewDish(null); setSavedDish(null); setDishBaseline(null); setFromAssigned(true); dialog.current?.showModal();
    try {
      const response = await reads.json<{ items: unknown[] }>("/api/studio?" + new URLSearchParams({ list: "assigned-dishes", ids: reference.dishId }));
      if (response.items.length !== 1) throw new Error("The current dish is unavailable.");
      const dish = dishSchema.parse(response.items[0]);
      if (dish.id !== reference.dishId) throw new Error("The current dish could not be verified.");
      setNewDish(dish); setSavedDish(dish); setDishBaseline(dish);
    } catch (failure) { setCreatingDishError((failure as Error).message || "The current dish could not be loaded."); }
    finally { setDishLoading(false); }
  }

  async function createDishFromPicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newDish || !canManage || creatingDishBusy || !newDish.name.trim() || !newDish.customerDescription.trim() || !newDish.kitchenDescription.trim()) return;
    setCreatingDishBusy(true); setCreatingDishError("");
    try {
      const item = dishSchema.parse(newDish);
      const result = await request({ action: "save-dish", item });
      const saved = dishSchema.parse(result.item);
      if (saved.id !== item.id || saved.version !== item.version + 1) throw new Error("The saved dish revision could not be verified.");
      onDishCreated(saved);
      if (!item.version) { setSelectedDishIds(ids => ids.includes(saved.id) ? ids : [...ids, saved.id]); setCreatingDish(false); setNewDish(null); }
      else { setNewDish(saved); setSavedDish(saved); setDishBaseline(saved); }
    } catch (failure) { setCreatingDishError((failure as Error).message || "The dish draft could not be saved."); }
    finally { setCreatingDishBusy(false); }
  }

  function finishDishExit(destination: "close" | "list") {
    if (destination === "close") dialog.current?.close();
    else { setCreatingDish(false); setCreatingDishError(""); setNewDish(null); }
  }
  function requestDishExit(destination: "close" | "list") {
    if (creatingDishBusy) return;
    if (newDish && dishBaseline && JSON.stringify(newDish) !== JSON.stringify(dishBaseline)) { setDishExit(destination); dishExitDialog.current?.showModal(); return; }
    finishDishExit(destination);
  }

  function addSelectedDishes() {
    const additions = selectedDishIds.flatMap(dishId => { const dish = dishById.get(dishId); return dish ? [{ dishId, revision: dish.version }] : []; });
    if (!additions.length || additions.length !== selectedDishIds.length) { setCreatingDishError("Selected dishes are still loading. Try again."); return; }
    change((current) => {
      const targets = current.schedule.kind === "fixed" ? [0] : pickerWeeks;
      return targets.reduce((next, targetWeek) => withChoices(next, targetWeek, (slot) => {
        const existing = new Set(menuChoiceReferences(slot).map(item => item.dishId));
        const available = additions.filter(item => !existing.has(item.dishId));
        if (!targetGroupId) return { ...slot, dishes: [...slot.dishes, ...available] };
        const group = slot.groups.find(item => item.groupId === targetGroupId);
        return { ...slot, groups: group ? slot.groups.map(item => item.groupId === targetGroupId ? { ...item, dishes: [...item.dishes, ...available] } : item) : [...slot.groups, { groupId: targetGroupId, dishes: available }] };
      }), current);
    });
    dialog.current?.close();
  }

  function applySchedule(confirmed = false) {
    const target = scheduleKind === "fixed" ? { kind: "fixed" as const, weekIndex: week } : { kind: "rotation" as const, weekIndex: week, cycleWeeks: Number(cycleWeeks), anchorMonday };
    const result = reconfigureProductMenu(configuration, target, confirmed);
    if (result.status === "invalid") { setScheduleError(result.message); return; }
    if (result.status === "confirmation-required") { setLoss(result.lostWeeks); scheduleDialog.current?.showModal(); return; }
    setScheduleError(""); setWeek(result.weekIndex); scheduleDialog.current?.close();
    if (result.configuration !== configuration) change(() => result.configuration);
  }

  function applyCopy(confirmed = false) {
    const result = copyProductMenuWeeks(configuration, { sourceWeek: week, targetWeeks: copyTargets, mode: copyMode, confirmedReplace: confirmed });
    if (result.status === "invalid") { setScheduleError(result.message); return; }
    if (result.status === "confirmation-required") { setCopyLoss(result.lostWeeks); return; }
    setScheduleError(""); setCopyLoss([]); copyDialog.current?.close();
    if (result.configuration !== configuration) change(() => result.configuration);
  }

  function moveDishTo(dishId: string, groupId: string) {
    const destination = currentChoices.groups.find(group => group.groupId === groupId)?.dishes.length || 0;
    const result = moveProductMenuDish(configuration, { weekIndex: week, dishId, toGroupId: groupId, toIndex: destination });
    if (result.status === "invalid") { setScheduleError(result.message); return; }
    if (result.configuration !== configuration) change(() => result.configuration);
  }

  const weekCount = configuration.schedule.kind === "rotation" ? configuration.schedule.weeks.length : 1;
  const heading = configuration.schedule.kind === "fixed" ? "Fixed menu" : `${weekCount}-week rotation`;
  return <div className={styles.builder}>
    {recovery && <div className={styles.errorBox} role="status"><p>A retained draft from this browser tab is available{recovery.conflicted ? " and requires conflict resolution" : ""}. Resume it or discard it before editing.</p><StudioButton onClick={() => editor.resumeRecovery()}>Resume retained draft</StudioButton><StudioButton onClick={() => editor.discardRecovery()}>Discard retained draft</StudioButton></div>}
    {status === "conflict" && <div className={styles.errorBox} role="alert"><p>{saveError}</p><StudioButton onClick={() => void editor.openLatest()}>Open latest draft</StudioButton></div>}
    <StudioEditorLayout editor={<fieldset className={styles.editorFields} disabled={Boolean(recovery) || !canManage}>
      <header className={styles.productHeading}><nav aria-label="Breadcrumb"><span>Menu Builder</span> <span aria-hidden="true">›</span> <span aria-current="page">{productName}</span></nav><div><h1>{productName}</h1><StudioStatus tone="info">Draft · {heading}{hasPublishedRevision ? " · prior version published" : ""}</StudioStatus></div><p>Choose the dishes and ordering style for the {productName} menu.</p></header>
      {status !== "saved" && <p className={styles.editorStatus} role="status">{status === "saving" ? "Saving draft…" : status === "conflict" ? "Version conflict" : status === "error" ? "Save failed" : "Unsaved changes"}{dirty && " · Save before review"}</p>}
      <section className={styles.scheduleSettings} aria-label="Menu schedule">
        <StudioSegmentedControl label="Menu type" value={scheduleKind} options={[{ value: "fixed", label: "Fixed menu" }, { value: "rotation", label: "Rotating menu" }]} onChange={setScheduleKind} />
        {scheduleKind === "rotation" && <div className={styles.rotationSettings}><StudioField label="Rotation length"><input type="number" min="1" max="52" step="1" value={cycleWeeks} onChange={event => setCycleWeeks(event.target.value)} /></StudioField><StudioField label="Cycle start Monday"><input type="date" value={anchorMonday} onChange={event => setAnchorMonday(event.target.value)} /></StudioField><p>Repeats automatically</p></div>}
        {(scheduleKind !== configuration.schedule.kind || (configuration.schedule.kind === "rotation" && (cycleWeeks !== String(configuration.schedule.weeks.length) || anchorMonday !== configuration.schedule.anchorMonday))) && <StudioButton onClick={() => applySchedule()} disabled={!canManage}>Apply schedule</StudioButton>}
        {scheduleError && <p className={styles.error} role="alert">{scheduleError}</p>}
      </section>
      {configuration.schedule.kind === "rotation" && <div className={styles.weekStrip} role="group" aria-label="Rotation weeks">{configuration.schedule.weeks.map((slot, index) => <button key={index} type="button" aria-pressed={week === index} onClick={() => setWeek(index)}><strong>Week {index + 1}</strong><small>{menuChoiceReferences(slot).length} dishes</small></button>)}</div>}
      <StudioPanel title={configuration.schedule.kind === "fixed" ? "Menu dishes" : `Week ${week + 1} – Dishes`} description="The dishes that customers can choose, in their display order." actions={<>{configuration.schedule.kind === "rotation" && <StudioButton onClick={() => { setCopyTargets([]); setCopyLoss([]); setScheduleError(""); copyDialog.current?.showModal(); }}>Copy to weeks</StudioButton>}<StudioButton variant="primary" onClick={() => openDishPicker()}><StudioIcon name="add" /> Add dishes</StudioButton></>}>
        {configuration.groups.length ? <div className={styles.groups}>
          {configuration.groups.map((group, groupIndex) => {
            const slot = currentChoices.groups.find((item) => item.groupId === group.id);
            const references = slot?.dishes || [];
            return <section className={styles.group} key={group.id}>
              <div className={styles.groupHeading}><StudioField label={`Group ${groupIndex + 1} name`}><input required value={group.name} maxLength={200} onChange={(event) => change((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, name: event.target.value } : item) }))} /></StudioField><StudioField label={`Selection for ${group.name || `group ${groupIndex + 1}`}`}><select value={group.presentation || ""} onChange={(event) => change((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, presentation: (event.target.value || undefined) as typeof item.presentation } : item) }))}><option value="">Use menu selection</option><option value="dropdown">Single choice</option><option value="checkboxes">Multiple choice</option><option value="quantities">Quantities</option></select></StudioField><StudioButton aria-label={`Move group ${group.name} up`} disabled={groupIndex === 0} onClick={() => moveGroup(group.id, -1)}>↑</StudioButton><StudioButton aria-label={`Move group ${group.name} down`} disabled={groupIndex === configuration.groups.length - 1} onClick={() => moveGroup(group.id, 1)}>↓</StudioButton><StudioButton variant="tertiary" aria-label={`Remove group ${group.name}`} onClick={() => { setRemovingGroupId(group.id); removeGroupDialog.current?.showModal(); }}>Remove</StudioButton></div>
              <DishList references={references} dishes={assigned.byRevision} dishName={dishName} move={(index, direction) => moveDish(group.id, index, direction)} remove={(id) => removeDish(group.id, id)} groups={configuration.groups.filter(item => item.id !== group.id)} moveTo={moveDishTo} edit={editDish} />
              <StudioButton variant="secondary" onClick={() => openDishPicker(group.id)}>Add to {group.name || "group"}</StudioButton>
            </section>;
          })}
        </div> : <DishList references={currentChoices.dishes} dishes={assigned.byRevision} dishName={dishName} move={(index, direction) => moveDish(undefined, index, direction)} remove={(id) => removeDish(undefined, id)} edit={editDish} />}
        {assigned.error && <StudioButton onClick={assigned.retry}>Retry saved dish details</StudioButton>}
        {configuration.groups.length === 0 ? <details className={styles.groupDisclosure}><summary>Add dish group</summary><p>Existing ungrouped dishes will move into this group in every week.</p><div className={styles.groupAdd}><StudioField label="New dish group name"><input value={newGroupName} maxLength={200} onChange={(event) => setNewGroupName(event.target.value)} placeholder="For example, Starters" /></StudioField><StudioButton onClick={addGroup}>Create group</StudioButton></div></details> : <div className={styles.groupAdd}><StudioButton variant="tertiary" onClick={addGroup}>Add dish group</StudioButton></div>}
      </StudioPanel>
      <StudioPanel title="Customer selection" description="How customers choose these dishes when booking.">
        <StudioSegmentedControl label="Customer selection" value={configuration.presentation} options={[{ value: "dropdown", label: "Dropdown" }, { value: "checkboxes", label: "Checkboxes" }, { value: "quantities", label: "Quantity selector" }]} onChange={(value) => change((current) => ({ ...current, presentation: value }))} />
      </StudioPanel>
      <p className={styles.draftNotice}>Changes are draft content only. Review, publication and customer activation remain governed separately.</p>
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
    </fieldset>} preview={<ProductMenuPreview itemId={draft.itemId} productName={productName} configuration={configuration} library={dishes} editorWeek={week} onEditWeek={setWeek} />} secondaryLabel="Customer preview" />
    <dialog className={styles.discardDialog} ref={removeGroupDialog} aria-labelledby="remove-group-heading">
      <h2 id="remove-group-heading">Remove dish group?</h2><p>Across all weeks, its dishes will move to the first remaining group, or to the ungrouped menu if this is the last group. Library dishes are kept.</p>
      <div className={styles.dialogActions}><StudioButton onClick={() => removeGroupDialog.current?.close()}>Cancel</StudioButton><StudioButton variant="danger" onClick={() => { change(current => removeProductMenuGroup(current, removingGroupId)); removeGroupDialog.current?.close(); }}>Remove group</StudioButton></div>
    </dialog>
    <dialog className={styles.discardDialog} ref={scheduleDialog} aria-labelledby="schedule-loss-heading">
      <h2 id="schedule-loss-heading">Confirm schedule change</h2><p>Only the selected week is kept when switching to a fixed menu. Reducing a rotation removes the weeks listed below from this draft.</p>
      <ul>{loss.map(item => <li key={item.weekIndex}>Week {item.weekIndex + 1}: {item.dishCount} dishes</li>)}</ul>
      <div className={styles.dialogActions}><StudioButton onClick={() => scheduleDialog.current?.close()}>Cancel</StudioButton><StudioButton variant="danger" onClick={() => applySchedule(true)}>Confirm change</StudioButton></div>
    </dialog>
    <dialog className={styles.discardDialog} ref={copyDialog} aria-labelledby="copy-heading">
      <h2 id="copy-heading">Copy week {week + 1}</h2><p>Choose target weeks and whether to append or replace their dishes.</p>
      {configuration.schedule.kind === "rotation" && <div className={styles.copyTargets}>{configuration.schedule.weeks.map((slot, index) => index === week ? null : <label key={index}><input type="checkbox" checked={copyTargets.includes(index)} onChange={event => { setCopyLoss([]); setCopyTargets(items => event.target.checked ? [...items, index] : items.filter(item => item !== index)); }} /> Week {index + 1} · {menuChoiceReferences(slot).length} dishes</label>)}</div>}
      <StudioField label="Copy behaviour"><select value={copyMode} onChange={event => { setCopyMode(event.target.value as "append" | "replace"); setCopyLoss([]); }}><option value="append">Append, keeping existing dishes</option><option value="replace">Replace target weeks</option></select></StudioField>
      {copyLoss.length > 0 && <p role="alert">Replacing will remove current assignments in {copyLoss.map(item => `week ${item.weekIndex + 1} (${item.dishCount} dishes)`).join(", ")}.</p>}
      {scheduleError && <p role="alert" className={styles.error}>{scheduleError}</p>}
      <div className={styles.dialogActions}><StudioButton onClick={() => copyDialog.current?.close()}>Cancel</StudioButton><StudioButton variant="primary" onClick={() => applyCopy(copyLoss.length > 0)}>{copyLoss.length ? "Confirm replacement" : "Copy dishes"}</StudioButton></div>
    </dialog>
    <dialog className={styles.discardDialog} ref={dishExitDialog} aria-labelledby="dish-exit-heading"><h2 id="dish-exit-heading">Discard dish edits?</h2><p>Your unsaved dish changes will be lost.</p><div className={styles.dialogActions}><StudioButton onClick={() => dishExitDialog.current?.close()}>Keep editing</StudioButton><StudioButton variant="danger" onClick={() => { dishExitDialog.current?.close(); finishDishExit(dishExit); }}>Discard edits</StudioButton></div></dialog>
    <dialog className={styles.dishDialog} ref={dialog} aria-labelledby="dish-picker-heading" onCancel={(event) => { event.preventDefault(); requestDishExit("close"); }}>
      <div className={styles.dialogHeader}><div><h2 id="dish-picker-heading">{creatingDish ? "Create new dish" : "Add dishes"}</h2><p>{creatingDish ? "Create a reusable library draft. Safety approval is reviewed separately." : "Search and select one or more dishes for this menu."}</p></div><button type="button" aria-label="Close dish picker" disabled={creatingDishBusy} onClick={() => requestDishExit("close")}>×</button></div>
      {creatingDish && dishLoading ? <p role="status">Loading current dish…</p> : creatingDish && !newDish ? <div><p role="alert">{creatingDishError}</p><StudioButton onClick={() => { setCreatingDish(false); setCreatingDishError(""); }}>Back to dishes</StudioButton></div> : creatingDish && newDish ? <form className={styles.newDishForm} onSubmit={(event) => void createDishFromPicker(event)}>
        <StudioField label="Dish name"><input required maxLength={200} value={newDish.name} onChange={(event) => setNewDish((current) => current ? ({ ...current, name: event.target.value }) : current)} /></StudioField>
        <StudioField label="Category"><select value={newDish.category} onChange={(event) => setNewDish((current) => current ? ({ ...current, category: event.target.value as Dish["category"] }) : current)}>{categories.map((category) => <option key={category} value={category}>{category.replaceAll("_", " ")}</option>)}</select></StudioField>
        <StudioField label="Temperature"><select value={newDish.temperature || ""} onChange={(event) => setNewDish((current) => current ? ({ ...current, temperature: (event.target.value || null) as Dish["temperature"] }) : current)}><option value="">Not set</option><option value="hot">Hot</option><option value="cold">Cold</option></select></StudioField>
        <StudioField label="Customer description"><textarea required maxLength={4000} value={newDish.customerDescription} onChange={(event) => setNewDish((current) => current ? ({ ...current, customerDescription: event.target.value }) : current)} /></StudioField>
        <StudioField label="Kitchen description"><textarea required maxLength={12000} value={newDish.kitchenDescription} onChange={(event) => setNewDish((current) => current ? ({ ...current, kitchenDescription: event.target.value }) : current)} /></StudioField>
        <DishAssortment dish={newDish} canManage={canManage && !creatingDishBusy} update={update => setNewDish(current => current ? update(current) : current)} />
        {savedDish && <p>Saving creates a new library revision. Existing menu assignments keep their selected revision; remove and reselect the dish to use the new one.</p>}
        {savedDish && safetyAvailable && <DishSafety key={`${savedDish.id}:${savedDish.version}:${JSON.stringify(newDish) === JSON.stringify(savedDish)}`} dish={savedDish} saved={JSON.stringify(newDish) === JSON.stringify(savedDish)} canManage={canManage} checkerOrigin={checkerOrigin} />}
        {creatingDishError && <p className={styles.error} role="alert">{creatingDishError}</p>}
        <div className={styles.dialogActions}><StudioButton type="button" disabled={creatingDishBusy} onClick={() => requestDishExit(fromAssigned ? "close" : "list")}>{fromAssigned ? "Back to menu" : "Back to dishes"}</StudioButton><StudioButton type="submit" variant="primary" busy={creatingDishBusy} disabled={!canManage || creatingDishBusy || !newDish.name.trim() || !newDish.customerDescription.trim() || !newDish.kitchenDescription.trim()}>{creatingDishBusy ? "Saving dish…" : "Save dish draft"}</StudioButton></div>
      </form> : <>
        <div className={styles.pickerTools}><StudioField label="Search dishes"><input type="search" value={dishQuery} onChange={(event) => setDishQuery(event.target.value)} placeholder="Search name or category" /></StudioField><StudioButton variant="secondary" disabled={!canManage} disabledReason="Your account has read-only access to dishes." onClick={() => { const blank = blankDish(); setNewDish(blank); setDishBaseline(blank); setSavedDish(null); setFromAssigned(false); setCreatingDish(true); setCreatingDishError(""); }}>Create new dish</StudioButton></div>
        <div className={styles.categoryFilters} role="group" aria-label="Filter dishes by category"><StudioButton variant={dishCategory === "all" ? "primary" : "secondary"} aria-pressed={dishCategory === "all"} onClick={() => setDishCategory("all")}>All dishes</StudioButton>{categories.map((category) => <StudioButton key={category} variant={dishCategory === category ? "primary" : "secondary"} aria-pressed={dishCategory === category} onClick={() => setDishCategory(category)}>{category.replaceAll("_", " ")}</StudioButton>)}</div>
        <div className={styles.pickerList}><div className={styles.pickerHeading}><strong>Dishes</strong><strong>Category</strong></div>{visibleDishes.map((dish) => <label className={styles.pickerRow} data-selected={selectedDishIds.includes(dish.id)} key={dish.id}><input type="checkbox" checked={selectedDishIds.includes(dish.id)} onChange={(event) => setSelectedDishIds((ids) => event.target.checked ? [...ids, dish.id] : ids.filter((id) => id !== dish.id))} /><span><strong>{dish.name}</strong>{dish.customerDescription && <small>{dish.customerDescription}</small>}</span><span className={styles.pickerCategory}>{dish.category.replaceAll("_", " ")}</span></label>)}
          {dishError && <p role="alert">{dishError} <StudioButton onClick={onLoadDishes}>Try again</StudioButton></p>}
          {!visibleDishes.length && !dishError && <p className={styles.muted}>{loadingDishes ? "Loading dishes…" : "No dishes match this search and category."}</p>}
          {dishCursor && <StudioButton onClick={onLoadMoreDishes} disabled={loadingDishes}>{loadingDishes ? "Loading…" : "Load more dishes"}</StudioButton>}
        </div>
        {configuration.schedule.kind === "rotation" && <fieldset className={styles.pickerWeeks}><legend>Add to weeks</legend>{configuration.schedule.weeks.map((_, index) => <label key={index}><input type="checkbox" checked={pickerWeeks.includes(index)} onChange={event => setPickerWeeks(items => event.target.checked ? [...items, index] : items.filter(item => item !== index))} /> Week {index + 1}</label>)}</fieldset>}
        {creatingDishError && <p className={styles.error} role="alert">{creatingDishError}</p>}
        <div className={styles.dialogActions}><span aria-live="polite">{selectedDishIds.length} {selectedDishIds.length === 1 ? "dish" : "dishes"} selected</span><StudioButton onClick={() => dialog.current?.close()}>Cancel</StudioButton><StudioButton variant="primary" disabled={!selectedDishIds.length || (configuration.schedule.kind === "rotation" && !pickerWeeks.length)} onClick={addSelectedDishes}>Add selected dishes</StudioButton></div>
      </>}
    </dialog>
    <StudioHeaderActions>
      <StudioButton onClick={onBack}>Menu Builder</StudioButton>
      <StudioButton busy={status === "saving"} disabled={!dirty || !canManage || status === "conflict" || Boolean(recovery)} onClick={() => void save()}>{status === "error" ? "Retry save" : "Save draft"}</StudioButton>
      <StudioButton variant="primary" disabled={!canManage || dirty || Boolean(recovery) || status !== "saved"} onClick={onReview}>Review &amp; publish</StudioButton>
    </StudioHeaderActions>
  </div>;
}

function archivedDishName(assigned: ReturnType<typeof useProductMenuDishes>, reference: ProductMenuDishReference) {
  const dish = assigned.byRevision.get(productMenuDishKey(reference));
  return dish ? dish.name || "Unnamed dish" : assigned.loading ? "Loading dish…" : "Dish revision unavailable";
}

function DishList({ references, dishes, dishName, move, remove, groups = [], moveTo, edit }: { references: ProductMenuDishReference[]; dishes: Map<string, ProductMenuDish>; dishName: DishDisplay; move: (index: number, direction: -1 | 1) => void; remove: (dishId: string) => void; groups?: Array<{ id: string; name: string }>; moveTo?: (dishId: string, groupId: string) => void; edit: (reference: ProductMenuDishReference) => void }) {
  const dragged = useRef<number | null>(null);
  return <ol className={styles.dishList}>{references.map((reference, index) => {
    const dish = dishes.get(productMenuDishKey(reference));
    const name = dishName(reference);
    return <li key={reference.dishId} draggable onDragStart={() => { dragged.current = index; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const from = dragged.current; dragged.current = null; if (from === null || from === index) return; const direction = from < index ? 1 : -1; for (let step = from; step !== index; step += direction) move(step, direction); }} onDragEnd={() => { dragged.current = null; }}>
      <span className={styles.dragHandle} aria-hidden="true">⠿</span><div><strong>{name}</strong>{dish?.customerDescription && <small>{dish.customerDescription}</small>}</div>
      <span className={styles.safetyNote}>Safety checked in review</span><div className={styles.dishActions}><button type="button" aria-label={`Edit ${name}`} onClick={() => edit(reference)}>✎</button>{groups.length > 0 && <select aria-label={`Move ${name} to another group`} value="" onChange={event => { if (event.target.value) moveTo?.(reference.dishId, event.target.value); }}><option value="">Move to group</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}<button type="button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Move ${name} down`} disabled={index === references.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`Remove ${name}`} onClick={() => remove(reference.dishId)}>×</button></div>
    </li>;
  })}</ol>;
}

export default function ProductMenuBuilder({ actorName, canManage, canPublish, publicationPilot, safetyAvailable = false, checkerOrigin, onNavigate, embedded = false, requestedProductId, requestedDestination, onProductRequestHandled, onNavigationHandled, onDirtyStateChange, onActiveProductChange }: {
  actorName: string;
  canManage: boolean;
  canPublish: boolean;
  publicationPilot?: StudioPublicationPilot;
  safetyAvailable?: boolean;
  checkerOrigin?: string;
  onNavigate: (destination: StudioDestination) => void;
  embedded?: boolean;
  requestedProductId?: string | null;
  requestedDestination?: StudioDestination | null;
  onProductRequestHandled?: () => void;
  onNavigationHandled?: () => void;
  onDirtyStateChange?: (dirty: boolean) => void;
  onActiveProductChange?: (itemId: string | null) => void;
}) {
  const reads = useStudioReads();
  const catalogue = useStudioRead(reads.catalogue);
  const menuIndex = useStudioRead(reads.summaries);
  const library = useStudioRead(reads.dishes);
  const products = catalogue.value?.products ?? [];
  const summaries = menuIndex.value ?? [];
  const dishes = library.value?.items ?? [];
  const dishCursor = library.value?.nextCursor ?? null;
  const loading = catalogue.status === "idle" || catalogue.status === "loading" || menuIndex.status === "idle" || menuIndex.status === "loading";
  const error = catalogue.error?.message || menuIndex.error?.message;
  const [draft, setDraft] = useState<ProductMenuDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const [notice, setNotice] = useState<Notice>({ kind: "info", message: "Menu Builder" });
  const discardDialog = useRef<HTMLDialogElement>(null);
  const discardEditor = useRef<(() => boolean) | null>(null);
  const registerDiscard = useCallback((discard: (() => boolean) | null) => { discardEditor.current = discard; }, []);
  const openGeneration = useRef(0);
  const initialLinkHandled = useRef(false);
  const productName = (draft && catalogue.value?.productsById.get(draft.itemId)?.name) || "Hospitality menu";
  const currentProduct = Boolean(draft && catalogue.value?.productsById.has(draft.itemId));
  const productLinks = useMemo(() => summaries.flatMap((summary) => {
    const product = catalogue.value?.productsById.get(summary.itemId);
    return product ? [{ id: summary.itemId, name: product.name, status: "Draft", summary: summary.kind === "fixed" ? `Fixed · ${summary.dishCount ?? 0} dishes` : `${summary.cycleWeeks}-week rotation` }] : [];
  }), [catalogue.value, summaries]);

  const loadIndex = useCallback((force = false) => {
    void reads.loadBuilder(force).catch(() => undefined);
  }, [reads]);
  const loadDishes = useCallback((cursor?: string) => {
    void reads.loadDishPage(cursor).catch(() => undefined);
  }, [reads]);

  useEffect(() => { loadIndex(); return () => { openGeneration.current++; }; }, [loadIndex]);
  useEffect(() => {
    if (menuIndex.status === "idle") void reads.loadSummaries().catch(() => undefined);
  }, [menuIndex.status, reads]);
  useEffect(() => {
    onActiveProductChange?.(editing ? draft?.itemId || null : null);
    return () => onActiveProductChange?.(null);
  }, [draft?.itemId, editing, onActiveProductChange]);
  useEffect(() => { if (!requestedProductId || !catalogue.value) return; if (requestedProductId !== draft?.itemId) requestProduct(requestedProductId); onProductRequestHandled?.(); }, [requestedProductId, draft?.itemId, catalogue.value]);
  useEffect(() => { if (!requestedDestination) return; navigate(requestedDestination); onNavigationHandled?.(); }, [requestedDestination]);
  useEffect(() => {
    if (initialLinkHandled.current || !menuIndex.value || !catalogue.value) return;
    initialLinkHandled.current = true;
    const itemId = new URLSearchParams(window.location.search).get("product");
    if (!itemId || !summaries.some((item) => item.itemId === itemId) || draft || requestedProductId) return;
    void openProduct(itemId);
  }, [menuIndex.value, catalogue.value]);

  async function openProduct(itemId: string) {
    const generation = ++openGeneration.current;
    setDraftError("");
    setBusy(true);
    try {
      const item = await reads.loadDraft(itemId, menuIndex.value?.find(summary => summary.itemId === itemId)?.version);
      if (generation !== openGeneration.current) return;
      if (!item) throw new Error("This menu draft is no longer available. Refresh the product list.");
      setDraft(item); setEditing(true); setReviewing(false); setDirty(false); onDirtyStateChange?.(false); setNotice({ kind: "info", message: "Draft loaded" });
      window.history.replaceState(null, "", `/?product=${encodeURIComponent(itemId)}`);
    } catch (failure) { if (generation === openGeneration.current) setDraftError((failure as Error).message || "The menu draft could not be opened."); }
    finally { if (generation === openGeneration.current) setBusy(false); }
  }

  async function createProduct(itemId: string, setup: ProductMenuSetup) {
    const result = await sendStudioProduct<{ item: ProductMenuDraft }>(reads.fetch, "product-menus", { action: "create", itemId, setup });
    setDraft(result.item); setEditing(true); setReviewing(false); setDirty(false); onDirtyStateChange?.(false); setDraftError("");
    reads.rememberDraft(result.item, summarizeDraft(result.item));
    window.history.replaceState(null, "", `/?product=${encodeURIComponent(itemId)}`);
  }

  function requestProduct(itemId: string) {
    if (draft?.itemId === itemId && editing) return true;
    if (dirty) { setPendingExit({ kind: "product", itemId }); discardDialog.current?.showModal(); return false; }
    void openProduct(itemId);
    return true;
  }

  function requestHome() {
    if (dirty) { setPendingExit({ kind: "home" }); discardDialog.current?.showModal(); return; }
    openGeneration.current++;
    setBusy(false);
    setEditing(false); setReviewing(false); setDraft(null); setDirty(false); onDirtyStateChange?.(false); setDraftError(""); setNotice({ kind: "info", message: "Menu Builder" });
    window.history.replaceState(null, "", "/");
  }

  function navigate(destination: StudioDestination) {
    if (destination === "builder") { requestHome(); return true; }
    if (dirty) { setPendingExit({ kind: "destination", destination }); discardDialog.current?.showModal(); return false; }
    onNavigate(destination);
    return true;
  }

  function discardAndContinue() {
    if (discardEditor.current && !discardEditor.current()) { setDraftError("A save is in progress. Wait for it to finish before leaving."); return; }
    setDirty(false); onDirtyStateChange?.(false); discardDialog.current?.close();
    const next = pendingExit; setPendingExit(null);
    if (!next) return;
    if (next.kind === "product") { void openProduct(next.itemId); return; }
    if (next.kind === "home") { setEditing(false); setDraft(null); setDraftError(""); window.history.replaceState(null, "", "/"); return; }
    onNavigate(next.destination);
  }

  async function saveConfiguration(snapshot: ProductMenuDraft): Promise<ProductMenuDraft> {
    const result = await sendStudioProduct<{ item: ProductMenuDraft }>(reads.fetch, "product-menus", { action: "save", item: snapshot });
    const saved = productMenuDraft.parse(result.item);
    if (saved.itemId !== snapshot.itemId || saved.version < snapshot.version || saved.version > snapshot.version + 1 || JSON.stringify(productMenuConfiguration.parse(saved.configuration)) !== JSON.stringify(productMenuConfiguration.parse(snapshot.configuration))) throw new Error("Studio could not verify the save acknowledgement. Retry this save.");
    setDraft(saved);
    reads.rememberDraft(saved, summarizeDraft(saved, reads.summaries.snapshot().value?.find((item) => item.itemId === saved.itemId)));
    setNotice({ kind: "success", message: "Draft saved" });
    return saved;
  }

  async function loadLatestDraft(): Promise<ProductMenuDraft> {
    if (!draft) throw new Error("The menu draft is unavailable.");
    const result = await reads.json<{ item: ProductMenuDraft | null }>("/api/studio/product-menus?" + new URLSearchParams({ itemId: draft.itemId }));
    if (!result.item) throw new Error("The latest draft is unavailable.");
    setDraft(result.item);
    reads.rememberDraft(result.item, summarizeDraft(result.item, reads.summaries.snapshot().value?.find(item => item.itemId === result.item!.itemId)));
    return result.item;
  }

  const markDirty = useCallback((value: boolean) => {
    setDirty(value);
    onDirtyStateChange?.(value);
  }, [onDirtyStateChange]);

  const headerActions: ReactNode = undefined;
  const content = <>
    {(loading || busy) && <p role="status">{busy ? "Opening menu draft…" : "Loading Hospitality products and menu drafts…"}</p>}
    {error && <div className={styles.errorBox} role="alert"><p>{error}</p><StudioButton onClick={() => loadIndex(true)}>Try again</StudioButton></div>}
    {editing && draft && !currentProduct && !loading && !error && <p role="alert">This product is unavailable in the current Hospitality catalogue.</p>}
    {editing && draft ? reviewing ? <ProductMenuReview key={`${draft.itemId}:${draft.version}`} draft={draft} productName={productName} dishes={dishes} canPublish={canPublish && currentProduct} pilot={publicationPilot} onBack={() => setReviewing(false)} submit={body => sendStudioProduct(reads.fetch, "product-publication", body)} onPublished={() => reads.rememberDraft(draft, { ...summarizeDraft(draft), publicationStatus: "published", hasPublishedRevision: true })} />
      : <ProductMenuEditor key={draft.itemId} draft={draft} productName={productName} hasPublishedRevision={summaries.find(item => item.itemId === draft.itemId)?.hasPublishedRevision ?? false} dishes={dishes} dishCursor={dishCursor} loadingDishes={library.status === "loading"} dishError={library.error?.message} canManage={canManage && currentProduct}
        onLoadDishes={() => loadDishes()} onLoadMoreDishes={() => loadDishes(dishCursor || undefined)} onDishCreated={reads.rememberDish} onSave={saveConfiguration} onLoadLatest={loadLatestDraft} recoveryScope={reads.draftRecoveryScope()} safetyAvailable={safetyAvailable} checkerOrigin={checkerOrigin} onRegisterDiscard={registerDiscard} onReview={() => setReviewing(true)} onDirtyChange={markDirty} onBack={requestHome} />
      : !loading && !error && <MenuBuilderHome products={products} summaries={summaries} canManage={canManage} onOpen={(itemId) => { void openProduct(itemId); }} onCreate={createProduct} />}
    {draftError && <p className={styles.errorBox} role="alert">{draftError}</p>}
    <dialog className={styles.discardDialog} ref={discardDialog} aria-labelledby="discard-heading">
      <h2 id="discard-heading">Discard unsaved changes?</h2><p>Your latest edits have not been saved. You can save the draft first, or discard the edits and continue.</p>
      {draftError && <p className={styles.errorBox} role="alert">{draftError}</p>}
      <div className={styles.dialogActions}><StudioButton onClick={() => { setPendingExit(null); discardDialog.current?.close(); }}>Keep editing</StudioButton><StudioButton variant="danger" onClick={discardAndContinue}>Discard changes</StudioButton></div>
    </dialog>
  </>;
  if (embedded) return content;
  return <StudioShell actorName={actorName} active="builder" onNavigate={navigate} navigationHrefs={{ builder: "/", library: "/?page=library", catalogue: "/?page=catalogue" }} productLinks={productLinks} activeProductId={draft?.itemId} onSelectProduct={requestProduct} saveState={<StudioStatus tone={notice.kind}>{dirty ? "Unsaved changes" : notice.message}</StudioStatus>} headerActions={headerActions} contentWidth={editing ? "wide" : "standard"}>{content}</StudioShell>;
}
