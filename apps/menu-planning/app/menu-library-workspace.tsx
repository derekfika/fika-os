"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { copyMenuStructure, type MenuStructureSnapshot, type MenuStructureTemplate } from "@/lib/menu-structure-library";
import { MENU_LIBRARY_CATEGORIES, standardMainLunchStructure, type MenuLibraryCategory, type SavedDailyMenu, type SavedDailyMenuContent, type SavedMenuDish } from "@/lib/menu-library";
import type { MenuServiceType } from "@/lib/rolling-menu-types";
import { emptyPickerFilters, type PickerFilters } from "@/lib/dish-picker-filters";
import type { Dish } from "./planner-data";
import { useMenuAccess } from "./menu-access";
import PlannerModal from "./planner-modal";
import CanonicalDishPicker from "./canonical-dish-picker";
import DishEditorModal from "./dish-editor-modal";
import { invalidateCatalogueCache } from "@/lib/menu-catalogue-cache";
import { invalidateDishTagRegistry } from "@/lib/dish-tag-client";
import type { EditorDishRef } from "@/lib/dish-editor";
import { standardMainLunchStructure as mainLunchStructure } from "@/lib/menu-library";
import "./menu-library.css";

type EditorDraft = SavedDailyMenuContent & { id?: string; version?: number };
type ApiMenuResponse = { menus?: SavedDailyMenu[]; error?: { message?: string } };
type StructureResponse = { templates?: MenuStructureTemplate[]; error?: { message?: string } };
type DishEditorState = { name: string };

const SERVICE_TYPES: MenuServiceType[] = ["Breakfast", "Lunch", "Dinner", "Other"];
const categoryLabel: Record<MenuLibraryCategory, string> = { regular: "Regular service", seasonal: "Seasonal", themed: "Themed", other: "Other" };
const EMPTY_DRAFT = (): EditorDraft => ({ name: "", serviceType: "Breakfast", category: "regular", tags: [], structure: mainLunchStructure(), dishes: [] });

async function readJson<T extends { error?: { message?: string } }>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(body.error?.message || `${fallback} (HTTP ${response.status}).`);
  return body;
}

function mapCatalogueDish(entry: Record<string, unknown>): Dish {
  const item = entry.item && typeof entry.item === "object" ? entry.item as Record<string, unknown> : {};
  return {
    id: String(entry.id || ""),
    name: String(entry.displayName ?? entry.name ?? ""),
    category: typeof entry.category === "string" ? entry.category : undefined,
    subcategory: typeof entry.subcategory === "string" ? entry.subcategory : undefined,
    description: typeof item.description === "string" ? item.description : undefined,
    aliases: Array.isArray(item.sourceAliases) ? item.sourceAliases.filter((value): value is string => typeof value === "string") : undefined,
    tagIds: Array.isArray(item.tagIds) ? item.tagIds.filter((value): value is string => typeof value === "string") : undefined,
  };
}

function copyMenuForEdit(menu: SavedDailyMenu): EditorDraft {
  return {
    id: menu.id, version: menu.version, name: menu.name, serviceType: menu.serviceType, category: menu.category,
    tags: [...menu.tags], structure: copyMenuStructure(menu.structure), dishes: menu.dishes.map(dish => ({ ...dish })),
  };
}

export default function MenuLibraryWorkspace() {
  const access = useMenuAccess();
  const [menus, setMenus] = useState<SavedDailyMenu[]>([]);
  const [structures, setStructures] = useState<MenuStructureTemplate[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<EditorDraft>();
  const [preview, setPreview] = useState<SavedDailyMenu>();
  const [duplicateTarget, setDuplicateTarget] = useState<SavedDailyMenu>();
  const [duplicateName, setDuplicateName] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<SavedDailyMenu>();
  const [pickerSlot, setPickerSlot] = useState<string>();
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerFilters, setPickerFilters] = useState<PickerFilters>(emptyPickerFilters);
  const [pickerMode, setPickerMode] = useState<"recommended" | "all">("all");
  const [dishEditor, setDishEditor] = useState<DishEditorState>();
  const [dishCreationSlot, setDishCreationSlot] = useState<string>();
  const [pendingStructure, setPendingStructure] = useState<MenuStructureSnapshot>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [menuResponse, structureResponse, catalogueResponse] = await Promise.all([
        fetch(`/api/menu-library${showArchived ? "?includeArchived=1" : ""}`, { cache: "no-store" }),
        fetch(`/api/menu-structure-library${showArchived ? "?includeArchived=1" : ""}`, { cache: "no-store" }),
        fetch("/api/catalogue", { cache: "no-store" }),
      ]);
      const [menuBody, structureBody, catalogueBody] = await Promise.all([
        readJson<ApiMenuResponse>(menuResponse, "Saved menus could not be loaded"),
        readJson<StructureResponse>(structureResponse, "Saved layouts could not be loaded"),
        readJson<{ entries?: Array<Record<string, unknown>>; error?: { message?: string } }>(catalogueResponse, "The Dish Library could not be loaded"),
      ]);
      setMenus(menuBody.menus || []);
      setStructures((structureBody.templates || []).filter(template => !template.archivedAt));
      setDishes((catalogueBody.entries || []).map(mapCatalogueDish).filter(dish => dish.id && dish.name));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Menu Library data could not be loaded."); }
    finally { setLoading(false); }
  }, [showArchived]);

  useEffect(() => { void reload(); }, [reload]);

  const visibleMenus = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return menus.filter(menu => (showArchived || !menu.archivedAt)
      && (serviceFilter === "all" || menu.serviceType === serviceFilter)
      && (categoryFilter === "all" || menu.category === categoryFilter)
      && (!query || [menu.name, menu.serviceType, categoryLabel[menu.category], ...menu.tags, ...menu.dishes.map(dish => dish.dishName)].some(value => value.toLocaleLowerCase().includes(query))))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [menus, search, serviceFilter, categoryFilter, showArchived]);

  const structureChoices = useMemo(() => [
    { id: "__main-lunch-standard__", name: "Main Lunch · Standard", version: 1, structure: standardMainLunchStructure() },
    ...structures.map(template => ({ id: template.id, name: template.name, version: template.version, structure: copyMenuStructure(template, template) })),
  ], [structures]);

  const startCreate = () => {
    const breakfastTemplate = structures.find(template => /breakfast/i.test(template.name));
    setDraft({ ...EMPTY_DRAFT(), ...(breakfastTemplate ? { structure: copyMenuStructure(breakfastTemplate, breakfastTemplate) } : {}) });
    setMessage(""); setError("");
  };

  const saveDraft = async () => {
    if (!draft || saving) return;
    setSaving(true); setError(""); setMessage("");
    const content = { name: draft.name, serviceType: draft.serviceType, category: draft.category, tags: draft.tags, structure: draft.structure, dishes: draft.dishes };
    try {
      const response = await fetch("/api/menu-library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: draft.id ? "edit" : "create", ...(draft.id ? { menuId: draft.id, expectedVersion: draft.version } : {}), menu: content }) });
      const body = await readJson<ApiMenuResponse>(response, "The saved menu could not be saved");
      setMenus(body.menus || []); setDraft(undefined); setMessage(draft.id ? "Menu changes saved. Existing weekly menus remain unchanged." : "Daily menu saved to the library.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The saved menu could not be saved."); }
    finally { setSaving(false); }
  };

  const updateDraft = (patch: Partial<EditorDraft>) => setDraft(current => current ? { ...current, ...patch } : current);
  const requestStructureChange = (choiceId: string) => {
    const choice = structureChoices.find(item => item.id === choiceId);
    if (!choice || !draft) return;
    const retainedSlots = new Set(choice.structure.categories.flatMap(category => category.rows.map(row => row.slot)));
    const removedDishes = draft.dishes.filter(dish => !retainedSlots.has(dish.slot));
    if (removedDishes.length) { setPendingStructure(choice.structure); return; }
    updateDraft({ structure: copyMenuStructure(choice.structure, choice.id === "__main-lunch-standard__" ? undefined : { id: choice.id, version: choice.version }) });
  };

  const assignDish = (dish: Dish) => {
    if (!pickerSlot || !draft) return;
    const slot = pickerSlot;
    const savedDish: SavedMenuDish = { slot, dishId: dish.id, dishName: dish.name };
    updateDraft({ dishes: [...draft.dishes.filter(item => item.slot !== slot), savedDish] });
    setPickerSlot(undefined);
  };

  const chooseDish = (slot: string) => { setPickerSlot(slot); setPickerQuery(""); setPickerFilters(emptyPickerFilters); setPickerMode("all"); };

  const addDishFromLibrary = async (name: string) => {
    setDishCreationSlot(pickerSlot); setPickerSlot(undefined); setDishEditor({ name });
  };

  const onDishCreated = async (saved: { id: string; name: string }) => {
    setDishEditor(undefined);
    await invalidateCatalogueCache(); invalidateDishTagRegistry();
    const response = await fetch("/api/catalogue", { cache: "no-store" });
    const body = await readJson<{ entries?: Array<Record<string, unknown>>; error?: { message?: string } }>(response, "The Dish Library could not be refreshed");
    const refreshed = (body.entries || []).map(mapCatalogueDish).filter(dish => dish.id && dish.name);
    setDishes(refreshed);
    const selected = refreshed.find(dish => dish.id === saved.id) || { id: saved.id, name: saved.name };
    if (dishCreationSlot && selected.id && draft) {
      const slot = dishCreationSlot;
      const savedDish = { slot, dishId: selected.id, dishName: selected.name };
      updateDraft({ dishes: [...draft.dishes.filter(item => item.slot !== slot), savedDish] });
    }
    setDishCreationSlot(undefined);
  };

  const duplicateMenu = async () => {
    if (!duplicateTarget) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/menu-library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "duplicate", menuId: duplicateTarget.id, expectedVersion: duplicateTarget.version, name: duplicateName }) });
      const body = await readJson<ApiMenuResponse>(response, "The menu could not be duplicated");
      setMenus(body.menus || []); setDuplicateTarget(undefined); setDuplicateName(""); setMessage("An independent menu copy was created.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The menu could not be duplicated."); }
    finally { setSaving(false); }
  };

  const archiveMenu = async () => {
    if (!archiveTarget) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/menu-library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive", menuId: archiveTarget.id, expectedVersion: archiveTarget.version }) });
      const body = await readJson<ApiMenuResponse>(response, "The menu could not be archived");
      setMenus(body.menus || []); setArchiveTarget(undefined); setMessage("Menu archived. Existing planner menus and publications are unchanged.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The menu could not be archived."); }
    finally { setSaving(false); }
  };

  const tagText = draft?.tags.join(", ") || "";
  const editorDishes = dishes.map(dish => ({ id: dish.id, name: dish.name, category: dish.category || "Uncategorised", tagIds: dish.tagIds || [] })) as EditorDishRef[];
  return <section className="fika-ui menu-library-ui">
    <header className="menu-library-heading">
      <div><small>MENU PLANNING · REUSABLE DAILY MENUS</small><h2>Menu Library</h2><p>Save a full day of canonical dishes and its layout. Dates, sites, portions, PAX and publication state stay in each planner service.</p></div>
      {access.canManageOrganisation && !draft && <button type="button" className="button button-purple" onClick={startCreate}>Create daily menu</button>}
    </header>

    {error && <p className="fika-notice fika-notice--danger" role="alert">{error}</p>}
    {message && <p className="fika-notice menu-library-success" role="status">{message}</p>}

    {draft ? <section className="menu-library-editor" aria-labelledby="menu-library-editor-heading">
      <div className="menu-library-editor__heading"><div><small>{draft.id ? `SAVED MENU · VERSION ${draft.version}` : "NEW DAILY MENU"}</small><h3 id="menu-library-editor-heading">{draft.id ? "Edit saved menu" : "Create daily menu"}</h3><p>Dish identity and row layout are saved. Operational quantities and allergen reviews are never copied into the library.</p></div><span className="menu-library-badge">Independent menu content</span></div>
      <div className="menu-library-form-grid">
        <label className="fika-field"><span>Menu name</span><input className="fika-input" maxLength={100} value={draft.name} onChange={event => updateDraft({ name: event.target.value })} placeholder="e.g. Breakfast at Munich RE" /></label>
        <label className="fika-field"><span>Service</span><select className="fika-select" value={draft.serviceType} onChange={event => updateDraft({ serviceType: event.target.value as MenuServiceType })}>{SERVICE_TYPES.map(service => <option key={service}>{service}</option>)}</select></label>
        <label className="fika-field"><span>Category</span><select className="fika-select" value={draft.category} onChange={event => updateDraft({ category: event.target.value as MenuLibraryCategory })}>{MENU_LIBRARY_CATEGORIES.map(category => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select></label>
        <label className="fika-field"><span>Tags <small>(comma separated)</small></span><input className="fika-input" value={tagText} onChange={event => updateDraft({ tags: event.target.value.split(",").map(value => value.trim()).filter(Boolean).slice(0, 12) })} placeholder="e.g. seasonal, Christmas" /></label>
      </div>
      <label className="fika-field menu-library-layout"><span>Menu structure</span><select className="fika-select" value={draft.structure.templateId || "__main-lunch-standard__"} onChange={event => requestStructureChange(event.target.value)}>
        <option value="__main-lunch-standard__">Main Lunch · Standard</option>
        {structures.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}
        {draft.structure.templateId && !structures.some(template => template.id === draft.structure.templateId) && <option value={draft.structure.templateId}>Saved layout snapshot · v{draft.structure.templateVersion || 1}</option>}
      </select><small>Layouts are copied into this menu and stay unchanged if a saved layout is later edited or archived.</small></label>

      {pendingStructure && <div className="fika-notice fika-notice--warning" role="alert"><p>Changing this layout removes dishes from rows it does not contain. Choose whether to apply the new layout and remove those dish rows.</p><div><button type="button" className="button button-soft" onClick={() => setPendingStructure(undefined)}>Keep current layout</button><button type="button" className="button button-danger" onClick={() => { const slots = new Set(pendingStructure.categories.flatMap(category => category.rows.map(row => row.slot))); updateDraft({ structure: copyMenuStructure(pendingStructure), dishes: draft.dishes.filter(dish => slots.has(dish.slot)) }); setPendingStructure(undefined); }}>Change layout and remove unmatched dishes</button></div></div>}

      <div className="menu-library-structure">
        <div className="menu-library-structure__heading"><div><h4>Daily menu</h4><p>Choose dishes from the canonical Dish Library. Preview and reorder rows in Menu Designer.</p></div><span>{draft.dishes.length} dish{draft.dishes.length === 1 ? "" : "es"}</span></div>
        {draft.structure.categories.map(category => <section className="menu-library-category" key={category.id}>
          <h5>{category.name}</h5>
          {category.rows.map(row => {
            const savedDish = draft.dishes.find(item => item.slot === row.slot);
            const activeDish = savedDish && dishes.find(dish => dish.id === savedDish.dishId);
            return <div className="menu-library-dish-row" key={row.id}><div className="menu-library-dish-row__slot"><strong>{row.name}</strong><small>{row.slot}</small></div><div className="menu-library-dish-row__dish">{savedDish ? <><strong>{activeDish?.name || savedDish.dishName}</strong><small>{activeDish ? "Canonical Dish Library dish" : "Canonical reference unavailable · refresh before saving"}</small></> : <span>No dish selected</span>}</div><button type="button" className="button button-soft" disabled={!access.canManageOrganisation} onClick={() => chooseDish(row.slot)}>{savedDish ? "Change dish" : "Add dish"}</button>{savedDish && <button type="button" className="button button-soft" onClick={() => updateDraft({ dishes: draft.dishes.filter(item => item.slot !== row.slot) })}>Remove</button>}</div>;
          })}
        </section>)}
      </div>
      <footer className="menu-library-editor__actions"><button type="button" className="button button-soft" disabled={saving} onClick={() => { setDraft(undefined); setPendingStructure(undefined); }}>Cancel</button><button type="button" className="button button-purple" disabled={saving || !access.canManageOrganisation || !draft.name.trim()} onClick={() => void saveDraft()}>{saving ? "Saving menu…" : "Save menu"}</button></footer>
    </section> : <>
      <section className="menu-library-filters" aria-label="Search and filter the Menu Library">
        <label className="fika-field menu-library-search"><span>Search menus, tags and dishes</span><input className="fika-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search saved menus" /></label>
        <label className="fika-field"><span>Service</span><select className="fika-select" value={serviceFilter} onChange={event => setServiceFilter(event.target.value)}><option value="all">All services</option>{SERVICE_TYPES.map(service => <option key={service}>{service}</option>)}</select></label>
        <label className="fika-field"><span>Category</span><select className="fika-select" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{MENU_LIBRARY_CATEGORIES.map(category => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select></label>
        <label className="menu-library-archived"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Show archived menus</label>
      </section>
      {loading ? <p className="menu-library-empty" role="status">Loading saved menus…</p> : visibleMenus.length ? <div className="menu-library-grid">
        {visibleMenus.map(menu => <article className={`menu-library-card${menu.archivedAt ? " menu-library-card--archived" : ""}`} key={menu.id}>
          <div className="menu-library-card__heading"><div><span className="menu-library-category-label">{categoryLabel[menu.category]} · {menu.serviceType}</span><h3>{menu.name}</h3></div><span className="menu-library-version">v{menu.version}</span></div>
          <p className="menu-library-card__meta">{menu.dishes.length} dish{menu.dishes.length === 1 ? "" : "es"} · {menu.structure.categories.length} categories · {menu.revisions.length} prior revision{menu.revisions.length === 1 ? "" : "s"}{menu.archivedAt ? " · Archived" : ""}</p>
          <div className="menu-library-tags">{menu.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          <div className="menu-library-card__actions"><button type="button" className="button button-soft" onClick={() => setPreview(menu)}>Preview</button>{access.canManageOrganisation && !menu.archivedAt && <><button type="button" className="button button-soft" onClick={() => setDraft(copyMenuForEdit(menu))}>Edit</button><button type="button" className="button button-soft" onClick={() => { setDuplicateTarget(menu); setDuplicateName(`${menu.name} copy`); }}>Duplicate</button><button type="button" className="button button-danger" onClick={() => setArchiveTarget(menu)}>Archive</button></>}</div>
        </article>)}
      </div> : <div className="menu-library-empty"><h3>{search || serviceFilter !== "all" || categoryFilter !== "all" ? "No menus match these filters." : "Your Menu Library is empty."}</h3><p>Save complete daily menus here to reuse their canonical dishes and layout in the Week Planner.</p>{access.canManageOrganisation && <button type="button" className="button button-purple" onClick={startCreate}>Create daily menu</button>}</div>}
    </>}

    {pickerSlot && <CanonicalDishPicker dishes={dishes} initialQuery={pickerQuery} onQueryChange={setPickerQuery} filters={pickerFilters} setFilters={setPickerFilters} mode={pickerMode} setMode={setPickerMode} slot={pickerSlot} displaySlotLabel={draft?.structure.categories.flatMap(category => category.rows).find(row => row.slot === pickerSlot)?.name || pickerSlot} onChoose={assignDish} canCreate={access.canManageOrganisation} onCreate={name => void addDishFromLibrary(name)} onClose={() => setPickerSlot(undefined)} />}
    {dishEditor && access.canManageOrganisation && <DishEditorModal mode="create" initialName={dishEditor.name} initialCategory="Uncategorised" dishes={editorDishes} onCancel={() => setDishEditor(undefined)} onSaved={saved => void onDishCreated(saved)} />}

    {preview && <PlannerModal title="Menu preview" onClose={() => setPreview(undefined)} className="item-detail menu-library-dialog"><header><div><small>{categoryLabel[preview.category]} · {preview.serviceType} · v{preview.version}</small><h3>{preview.name}</h3></div><button type="button" className="modal-close" onClick={() => setPreview(undefined)} aria-label="Close preview">Close</button></header><div className="menu-library-tags">{preview.tags.map(tag => <span key={tag}>{tag}</span>)}</div>{preview.structure.categories.map(category => <section className="menu-library-preview-category" key={category.id}><h4>{category.name}</h4><ul>{category.rows.map(row => { const dish = preview.dishes.find(item => item.slot === row.slot); return <li key={row.id}><span>{row.name}</span><strong>{dish?.dishName || "No dish saved"}</strong></li>; })}</ul></section>)}<p>Preview contains culinary content only. It does not include service dates, site allocations, portions, PAX, publication state or allergen approvals.</p></PlannerModal>}

    {duplicateTarget && <PlannerModal title="Duplicate saved menu" onClose={() => setDuplicateTarget(undefined)} className="item-detail menu-library-dialog"><header><div><small>Independent copy</small><h3>Duplicate {duplicateTarget.name}</h3></div><button type="button" className="modal-close" onClick={() => setDuplicateTarget(undefined)} aria-label="Close duplicate menu">Close</button></header><label className="fika-field"><span>Name for the copy</span><input className="fika-input" autoFocus maxLength={100} value={duplicateName} onChange={event => setDuplicateName(event.target.value)} /></label><p>The copy gets its own saved-menu identity and can be edited independently.</p><footer><button type="button" className="button button-soft" onClick={() => setDuplicateTarget(undefined)}>Cancel</button><button type="button" className="button button-purple" disabled={saving || !duplicateName.trim()} onClick={() => void duplicateMenu()}>{saving ? "Duplicating…" : "Create copy"}</button></footer></PlannerModal>}

    {archiveTarget && <PlannerModal title="Archive saved menu?" onClose={() => setArchiveTarget(undefined)} className="item-detail menu-library-dialog"><header><div><small>Preserve history</small><h3>Archive {archiveTarget.name}?</h3></div><button type="button" className="modal-close" onClick={() => setArchiveTarget(undefined)} aria-label="Close archive menu">Close</button></header><p>The library entry will be hidden from normal search. Existing planner menus and historical publications remain unchanged.</p><footer><button type="button" className="button button-soft" disabled={saving} onClick={() => setArchiveTarget(undefined)}>Keep menu</button><button type="button" className="button button-danger" disabled={saving} onClick={() => void archiveMenu()}>{saving ? "Archiving…" : "Archive menu"}</button></footer></PlannerModal>}
  </section>;
}
