"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
export type BuffetBookingChrome = { logoPath: string; logoAlt: string; background: string; steps: string[]; activeStep: number };

type Props = {
  menu: BuffetMenu;
  guestCount: number;
  initialPackageId: string;
  priceByPackageId?: Record<string, number>;
  bookingChrome?: BuffetBookingChrome;
  selection?: BuffetSelection;
  dietaryNotes?: string;
  onSave: (selection: BuffetSelection, dietaryNotes: string, stayOpen?: boolean) => void;
  onCancel: () => void;
  onContinue?: () => void;
};

const emptySelection = (packageId: string): BuffetSelection => ({ packageId, nonVegetarianMainId: "", vegetarianMainId: "", mainPortions: {}, saladIds: [], dessertIds: [] });
const selectedCountMessage = (label: string, count: number, expected: number) => count === expected ? "" : `Choose ${expected} ${label}${expected === 1 ? "" : "s"}.`;

export function BuffetMenuBuilder({ menu, guestCount, initialPackageId, priceByPackageId = {}, bookingChrome, selection, dietaryNotes = "", onSave, onCancel, onContinue }: Props) {
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
  const pricePerGuest = priceByPackageId[draft.packageId] || 0;
  const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
  const changePortions = (id: string, change: number) => setDraft(current => ({ ...current, mainPortions: { ...current.mainPortions, [id]: Math.max(0, (current.mainPortions[id] || 0) + change) } }));

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
  const validate = (continueAfterSave = false) => {
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
    if (!continueAfterSave) initial.current = JSON.stringify({ selection: draft, dietaryNotes: draftDietaryNotes });
    onSave(draft, draftDietaryNotes, !continueAfterSave);
    if (continueAfterSave) onContinue?.();
  };

  const dishList = (categories: BuffetDish["category"][], key: "nonVegetarianMainId" | "vegetarianMainId", number: 1 | 2, title: string, helper: string) => <section className={styles.section} aria-labelledby={`buffet-main-${number}`}><div className={styles.sectionIntro}><h2 id={`buffet-main-${number}`}>{number}. {title}</h2><p>{helper}</p></div><div className={styles.dishGrid}>{menu.dishes.filter(item => categories.includes(item.category)).map(item => <label className={styles.dishCard} data-selected={draft[key] === item.id || undefined} key={item.id}><input type="radio" name={key} checked={draft[key] === item.id} disabled={item.selectionStatus === "review_required"} onChange={() => updateMain(key, item.id)} /><span className={styles.dishCopy}><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}{item.dietaryInformation && <small>{item.dietaryInformation}</small>}{item.allergenInformation && <small>{item.allergenInformation}</small>}{item.selectionStatus === "review_required" && <small>Unavailable pending review</small>}</span>{!item.allergenInformation && <span className={styles.visuallyHidden}>Allergen information not recorded</span>}</label>)}</div></section>;
  const choiceList = (category: "salad" | "dessert", key: "saladIds" | "dessertIds", count: number, number: 4 | 5, heading: string, helper: string) => <section className={styles.section} aria-labelledby={`buffet-choice-${number}`}><div className={styles.sectionIntro}><h2 id={`buffet-choice-${number}`}>{number}. {heading}</h2><p>{helper}</p></div><fieldset className={styles.choiceFieldset}><legend className={styles.visuallyHidden}>Choose {count} {category === "salad" ? "salads" : "desserts"}</legend><div className={styles.choiceGrid}>{menu.dishes.filter(item => item.category === category).map(item => <label className={styles.dishCard} data-selected={draft[key].includes(item.id) || undefined} key={item.id}><input type="checkbox" checked={draft[key].includes(item.id)} disabled={item.selectionStatus === "review_required"} onChange={() => toggle(key, item.id)} /><span className={styles.dishCopy}><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}{item.dietaryInformation && <small>{item.dietaryInformation}</small>}{item.allergenInformation && <small>{item.allergenInformation}</small>}</span>{!item.allergenInformation && <span className={styles.visuallyHidden}>Allergen information not recorded</span>}</label>)}</div></fieldset></section>;


  if (!mounted || typeof document === "undefined") return null;
  return createPortal(<section ref={screenRef} data-testid="buffet-menu-screen" className={styles.screen} aria-labelledby="buffet-menu-title" tabIndex={-1} style={{ "--buffet-brand-background": bookingChrome?.background || "var(--color-brand-dark)" } as CSSProperties}>
    <header className={styles.header}>
      {bookingChrome ? <><div className={styles.brand}><img src={bookingChrome.logoPath} alt={bookingChrome.logoAlt} /><span>Hospitality Booking</span></div><div className={styles.topProgress}><strong>Choose</strong><span aria-hidden="true">—</span><span>Plan</span><span aria-hidden="true">—</span><span>Submit</span></div></> : <><button type="button" className={styles.back} onClick={requestBack}>← <span>Back to booking</span></button><span className={styles.genericBrand}>Hot Fork Buffet · Menu selection</span></>}
    </header>
    <div className={`${styles.layout} ${bookingChrome ? styles.withNavigation : ""}`}>
      {bookingChrome && <nav className={styles.stepNav} aria-label="Booking progress">{bookingChrome.steps.map((label, index) => <div className={index === bookingChrome.activeStep ? styles.stepActive : index < bookingChrome.activeStep ? styles.stepComplete : styles.step} aria-current={index === bookingChrome.activeStep ? "step" : undefined} key={`${index}-${label}`}><span>{String(index + 1).padStart(2, "0")}</span>{label}</div>)}</nav>}
      <main className={styles.workarea}>
        <div className={styles.pageIntro}><p className={styles.eyebrow}>Build your buffet</p><h1 ref={headingRef} tabIndex={-1} id="buffet-menu-title">CHOOSE YOUR MENU</h1><p id="buffet-menu-intro">Select dishes for {guestCount || "your"} guests. Dietary meals are included in your guest count and total price.</p><div className={styles.bookingMeta}><strong>HOT FORK BUFFET</strong><span aria-hidden="true">|</span><span>For {guestCount} guests</span>{pkg && !pkg.orderingReady && <span className={styles.previewBadge} role="status">Preview only · Live ordering disabled{pkg.pendingRules?.length ? <span className={styles.visuallyHidden}> {pkg.pendingRules.join(" ")}</span> : null}</span>}</div></div>
        {pkg && <>
          <fieldset className={styles.packageGroup}><legend>Package</legend>{menu.packages.map(item => <label className={styles.packageOption} data-selected={draft.packageId === item.id || undefined} key={item.id}><input type="radio" name="buffet-package" value={item.id} checked={draft.packageId === item.id} onChange={() => setDraft(current => ({ ...current, packageId: item.id, dessertIds: [] }))} /><span><strong>{item.label}</strong><small>{priceByPackageId[item.id] > 0 ? `${money(priceByPackageId[item.id])} per guest excluding VAT` : "Price on request"}</small></span></label>)}</fieldset>
          {dishList(["meat", "fish"], "nonVegetarianMainId", 1, "MEAT OR FISH MAIN", "Choose one meat or fish main.")}
          {dishList(["vegetarian", "vegan"], "vegetarianMainId", 2, "VEGETARIAN / VEGAN MAIN", "Choose one vegetarian or vegan main.")}
          <section className={styles.section} aria-labelledby="buffet-portions-title"><div className={styles.sectionIntro}><h2 id="buffet-portions-title">3. Allocate portions</h2><p>Set how many portions of each main you would like. Each main needs at least {pkg.mainMinimumPortions} portions.</p></div><div className={styles.allocationArea}>{mains.map(id => <div className={styles.portion} key={id}><span className={styles.portionLabel}><strong>{dish(id)?.name || "Selected main"}</strong><small>{draft.mainPortions[id] || 0} portions</small></span><div className={styles.stepperControl}><button type="button" aria-label={`Remove one ${dish(id)?.name || "main"} portion`} onClick={() => changePortions(id, -1)} disabled={!draft.mainPortions[id]}>−</button><input aria-label={dish(id)?.name || "Main portions"} type="number" min="0" step="1" inputMode="numeric" value={draft.mainPortions[id] ?? 0} onChange={event => { const value = event.currentTarget.value; setDraft(current => ({ ...current, mainPortions: { ...current.mainPortions, [id]: Math.max(0, Number(value) || 0) } })); }} /><button type="button" aria-label={`Add one ${dish(id)?.name || "main"} portion`} onClick={() => changePortions(id, 1)}>+</button></div></div>)}<div className={styles.allocated}><span>Allocated</span><strong>{total} / {guestCount}</strong><span className={total === guestCount ? styles.totalSuccess : styles.totalPending} role="status">{total === guestCount ? "✓ Total matches guest count" : `Allocate ${guestCount - total} more portions`}</span></div></div></section>
          {choiceList("salad", "saladIds", pkg.saladCount, 4, "SELECT SALADS", `Choose ${pkg.saladCount} salads. The chef decides the quantities.`)}
          {choiceList("dessert", "dessertIds", pkg.dessertCount, 5, "SELECT DESSERTS", `${pkg.label} package: choose ${pkg.dessertCount} dessert${pkg.dessertCount === 1 ? "" : "s"}; the chef allocates portions.`)}
          <p className={styles.chefNote}>{pkg.dessertIntent === "equal-split" ? "Gold dessert selection expresses a 50/50 preference; the chef decides practical production quantities." : "The chef decides dessert production quantities."} Salad quantities are also decided by the chef.</p>
          <section className={styles.section} aria-labelledby="buffet-dietaries-title"><div className={styles.sectionIntro}><h2 id="buffet-dietaries-title">6. Dietary notes</h2><p>Add dietary requirements, allergies or other notes for the chef (optional).</p></div><div className={styles.dietaryArea}><label className={styles.dietaryField}><span className={styles.visuallyHidden}>Dietary notes</span><textarea rows={2} maxLength={4000} value={draftDietaryNotes} placeholder="E.g. Coeliac, nut allergy, or other dietary requirements…" onChange={event => setDraftDietaryNotes(event.target.value)} /></label><p className={styles.allergenNotice}>ⓘ &nbsp;Allergen and dietary information is not fully recorded. Please confirm any allergies or dietary requirements with the hospitality team so they can be accommodated.</p></div></section>
        </>}
      </main>
      <aside className={styles.summaryColumn} aria-label="Request and selection summary"><section className={styles.requestPanel}><div className={styles.summaryHead}><h2>Your request</h2><span>Progress saved</span></div><strong className={styles.requestName}>Hot Fork Buffet</strong><span>{pkg?.label || "Choose a package"} package</span><dl><div><dt>Guests</dt><dd>{guestCount}</dd></div><div><dt>Price per guest (excl. VAT)</dt><dd>{pricePerGuest > 0 ? money(pricePerGuest) : "Price on request"}</dd></div><div className={styles.estimated}><dt>Estimated total</dt><dd>{pricePerGuest > 0 ? money(pricePerGuest * guestCount) : "Quote required"}</dd></div></dl><p>Indicative prices exclude VAT and are subject to menu availability and any staffing, labour and hire equipment where applicable.</p></section><section className={styles.selectionSummary}><h2>Your selection summary</h2><dl><div><dt>Package</dt><dd>{pkg?.label || "Not selected"} · {pricePerGuest > 0 ? `${money(pricePerGuest)} per guest` : "Price on request"}</dd></div><div><dt>Mains</dt><dd>{mains.length ? mains.map(id => <span className={styles.summaryDish} key={id}>• {dish(id)?.name || "Saved dish unavailable"}{draft.mainPortions[id] ? ` (${draft.mainPortions[id]} portions)` : ""}</span>) : "Not selected"}</dd></div><div><dt>Salads ({draft.saladIds.length})</dt><dd>{draft.saladIds.length ? draft.saladIds.map(id => <span className={styles.summaryDish} key={id}>• {dish(id)?.name || "Saved salad unavailable"}</span>) : "Not selected"}</dd></div><div><dt>Desserts ({draft.dessertIds.length})</dt><dd>{draft.dessertIds.length ? draft.dessertIds.map(id => <span className={styles.summaryDish} key={id}>• {dish(id)?.name || "Saved dessert unavailable"}</span>) : "Not selected"}</dd></div><div><dt>Dietary notes</dt><dd>{draftDietaryNotes.trim() ? draftDietaryNotes : <em>Not added</em>}</dd></div></dl></section></aside>
    </div>
    {errors.length > 0 && <div className={styles.error} role="alert" tabIndex={-1}><strong>Please review your menu</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
    {confirmLeave && <div className={styles.leaveNotice} role="alert"><div><strong>Discard these menu edits?</strong><p>Your previous saved selection is unchanged.</p></div><div><button type="button" className={styles.secondary} onClick={() => setConfirmLeave(false)}>Keep editing</button><button type="button" className={styles.destructive} onClick={onCancel}>Discard and go back</button></div></div>}
    <footer className={styles.actions}><button type="button" className={styles.secondary} onClick={requestBack}>← &nbsp;Back to menu</button><button type="button" className={styles.secondary} onClick={() => validate(false)}>Save selection</button><button type="button" className={styles.primary} onClick={() => validate(true)}>Continue &nbsp;→</button></footer>
  </section>, document.body);
}
