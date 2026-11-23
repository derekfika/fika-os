import { useEffect, useRef, useState } from "react";

import { Button, PageHeading, Pill } from "./studio-ui";

import styles from "./studio.module.css";



import type { CataloguePayload as Payload, CataloguePrice as Price } from "./catalogue-wire";

const money = (price?: Price) => price ? `Â£${price.amount.toFixed(2)} Â· VAT ${price.vatRate * 100}% Â· effective ${price.effectiveFrom}` : "No company price recorded";

const words = (value: string) => value.replaceAll("_", " ");



export function CatalogueView({ area, initialItemId, back }: { area: "products" | "sites"; initialItemId?: string; back?: () => void }) {

  const [data, setData] = useState<Payload | null>(null);

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(true);

  const [attempt, setAttempt] = useState(0);

  const [search, setSearch] = useState("");

  const [itemId, setItemId] = useState(initialItemId || "");

  const [siteId, setSiteId] = useState("");

  const [serviceId, setServiceId] = useState("");

  const [eventDate, setEventDate] = useState("");

  const [verification, setVerification] = useState("");

  const [checking, setChecking] = useState(false);

  const selection = useRef("");

  selection.current = JSON.stringify([itemId, siteId, serviceId, eventDate]);

  useEffect(() => { setVerification(""); }, [itemId, siteId, serviceId, eventDate]);

  async function verify() {

    const requestedSelection = selection.current;

    setChecking(true); setVerification("");

    try {

      const query = new URLSearchParams({ itemId, siteId, serviceId, eventDate });

      const response = await fetch(`/api/catalogue/availability?${query}`, { cache: "no-store" });

      if (!response.ok) throw new Error();

      const result = await response.json();

      if (!["standard", "quote_only", "unavailable"].includes(result.status)) throw new Error();

      if (selection.current !== requestedSelection) return;

      setVerification(`Verified catalogue result: ${words(result.status)}${result.reason ? ` · ${result.reason}` : ""}${typeof result.amount === "number" ? ` · £${result.amount.toFixed(2)}` : ""}${typeof result.vatRate === "number" ? ` · VAT ${result.vatRate * 100}%` : ""}. Booking acceptance is checked separately.`);

    } catch { if (selection.current === requestedSelection) setVerification("Availability could not be verified. Booking eligibility remains unknown."); } finally { setChecking(false); }

  }

  useEffect(() => { setItemId(initialItemId || ""); }, [initialItemId]);

  useEffect(() => {

    const controller = new AbortController();

    setLoading(true); setError(""); setData(null);

    fetch("/api/catalogue", { cache: "no-store", signal: controller.signal }).then(async response => {

      if (!response.ok) throw new Error("Catalogue access is unavailable. Check your access or try again.");

      const value = await response.json();

      if (!Array.isArray(value.rows) || !Array.isArray(value.oplocs)) throw new Error("Catalogue information is unavailable. Try again.");

      setData(value);

    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message || "Catalogue information is unavailable."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();

  }, [attempt]);

  const selected = data?.rows.find(row => row.itemId === itemId);

  const sites = data?.oplocs.filter(site => site.active) || [];

  const offering = selected?.offerings.find(row => row.oplocId === siteId && row.available && row.status === "active");

  const layout = data?.serviceLayout;

  const companyRules = layout?.company.services;

  const siteRules = layout?.sites[siteId]?.services;

  return <>

    <PageHeading title={area === "products" ? "Products & pricing" : "Sites & services"}>{back && <Button onClick={back}>Back to section</Button>}</PageHeading>

    <p>Products control commercial settings. Menu sections control the dishes and rotation linked to them.</p>

    {loading && <p role="status">Loading catalogueâ€¦</p>}

    {error && <div className="fika-notice fika-notice--danger" role="alert">{error} <Button onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>}

    {data && <div className={styles.panelBody}>

      <label className="fika-field">Search products<input className="fika-input" type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>

      <label className="fika-field">Product<select className="fika-select" value={itemId} onChange={event => setItemId(event.target.value)}><option value="">Choose a product</option>{data.rows.filter(row => row.itemId === itemId || `${row.name} ${row.category}`.toLocaleLowerCase("en-GB").includes(search.toLocaleLowerCase("en-GB"))).map(row => <option key={row.itemId} value={row.itemId}>{row.name} Â· {row.category} Â· {row.status}</option>)}</select></label>

      {itemId && !selected && <p role="status">This mapped item is not present in the current catalogue. Its saved mapping is retained.</p>}

      {!data.rows.length && <p>No products are available.</p>}

      {selected && <section aria-label="Product details"><h2>{selected.name}</h2><Pill>{words(selected.status)}</Pill><p>{selected.description || "No description recorded"}</p><p>Category: {selected.category}</p><p>Company price: {money(selected.defaultPrice)}</p><p>Company minimum: {selected.defaultMinimumQuantity ?? "Not set"}</p>{selected.defaultMode === "quote_only" && <p>Company default: quote only</p>}<p>Production routing: {words(selected.routing.state)}</p>{selected.needsReview.length > 0 && <p>Needs review: {selected.needsReview.map(words).join(", ")}</p>}</section>}

      {area === "sites" && <><label className="fika-field">Site<select className="fika-select" value={siteId} onChange={event => setSiteId(event.target.value)}><option value="">Choose a site</option>{sites.map(site => <option key={site.oplocId} value={site.oplocId}>{site.label}</option>)}</select></label>

        {selected && siteId && <section aria-label="Site availability"><h2>Site availability</h2><p>{selected.availableAt.includes(siteId) ? "Configured as available" : "Not configured as available"}</p><p>Price: {offering ? `${words(offering.price.source)}${offering.price.effective ? ` Â· ${money(offering.price.effective)}` : ""}` : `Company default Â· ${money(selected.defaultPrice)}`}</p><p>Minimum: {offering ? `${words(offering.minimum.source)}${offering.minimum.effective != null ? ` Â· ${offering.minimum.effective}` : ""}` : `Company default Â· ${selected.defaultMinimumQuantity ?? "Not set"}`}</p>{offering?.mode === "quote_only" && <p>Quote only</p>}</section>}

        {selected && siteId && companyRules && <section aria-label="Verify catalogue availability"><h2>Verify catalogue availability</h2><label className="fika-field">Booking service<select className="fika-select" value={serviceId} onChange={event => setServiceId(event.target.value)}><option value="">Choose a service</option>{Object.keys(companyRules).map(id => <option key={id} value={id}>{words(id)}</option>)}</select></label><label className="fika-field">Event date<input className="fika-input" type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} /></label><Button disabled={!serviceId || !eventDate || checking} onClick={() => void verify()}>{checking ? "Checking…" : "Check availability"}</Button>{verification && <p role="status">{verification}</p>}</section>}

        {siteId && <section aria-label="Booking service configuration"><h2>Booking services</h2><p>These are configured category permissions, not verification that a product is orderable. Check a site and event date in Customer preview for availability.</p>{!companyRules ? <p role="status">Service configuration is unavailable.</p> : Object.entries(companyRules).map(([id, company]) => { const rule = siteRules?.[id] || company; return <div key={id}><h3>{words(id)}</h3><p>{rule.hidden ? "Hidden" : "Visible"} Â· {siteRules?.[id] ? "Site override" : "Company default"}</p><p>Categories in order: {rule.categories.join(", ") || "None"}</p>{selected && <p>{rule.hidden ? "Service hidden" : rule.categories.includes(selected.category) ? "Product category configured for this service" : "Product category not configured for this service"}</p>}</div>; })}</section>}</>}

    </div>}

  </>;

}
