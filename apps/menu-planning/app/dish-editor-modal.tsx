"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import PlannerModal from "./planner-modal";
import { SpellUnderlinedText, useSpellcheckLists, useSpellingDictionary } from "./spellcheck-panel";
import { CANONICAL_DISH_CATEGORIES } from "@/lib/dish-categories";
import { findSpellingIssues } from "@/lib/menu-spellcheck";
import { invalidateCatalogueCache } from "@/lib/menu-catalogue-cache";
import { DISH_TAG_GROUPS, DISH_TAG_GROUP_LABELS, groupTags, searchTags, type DishTag, type DishTagGroup, type DishTagRegistry } from "@/lib/dish-tags";
import {
  buildCreatePayload,
  buildUpdatePayload,
  cleanDishName,
  normaliseSaladSubtype,
  SALAD_SLOT_SUBTYPES,
  savedOutcomeIsExisting,
  similarDishWarnings,
  suggestTags,
  validateDishForm,
  type EditorDishRef,
  type PreservedDishFields,
} from "@/lib/dish-editor";
import "./dish-editor-modal.css";

export type SavedDish = { id: string; name: string; category: string; tagIds: string[]; outcome: "created" | "existing" | "updated" };

type Props = {
  mode: "create" | "edit";
  /** Create: the typed name. Edit: ignored (the saved record is loaded). */
  initialName: string;
  initialCategory: string;
  /** New salad dishes created from a numbered slot start with that explicit subtype selected. */
  initialSubcategory?: string;
  dishId?: string;
  dishes: readonly EditorDishRef[];
  onSaved: (dish: SavedDish) => Promise<void> | void;
  onCancel: () => void;
};

type TagList = { version: number; tags: DishTag[] };

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

/**
 * Create / Edit Dish. Save persists the canonical Dish Library record (never a planner-only label);
 * Cancel and Escape change nothing. Provisional allergens are not authored here: a new dish starts
 * with no allergen evidence, so it is never treated as Clear or signed.
 */
export default function DishEditorModal({ mode, initialName, initialCategory, initialSubcategory, dishId, dishes, onSaved, onCancel }: Props) {
  const formId = useId();
  const [name, setName] = useState(mode === "create" ? cleanDishName(initialName) : "");
  const [category, setCategory] = useState(initialCategory);
  // `undefined` = the salad slot was not touched, so an edit leaves whatever is stored exactly as it is.
  const [subcategory, setSubcategory] = useState<string | undefined>(mode === "create" ? initialSubcategory : undefined);
  const [storedSubtype, setStoredSubtype] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [preserved, setPreserved] = useState<PreservedDishFields>({});
  const [loading, setLoading] = useState(mode === "edit");
  const [loadError, setLoadError] = useState("");
  const [tags, setTags] = useState<TagList>({ version: 0, tags: [] });
  const [tagsError, setTagsError] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [newTagLabel, setNewTagLabel] = useState("");
  const [newTagGroup, setNewTagGroup] = useState<DishTagGroup>("type");
  const [tagBusy, setTagBusy] = useState(false);
  const [tagMessage, setTagMessage] = useState("");
  const [feedbackEnabled, setFeedbackEnabled] = useState(false);
  const [rejectedSuggestions, setRejectedSuggestions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const spell = useSpellcheckLists();
  const dictionary = useSpellingDictionary();

  useEffect(() => {
    let active = true;
    void fetch("/api/dish-tags", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, body: await readJson(response) }))
      .then(({ ok, body }) => {
        if (!active) return;
        if (!ok) setTagsError(body.error?.message || "Tags could not be loaded. You can still save the dish without tags.");
        else setTags({ version: Number(body.version) || 0, tags: body.tags || [] });
      })
      .catch(() => { if (active) setTagsError("Tags could not be loaded. You can still save the dish without tags."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !dishId) return;
    let active = true;
    void fetch(`/api/catalogue?id=${encodeURIComponent(dishId)}`, { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, body: await readJson(response) }))
      .then(({ ok, body }) => {
        if (!active) return;
        const item = body.entry?.item;
        if (!ok || !item) { setLoadError(body.error?.message || "The dish could not be loaded for editing."); setLoading(false); return; }
        setName(item.displayName || "");
        setCategory(CANONICAL_DISH_CATEGORIES.includes(item.category) ? item.category : initialCategory);
        setTagIds(Array.isArray(item.tagIds) ? item.tagIds : []);
        setStoredSubtype(normaliseSaladSubtype(item.subcategory) || "");
        setPreserved({ subcategory: item.subcategory, description: item.description, preparationNotes: item.preparationNotes, mayContainNotes: item.mayContainNotes, ingredients: item.ingredients, methodSteps: item.methodSteps });
        setLoading(false);
      })
      .catch(() => { if (active) { setLoadError("The dish could not be loaded for editing."); setLoading(false); } });
    return () => { active = false; };
  }, [mode, dishId, initialCategory]);

  const registry: DishTagRegistry = useMemo(() => ({ schemaVersion: 1, version: tags.version, tags: tags.tags }), [tags]);
  const visibleTags = useMemo(() => searchTags(registry, tagQuery), [registry, tagQuery]);
  const taggedDishes = useMemo(() => dishes.filter((dish): dish is EditorDishRef & { tagIds: string[] } => Array.isArray((dish as EditorDishRef & { tagIds?: string[] }).tagIds) && (dish as EditorDishRef & { tagIds: string[] }).tagIds.length > 0), [dishes]);
  const suggestions = useMemo(() => suggestTags(tags.tags, name, tagIds, { similarDishes: taggedDishes }), [tags.tags, name, tagIds, taggedDishes]);
  const similar = useMemo(() => similarDishWarnings(dishes, name, dishId), [dishes, name, dishId]);
  const spellingIssues = useMemo(() => (dictionary.status === "ready" ? findSpellingIssues(name, { ignored: spell.ignored, addedWords: spell.added, speller: dictionary.speller }) : []), [name, spell.ignored, spell.added, dictionary]);
  const selectedTags = tagIds.map((id) => tags.tags.find((tag) => tag.id === id) || { id, label: id, group: "type" as DishTagGroup, synonyms: [], createdAt: "", createdBy: "" });

  const toggle = (id: string) => setTagIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const saveFeedback = (tagId: string, outcome: "accepted" | "rejected") => {
    if (!feedbackEnabled) return;
    try {
      const key = "fika-menu-tag-suggestion-feedback-v1";
      const current = JSON.parse(window.localStorage.getItem(key) || "[]") as Array<{ dish: string; tagId: string; outcome: string; at: string }>;
      current.push({ dish: cleanDishName(name).toLocaleLowerCase("en-GB"), tagId, outcome, at: new Date().toISOString() });
      window.localStorage.setItem(key, JSON.stringify(current.slice(-200)));
    } catch { /* Local feedback is optional and never blocks editing. */ }
  };

  const acceptSuggestion = (tagId: string) => { saveFeedback(tagId, "accepted"); toggle(tagId); };
  const rejectSuggestion = (tagId: string) => { saveFeedback(tagId, "rejected"); setRejectedSuggestions((current) => current.includes(tagId) ? current : [...current, tagId]); };

  const addTag = async () => {
    const label = cleanDishName(newTagLabel);
    if (!label || tagBusy) return;
    setTagBusy(true); setTagMessage(""); setTagsError("");
    try {
      const response = await fetch("/api/dish-tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create-tag", label, group: newTagGroup, expectedVersion: tags.version }) });
      const body = await readJson(response);
      if (!response.ok) {
        // A concurrent change: reload the list and let the user retry rather than failing silently.
        if (response.status === 409) {
          const fresh = await readJson(await fetch("/api/dish-tags", { cache: "no-store" }));
          if (fresh.tags) setTags({ version: Number(fresh.version) || 0, tags: fresh.tags });
        }
        throw new Error(body.error?.message || "The tag could not be created.");
      }
      const tag = body.tag as DishTag;
      setTags((current) => ({ version: Number(body.version) || current.version, tags: current.tags.some((entry) => entry.id === tag.id) ? current.tags : [...current.tags, tag] }));
      setTagIds((current) => (current.includes(tag.id) ? current : [...current, tag.id]));
      setNewTagLabel("");
      setTagMessage(body.outcome === "created" ? `Added the tag “${tag.label}”.` : `“${tag.label}” already exists and has been selected.`);
    } catch (cause) {
      setTagsError(cause instanceof Error ? cause.message : "The tag could not be created.");
    } finally {
      setTagBusy(false);
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (savingRef.current || loading) return;
    const state = { name, category, tagIds, subcategory };
    const problem = validateDishForm(state, CANONICAL_DISH_CATEGORIES);
    if (problem) { setError(problem); return; }
    savingRef.current = true; setSaving(true); setError("");
    try {
      const payload = mode === "edit" && dishId ? buildUpdatePayload(dishId, state, preserved) : buildCreatePayload(state);
      const response = await fetch("/api/catalogue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error?.message || (typeof body.error === "string" ? body.error : "The dish could not be saved."));
      await invalidateCatalogueCache();
      const item = body.item as { canonicalId: string; displayName: string; category: string; tagIds?: string[] };
      await onSaved({ id: item.canonicalId, name: item.displayName, category: item.category, tagIds: item.tagIds || [], outcome: mode === "edit" ? "updated" : savedOutcomeIsExisting(body.outcome) ? "existing" : "created" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The dish could not be saved.");
      savingRef.current = false; setSaving(false);
    }
  };

  const title = mode === "edit" ? "Edit dish" : "Create dish";
  return (
    <PlannerModal title={title} onClose={onCancel} dismissible={!saving} busy={saving} className="dish-editor-dialog">
      <aside className="dish-picker dish-editor">
        <header>
          <div><small>Dish Library</small><h3>{title}</h3></div>
          <button type="button" className="modal-close" onClick={onCancel} disabled={saving} aria-label="Cancel and close">Close</button>
        </header>
        {loadError ? (
          <div className="dish-editor-body"><p className="menu-error" role="alert">{loadError}</p><div className="dish-editor-actions"><button type="button" className="button button-soft" onClick={onCancel}>Close</button></div></div>
        ) : (
          <form className="dish-editor-body" id={formId} onSubmit={(event) => void submit(event)} aria-busy={saving || loading}>
            {loading && <p role="status" className="dish-editor-note">Loading the dish…</p>}
            <label className="dish-editor-field">Dish name
              <input data-modal-autofocus value={name} disabled={loading} onChange={(event) => { setName(event.target.value); setRejectedSuggestions([]); }} placeholder="Type a dish title" autoComplete="off" required />
            </label>
            {spellingIssues.length > 0 && (
              <p className="dish-editor-warn" role="status">Check the spelling: <SpellUnderlinedText text={name} ignored={spell.ignored} added={spell.added} speller={dictionary.speller} />. Saving is still allowed.</p>
            )}
            {similar.length > 0 && (
              <div className="dish-editor-warn" role="status">
                <strong>Similar dishes already exist:</strong>
                <ul>{similar.map((dish) => <li key={dish.id}>{dish.name}</li>)}</ul>
                <span>Check you are not creating a duplicate. An exact existing name or alias is selected for you instead of saved twice.</span>
              </div>
            )}
            <label className="dish-editor-field">Primary category
              <select value={category} disabled={loading} onChange={(event) => setCategory(event.target.value)}>
                {CANONICAL_DISH_CATEGORIES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>

            {category === "Salad" && (
              <label className="dish-editor-field">Salad slot
                <select value={subcategory ?? storedSubtype} disabled={loading} onChange={(event) => setSubcategory(event.target.value)}>
                  <option value="">Not assigned yet</option>
                  {SALAD_SLOT_SUBTYPES.map((entry) => <option key={entry.slot} value={entry.subtype}>{entry.subtype} ({entry.slot.replace("SALAD", "Salad")})</option>)}
                </select>
                <small>The salad slot decides which planner slot offers this dish. FIKA Seasonal is an explicit choice only.</small>
              </label>
            )}

            <fieldset className="dish-editor-tags">
              <legend>Tags <small>(optional, as many as you like)</small></legend>
              {selectedTags.length > 0 && (
                <ul className="dish-editor-chips" aria-label="Selected tags">
                  {selectedTags.map((tag) => <li key={tag.id}><button type="button" className="dish-editor-chip" onClick={() => toggle(tag.id)} aria-label={`Remove tag ${tag.label}`}>{tag.label} <span aria-hidden="true">×</span></button></li>)}
                </ul>
              )}
              {suggestions.some((suggestion) => !rejectedSuggestions.includes(suggestion.tag.id)) && (
                <div className="dish-editor-suggest"><span>Suggested (choose to add):</span>{suggestions.filter((suggestion) => !rejectedSuggestions.includes(suggestion.tag.id)).map(({ tag, reason }) => <span className="dish-editor-suggestion" key={tag.id}><button type="button" className="dish-editor-chip dish-editor-chip--suggest" onClick={() => acceptSuggestion(tag.id)} aria-label={`Add suggested tag ${tag.label}`}>＋ {tag.label}</button><small>{reason}</small><button type="button" className="dish-editor-reject" onClick={() => rejectSuggestion(tag.id)} aria-label={`Dismiss suggestion ${tag.label}`}>Dismiss</button></span>)}</div>
              )}
              <label className="dish-editor-feedback"><input type="checkbox" checked={feedbackEnabled} onChange={(event) => setFeedbackEnabled(event.target.checked)} /> Save accepted or dismissed suggestions on this device</label>
              <label className="dish-editor-field">Search tags
                <input type="search" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="Search by name or synonym" autoComplete="off" />
              </label>
              <div className="dish-editor-taglist" role="group" aria-label="Available tags">
                {groupTags(visibleTags).map((entry) => (
                  <div key={entry.group}>
                    <strong>{DISH_TAG_GROUP_LABELS[entry.group]}</strong>
                    <div className="dish-editor-checks">
                      {entry.tags.map((tag) => <label key={tag.id} className="dish-editor-check"><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => toggle(tag.id)} /><span>{tag.label}</span></label>)}
                    </div>
                  </div>
                ))}
                {!visibleTags.length && <p className="dish-editor-note">{tags.tags.length ? "No tag matches that search. You can add it below." : "No tags exist yet. Add the first one below."}</p>}
              </div>
              <div className="dish-editor-newtag">
                <label className="dish-editor-field">New tag
                  <input value={newTagLabel} onChange={(event) => setNewTagLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addTag(); } }} placeholder="Name a new tag" autoComplete="off" />
                </label>
                <label className="dish-editor-field">Group
                  <select value={newTagGroup} onChange={(event) => setNewTagGroup(event.target.value as DishTagGroup)}>
                    {DISH_TAG_GROUPS.map((group) => <option key={group} value={group}>{DISH_TAG_GROUP_LABELS[group]}</option>)}
                  </select>
                </label>
                <button type="button" className="button button-soft" disabled={tagBusy || !cleanDishName(newTagLabel)} onClick={() => void addTag()}>{tagBusy ? "Adding…" : "Add tag"}</button>
              </div>
              {tagMessage && <p className="dish-editor-note" role="status">{tagMessage}</p>}
              {tagsError && <p className="menu-error" role="alert">{tagsError}</p>}
            </fieldset>

            <p className="dish-editor-note">Allergens are not set here. A new dish starts with no recorded allergens, and the CPU chef checks and signs each allergen release.</p>
            {error && <p className="menu-error" role="alert">{error}</p>}
            <div className="dish-editor-actions">
              <button type="button" className="button button-soft" onClick={onCancel} disabled={saving}>Cancel</button>
              <button type="submit" className="button button-mint" disabled={saving || loading || !cleanDishName(name)}>{saving ? "Saving…" : mode === "edit" ? "Save changes" : "Create and add to planner"}</button>
            </div>
          </form>
        )}
      </aside>
    </PlannerModal>
  );
}
