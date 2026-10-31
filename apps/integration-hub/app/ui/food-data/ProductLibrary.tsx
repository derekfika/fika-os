"use client";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { buildIngredientIndex, type IngredientIndex, type IngredientRecord, type IngredientSearchField } from "@/lib/food-data/ingredients";
import type { FoodManifest } from "@/lib/food-data/manifest";
import styles from "./food-data.module.css";
import VirtualList from "./VirtualList";
import { Allergens, Field, Nutrition, blank, gbp, gbpPrecise, integer } from "./shared";

const searchFields: [IngredientSearchField, string][] = [["all", "All fields"], ["name", "Product name"], ["supplier", "Supplier"], ["supplierCode", "Supplier code"], ["productCode", "Product code"], ["brand", "Brand"], ["category", "Product category"]];
const COLS = "minmax(0,3fr) minmax(0,2fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr)";

export function useIngredientIndex(records: IngredientRecord[]) { return useMemo<IngredientIndex>(() => buildIngredientIndex(records), [records]); }

function packLabel(record: IngredientRecord) { const { packQuantity, unit } = record.pricing; return packQuantity === null ? "—" : `${packQuantity} ${unit}`.trim(); }

export default function ProductLibrary({ index, manifest }: { index: IngredientIndex; manifest: FoodManifest }) {
  const [text, setText] = useState(""); const [field, setField] = useState<IngredientSearchField>("all");
  const [supplier, setSupplier] = useState(""); const [category, setCategory] = useState(""); const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<number | undefined>();
  const deferredText = useDeferredValue(text);
  const detail = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => index.search({ text: deferredText, field, supplier, category, status }), [index, deferredText, field, supplier, category, status]);
  const filtered = Boolean(text || supplier || category || status);
  const activeIndex = selected === undefined ? -1 : matches.indexOf(selected);
  const record = activeIndex === -1 || selected === undefined ? undefined : index.records[selected];

  return <section aria-label="Product and Supplier Library">
    <form className={styles.toolbar} role="search" onSubmit={event => event.preventDefault()}>
      <Field id="pl-search" label="Search products"><input id="pl-search" type="search" value={text} onChange={event => setText(event.target.value)} autoComplete="off" /></Field>
      <Field id="pl-field" label="Search in"><select id="pl-field" value={field} onChange={event => setField(event.target.value as IngredientSearchField)}>{searchFields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field id="pl-supplier" label="Supplier"><select id="pl-supplier" value={supplier} onChange={event => setSupplier(event.target.value)}><option value="">All suppliers</option>{index.suppliers.map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field id="pl-category" label="Product category"><select id="pl-category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{index.categories.map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field id="pl-status" label="Purchase status"><select id="pl-status" value={status} onChange={event => setStatus(event.target.value)}><option value="">Any status</option>{index.statuses.map(value => <option key={value}>{value}</option>)}</select></Field>
      <button type="button" className={styles.button} disabled={!filtered} onClick={() => { setText(""); setSupplier(""); setCategory(""); setStatus(""); setField("all"); }}>Clear filters</button>
    </form>
    <p className={styles.count} aria-live="polite" role="status">{integer.format(matches.length)} of {integer.format(index.records.length)} product records{filtered ? " match" : ""}. Duplicate source rows are kept and shown separately.</p>
    <div className={styles.layout}>
      <div className={styles.listCard}>
        <div className={styles.listHead} style={{ ["--cols" as string]: COLS, ["--colsSmall" as string]: "minmax(0,3fr) minmax(0,1.5fr)" }} aria-hidden="true"><span>Product</span><span>Supplier</span><span className={styles.hideSmall}>Supplier code</span><span className={styles.hideSmall}>Pack</span><span className={`${styles.num} ${styles.hideSmall}`}>Pack price inc VAT</span></div>
        {matches.length === 0
          ? <div className={styles.state}><h2>No products match</h2><p>Try a shorter search, a different field, or clear the filters.</p></div>
          : <VirtualList count={matches.length} label="Products" key={`${deferredText}|${field}|${supplier}|${category}|${status}`} activeIndex={activeIndex === -1 ? undefined : activeIndex} onActivate={position => { setSelected(matches[position]); detail.current?.focus(); }}
              renderRow={(position, props) => {
                const item = index.records[matches[position]];
                return <button type="button" {...props} style={{ ["--cols" as string]: COLS, ["--colsSmall" as string]: "minmax(0,3fr) minmax(0,1.5fr)" }}>
                  <span className={`${styles.cell} ${styles.cellStrong}`}>{item.name || "(no name)"}{item.status && item.status !== "Active" ? <span className={`${styles.badge} ${styles.badgeWarn}`} style={{ marginLeft: 8 }}>{item.status}</span> : null}</span>
                  <span className={styles.cell}>{item.supplier || "—"}</span>
                  <span className={`${styles.cell} ${styles.hideSmall}`}>{item.supplierCode || "—"}</span>
                  <span className={`${styles.cell} ${styles.hideSmall}`}>{packLabel(item)}</span>
                  <span className={`${styles.cell} ${styles.num} ${styles.hideSmall}`}>{item.pricing.priceIncVat === null ? "—" : gbp.format(item.pricing.priceIncVat)}</span>
                </button>;
              }} />}
      </div>
      <div className={styles.detail} ref={detail} tabIndex={-1} role="region" aria-label="Product detail">
        {record ? <ProductDetail record={record} manifest={manifest} /> : <div><h2>Product detail</h2><p className={styles.muted}>Select a product to see its supplier, pack, price, allergen and nutrition data as exported from Kafoodle.</p></div>}
      </div>
    </div>
  </section>;
}

function ProductDetail({ record, manifest }: { record: IngredientRecord; manifest: FoodManifest }) {
  const { pricing } = record;
  return <div>
    <h2>{record.name || "(no name)"}</h2>
    <p className={styles.muted} style={{ margin: 0 }}>{record.brand || "No brand in source"}{record.status ? ` · ${record.status}` : ""}{record.locked === "Y" ? " · Locked in Kafoodle" : ""}</p>
    <h3>Supplier and codes</h3>
    <dl className={styles.dl}>
      <dt>Supplier</dt><dd>{blank(record.supplier)}</dd>
      <dt>Supplier code</dt><dd>{blank(record.supplierCode)}</dd>
      <dt>Product code</dt><dd>{blank(record.productCode)}</dd>
      <dt>Category</dt><dd>{blank(record.category)}</dd>
      <dt>Customer facing name</dt><dd>{blank(record.customerFacingName)}</dd>
      <dt>Origin</dt><dd>{blank(record.origin)}</dd>
    </dl>
    <h3>Pack and price</h3>
    <dl className={styles.dl}>
      <dt>Pack quantity</dt><dd>{pricing.packQuantity === null ? <span className={styles.muted}>Not in source</span> : `${pricing.packQuantity} ${pricing.unit}`.trim()}</dd>
      <dt>Pack price (inc VAT, source)</dt><dd>{pricing.priceIncVat === null ? <span className={styles.muted}>Not in source</span> : gbp.format(pricing.priceIncVat)}</dd>
      <dt>VAT rate (source)</dt><dd>{pricing.vatRate === null ? <span className={styles.muted}>Not in source</span> : `${pricing.vatRate}%`}</dd>
      <dt>Pack price ex VAT (calculated)</dt><dd>{pricing.priceExVat === null ? <span className={styles.muted}>Not calculated</span> : gbpPrecise.format(pricing.priceExVat)}</dd>
      <dt>Unit cost (calculated)</dt><dd>{pricing.unitCost ? <>{gbpPrecise.format(pricing.unitCost.incVat)} per {pricing.unitCost.per} inc VAT{pricing.unitCost.exVat !== null && <><br />{gbpPrecise.format(pricing.unitCost.exVat)} per {pricing.unitCost.per} ex VAT</>}</> : <span className={styles.muted}>Not calculated</span>}</dd>
    </dl>
    {pricing.unitCostNote && <p className={styles.muted} style={{ fontSize: "var(--text-xs)" }}>{pricing.unitCostNote}</p>}
    <p className={`${styles.note} ${styles.noteWarn}`}>Price-effective date: unknown. Prices are a quarterly Kafoodle baseline and are not live supplier prices.</p>
    <h3>Allergens</h3>
    <Allergens allergens={record.allergens} recorded={record.allergensRecorded} />
    <h3>Nutrition</h3>
    <Nutrition items={record.nutrition} basis="Values exactly as exported. The export does not state the quantity they are per." />
    <h3>Dietary flags (as exported)</h3>
    <ul className={styles.chips}>{record.diets.map(diet => <li key={diet.label} className={styles.badge}>{diet.label}: {diet.value.trim() === "" ? "blank" : diet.value === "Y" ? "Yes" : diet.value === "N" ? "No" : diet.value}</li>)}</ul>
    <h3>Ingredient declaration</h3>
    <p style={{ margin: 0, overflowWrap: "anywhere" }}>{record.declaration.trim() === "" ? <span className={styles.muted}>No declaration in source.</span> : record.declaration}</p>
    <h3>Source metadata</h3>
    <dl className={styles.dl}>
      <dt>Source</dt><dd>Kafoodle export, snapshot {manifest.snapshot}</dd>
      <dt>Source row</dt><dd>{record.index + 1}</dd>
      <dt>Linked recipe name</dt><dd>{blank(record.linkedRecipeName)}</dd>
    </dl>
  </div>;
}
