"use client";
import { useEffect, useState } from "react";
import "./dish-form.css";
import type { MenuItem } from "@/lib/domain";
import { CANONICAL_DISH_CATEGORIES } from "@/lib/dish-categories";
import { invalidateCatalogueCache } from "@/lib/menu-catalogue-cache";
import MenuPlanningShell from "../../menu-planning-shell";
type Ingredient = { name: string; quantity: string; unit: string };

export default function NewDishPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(CANONICAL_DISH_CATEGORIES[0]);
  const [subcategory, setSubcategory] = useState("");
  const [preparationNotes, setPreparationNotes] = useState("");
  const [mayContainNotes, setMayContainNotes] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([{ name: "", quantity: "", unit: "" }]);
  const [methodSteps, setMethodSteps] = useState([""]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dishId, setDishId] = useState("");
  const [loadingDish, setLoadingDish] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    setDishId(id);
    setLoadingDish(true);
    void fetch(`/api/catalogue?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The dish could not be loaded.");
      const item = body.entry?.item as MenuItem | undefined;
      if (!item?.canonicalId) throw new Error("The dish record is unavailable for editing.");
      setName(item.displayName || "");
      setDescription(item.description || "");
      setCategory(item.category || CANONICAL_DISH_CATEGORIES[0]);
      setSubcategory(item.subcategory || "");
      setPreparationNotes(item.preparationNotes || "");
      setMayContainNotes(item.mayContainNotes || "");
      setIngredients(item.ingredients?.length ? item.ingredients.map(ingredient => ({ name: ingredient.name, quantity: ingredient.quantity === undefined ? "" : String(ingredient.quantity), unit: ingredient.unit || "" })) : [{ name: "", quantity: "", unit: "" }]);
      setMethodSteps(item.methodSteps?.length ? item.methodSteps : [""]);
    }).catch((cause: Error) => setError(cause.message)).finally(() => setLoadingDish(false));
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError("Give this dish a name before saving."); return; }
    setSaving(true);
    setError("");
    const recipeIngredients = ingredients.filter(item => item.name.trim()).map(item => ({ name: item.name.trim(), quantity: item.quantity ? Number(item.quantity) : undefined, unit: item.unit.trim() || undefined }));
    try {
      const response = await fetch("/api/catalogue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: dishId ? "update-dish" : "create-dish",
          ...(dishId ? { id: dishId } : {}),
          displayName: name.trim(), category, subcategory, description, preparationNotes, mayContainNotes,
          ingredients: recipeIngredients, methodSteps: methodSteps.map(step => step.trim()).filter(Boolean),
        }),
      });
      const body = await response.json();
      if (!response.ok) { setError(body.error?.message || "The dish could not be saved."); setSaving(false); return; }
      // IndexedDB is a best-effort client cache. It must not hold a confirmed
      // server mutation on the form; navigation also forces the library to
      // revalidate the canonical catalogue.
      await Promise.race([invalidateCatalogueCache(), new Promise<void>(resolve => window.setTimeout(resolve, 1200))]);
      window.location.href = "/catalogue";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The dish could not be saved.");
      setSaving(false);
    }
  };

  const updateIngredient = (index: number, field: keyof Ingredient, value: string) => setIngredients(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));

  return <MenuPlanningShell section="Dish Library">
    <section className="workspace-intro"><small>Governed recipe record</small><h2>{dishId ? "Edit dish" : "Create dish"}</h2><p>Capture ingredients, method and operational notes. Allergen evidence is reviewed separately.</p></section>
    {error && <div className="menu-error" role="alert">{error}</div>}
    {loadingDish ? <div className="empty-state" role="status">Loading dish…</div> : <form className="dish-form" onSubmit={save}>
      <section className="form-card"><header><small>Identity and classification</small><h3>What is this dish?</h3></header><div className="form-grid">
        <label>Dish name *<input required spellCheck lang="en-GB" value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Category<select value={category} onChange={event => setCategory(event.target.value)}>{CANONICAL_DISH_CATEGORIES.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
        <label>Subcategory<input spellCheck lang="en-GB" value={subcategory} onChange={event => setSubcategory(event.target.value)} /></label>
        <label className="wide">Short description<textarea spellCheck lang="en-GB" value={description} onChange={event => setDescription(event.target.value)} rows={3} /></label>
      </div></section>
      <section className="form-card"><header><small>Recipe record</small><h3>Ingredients and method.</h3></header><div className="ingredient-editor">
        <div className="subheading"><strong>Ingredients</strong><button type="button" className="button button-soft" onClick={() => setIngredients(current => [...current, { name: "", quantity: "", unit: "" }])}>Add ingredient</button></div>
        {ingredients.map((item, index) => <div className="ingredient-row" key={index}><input aria-label={`Ingredient ${index + 1}`} spellCheck lang="en-GB" value={item.name} onChange={event => updateIngredient(index, "name", event.target.value)} placeholder="Ingredient" /><input aria-label={`Quantity ${index + 1}`} value={item.quantity} onChange={event => updateIngredient(index, "quantity", event.target.value)} placeholder="Quantity" /><input aria-label={`Unit ${index + 1}`} spellCheck lang="en-GB" value={item.unit} onChange={event => updateIngredient(index, "unit", event.target.value)} placeholder="Unit" /></div>)}
      </div><div className="method-editor">
        <div className="subheading"><strong>Method steps</strong><button type="button" className="button button-soft" onClick={() => setMethodSteps(current => [...current, ""])}>Add method step</button></div>
        {methodSteps.map((step, index) => <div className="method-row" key={index}><span>{index + 1}</span><textarea spellCheck lang="en-GB" aria-label={`Method step ${index + 1}`} value={step} onChange={event => setMethodSteps(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} rows={2} /></div>)}
      </div></section>
      <section className="form-card"><header><small>Operational and safety notes</small><h3>Keep the evidence explicit.</h3></header><div className="form-grid">
        <label className="wide">May-contain notes<textarea spellCheck lang="en-GB" value={mayContainNotes} onChange={event => setMayContainNotes(event.target.value)} rows={2} /></label>
        <label className="wide">Preparation notes<textarea spellCheck lang="en-GB" value={preparationNotes} onChange={event => setPreparationNotes(event.target.value)} rows={3} /></label>
      </div><p className="form-help">Allergen evidence is never inferred from the title, ingredients or method.</p></section>
      <footer className="form-actions"><a className="button button-soft" href="/catalogue">Cancel</a><button className="button button-mint" disabled={saving}>{saving ? "Saving dish…" : dishId ? "Save changes" : "Save draft dish"}</button></footer>
    </form>}
  </MenuPlanningShell>;
}
