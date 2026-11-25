"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProductMenuChoices, ProductMenuConfiguration, ProductMenuDraft, ProductMenuSummary } from "../../shared/hospitality-menu-studio-product-content";
import type { Dish } from "../lib/contract";
import { productMenuDishKey, type ProductMenuDish, type ProductMenuDishReference } from "../lib/product-menu-dishes";
import type { CataloguePayload, CatalogueRow } from "./catalogue-wire";
import { MenuBuilderHome, type ProductMenuSetup } from "./menu-builder-home";
import { menuChoiceReferences, removeProductMenuGroup } from "./product-menu-editor-model";
import { ProductMenuPreview } from "./product-menu-preview";
import { StudioButton, StudioEditorLayout, StudioField, StudioIcon, StudioPageHeader, StudioPanel, StudioSegmentedControl, StudioShell, StudioStatus, type StudioDestination } from "./studio-design-system";
import { request } from "./use-studio-draft";
import { useProductMenuDishes } from "./use-product-menu-dishes";
import styles from "./product-menu-builder.module.css";

type PendingExit = { kind: "product"; itemId: string } | { kind: "destination"; destination: StudioDestination } | { kind: "home" };
type Notice = { kind: "neutral" | "info" | "success" | "warning" | "danger"; message: string };

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || body.message || "This information is unavailable. Try again.");
  return body as T;
}

async function sendJson<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/studio/product-menus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The menu draft could not be saved.");
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

function summarizeDraft(draft: ProductMenuDraft): ProductMenuSummary {
  const { configuration } = draft;
  return configuration.schedule.kind === "fixed"
    ? { itemId: draft.itemId, version: draft.version, updatedAt: draft.updatedAt, kind: "fixed", dishCount: configuration.schedule.choices.dishes.length + configuration.schedule.choices.groups.reduce((count, group) => count + group.dishes.length, 0) }
    : { itemId: draft.itemId, version: draft.version, updatedAt: draft.updatedAt, kind: "rotation", cycleWeeks: configuration.schedule.weeks.length };
}

type DishDisplay = (reference: ProductMenuDishReference) => string;

function ProductMenuReview({ draft, productName, dishes, onBack }: { draft: ProductMenuDraft; productName: string; dishes: Dish[]; onBack: () => void }) {
  const lookup = new Map(dishes.map((dish) => [dish.id, dish]));
  const slots = draft.configuration.schedule.kind === "fixed" ? [draft.configuration.schedule.choices] : draft.configuration.schedule.weeks;
  const allReferences = slots.flatMap(menuChoiceReferences);
  const assigned = useProductMenuDishes(allReferences, dishes);
  const dishName = (reference: ProductMenuDishReference) => archivedDishName(assigned, reference);
  const emptySlots = slots.filter((slot) => !menuChoiceReferences(slot).length).length;
  const missingReferences = new Set(allReferences.map(productMenuDishKey).filter(key => !assigned.byRevision.has(key)));
  const changedReferences = allReferences.filter((reference) => {
    const current = lookup.get(reference.dishId);
    return current && current.version > reference.revision;
  });
  const safetyReason = "Product drafts do not yet have a connected CPU safety review and Hub publication/activation contract.";
  return <div className={styles.reviewPage}>
    <StudioPageHeader breadcrumbs={[{ label: "Menu Builder" }, { label: productName }, { label: "Review & publish" }]} title="Review & publish" description={`${productName} · ${draft.configuration.schedule.kind === "fixed" ? "Fixed menu" : `${draft.configuration.schedule.weeks.length}-week rotation`}`} actions={<StudioButton onClick={onBack}>Back to editor</StudioButton>} />
    <div className={styles.reviewGrid}>
      <StudioPanel title="Menu summary" description={`Draft version ${draft.version} · ${draft.configuration.presentation === "dropdown" ? "Single choice" : draft.configuration.presentation === "checkboxes" ? "Multiple choice" : "Quantities"}`}>
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
      <StudioPanel title="Readiness" description="Only verified checks can approve a menu for customers.">
        <ul className={styles.readiness}>
          <li><StudioStatus tone={emptySlots ? "warning" : "neutral"}>{emptySlots ? "Action needed" : "Not verified"}</StudioStatus><span>{emptySlots ? `${emptySlots} menu ${emptySlots === 1 ? "slot is" : "slots are"} empty.` : "Menu configuration checks are not available for this draft."}</span></li>
          <li><StudioStatus tone={assigned.loading ? "neutral" : missingReferences.size ? "danger" : "success"}>{assigned.loading ? "Checking" : missingReferences.size ? "Dish unavailable" : "Loaded"}</StudioStatus><span>{assigned.loading ? "Loading assigned dish revisions." : missingReferences.size ? `${missingReferences.size} assigned dish revisions could not be loaded.` : "Assigned dish revisions are available."}</span></li>
          {changedReferences.length > 0 && <li><StudioStatus tone="warning">Re-review needed</StudioStatus><span>{changedReferences.length} dishes have changed since this draft selected their saved revisions.</span></li>}
          <li><StudioStatus tone="warning">Unavailable</StudioStatus><span>{safetyReason}</span></li>
          <li><StudioStatus tone="warning">Not checked</StudioStatus><span>Site/date availability and booking impact are not verified for product drafts.</span></li>
        </ul>
        {assigned.error && <StudioButton onClick={assigned.retry}>Retry saved dish details</StudioButton>}
        <StudioButton variant="primary" disabled disabledReason={`${safetyReason} The current verified menu remains in effect.`}>Publish menu</StudioButton>
        <p className={styles.reviewBoundary}>Reviewing this draft does not publish it or change customer availability. Existing bookings keep their current records.</p>
      </StudioPanel>
    </div>
  </div>;
}

function ProductMenuEditor({ draft, productName, dishes, dishCursor, loadingDishes, canManage, onLoadMoreDishes, onSave, onReview, onDirtyChange, onBack }: {
  draft: ProductMenuDraft;
  productName: string;
  dishes: Dish[];
  dishCursor: string | null;
  loadingDishes: boolean;
  canManage: boolean;
  onLoadMoreDishes: () => void;
  onSave: (configuration: ProductMenuConfiguration) => Promise<void>;
  onReview: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
}) {
  const [configuration, setConfiguration] = useState(draft.configuration);
  const [week, setWeek] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dishQuery, setDishQuery] = useState("");
  const [selectedDishIds, setSelectedDishIds] = useState<string[]>([]);
  const [targetGroupId, setTargetGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const currentChoices = choicesAt(configuration, week);
  const references = useMemo(() => menuChoiceReferences(currentChoices), [currentChoices]);
  const allAssigned = useMemo(() => new Set(references.map(dish => dish.dishId)), [references]);
  const assigned = useProductMenuDishes(references, dishes);
  const dishName = (reference: ProductMenuDishReference) => archivedDishName(assigned, reference);
  const visibleDishes = useMemo(() => {
    const query = dishQuery.trim().toLocaleLowerCase("en-GB");
    return dishes.filter((dish) => !allAssigned.has(dish.id) && (!query || `${dish.name} ${dish.category} ${dish.customerDescription}`.toLocaleLowerCase("en-GB").includes(query)));
  }, [allAssigned, dishes, dishQuery]);
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
    setTargetGroupId(groupId || configuration.groups[0]?.id || "");
    setSelectedDishIds([]);
    setDishQuery("");
    dialog.current?.showModal();
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
    <StudioPageHeader breadcrumbs={[{ label: "Menu Builder" }, { label: productName }]} title={productName} description={heading} context={<StudioStatus tone="info">Draft · version {draft.version}</StudioStatus>} actions={<StudioButton variant="primary" disabled={!canManage || dirty} disabledReason={!canManage ? "This account cannot review menu drafts." : dirty ? "Save the draft before reviewing it." : undefined} onClick={onReview}>Review &amp; publish</StudioButton>} />
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
              <div className={styles.groupHeading}><StudioField label={`Group ${groupIndex + 1} name`}><input required value={group.name} maxLength={200} onChange={(event) => change((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, name: event.target.value } : item) }))} /></StudioField><StudioField label={`Selection for ${group.name || `group ${groupIndex + 1}`}`}><select value={group.presentation || ""} onChange={(event) => change((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, presentation: (event.target.value || undefined) as typeof item.presentation } : item) }))}><option value="">Use menu selection</option><option value="dropdown">Single choice</option><option value="checkboxes">Multiple choice</option><option value="quantities">Quantities</option></select></StudioField><StudioButton variant="tertiary" aria-label={`Remove group ${group.name}`} onClick={() => change(current => removeProductMenuGroup(current, group.id))}>Remove</StudioButton></div>
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
      <div className={styles.dialogHeader}><div><h2 id="dish-picker-heading">Add dishes</h2><p>Selected dishes will use their current saved revisions.</p></div><button type="button" aria-label="Close dish picker" onClick={() => dialog.current?.close()}>×</button></div>
      <StudioField label="Search dishes"><input type="search" value={dishQuery} onChange={(event) => setDishQuery(event.target.value)} placeholder="Search name or category" /></StudioField>
      <div className={styles.pickerList}>{visibleDishes.map((dish) => <label className={styles.pickerRow} key={dish.id}><input type="checkbox" checked={selectedDishIds.includes(dish.id)} onChange={(event) => setSelectedDishIds((ids) => event.target.checked ? [...ids, dish.id] : ids.filter((id) => id !== dish.id))} /><span><strong>{dish.name}</strong><small>{dish.category}{dish.customerDescription ? ` · ${dish.customerDescription}` : ""}</small></span></label>)}
        {!visibleDishes.length && <p className={styles.muted}>{loadingDishes ? "Loading dishes…" : "No dishes match. Add a dish from the Dish Library and return here."}</p>}
        {dishCursor && <StudioButton onClick={onLoadMoreDishes} disabled={loadingDishes}>{loadingDishes ? "Loading…" : "Load more dishes"}</StudioButton>}
      </div>
      <div className={styles.dialogActions}><StudioButton onClick={() => dialog.current?.close()}>Cancel</StudioButton><StudioButton variant="primary" disabled={!selectedDishIds.length} onClick={addSelectedDishes}>Add selected dishes</StudioButton></div>
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

export default function ProductMenuBuilder({ actorName, canManage, onNavigate, embedded = false, requestedProductId, requestedDestination, onProductRequestHandled, onNavigationHandled, onDirtyStateChange, onProductsLoaded, onActiveProductChange }: {
  actorName: string;
  canManage: boolean;
  onNavigate: (destination: StudioDestination) => void;
  embedded?: boolean;
  requestedProductId?: string | null;
  requestedDestination?: StudioDestination | null;
  onProductRequestHandled?: () => void;
  onNavigationHandled?: () => void;
  onDirtyStateChange?: (dirty: boolean) => void;
  onProductsLoaded?: (products: CatalogueRow[], summaries: ProductMenuSummary[]) => void;
  onActiveProductChange?: (itemId: string | null) => void;
}) {
  const [products, setProducts] = useState<CatalogueRow[]>([]);
  const [summaries, setSummaries] = useState<ProductMenuSummary[]>([]);
  const [draft, setDraft] = useState<ProductMenuDraft | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [dishCursor, setDishCursor] = useState<string | null>(null);
  const [loadingDishes, setLoadingDishes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const [notice, setNotice] = useState<Notice>({ kind: "info", message: "Menu Builder" });
  const discardDialog = useRef<HTMLDialogElement>(null);
  const productName = useMemo(() => products.find((item) => item.itemId === draft?.itemId)?.name || "Hospitality menu", [draft?.itemId, products]);
  const productLinks = useMemo(() => summaries.flatMap((summary) => {
    const product = products.find((item) => item.itemId === summary.itemId);
    return product ? [{ id: summary.itemId, name: product.name, status: "Draft", summary: summary.kind === "fixed" ? `Fixed · ${summary.dishCount ?? 0} dishes` : `${summary.cycleWeeks}-week rotation` }] : [];
  }), [products, summaries]);

  const loadIndex = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const catalogue = await readJson<CataloguePayload>("/api/catalogue");
      const items: ProductMenuSummary[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const queryString: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const listPage: { items: ProductMenuSummary[]; nextCursor: string | null } = await readJson<{ items: ProductMenuSummary[]; nextCursor: string | null }>(`/api/studio/product-menus${queryString}`);
        items.push(...listPage.items);
        cursor = listPage.nextCursor;
        if (!cursor) break;
        if (page === 19) throw new Error("Too many configured menus to verify in one session. Narrow the catalogue and try again.");
      }
      setProducts(catalogue.rows.filter((item) => item.status === "active"));
      setSummaries(items);
    } catch (failure) { setError((failure as Error).message || "Menu Builder could not load."); }
    finally { setLoading(false); }
  }, []);

  const loadDishes = useCallback(async (cursor?: string) => {
    setLoadingDishes(true);
    try {
      const query = cursor ? `?list=dishes&cursor=${encodeURIComponent(cursor)}` : "?list=dishes";
      const result = await request(undefined, query);
      setDishes((previous) => cursor ? [...previous, ...result.items] : result.items);
      setDishCursor(result.nextCursor || null);
    } catch (failure) { setDraftError((failure as Error).message || "The Dish Library is unavailable."); }
    finally { setLoadingDishes(false); }
  }, []);

  useEffect(() => { void loadIndex(); }, [loadIndex]);
  useEffect(() => { onProductsLoaded?.(products, summaries); }, [onProductsLoaded, products, summaries]);
  useEffect(() => {
    onActiveProductChange?.(editing ? draft?.itemId || null : null);
    return () => onActiveProductChange?.(null);
  }, [draft?.itemId, editing, onActiveProductChange]);
  useEffect(() => { if (draft) void loadDishes(); }, [draft?.itemId, loadDishes]);
  useEffect(() => { if (!requestedProductId) return; if (requestedProductId !== draft?.itemId) requestProduct(requestedProductId); onProductRequestHandled?.(); }, [requestedProductId, draft?.itemId]);
  useEffect(() => { if (!requestedDestination) return; navigate(requestedDestination); onNavigationHandled?.(); }, [requestedDestination]);
  useEffect(() => {
    const itemId = new URLSearchParams(window.location.search).get("product");
    if (!itemId || !summaries.some((item) => item.itemId === itemId) || draft) return;
    void openProduct(itemId);
  }, [draft, summaries]);

  async function openProduct(itemId: string) {
    setDraftError("");
    setBusy(true);
    try {
      const result = await readJson<{ item: ProductMenuDraft | null }>(`/api/studio/product-menus?itemId=${encodeURIComponent(itemId)}`);
      if (!result.item) throw new Error("This menu draft is no longer available. Refresh the product list.");
      setDraft(result.item); setEditing(true); setReviewing(false); setDirty(false); onDirtyStateChange?.(false); setNotice({ kind: "info", message: "Draft loaded" });
      window.history.replaceState(null, "", `/?product=${encodeURIComponent(itemId)}`);
    } catch (failure) { setDraftError((failure as Error).message || "The menu draft could not be opened."); }
    finally { setBusy(false); }
  }

  async function createProduct(itemId: string, setup: ProductMenuSetup) {
    const result = await sendJson<{ item: ProductMenuDraft }>({ action: "create", itemId, setup });
    setDraft(result.item); setEditing(true); setReviewing(false); setDirty(false); onDirtyStateChange?.(false); setDraftError("");
    setSummaries((previous) => [summarizeDraft(result.item), ...previous.filter((item) => item.itemId !== itemId)]);
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
    const result = await sendJson<{ item: ProductMenuDraft }>({ action: "save", item: { ...draft, configuration } });
    setDraft(result.item); setSummaries((previous) => [summarizeDraft(result.item), ...previous.filter((item) => item.itemId !== result.item.itemId)]);
    setDirty(false); setNotice({ kind: "success", message: "Draft saved" });
    onDirtyStateChange?.(false);
  }

  const markDirty = useCallback((value: boolean) => {
    setDirty(value);
    onDirtyStateChange?.(value);
  }, [onDirtyStateChange]);

  const headerActions: ReactNode = draft && editing ? <StudioButton variant="primary" disabled disabledReason="Publishing and activation are not available for product drafts yet. Saving a draft does not change customer availability.">Review &amp; publish</StudioButton> : undefined;
  const content = <>
    {loading && <p role="status">Loading Hospitality products and menu drafts…</p>}
    {error && <div className={styles.errorBox} role="alert"><p>{error}</p><StudioButton onClick={() => void loadIndex()}>Try again</StudioButton></div>}
    {!loading && !error && (editing && draft ? reviewing ? <ProductMenuReview draft={draft} productName={productName} dishes={dishes} onBack={() => setReviewing(false)} /> : <ProductMenuEditor draft={draft} productName={productName} dishes={dishes} dishCursor={dishCursor} loadingDishes={loadingDishes} canManage={canManage} onLoadMoreDishes={() => void loadDishes(dishCursor || undefined)} onSave={saveConfiguration} onReview={() => setReviewing(true)} onDirtyChange={markDirty} onBack={requestHome} /> : <MenuBuilderHome products={products} summaries={summaries} canManage={canManage} onOpen={(itemId) => { void openProduct(itemId); }} onCreate={createProduct} />)}
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
