"use client";

import { useEffect, useState } from "react";
import type { ProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";
import type { StudioChoicePresentation, StudioPreviewOffering } from "../../shared/hospitality-menu-studio-selection";
import { productMenuDishKey, type ProductMenuDish, type ProductMenuDishReference } from "../lib/product-menu-dishes";
import { menuChoiceReferences } from "./product-menu-editor-model";
import { previewChoices, previewScopeMatches } from "./product-menu-preview-model";
import { StudioField, StudioPanel, StudioStatus } from "./studio-design-system";
import { useProductMenuDishes } from "./use-product-menu-dishes";
import styles from "./product-menu-preview.module.css";

type Site = { id: string; name: string };
type Load<T> = { status: "loading" } | { status: "error" } | { status: "ready"; value: T };

export function ProductMenuPreview({ itemId, productName, configuration, library, onEditWeek }: {
  itemId: string; productName: string; configuration: ProductMenuConfiguration; library: ProductMenuDish[]; onEditWeek: (week: number) => void;
}) {
  const [sites, setSites] = useState<Load<Site[]>>({ status: "loading" });
  const [siteId, setSiteId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [siteAttempt, setSiteAttempt] = useState(0);
  const [offeringAttempt, setOfferingAttempt] = useState(0);
  const [offering, setOffering] = useState<Load<StudioPreviewOffering> | null>(null);
  const dateChoices = previewChoices(configuration, eventDate);
  const references = dateChoices ? menuChoiceReferences(dateChoices.choices) : [];
  const assigned = useProductMenuDishes(references, library);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/studio?list=catalogue", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json() as { sites?: Site[] };
        if (!Array.isArray(body.sites) || body.sites.some(site => typeof site.id !== "string" || typeof site.name !== "string")) throw new Error();
        if (!controller.signal.aborted) setSites({ status: "ready", value: body.sites });
      } catch { if (!controller.signal.aborted) setSites({ status: "error" }); }
    }
    void load();
    return () => controller.abort();
  }, [siteAttempt]);

  useEffect(() => {
    if (!siteId || !dateChoices) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ itemId, siteId, eventDate });
    setOffering({ status: "loading" });
    async function load() {
      try {
        const response = await fetch(`/api/studio/product-preview?${query}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const value = await response.json() as StudioPreviewOffering;
        if (!previewScopeMatches(value, itemId, siteId, eventDate) || !["priced", "quote-only", "unavailable"].includes(value.state)) throw new Error();
        if (!controller.signal.aborted) setOffering({ status: "ready", value });
      } catch { if (!controller.signal.aborted) setOffering({ status: "error" }); }
    }
    void load();
    return () => controller.abort();
  }, [itemId, siteId, eventDate, Boolean(dateChoices), offeringAttempt]);

  const current = offering?.status === "ready" && previewScopeMatches(offering.value, itemId, siteId, eventDate) ? offering.value : null;
  const ready = current?.state === "priced" && dateChoices && !assigned.loading && !assigned.error && references.every(reference => assigned.byRevision.has(productMenuDishKey(reference)));
  const selectionKey = JSON.stringify([itemId, siteId, eventDate, configuration, current?.state]);

  return <StudioPanel title="Customer preview" description="Try this draft without creating a booking." className={styles.preview}>
    <StudioStatus tone="warning">Draft · not bookable</StudioStatus>
    <h3>{productName}</h3>
    {sites.status === "loading" && <p role="status">Loading sites…</p>}
    {sites.status === "error" && <p role="alert">Sites could not be verified. <button type="button" onClick={() => { setSites({ status: "loading" }); setSiteAttempt(value => value + 1); }}>Try again</button></p>}
    {sites.status === "ready" && <StudioField label="Preview site"><select value={siteId} onChange={event => { setOffering(null); setSiteId(event.target.value); }}><option value="">Choose a site</option>{sites.value.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></StudioField>}
    <StudioField label="Preview date"><input type="date" value={eventDate} onChange={event => { setOffering(null); setEventDate(event.target.value); }} /></StudioField>
    {dateChoices && "week" in dateChoices && <p>Previewing week {dateChoices.week} for this date. <button type="button" onClick={() => onEditWeek(dateChoices.week - 1)}>Edit this week</button></p>}
    {siteId && eventDate && !dateChoices && <p role="alert">Choose a valid date.</p>}
    {siteId && dateChoices && (!offering || offering.status === "loading" || (offering.status === "ready" && !current)) && <p role="status">Checking site and date…</p>}
    {siteId && dateChoices && offering?.status === "error" && <p role="alert">Site and date rules could not be verified. <button type="button" onClick={() => { setOffering({ status: "loading" }); setOfferingAttempt(value => value + 1); }}>Try again</button></p>}
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
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const groups = configuration.groups.length ? configuration.groups.map(group => ({ id: group.id, name: group.name, presentation: group.presentation || configuration.presentation, dishes: choices.groups.find(slot => slot.groupId === group.id)?.dishes || [] })) : [{ id: "menu", name: "Dishes", presentation: configuration.presentation, dishes: choices.dishes }];
  const supported = (mode: StudioChoicePresentation) => offering.supportedPresentations.includes(mode) && (!configuration.groups.length || mode === "quantities");
  function display(reference: ProductMenuDishReference) { return dishes.get(productMenuDishKey(reference))!; }
  return <div className={styles.choices}>{groups.map(group => <fieldset key={group.id} className={styles.group}>
    <legend>{group.name}</legend>
    {!group.dishes.length ? <p>No dishes for this date.</p> : !supported(group.presentation) ? <p>These selection rules are not available to preview for this site.</p> : group.presentation === "dropdown" ?
      <StudioField label={`Choose ${group.name}`}><select value={selected[group.id] || ""} onChange={event => setSelected(previous => ({ ...previous, [group.id]: event.target.value }))}><option value="">Choose a dish</option>{group.dishes.map(reference => <option key={productMenuDishKey(reference)} value={productMenuDishKey(reference)}>{display(reference).name}</option>)}</select></StudioField> :
      group.presentation === "quantities" ? <><p>Enter a quantity for each dish.{offering.minimumDishQuantity ? ` Minimum ${offering.minimumDishQuantity} per selected dish.` : ""}</p>{group.dishes.map(reference => {
        const key = productMenuDishKey(reference), dish = display(reference);
        return <label key={key} className={styles.row}><span><strong>{dish.name}</strong>{dish.customerDescription && <span>{dish.customerDescription}</span>}</span><input aria-label={`Quantity for ${dish.name}`} type="number" min="0" step="1" value={quantities[key] || ""} onChange={event => setQuantities(previous => ({ ...previous, [key]: event.target.value }))} /></label>;
      })}</> : <p>Multiple selection is unavailable until its ordering rules are verified.</p>}
  </fieldset>)}<p className={styles.note}>Preview selections are temporary and do not create a booking or change availability.</p></div>;
}
