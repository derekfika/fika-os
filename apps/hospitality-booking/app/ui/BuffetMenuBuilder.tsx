"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./BuffetMenuBuilder.module.css";

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
  dessertIntent: "equal-split" | "one-choice";
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

export function BuffetMenuBuilder({ menu, guestCount, initialPackageId, selection, dietaryNotes = "", onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<BuffetSelection>(() => selection ? { ...selection, mainPortions: { ...selection.mainPortions }, saladIds: [...selection.saladIds], dessertIds: [...selection.dessertIds] } : emptySelection(initialPackageId));
  const [draftDietaryNotes, setDraftDietaryNotes] = useState(dietaryNotes);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [mounted, setMounted] = useState(false);
  const screenRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pkg = menu.packages.find(item => item.id === draft.packageId);
  const dish = (id: string) => menu.dishes.find(item => item.id === id);
  const mains = [draft.nonVegetarianMainId, draft.vegetarianMainId].filter(Boolean);
  const total = mains.reduce((sum, id) => sum + (draft.mainPortions[id] || 0), 0);
  const initial = useRef(JSON.stringify({ selection: selection || emptySelection(initialPackageId), dietaryNotes }));
  const dirty = JSON.stringify({ selection: draft, dietaryNotes: draftDietaryNotes }) !== initial.current;
  const requestBack = () => { if (dirty) setConfirmLeave(true); else onCancel(); };

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    const page = screenRef.current;
    const siblings = page?.parentElement ? [...page.parentElement.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== page) : [];
    const priorInert = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    return () => { siblings.forEach((element, index) => { element.inert = priorInert[index]; }); previouslyFocused?.focus(); };
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
    }
    setErrors(next);
    if (next.length) { window.setTimeout(() => screenRef.current?.querySelector<HTMLElement>("[role=alert]")?.focus(), 0); return; }
    onSave(draft, draftDietaryNotes);
  };

  const dishList = (categories: BuffetDish["category"][], key: "nonVegetarianMainId" | "vegetarianMainId", legend: string) => <fieldset className={styles.group}><legend>{legend}</legend>{categories.map(category => <div key={category}><h4 className={styles.category}>{category === "meat" ? "Meat" : category === "fish" ? "Fish" : category === "vegetarian" ? "Vegetarian" : "Vegan"} {["vegetarian", "vegan"].includes(category) && <small>(source category; suitability not recorded)</small>}</h4>{menu.dishes.filter(item => item.category === category).map(item => <label className={styles.option} key={item.id}><input type="radio" name={key} checked={draft[key] === item.id} disabled={item.selectionStatus === "review_required"} onChange={() => updateMain(key, item.id)} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}<small>{item.dietaryInformation || "Dietary suitability not recorded"}</small>{item.selectionStatus === "review_required" && <small>Unavailable pending dietary review</small>}<small>{item.allergenInformation || "Allergen information not recorded"}</small></span></label>)}</div>)}</fieldset>;
  const choiceList = (category: "salad" | "dessert", key: "saladIds" | "dessertIds", count: number) => <fieldset className={styles.group}><legend>{category === "salad" ? "Salads" : "Desserts"} <span>(choose {count})</span></legend>{menu.dishes.filter(item => item.category === category).map(item => <label className={styles.option} key={item.id}><input type="checkbox" checked={draft[key].includes(item.id)} disabled={item.selectionStatus === "review_required"} onChange={() => toggle(key, item.id)} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}<small>{item.dietaryInformation || "Dietary suitability not recorded"}</small>{item.selectionStatus === "review_required" && <small>Unavailable pending dietary review</small>}<small>{item.allergenInformation || "Allergen information not recorded"}</small></span></label>)}</fieldset>;

  if (!mounted || typeof document === "undefined") return null;
  const validation = [
    mains.length !== 2 ? "Choose both mains" : total !== guestCount ? `Allocate ${guestCount} main portions` : "Main allocations complete",
    pkg && draft.saladIds.length !== pkg.saladCount ? `Choose ${pkg.saladCount} salads` : "Salad choices complete",
    pkg && draft.dessertIds.length !== pkg.dessertCount ? `Choose ${pkg.dessertCount} desserts` : "Dessert choices complete",
  ];
  return createPortal(<section ref={screenRef} data-testid="buffet-menu-screen" className={styles.screen} aria-labelledby="buffet-menu-title" tabIndex={-1}>
    <header className={styles.header}><button type="button" className={styles.back} onClick={requestBack}>← <span>Back to booking</span></button><div className={styles.heading}><p className={styles.eyebrow}>Hot Fork Buffet · Menu selection</p><h1 ref={headingRef} tabIndex={-1} id="buffet-menu-title">Build your menu</h1><p id="buffet-menu-intro">Choose a package and dishes for {guestCount || "your"} guests. Dietary meals are included in your guest count; sides are included with the mains.</p></div><span className={styles.step}>Booking · Menu</span></header>
    <div className={styles.content}>
      <main className={styles.workarea}>
        <fieldset className={styles.packageGroup}><legend>Choose your package</legend>{menu.packages.map(item => <label className={styles.packageOption} key={item.id}><input type="radio" name="buffet-package" value={item.id} checked={draft.packageId === item.id} onChange={() => setDraft(current => ({ ...current, packageId: item.id, dessertIds: [] }))} /><span><strong>{item.label}</strong><small>{item.dessertCount} dessert choice{item.dessertCount === 1 ? "" : "s"} · {item.saladCount} salads</small></span></label>)}</fieldset>
        {pkg && <>
          {!pkg.orderingReady && <p className={styles.notice} role="status">Preview only. Live customer ordering remains disabled.{pkg.pendingRules?.length ? ` ${pkg.pendingRules.join(" ")}` : ""}</p>}
          <div className={styles.menuGrid}><div>{dishList(["meat", "fish"], "nonVegetarianMainId", "1 · Choose one meat or fish main")}</div><div>{dishList(["vegetarian", "vegan"], "vegetarianMainId", "2 · Choose one vegetarian or vegan main")}</div></div>
          <section className={styles.group} aria-labelledby="buffet-portions-title"><p className={styles.eyebrow}>Main allocations</p><h2 id="buffet-portions-title">Allocate portions</h2><p>Allocate all {guestCount} guests across the two mains. Each main needs at least {pkg.mainMinimumPortions} portions.</p>{mains.map(id => <label className={styles.portion} key={id}><span>{dish(id)?.name || "Saved dish no longer available"}</span><input aria-label={dish(id)?.name || "Main portions"} type="number" min="0" step="1" inputMode="numeric" value={draft.mainPortions[id] ?? ""} onChange={event => { const value = event.currentTarget.value; setDraft(current => ({ ...current, mainPortions: { ...current.mainPortions, [id]: value === "" ? 0 : Number(value) } })); }} /></label>)}<p className={styles.total} aria-live="polite">Main portions: {total} of {guestCount} guests</p></section>
          <div className={styles.menuGrid}>{choiceList("salad", "saladIds", pkg.saladCount)}{choiceList("dessert", "dessertIds", pkg.dessertCount)}</div>
          <p className={styles.chefNote}>{pkg.dessertIntent === "equal-split" ? "Gold dessert selection expresses a 50/50 preference; chefs decide practical production quantities." : "Chefs decide dessert production quantities."} Salad production quantities are also at chef discretion.</p>
          <section className={styles.group} aria-labelledby="buffet-dietaries-title"><p className={styles.eyebrow}>Dietary requirements</p><h2 id="buffet-dietaries-title">Tell us what the kitchen needs to know</h2><p>Dietary meals are included in your guest count. Menu descriptions do not confirm allergen status. The Hospitality team will review requirements before service.</p><label className={styles.dietaryField}>Dietary notes <small>(optional)</small><textarea rows={4} maxLength={4000} value={draftDietaryNotes} onChange={event => setDraftDietaryNotes(event.target.value)} /></label></section>
        </>}
      </main>
      <aside className={styles.summary} aria-labelledby="buffet-summary-title"><p className={styles.eyebrow}>Your request</p><h2 id="buffet-summary-title">Selection summary</h2><p>{pkg?.label || "Choose a package"} · {guestCount} guests</p><ul>{mains.map(id => <li key={id}><span>{dish(id)?.name || "Saved dish no longer available"}</span><strong>{draft.mainPortions[id] || 0} portions</strong></li>)}{draft.saladIds.map(id => <li key={id}><span>{dish(id)?.name || "Saved salad no longer available"}</span><small>Chef discretion</small></li>)}{draft.dessertIds.map(id => <li key={id}><span>{dish(id)?.name || "Saved dessert no longer available"}</span><small>{pkg?.dessertIntent === "equal-split" ? "50/50 intent · chef discretion" : "Chef discretion"}</small></li>)}</ul><h3>Ready to continue</h3><ul className={styles.validation}>{validation.map((item, index) => <li key={index}>{item}</li>)}</ul><p className={styles.allergenNotice}>Allergen information may be unrecorded. Please discuss requirements with the Hospitality team.</p></aside>
    </div>
    {errors.length > 0 && <div className={styles.error} role="alert" tabIndex={-1}><strong>Please review your menu</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
    {confirmLeave && <div className={styles.leaveNotice} role="alert"><div><strong>Discard these menu edits?</strong><p>Your previous saved selection is unchanged.</p></div><div><button type="button" className={styles.secondary} onClick={() => setConfirmLeave(false)}>Keep editing</button><button type="button" className={styles.destructive} onClick={onCancel}>Discard and go back</button></div></div>}
    <footer className={styles.actions}><button type="button" className={styles.secondary} onClick={requestBack}>Back to booking</button><button type="button" className={styles.primary} onClick={validate}>Save menu</button></footer>
  </section>, document.body);
}
