"use client";

import { createElement, useEffect, useState } from "react";
import { catalogueMinimums } from "@fika/server-shared/hospitality-effective-offering";
import type { ProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";
import type { StudioChoicePresentation, StudioPreviewOffering } from "../../shared/hospitality-menu-studio-selection";
import { renderStudioDishChoiceControls } from "../../shared/hospitality-menu-studio-choice-controls";
import { productMenuDishKey, type ProductMenuDish, type ProductMenuDishReference } from "../lib/product-menu-dishes";
import { menuChoiceReferences } from "./product-menu-editor-model";
import { evaluatePreviewSelection, previewChoices, previewDateForWeek, previewScopeMatches } from "./product-menu-preview-model";
import { StudioField, StudioPanel, StudioStatus } from "./studio-design-system";
import { useProductMenuDishes } from "./use-product-menu-dishes";
import { useStudioRead, useStudioReads } from "./studio-reads";
import styles from "./product-menu-preview.module.css";

type Load<T> = { status: "loading" } | { status: "error" } | { status: "ready"; value: T };

export function ProductMenuPreview({ itemId, productName, configuration, library, editorWeek, onEditWeek }: {
  itemId: string; productName: string; configuration: ProductMenuConfiguration; library: ProductMenuDish[]; editorWeek: number; onEditWeek: (week: number) => void;
}) {
  const reads = useStudioReads();
  const catalogue = useStudioRead(reads.catalogue);
  const catalogueHash = reads.publicIdentity();
  const [siteId, setSiteId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [offeringAttempt, setOfferingAttempt] = useState(0);
  const [offering, setOffering] = useState<Load<StudioPreviewOffering> & { hash: string } | null>(null);
  const dateChoices = previewChoices(configuration, eventDate);
  const references = dateChoices ? menuChoiceReferences(dateChoices.choices) : [];
  const assigned = useProductMenuDishes(references, library);

  useEffect(() => {
    void reads.loadPublic().catch(() => undefined);
  }, [reads]);

  useEffect(() => {
    if (!siteId || !dateChoices || !catalogueHash) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ itemId, siteId, eventDate });
    setOffering({ status: "loading", hash: catalogueHash });
    async function load() {
      try {
        const response = await reads.fetch(`/api/studio/product-preview?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const value = await response.json() as StudioPreviewOffering;
        if (!previewScopeMatches(value, itemId, siteId, eventDate) || !["priced", "quote-only", "unavailable"].includes(value.state)) throw new Error();
        if (!controller.signal.aborted) setOffering({ status: "ready", value, hash: catalogueHash! });
      } catch { if (!controller.signal.aborted) setOffering({ status: "error", hash: catalogueHash! }); }
    }
    void load();
    return () => controller.abort();
  }, [reads, itemId, siteId, eventDate, Boolean(dateChoices), catalogueHash, offeringAttempt]);

  const current = catalogue.status === "ready" && offering?.status === "ready" && offering.hash === catalogueHash && previewScopeMatches(offering.value, itemId, siteId, eventDate) ? offering.value : null;
  const ready = current?.state === "priced" && dateChoices && !assigned.loading && !assigned.error && references.every(reference => assigned.byRevision.has(productMenuDishKey(reference)));
  const selectionKey = JSON.stringify([itemId, siteId, eventDate, configuration, current?.state]);
  const dateWeek = dateChoices && "week" in dateChoices ? dateChoices.week : undefined;

  return <StudioPanel title="Customer preview" description="Try this draft without creating a booking." className={styles.preview}>
    <StudioStatus tone="warning">Draft · not bookable</StudioStatus>
    <h3>{productName}</h3>
    {(catalogue.status === "loading" || catalogue.status === "idle") && <p role="status">Loading sites…</p>}
    {catalogue.status === "error" && <p role="alert">Sites could not be verified. <button type="button" onClick={() => { void reads.loadPublic(true).catch(() => undefined); }}>Try again</button></p>}
    {catalogue.value && <StudioField label="Preview site"><select value={siteId} onChange={event => { setOffering(null); setSiteId(event.target.value); }}><option value="">Choose a site</option>{catalogue.value.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></StudioField>}
    <StudioField label="Preview date"><input type="date" value={eventDate} onChange={event => { setOffering(null); setEventDate(event.target.value); }} /></StudioField>
    {dateWeek !== undefined && <p>Previewing week {dateWeek} for this date; editor shows week {editorWeek + 1}. {dateWeek !== editorWeek + 1 && <><button type="button" onClick={() => onEditWeek(dateWeek - 1)}>Edit this week</button>{" "}<button type="button" onClick={() => { const next = previewDateForWeek(configuration, eventDate, editorWeek); if (next) { setOffering(null); setEventDate(next); } }}>Preview editor week</button></>}</p>}
    {siteId && eventDate && !dateChoices && <p role="alert">Choose a valid date.</p>}
    {catalogueHash && siteId && dateChoices && (!offering || offering.status === "loading" || (offering.status === "ready" && !current)) && <p role="status">Checking site and date…</p>}
    {catalogueHash && siteId && dateChoices && offering?.status === "error" && <p role="alert">Site and date rules could not be verified. <button type="button" onClick={() => { setOffering(null); setOfferingAttempt(value => value + 1); }}>Try again</button></p>}
    {current?.state === "unavailable" && <p>Unavailable for this site and date.</p>}
    {current?.state === "quote-only" && <p>Quote required for this site and date.</p>}
    {current?.state === "priced" && <p>{new Intl.NumberFormat("en-GB", { style: "currency", currency: current.price.currency }).format(current.price.amount)}{current.minimumQuantity ? ` · minimum ${current.minimumQuantity}` : ""}{current.minimumGuests ? ` · minimum ${current.minimumGuests} guests` : ""}{current.noticeRequiredDays ? ` · ${current.noticeRequiredDays} days’ notice` : ""}</p>}
    {assigned.loading && <p role="status">Loading saved dish details…</p>}
    {assigned.error && <p role="alert">Saved dish details could not be verified. Retry before previewing the choices. <button type="button" onClick={assigned.retry}>Retry</button></p>}
    {current?.state === "priced" && dateChoices && !assigned.loading && !assigned.error && !ready && <p role="alert">One or more saved dish revisions are unavailable.</p>}
    {ready && <ChoiceSimulation key={selectionKey} configuration={configuration} choices={dateChoices.choices} dishes={assigned.byRevision} offering={current} />}
  </StudioPanel>;
}

function ChoiceSimulation({ configuration, choices, dishes, offering }: {
  configuration: ProductMenuConfiguration; choices: NonNullable<ReturnType<typeof previewChoices>>["choices"];
  dishes: Map<string, ProductMenuDish>; offering: Extract<StudioPreviewOffering, { state: "priced" }>;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [guests, setGuests] = useState("");
  const groups = configuration.groups.length ? configuration.groups.map(group => ({ id: group.id, name: group.name, presentation: group.presentation || configuration.presentation, dishes: choices.groups.find(slot => slot.groupId === group.id)?.dishes || [] })) : [{ id: "menu", name: "Dishes", presentation: configuration.presentation, dishes: choices.dishes }];
  const supported = (mode: StudioChoicePresentation) => offering.supportedPresentations.includes(mode) && (!configuration.groups.length || mode === "quantities");
  function display(reference: ProductMenuDishReference) { return dishes.get(productMenuDishKey(reference))!; }
  const refs = groups.flatMap(group => group.dishes);
  const minimums = catalogueMinimums({ id: offering.itemId, name: offering.name, minimumQuantity: offering.minimumQuantity, minimumGuests: offering.minimumGuests }, { gallagher: false });
  const allSupported = groups.every(group => supported(group.presentation));
  const evaluation = evaluatePreviewSelection({ dishIds: refs.map(reference => reference.dishId), presentation: configuration.groups.length ? "quantities" : configuration.presentation, quantities, minimumDish: offering.minimumDishQuantity ?? 1, minimumTotal: minimums.quantity, minimumGuests: minimums.guests, guests, unitPrice: offering.price.amount, supported: allSupported });
  return <div className={styles.choices}>{groups.map(group => {
    if (!group.dishes.length || !supported(group.presentation)) return <fieldset key={group.id} className={styles.group}><legend>{group.name}</legend><p>{!group.dishes.length ? "No dishes for this date." : "These selection rules are not available to preview for this site."}</p></fieldset>;
    const customerDishes = group.dishes.map(reference => { const dish = display(reference); return { id: dish.id, name: dish.name, description: dish.customerDescription }; });
    return renderStudioDishChoiceControls(createElement, { label: group.name, presentation: group.presentation, dishes: customerDishes,
      groups: [{ id: group.id, name: group.name, presentation: group.presentation, dishIds: customerDishes.map(dish => dish.id) }],
      quantities, dropdownChoices: selected,
      onDropdownChange: (id, dishId) => { setSelected(previous => ({ ...previous, [id]: dishId })); setQuantities({}); },
      onQuantityChange: (dishId, quantity) => setQuantities(previous => ({ ...previous, [dishId]: quantity })),
      fieldClassName: styles.group, rowClassName: styles.row });
  })}<StudioField label="Guests"><input type="number" min="1" step="1" value={guests} onChange={event => setGuests(event.target.value)} /></StudioField>
    <p aria-live="polite">{!allSupported ? "Selection rules are unavailable for this menu." : !evaluation.validSelection ? `Choose dishes with at least ${offering.minimumDishQuantity ?? 1} units per selection.` : evaluation.totalQuantity < minimums.quantity ? `Order at least ${minimums.quantity} units.` : !evaluation.validGuests ? `Enter at least ${minimums.guests} guests.` : "Selection meets the preview minimums."}</p>
    {evaluation.netTotal !== undefined && <p>Estimated menu total: {new Intl.NumberFormat("en-GB", { style: "currency", currency: offering.price.currency }).format(evaluation.netTotal)} before VAT.</p>}
    <p className={styles.note}>This standard scenario does not verify customer-specific rules, service time, other booking choices or publication. Preview selections do not create a booking or change availability.</p></div>;
}
