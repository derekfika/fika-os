"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./BuffetMenuDialog.module.css";

/** Customer-safe presentation model. The caller maps the server's versioned configuration into this view. */
export type BuffetDish = {
  id: string;
  name: string;
  category: "meat" | "fish" | "vegetarian" | "vegan" | "salad" | "dessert";
  description?: string;
  dietaryInformation?: string;
  allergenInformation?: string;
  selectionStatus?: "eligible" | "review_required";
};
export type BuffetPackage = {
  id: string;
  label: string;
  saladCount: number;
  dessertCount: number;
  mainMinimumPortions: number;
  dessertMinimumPortions?: number;
  dessertAllocation: "equal-split" | "unconfirmed";
  /** True only when the server has approved this configuration for customer ordering. */
  orderingReady: boolean;
  pendingRules?: string[];
};
export type BuffetSelection = {
  packageId: string;
  nonVegetarianMainId: string;
  vegetarianMainId: string;
  mainPortions: Record<string, number>;
  saladIds: string[];
  dessertIds: string[];
};
export type BuffetMenu = { version: string; packages: BuffetPackage[]; dishes: BuffetDish[] };

type Props = {
  menu: BuffetMenu;
  guestCount: number;
  initialPackageId: string;
  selection?: BuffetSelection;
  dietaryNotes?: string;
  onSave: (selection: BuffetSelection, dietaryNotes: string) => void;
  onCancel: () => void;
};

const emptySelection = (packageId: string): BuffetSelection => ({ packageId, nonVegetarianMainId: "", vegetarianMainId: "", mainPortions: {}, saladIds: [], dessertIds: [] });
const selectedCountMessage = (label: string, count: number, expected: number) => count === expected ? "" : `Choose ${expected} ${label}${expected === 1 ? "" : "s"}.`;

export function BuffetMenuDialog({ menu, guestCount, initialPackageId, selection, dietaryNotes = "", onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<BuffetSelection>(() => selection ? { ...selection, mainPortions: { ...selection.mainPortions }, saladIds: [...selection.saladIds], dessertIds: [...selection.dessertIds] } : emptySelection(initialPackageId));
  const [draftDietaryNotes, setDraftDietaryNotes] = useState(dietaryNotes);
  const [errors, setErrors] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const pkg = menu.packages.find(item => item.id === draft.packageId);
  const dish = (id: string) => menu.dishes.find(item => item.id === id);
  const mains = [draft.nonVegetarianMainId, draft.vegetarianMainId].filter(Boolean);
  const total = mains.reduce((sum, id) => sum + (draft.mainPortions[id] || 0), 0);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancelRef.current(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previouslyFocused?.focus(); };
  }, [mounted]);

  const updateMain = (key: "nonVegetarianMainId" | "vegetarianMainId", id: string) => setDraft(current => {
    const portions = { ...current.mainPortions }; delete portions[current[key]];
    return { ...current, [key]: id, mainPortions: portions };
  });
  const toggle = (key: "saladIds" | "dessertIds", id: string) => setDraft(current => ({ ...current, [key]: current[key].includes(id) ? current[key].filter(value => value !== id) : [...current[key], id] }));
  const validate = () => {
    const next: string[] = [];
    if (!pkg) next.push("Choose an available package.");
    if (!Number.isInteger(guestCount) || guestCount < 1) next.push("Enter the number of guests before saving your menu.");
    if (!dish(draft.nonVegetarianMainId) || dish(draft.nonVegetarianMainId)?.selectionStatus === "review_required" || !["meat", "fish"].includes(dish(draft.nonVegetarianMainId)!.category)) next.push("Choose one meat or fish main.");
    if (!dish(draft.vegetarianMainId) || dish(draft.vegetarianMainId)?.selectionStatus === "review_required" || !["vegetarian", "vegan"].includes(dish(draft.vegetarianMainId)!.category)) next.push("Choose one vegetarian or vegan main.");
    if (pkg) {
      if (mains.some(id => !Number.isInteger(draft.mainPortions[id]) || draft.mainPortions[id] < pkg.mainMinimumPortions)) next.push(`Each selected main needs at least ${pkg.mainMinimumPortions} portions.`);
      if (mains.length && total !== guestCount) next.push(`Main portions must add up to ${guestCount} guests.`);
      const saladIssue = selectedCountMessage("salad", draft.saladIds.length, pkg.saladCount); if (saladIssue) next.push(saladIssue);
      const dessertIssue = selectedCountMessage("dessert", draft.dessertIds.length, pkg.dessertCount); if (dessertIssue) next.push(dessertIssue);
      if (draft.saladIds.some(id => dish(id)?.category !== "salad" || dish(id)?.selectionStatus === "review_required") || draft.dessertIds.some(id => dish(id)?.category !== "dessert" || dish(id)?.selectionStatus === "review_required")) next.push("Review choices that are no longer on the menu.");
      const dessertPortions = pkg.dessertAllocation === "equal-split" && guestCount % 2 === 0 ? guestCount / 2 : undefined;
      if (dessertPortions !== undefined && pkg.dessertMinimumPortions !== undefined && dessertPortions < pkg.dessertMinimumPortions) next.push(`Each selected dessert needs at least ${pkg.dessertMinimumPortions} portions.`);
    }
    setErrors(next);
    if (next.length) { window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("[role=alert]")?.focus(), 0); return; }
    onSave(draft, draftDietaryNotes);
  };

  const dishList = (categories: BuffetDish["category"][], key: "nonVegetarianMainId" | "vegetarianMainId", legend: string) => <fieldset className={styles.group}><legend>{legend}</legend>{categories.map(category => <div key={category}><h4 className={styles.category}>{category === "meat" ? "Meat" : category === "fish" ? "Fish" : category === "vegetarian" ? "Vegetarian" : "Vegan"} {["vegetarian", "vegan"].includes(category) && <small>(source category; suitability not recorded)</small>}</h4>{menu.dishes.filter(item => item.category === category).map(item => <label className={styles.option} key={item.id}><input type="radio" name={key} checked={draft[key] === item.id} disabled={item.selectionStatus === "review_required"} onChange={() => updateMain(key, item.id)} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}<small>{item.dietaryInformation || "Dietary suitability not recorded"}</small>{item.selectionStatus === "review_required" && <small>Unavailable pending dietary review</small>}<small>{item.allergenInformation || "Allergen information not recorded"}</small></span></label>)}</div>)}</fieldset>;
  const choiceList = (category: "salad" | "dessert", key: "saladIds" | "dessertIds", count: number) => <fieldset className={styles.group}><legend>{category === "salad" ? "Salads" : "Desserts"} <span>(choose {count})</span></legend>{menu.dishes.filter(item => item.category === category).map(item => <label className={styles.option} key={item.id}><input type="checkbox" checked={draft[key].includes(item.id)} disabled={item.selectionStatus === "review_required"} onChange={() => toggle(key, item.id)} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}<small>{item.dietaryInformation || "Dietary suitability not recorded"}</small>{item.selectionStatus === "review_required" && <small>Unavailable pending dietary review</small>}<small>{item.allergenInformation || "Allergen information not recorded"}</small></span></label>)}</fieldset>;

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(<div className={styles.backdrop}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="buffet-menu-title" aria-describedby="buffet-menu-intro" tabIndex={-1}>
      <header className={styles.header}><div><p className={styles.eyebrow}>Hot Fork Buffet</p><h2 ref={headingRef} tabIndex={-1} id="buffet-menu-title">Choose your menu</h2><p id="buffet-menu-intro">Choose dishes for {guestCount || "your"} guests. Dietary meals are included in your guest count. Sides are included with the mains. Saving sets the package quantity to the guest count.</p></div><button type="button" className={styles.close} onClick={onCancel} aria-label="Close menu selector">×</button></header>
      <fieldset className={styles.packageGroup}><legend>Package</legend>{menu.packages.map(item => <label className={styles.packageOption} key={item.id}><input type="radio" name="buffet-package" value={item.id} checked={draft.packageId === item.id} onChange={() => setDraft(current => ({ ...current, packageId: item.id, dessertIds: [] }))} /><span>{item.label}</span></label>)}</fieldset>
      {pkg && <>
        {!pkg.orderingReady && <p className={styles.notice} role="status">This menu is a preview. Ordering is unavailable until the package rules are confirmed.{pkg.pendingRules?.length ? ` ${pkg.pendingRules.join(" ")}` : ""}</p>}
        {dishList(["meat", "fish"], "nonVegetarianMainId", "Choose one meat or fish main")}
        {dishList(["vegetarian", "vegan"], "vegetarianMainId", "Choose one vegetarian or vegan main")}
        <section className={styles.group} aria-labelledby="buffet-portions-title"><h3 id="buffet-portions-title">Main portions</h3><p>Allocate portions across the selected mains. Each selected main needs at least {pkg.mainMinimumPortions}.</p>{mains.map(id => <label className={styles.portion} key={id}><span>{dish(id)?.name || "Saved dish no longer available"}</span><input type="number" min="0" step="1" inputMode="numeric" value={draft.mainPortions[id] ?? ""} onChange={event => { const value = event.currentTarget.value; setDraft(current => ({ ...current, mainPortions: { ...current.mainPortions, [id]: value === "" ? 0 : Number(value) } })); }} /></label>)}<p className={styles.total} aria-live="polite">Main portions: {total} of {guestCount} guests</p></section>
        {choiceList("salad", "saladIds", pkg.saladCount)}
        {choiceList("dessert", "dessertIds", pkg.dessertCount)}
        <section className={styles.group} aria-labelledby="buffet-dietaries-title"><h3 id="buffet-dietaries-title">Dietary requirements and allergens</h3><p>Dietary meals are included in your guest count. Add allergy details in the Dietaries step; ask the hospitality team about allergens where information is not recorded.</p><label className={styles.dietaryField}>Dietary notes <small>(optional)</small><textarea rows={3} maxLength={4000} value={draftDietaryNotes} onChange={event => setDraftDietaryNotes(event.target.value)} /></label></section>
        <section className={styles.summary} aria-labelledby="buffet-summary-title"><h3 id="buffet-summary-title">Your selection</h3><p>{pkg.label} · {guestCount} guests</p><ul>{mains.map(id => <li key={id}>{dish(id)?.name || "Saved dish no longer available"}: {draft.mainPortions[id] || 0} portions</li>)}{draft.saladIds.map(id => <li key={id}>{dish(id)?.name || "Saved salad no longer available"}</li>)}{draft.dessertIds.map(id => <li key={id}>{dish(id)?.name || "Saved dessert no longer available"}{pkg.dessertAllocation === "equal-split" && guestCount % 2 === 0 ? `: ${guestCount / 2} portions` : ": portions awaiting confirmation"}</li>)}</ul></section>
      </>}
      {errors.length > 0 && <div className={styles.error} role="alert" tabIndex={-1}><strong>Please review your menu</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      <footer className={styles.actions}><button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button><button type="button" className={styles.primary} onClick={validate}>Save selection</button></footer>
    </section>
  </div>, document.body);
}


