"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ProductMenuChoices, ProductMenuConfiguration, ProductMenuDraft, ProductMenuListing, ProductMenuSummary } from "../../shared/hospitality-menu-studio-product-content";
import type { StudioPublicationDescriptor } from "../../shared/hospitality-menu-studio-publication";
import { categories, type Dish } from "../lib/contract";
import type { StudioPublicationPilot } from "../lib/hub-publication";
import { productMenuDishKey, type ProductMenuDish, type ProductMenuDishReference } from "../lib/product-menu-dishes";
import { MenuBuilderHome, type ProductMenuSetup } from "./menu-builder-home";
import { filterPickerDishes } from "./product-menu-picker-model";
import { menuChoiceReferences, removeProductMenuGroup } from "./product-menu-editor-model";
import { ProductMenuPreview } from "./product-menu-preview";
import { StudioButton, StudioEditorLayout, StudioField, StudioIcon, StudioPageHeader, StudioPanel, StudioSegmentedControl, StudioShell, StudioStatus, type StudioDestination } from "./studio-design-system";
import { useStudioRequest } from "./use-studio-draft";
import { useStudioRead, useStudioReads } from "./studio-reads";
import { useProductMenuDishes } from "./use-product-menu-dishes";
import { useAssignedDishes } from "./use-assigned-dishes";
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
  if (!response.ok) throw new Error(result.error || "The product request could not be completed.");
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

function ProductMenuReview({ draft, productName, dishes, canPublish, pilot, onBack }: { draft: ProductMenuDraft; productName: string; dishes: Dish[]; canPublish: boolean; pilot?: StudioPublicationPilot; onBack: () => void }) {
  const reads = useStudioReads();
  const [effectiveDate, setEffectiveDate] = useState(pilot?.firstDate || "");
  const [review, setReview] = useState<{ issues: string[]; reviewToken: string | null } | null>(null);
  const [publicationId, setPublicationId] = useState("");
  const [activationReason, setActivationReason] = useState("");
  const [activationAttempt, setActivationAttempt] = useState<{ commandId: string; expectedGeneration: number } | null>(null);
  const [activated, setActivated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slots = draft.configuration.schedule.kind === "fixed" ? [draft.configuration.schedule.choices] : draft.configuration.schedule.weeks;
  const allReferences = slots.flatMap(menuChoiceReferences);
  const currentDishes = useAssignedDishes(allReferences.map(reference => reference.dishId), dishes);
  const lookup = new Map([...dishes, ...currentDishes.items].map((dish) => [dish.id, dish]));
  const assigned = useProductMenuDishes(allReferences, dishes);
  const dishName = (reference: ProductMenuDishReference) => archivedDishName(assigned, reference);
  const emptySlots = slots.filter((slot) => !menuChoiceReferences(slot).length).length;
  const missingReferences = new Set(allReferences.map(productMenuDishKey).filter(key => !assigned.byRevision.has(key)));
  const changedReferences = allReferences.filter((reference) => {
    const current = lookup.get(reference.dishId);
    return current && current.version > reference.revision;
  });
  async function checkReadiness() {
    if (!pilot || !canPublish || !effectiveDate) return;
    setBusy(true); setError(""); setReview(null);
    try {
      const result = await sendStudioProduct<{ issues: string[]; reviewToken: string | null }>(reads.fetch, "product-publication", { action: "review", itemId: draft.itemId, version: draft.version, effectiveDate });
      setReview(result);
    } catch (failure) { setError((failure as Error).message || "The CPU and Hub checks could not be completed."); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!review?.reviewToken || !pilot || !canPublish) return;
    setBusy(true); setError("");
    try {
      const result = await sendStudioProduct<{ publication: StudioPublicationDescriptor }>(reads.fetch, "product-publication", { action: "publish", itemId: draft.itemId, version: draft.version, effectiveDate, reviewToken: review.reviewToken, confirmed: true });
      setPublicationId(result.publication.id);
      if (result.publication.sourceDraftVersion === draft.version) {
        reads.rememberDraft(draft, { ...summarizeDraft(draft), publicationStatus: "published", hasPublishedRevision: true });
      }
    } catch (failure) { setError((failure as Error).message || "The publication was not confirmed by Hub."); }
    finally { setBusy(false); }
  }

  async function activate() {
    if (!pilot?.activateProduct || !publicationId || activationReason.trim().length < 3) return;
    const attempt = activationAttempt || { commandId: crypto.randomUUID(), expectedGeneration: pilot.generation };
    setActivationAttempt(attempt); setBusy(true); setError("");
    try {
      await sendStudioProduct(reads.fetch, "product-publication", { action: "activate", itemId: draft.itemId, publicationId, ...attempt, reason: activationReason });
      setActivated(true);
    } catch (failure) { setError((failure as Error).message || "Hub did not confirm activation. Retry the same request."); }
    finally { setBusy(false); }
  }
  return <div className={styles.reviewPage}>
    <StudioPageHeader breadcrumbs={[{ label: "Menu Builder" }, { label: productName }, { label: "Review & publish" }]} title="Review & publish" description={`${productName} · ${draft.configuration.schedule.kind === "fixed" ? "Fixed menu" : `${draft.configuration.schedule.weeks.length}-week rotation`}`} actions={<StudioButton onClick={onBack}>Back to editor</StudioButton>} />
    <div className={styles.reviewGrid}>
      <StudioPanel title="Menu summary" description={draft.configuration.presentation === "dropdown" ? "Single choice" : draft.configuration.presentation === "checkboxes" ? "Multiple choice" : "Quantities"}>
        {draft.configuration.schedule.kind === "rotation" && <p>Cycle starts Monday {draft.configuration.schedule.anchorMonday}. Repeats every {draft.configuration.schedule.weeks.length} weeks.</p>}
        <div className={styles.reviewSlots}>{slots.map((slot, index) => {
          const title = draft.configuration.schedule.kind === "fixed" ? "Dishes" : `Week ${index + 1}`;
          const groupOrder = new Map(draft.configuration.groups.map((group, groupIndex) => [group.id, groupIndex]));
          const grouped = [...slot.groups].sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0));
          return <section className={styles.reviewSlot} key={title}>
            <h3>{title}</h3>
            {slot.dishes.length > 0 && <ol>{slot.dishes.map((reference) => <li key={reference.dishId}>{dishName(reference)}</li>)}</ol>}
            {grouped.map((slotGroup) => {
              const group = draft.configuration.groups.find((item) => item.id === slotGroup.groupId);
              return <div className={styles.reviewGroup} key={slotGroup.groupId}><h4>{group?.name || "Group unavailable"}</h4>{slotGroup.dishes.length ? <ol>{slotGroup.dishes.map((reference) => <li key={reference.dishId}>{dishName(reference)}</li>)}</ol> : <p className={styles.muted}>No dishes assigned.</p>}</div>;
            })}
            {slot.dishes.length === 0 && grouped.length === 0 && <p className={styles.muted}>No dishes selected.</p>}
          </section>;
        })}</div>
      </StudioPanel>
      <StudioPanel title="Review and publication" description="The current CPU review and Hub publication contract decide whether this menu can proceed.">
        <ul className={styles.readiness}>
          <li><StudioStatus tone={emptySlots ? "warning" : "neutral"}>{emptySlots ? "Action needed" : "Ready to check"}</StudioStatus><span>{emptySlots ? `${emptySlots} menu ${emptySlots === 1 ? "slot is" : "slots are"} empty.` : "Run the authorised review to check the saved product, menu and safety evidence."}</span></li>
          <li><StudioStatus tone={assigned.loading ? "neutral" : missingReferences.size ? "danger" : "success"}>{assigned.loading ? "Checking" : missingReferences.size ? "Dish unavailable" : "Loaded"}</StudioStatus><span>{assigned.loading ? "Loading assigned dish revisions." : missingReferences.size ? `${missingReferences.size} assigned dish revisions could not be loaded.` : "Assigned dish revisions are available."}</span></li>
          {changedReferences.length > 0 && <li><StudioStatus tone="warning">Re-review needed</StudioStatus><span>{changedReferences.length} dishes have changed since this draft selected their saved revisions.</span></li>}
          {review && <li><StudioStatus tone={review.reviewToken ? "success" : "warning"}>{review.reviewToken ? "Checks passed" : "Action needed"}</StudioStatus><span>{review.reviewToken ? "Product and current CPU evidence checks passed. Hub publication is still a separate step." : review.issues.join(" ") || "The review did not approve this draft."}</span></li>}
          <li><StudioStatus tone="warning">Not checked</StudioStatus><span>Booking impact is unavailable under the current product publication contract.</span></li>
        </ul>
        {assigned.error && <StudioButton onClick={assigned.retry}>Retry saved dish details</StudioButton>}
        {pilot && canPublish ? <>
          <StudioField label="Effective date"><input type="date" min={pilot.firstDate} max={pilot.lastDate} value={effectiveDate} disabled={Boolean(publicationId)} onChange={(event) => { setEffectiveDate(event.target.value); setReview(null); setPublicationId(""); }} /></StudioField>
          <StudioButton onClick={() => void checkReadiness()} busy={busy} disabled={Boolean(publicationId) || !effectiveDate || Boolean(emptySlots) || assigned.loading || missingReferences.size > 0}>Check readiness</StudioButton>
          {review?.reviewToken && <StudioButton variant="primary" onClick={() => void publish()} busy={busy}>Publish to Hub</StudioButton>}
          {publicationId && <div className={styles.reviewBoundary}>
            <p><StudioStatus tone="success">Published to Hub</StudioStatus> This menu is published. Customer activation is a separate governed step.</p>
            {pilot.activateProduct ? <>
              <StudioField label="Activation reason"><input value={activationReason} maxLength={500} disabled={Boolean(activationAttempt)} onChange={(event) => { setActivationReason(event.target.value); setActivationAttempt(null); }} /></StudioField>
              <StudioButton variant="primary" onClick={() => void activate()} busy={busy} disabled={activated || activationReason.trim().length < 3}>{activated ? "Activated for customers" : activationAttempt ? "Retry activation" : "Activate for customers"}</StudioButton>
            </> : <p>Hub has not granted this account and staging scope product activation.</p>}
          </div>}
        </> : <p className={styles.reviewBoundary}>CPU review and Hub publication are unavailable to this account or staging scope. The draft remains unpublished.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <p className={styles.reviewBoundary}>Reviewing this draft does not publish it or change customer availability. Existing bookings keep their current records.</p>
      </StudioPanel>
    </div>
  </div>;
}

function ProductMenuEditor({ draft, productName, dishes, dishCursor, loadingDishes, dishError, canManage, onLoadDishes, onLoadMoreDishes, onDishCreated, onSave, onReview, onDirtyChange, onBack }: {
  draft: ProductMenuDraft;
  productName: string;
  dishes: Dish[];
  dishCursor: string | null;
  loadingDishes: boolean;
  dishError?: string;
  canManage: boolean;
  onLoadDishes: () => void;
  onLoadMoreDishes: () => void;
  onDishCreated: (dish: Dish) => void;
  onSave: (configuration: ProductMenuConfiguration) => Promise<void>;
  onReview: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
}) {
  const request = useStudioRequest();
  const [configuration, setConfiguration] = useState(draft.configuration);
  const [week, setWeek] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dishQuery, setDishQuery] = useState("");
  const [dishCategory, setDishCategory] = useState("all");
  const [selectedDishIds, setSelectedDishIds] = useState<string[]>([]);
  const [creatingDish, setCreatingDish] = useState(false);
  const [creatingDishBusy, setCreatingDishBusy] = useState(false);
  const [creatingDishError, setCreatingDishError] = useState("");
  const [newDish, setNewDish] = useState({ name: "", category: "other" as Dish["category"], temperature: null as Dish["temperature"], customerDescription: "", kitchenDescription: "" });
  const [targetGroupId, setTargetGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const currentChoices = choicesAt(configuration, week);
  const references = useMemo(() => menuChoiceReferences(currentChoices), [currentChoices]);
  const allAssigned = useMemo(() => new Set(references.map(dish => dish.dishId)), [references]);
  const assigned = useProductMenuDishes(references, dishes);
  const dishName = (reference: ProductMenuDishReference) => archivedDishName(assigned, reference);
  const visibleDishes = useMemo(() => filterPickerDishes(dishes, dishQuery, dishCategory, allAssigned), [allAssigned, dishes, dishQuery, dishCategory]);
  const dishById = useMemo(() => new Map(dishes.map((dish) => [dish.id, dish])), [dishes]);

  useEffect(() => {
    setConfiguration(draft.configuration);
    setWeek(0);
    setDirty(false);
    onDirtyChange(false);
  }, [draft.itemId, draft.version, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [dirty]);

  function change(update: (value: ProductMenuConfiguration) => ProductMenuConfiguration) {
    setConfiguration((current) => update(current));
    setDirty(true);
    onDirtyChange(true);
    setSaveError("");
  }

  async function save() {
    if (!dirty || !canManage || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(configuration);
      setDirty(false);
      onDirtyChange(false);
    } catch (failure) {
      setSaveError((failure as Error).message || "The latest menu changes were not confirmed.");
    } finally { setSaving(false); }
  }

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
    setDishQuery("");
    setDishCategory("all");
    setCreatingDish(false);
    setCreatingDishError("");
    dialog.current?.showModal();
  }

  async function createDishFromPicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || creatingDishBusy || !newDish.name.trim() || !newDish.customerDescription.trim() || !newDish.kitchenDescription.trim()) return;
    setCreatingDishBusy(true); setCreatingDishError("");
    try {
      const item: Dish = { ...newDish, id: crypto.randomUUID(), version: 0, updatedAt: "", name: newDish.name.trim(), customerDescription: newDish.customerDescription.trim(), kitchenDescription: newDish.kitchenDescription.trim(), assortment: null };
      const result = await request({ action: "save-dish", item });
      const saved = result.item as Dish;
      onDishCreated(saved);
      setSelectedDishIds((ids) => ids.includes(saved.id) ? ids : [...ids, saved.id]);
      setNewDish({ name: "", category: "other", temperature: null, customerDescription: "", kitchenDescription: "" });
      setCreatingDish(false);
    } catch (failure) { setCreatingDishError((failure as Error).message || "The dish draft could not be saved."); }
    finally { setCreatingDishBusy(false); }
  }

  function addSelectedDishes() {
    if (!selectedDishIds.length) return;
    change((current) => withChoices(current, week, (slot) => {
      if (!targetGroupId) return { ...slot, dishes: [...slot.dishes, ...selectedDishIds.map((dishId) => ({ dishId, revision: dishById.get(dishId)!.version }))] };
      const group = slot.groups.find((item) => item.groupId === targetGroupId);
      const additions = selectedDishIds.map((dishId) => ({ dishId, revision: dishById.get(dishId)!.version }));
      return { ...slot, groups: group ? slot.groups.map((item) => item.groupId === targetGroupId ? { ...item, dishes: [...item.dishes, ...additions] } : item) : [...slot.groups, { groupId: targetGroupId, dishes: additions }] };
    }));
    dialog.current?.close();
  }

  const weekCount = configuration.schedule.kind === "rotation" ? configuration.schedule.weeks.length : 1;
  const heading = configuration.schedule.kind === "fixed" ? "Fixed menu" : `${weekCount}-week rotation`;
  return <div className={styles.builder}>
    <StudioPageHeader breadcrumbs={[{ label: "Menu Builder" }, { label: productName }]} title={productName} description={heading} context={<StudioStatus tone="info">Draft</StudioStatus>} actions={<StudioButton variant="primary" disabled={!canManage || dirty} disabledReason={!canManage ? "This account cannot review menu drafts." : dirty ? "Save the draft before reviewing it." : undefined} onClick={onReview}>Review &amp; publish</StudioButton>} />
    <StudioEditorLayout editor={<>
      {configuration.schedule.kind === "rotation" && <StudioPanel title="Weeks" description="Choose a week to edit its dishes.">
        <div className={styles.weekStrip} role="group" aria-label="Rotation weeks">{configuration.schedule.weeks.map((_, index) => <button key={index} type="button" aria-pressed={week === index} onClick={() => setWeek(index)}>Week {index + 1}</button>)}</div>
      </StudioPanel>}
      <StudioPanel title="Customer selection" description="Choose how customers select dishes from this menu.">
        <StudioSegmentedControl label="Customer selection" value={configuration.presentation} options={[{ value: "dropdown", label: "Single choice" }, { value: "checkboxes", label: "Multiple choice" }, { value: "quantities", label: "Quantities" }]} onChange={(value) => change((current) => ({ ...current, presentation: value }))} />
      </StudioPanel>
      <StudioPanel title={configuration.schedule.kind === "fixed" ? "Dishes" : `Week ${week + 1} dishes`} description="Add dishes from the reusable library and set their order." actions={<StudioButton variant="secondary" onClick={() => openDishPicker()}>Add dishes</StudioButton>}>
        {configuration.groups.length ? <div className={styles.groups}>
          {configuration.groups.map((group, groupIndex) => {
            const slot = currentChoices.groups.find((item) => item.groupId === group.id);
            const references = slot?.dishes || [];
            return <section className={styles.group} key={group.id}>
              <div className={styles.groupHeading}><StudioField label={`Group ${groupIndex + 1} name`}><input required value={group.name} maxLength={200} onChange={(event) => change((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, name: event.target.value } : item) }))} /></StudioField><StudioField label={`Selection for ${group.name || `group ${groupIndex + 1}`}`}><select value={group.presentation || ""} onChange={(event) => change((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, presentation: (event.target.value || undefined) as typeof item.presentation } : item) }))}><option value="">Use menu selection</option><option value="dropdown">Single choice</option><option value="checkboxes">Multiple choice</option><option value="quantities">Quantities</option></select></StudioField><StudioButton aria-label={`Move group ${group.name} up`} disabled={groupIndex === 0} onClick={() => moveGroup(group.id, -1)}>↑</StudioButton><StudioButton aria-label={`Move group ${group.name} down`} disabled={groupIndex === configuration.groups.length - 1} onClick={() => moveGroup(group.id, 1)}>↓</StudioButton><StudioButton variant="tertiary" aria-label={`Remove group ${group.name}`} onClick={() => change(current => removeProductMenuGroup(current, group.id))}>Remove</StudioButton></div>
              <DishList references={references} dishes={assigned.byRevision} dishName={dishName} move={(index, direction) => moveDish(group.id, index, direction)} remove={(id) => removeDish(group.id, id)} />
              <StudioButton variant="secondary" onClick={() => openDishPicker(group.id)}>Add to {group.name || "group"}</StudioButton>
            </section>;
          })}
        </div> : <DishList references={currentChoices.dishes} dishes={assigned.byRevision} dishName={dishName} move={(index, direction) => moveDish(undefined, index, direction)} remove={(id) => removeDish(undefined, id)} />}
        {assigned.error && <StudioButton onClick={assigned.retry}>Retry saved dish details</StudioButton>}
        <div className={styles.groupAdd}>
          {configuration.groups.length === 0 && <StudioField label="New dish group name"><input value={newGroupName} maxLength={200} onChange={(event) => setNewGroupName(event.target.value)} placeholder="For example, Starters" /></StudioField>}
          <StudioButton variant="tertiary" onClick={addGroup}>{configuration.groups.length ? "Add dish group" : "Group these dishes"}</StudioButton>
        </div>
      </StudioPanel>
      <p className={styles.draftNotice}>Changes are draft content only. Review, publication and customer activation remain governed separately.</p>
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
    </>} preview={<ProductMenuPreview itemId={draft.itemId} productName={productName} configuration={configuration} library={dishes} editorWeek={week} onEditWeek={setWeek} />} secondaryLabel="Customer preview" />
    <dialog className={styles.dishDialog} ref={dialog} aria-labelledby="dish-picker-heading">
      <div className={styles.dialogHeader}><div><h2 id="dish-picker-heading">{creatingDish ? "Create new dish" : "Add dishes"}</h2><p>{creatingDish ? "Create a reusable library draft. Safety approval is reviewed separately." : "Search and select one or more dishes for this menu."}</p></div><button type="button" aria-label="Close dish picker" onClick={() => dialog.current?.close()}>×</button></div>
      {creatingDish ? <form className={styles.newDishForm} onSubmit={(event) => void createDishFromPicker(event)}>
        <StudioField label="Dish name"><input required maxLength={200} value={newDish.name} onChange={(event) => setNewDish((current) => ({ ...current, name: event.target.value }))} /></StudioField>
        <StudioField label="Category"><select value={newDish.category} onChange={(event) => setNewDish((current) => ({ ...current, category: event.target.value as Dish["category"] }))}>{categories.map((category) => <option key={category} value={category}>{category.replaceAll("_", " ")}</option>)}</select></StudioField>
        <StudioField label="Temperature"><select value={newDish.temperature || ""} onChange={(event) => setNewDish((current) => ({ ...current, temperature: (event.target.value || null) as Dish["temperature"] }))}><option value="">Not set</option><option value="hot">Hot</option><option value="cold">Cold</option></select></StudioField>
        <StudioField label="Customer description"><textarea required maxLength={4000} value={newDish.customerDescription} onChange={(event) => setNewDish((current) => ({ ...current, customerDescription: event.target.value }))} /></StudioField>
        <StudioField label="Kitchen description"><textarea required maxLength={12000} value={newDish.kitchenDescription} onChange={(event) => setNewDish((current) => ({ ...current, kitchenDescription: event.target.value }))} /></StudioField>
        {creatingDishError && <p className={styles.error} role="alert">{creatingDishError}</p>}
        <div className={styles.dialogActions}><StudioButton type="button" onClick={() => { setCreatingDish(false); setCreatingDishError(""); }}>Back to dishes</StudioButton><StudioButton type="submit" variant="primary" busy={creatingDishBusy} disabled={!canManage || creatingDishBusy || !newDish.name.trim() || !newDish.customerDescription.trim() || !newDish.kitchenDescription.trim()}>{creatingDishBusy ? "Saving dish…" : "Save dish draft"}</StudioButton></div>
      </form> : <>
        <div className={styles.pickerTools}><StudioField label="Search dishes"><input type="search" value={dishQuery} onChange={(event) => setDishQuery(event.target.value)} placeholder="Search name or category" /></StudioField><StudioButton variant="secondary" disabled={!canManage} disabledReason="Your account has read-only access to dishes." onClick={() => { setCreatingDish(true); setCreatingDishError(""); }}>Create new dish</StudioButton></div>
        <div className={styles.categoryFilters} role="group" aria-label="Filter dishes by category"><StudioButton variant={dishCategory === "all" ? "primary" : "secondary"} aria-pressed={dishCategory === "all"} onClick={() => setDishCategory("all")}>All dishes</StudioButton>{categories.map((category) => <StudioButton key={category} variant={dishCategory === category ? "primary" : "secondary"} aria-pressed={dishCategory === category} onClick={() => setDishCategory(category)}>{category.replaceAll("_", " ")}</StudioButton>)}</div>
        <div className={styles.pickerList}>{visibleDishes.map((dish) => <label className={styles.pickerRow} key={dish.id}><input type="checkbox" checked={selectedDishIds.includes(dish.id)} onChange={(event) => setSelectedDishIds((ids) => event.target.checked ? [...ids, dish.id] : ids.filter((id) => id !== dish.id))} /><span><strong>{dish.name}</strong><small>{dish.category}{dish.customerDescription ? ` · ${dish.customerDescription}` : ""}</small></span></label>)}
          {dishError && <p role="alert">{dishError} <StudioButton onClick={onLoadDishes}>Try again</StudioButton></p>}
          {!visibleDishes.length && !dishError && <p className={styles.muted}>{loadingDishes ? "Loading dishes…" : "No dishes match this search and category."}</p>}
          {dishCursor && <StudioButton onClick={onLoadMoreDishes} disabled={loadingDishes}>{loadingDishes ? "Loading…" : "Load more dishes"}</StudioButton>}
        </div>
        <div className={styles.dialogActions}><span aria-live="polite">{selectedDishIds.length} {selectedDishIds.length === 1 ? "dish" : "dishes"} selected</span><StudioButton onClick={() => dialog.current?.close()}>Cancel</StudioButton><StudioButton variant="primary" disabled={!selectedDishIds.length} onClick={addSelectedDishes}>Add selected dishes</StudioButton></div>
      </>}
    </dialog>
    <div className={styles.stickyActions}>
      <StudioButton onClick={onBack}>Menu Builder</StudioButton>
      <StudioButton variant="primary" busy={saving} disabled={!dirty || !canManage} disabledReason={!canManage ? "This account cannot manage menu drafts." : !dirty ? "There are no unsaved changes." : undefined} onClick={() => void save()}>{saving ? "Saving…" : "Save draft"}</StudioButton>
    </div>
  </div>;
}

function archivedDishName(assigned: ReturnType<typeof useProductMenuDishes>, reference: ProductMenuDishReference) {
  const dish = assigned.byRevision.get(productMenuDishKey(reference));
  return dish ? dish.name || "Unnamed dish" : assigned.loading ? "Loading dish…" : "Dish revision unavailable";
}

function DishList({ references, dishes, dishName, move, remove }: { references: ProductMenuDishReference[]; dishes: Map<string, ProductMenuDish>; dishName: DishDisplay; move: (index: number, direction: -1 | 1) => void; remove: (dishId: string) => void }) {
  return <ol className={styles.dishList}>{references.map((reference, index) => {
    const dish = dishes.get(productMenuDishKey(reference));
    const name = dishName(reference);
    return <li key={reference.dishId}>
      <div><strong>{name}</strong>{dish && <small>{dish.category}</small>}</div>
      <div className={styles.dishActions}><button type="button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Move ${name} down`} disabled={index === references.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`Remove ${name}`} onClick={() => remove(reference.dishId)}>Remove</button></div>
    </li>;
  })}</ol>;
}

export default function ProductMenuBuilder({ actorName, canManage, canPublish, publicationPilot, onNavigate, embedded = false, requestedProductId, requestedDestination, onProductRequestHandled, onNavigationHandled, onDirtyStateChange, onActiveProductChange }: {
  actorName: string;
  canManage: boolean;
  canPublish: boolean;
  publicationPilot?: StudioPublicationPilot;
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
    setDirty(false); onDirtyStateChange?.(false); discardDialog.current?.close();
    const next = pendingExit; setPendingExit(null);
    if (!next) return;
    if (next.kind === "product") { void openProduct(next.itemId); return; }
    if (next.kind === "home") { setEditing(false); setDraft(null); setDraftError(""); window.history.replaceState(null, "", "/"); return; }
    onNavigate(next.destination);
  }

  async function saveConfiguration(configuration: ProductMenuConfiguration) {
    if (!draft) return;
    const result = await sendStudioProduct<{ item: ProductMenuDraft }>(reads.fetch, "product-menus", { action: "save", item: { ...draft, configuration } });
    setDraft(result.item);
    reads.rememberDraft(result.item, summarizeDraft(result.item, reads.summaries.snapshot().value?.find((item) => item.itemId === result.item.itemId)));
    setDirty(false); setNotice({ kind: "success", message: "Draft saved" });
    onDirtyStateChange?.(false);
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
    {editing && draft ? reviewing ? <ProductMenuReview key={draft.itemId} draft={draft} productName={productName} dishes={dishes} canPublish={canPublish && currentProduct} pilot={publicationPilot} onBack={() => setReviewing(false)} />
      : <ProductMenuEditor key={draft.itemId} draft={draft} productName={productName} dishes={dishes} dishCursor={dishCursor} loadingDishes={library.status === "loading"} dishError={library.error?.message} canManage={canManage && currentProduct}
        onLoadDishes={() => loadDishes()} onLoadMoreDishes={() => loadDishes(dishCursor || undefined)} onDishCreated={reads.rememberDish} onSave={saveConfiguration} onReview={() => setReviewing(true)} onDirtyChange={markDirty} onBack={requestHome} />
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
