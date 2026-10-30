"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Plus, Search, X } from "lucide-react";
import ConfirmationModal from "./ConfirmationModal";
import "./HospitalityCatalogue.css";
import {
  ROUTING_CHOICES, ROUTING_CHOICE_LABELS, ROUTING_STATE_LABELS,
  type CatalogueOfferingView, type CataloguePayload, type CatalogueRow, type ReviewGroupView, type RoutingChoice,
} from "../../lib/hospitality-catalogue-types";
import { EMPTY_FILTERS, bulkImpact, categoriesOf, formatMoney, oplocLabel, pruneSelection, rowMatches, selectAllShown, selectableRows, selectableSites, sitesSummary, sortRows, summariseCounts, toggleSelection, withDuplicateFlag, type BulkDraft, type CatalogueFilters, type Sort, type SortKey } from "../../lib/hospitality-catalogue-view";

type Command = Record<string, unknown> & { action: string };
type ApiBody = { error?: { message?: string }; message?: string; rows?: CatalogueRow[]; payload?: CataloguePayload; bulk?: BulkResultView } & Partial<CataloguePayload>;
type BulkResultView = { operationId: string; results: Array<{ itemId: string; status: "applied" | "unchanged" | "already_applied" | "failed"; message: string }>; succeeded: number; failed: number; message: string };
type Send = (command: Command) => Promise<{ message: string; bulk?: BulkResultView }>;

const sentence = (value: string) => value.charAt(0).toLocaleUpperCase("en-GB") + value.slice(1);
const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function RoutingBadge({ state }: { state: CatalogueRow["routing"]["state"] }) {
  const tone = state === "routing_required" ? "warning" : state === "routing_conflict" ? "danger" : "neutral";
  return <span className={`hc-badge hc-badge--${tone}`}>{state === "routing_required" && <AlertTriangle size={13} aria-hidden="true" />}{state === "routing_required" ? "ROUTING REQUIRED" : ROUTING_STATE_LABELS[state]}</span>;
}

/** INHERITS / OVERRIDES are always spelled out; colour is never the only signal. */
export function SourceTag({ source }: { source: "inherits" | "overrides" | "site_only" | "none" | "quote_only" }) {
  const label = source === "inherits" ? "INHERITS" : source === "overrides" ? "OVERRIDES" : source === "site_only" ? "SITE VALUE" : source === "quote_only" ? "QUOTE ONLY" : "NOT SET";
  return <span className={`hc-tag hc-tag--${source}`}>{label}</span>;
}

const availability = sitesSummary;
const minimumLabel = (row: CatalogueRow) => (row.defaultMinimumQuantity !== undefined ? String(row.defaultMinimumQuantity) : "—");
const priceLabel = (row: CatalogueRow) => (row.defaultPrice ? formatMoney(row.defaultPrice.amount) : row.offerings.some(offering => offering.mode === "standard" && offering.status === "active") ? "Not set" : "—");

export default function HospitalityCatalogue({ refreshSession }: { refreshSession: () => Promise<boolean> }) {
  const [payload, setPayload] = useState<CataloguePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<CatalogueFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<Sort>({ key: "name", direction: "asc" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState<ReviewGroupView | null>(null);
  const [notice, setNotice] = useState("");
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<null | "edit" | "archive">(null);
  const [bulkReport, setBulkReport] = useState<BulkResultView | null>(null);

  const request = useCallback(async (init?: RequestInit) => {
    const send = () => fetch("/api/hospitality-catalogue", { cache: "no-store", ...init });
    let response = await send();
    if (response.status === 401 && (await refreshSession())) response = await send();
    const text = await response.text();
    let body: ApiBody; try { body = JSON.parse(text) as ApiBody; } catch { throw new Error("The catalogue service returned an unreadable response. Reload and try again."); }
    if (!response.ok) throw new Error(body?.error?.message || "The catalogue request failed.");
    return body;
  }, [refreshSession]);

  useEffect(() => {
    let live = true;
    request().then(body => { if (live) setPayload(body as CataloguePayload); }).catch(caught => { if (live) setError((caught as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [request]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setPayload(await request() as CataloguePayload); } catch (caught) { setError((caught as Error).message); } finally { setLoading(false); }
  }, [request]);

  const send: Send = useCallback(async command => {
    const body = await request({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
    setPayload(current => {
      if (body.payload) return body.payload as CataloguePayload;
      if (!current) return current;
      const fresh = new Map<string, CatalogueRow>((body.rows as CatalogueRow[]).map(row => [row.itemId, withDuplicateFlag(row, current.reviewGroups)]));
      const existing = new Set(current.rows.map(row => row.itemId));
      const rows = [...current.rows.map(row => fresh.get(row.itemId) || row), ...[...fresh.values()].filter(row => !existing.has(row.itemId))];
      return { ...current, rows, counts: summariseCounts(rows) };
    });
    setNotice(body.message ?? "");
    return { message: body.message ?? "", ...(body.bulk ? { bulk: body.bulk } : {}) };
  }, [request]);

  const rows = useMemo(() => payload?.rows ?? [], [payload]);
  const visible = useMemo(() => sortRows(rows.filter(row => rowMatches(row, filters)), sort), [rows, filters, sort]);
  const selected = rows.find(row => row.itemId === selectedId) || null;
  const chosen = useMemo(() => pruneSelection(selectedIds, visible), [selectedIds, visible]);
  const chosenRows = visible.filter(row => chosen.has(row.itemId));
  const selectableShown = selectableRows(visible);
  const statusBase = rows.filter(row => filters.status === "all" || row.status === filters.status).length;
  const countText = visible.length === statusBase
    ? (filters.status === "active" ? `${visible.length} active items` : filters.status === "archived" ? `${visible.length} archived items` : `${visible.length} items (including ${payload?.counts.archived ?? 0} archived)`)
    : `${visible.length} of ${statusBase} ${filters.status === "all" ? "" : `${filters.status} `}items shown`;
  const canManage = Boolean(payload?.canManage);
  const setSortKey = (key: SortKey) => setSort(current => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const update = (patch: Partial<CatalogueFilters>) => setFilters(current => ({ ...current, ...patch }));
  const openGroups = (payload?.reviewGroups ?? []).filter(group => group.decision !== "keep_separate" && group.decision !== "merge");

  if (loading && !payload) return <section className="hc" aria-busy="true"><header className="hc-header"><h1>Hospitality Catalogue</h1></header><p role="status" className="hc-state">Loading the catalogue…</p></section>;
  if (error && !payload) return <section className="hc"><header className="hc-header"><h1>Hospitality Catalogue</h1></header><div role="alert" className="hc-alert"><strong>The catalogue could not be loaded.</strong><span>{error}</span><button type="button" className="hc-btn" onClick={() => void load()}>Try again</button></div></section>;
  if (!payload) return null;

  const sortHeader = (key: SortKey, label: string) => <th scope="col" aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className="hc-sort" onClick={() => setSortKey(key)}>{label}{sort.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}</button></th>;

  return <section className="hc" aria-labelledby="hc-title">
    <header className="hc-header">
      <div><h1 id="hc-title">Hospitality Catalogue</h1><p>One company-wide list of hospitality products. Each product has one production route, company default price and minimum, and sites can override price or minimum where needed.</p></div>
      {canManage && <button type="button" className="hc-btn hc-btn--primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add item</button>}
    </header>

    <div className="hc-summary" role="group" aria-label="Catalogue summary">
      <span><strong>{payload.counts.active}</strong> active</span>
      <button type="button" className={`hc-chip ${filters.needsReview ? "is-on" : ""}`} aria-pressed={filters.needsReview} onClick={() => update({ needsReview: !filters.needsReview })}>Needs review <strong>{payload.counts.needsReview}</strong></button>
      <button type="button" className={`hc-chip ${filters.route === "routing_required" ? "is-on" : ""}`} aria-pressed={filters.route === "routing_required"} onClick={() => update({ route: filters.route === "routing_required" ? "all" : "routing_required" })}>Routing required <strong>{payload.counts.routingRequired}</strong></button>
      {payload.counts.archived > 0 && <button type="button" className={`hc-chip ${filters.status === "archived" ? "is-on" : ""}`} aria-pressed={filters.status === "archived"} onClick={() => update({ status: filters.status === "archived" ? "active" : "archived" })}>Archived <strong>{payload.counts.archived}</strong></button>}
      {!canManage && <span className="hc-viewonly">View only</span>}
    </div>

    {payload.canonicalisation.itemsAwaitingConsolidation > 0 ? <p className="hc-note" role="note">{payload.canonicalisation.itemsAwaitingConsolidation} items are duplicates of the same products and are waiting to be consolidated by the approved catalogue migration. You can keep working in the meantime.</p>
      : payload.counts.archived > 0 && filters.status === "active" && <p className="hc-hint">{payload.counts.archived} historical item records were archived during catalogue consolidation. Use Archived above to view them.</p>}
    {notice && <p className="hc-success" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {notice}</p>}
    {error && <div role="alert" className="hc-alert"><span>{error}</span></div>}

    {openGroups.length > 0 && <section className="hc-duplicates" aria-labelledby="hc-dupe-title">
      <button type="button" className="hc-disclosure" aria-expanded={showDuplicates} onClick={() => setShowDuplicates(value => !value)}><span id="hc-dupe-title">Possible duplicates to review ({openGroups.length})</span></button>
      {showDuplicates && <ul className="hc-dupe-list">{openGroups.map(group => {
        const names = group.memberIds.map(id => rows.find(row => row.itemId === id)?.name || "Unknown item");
        return <li key={group.id}><span><strong>{names.join(" / ")}</strong><small>{sentence(group.reasons[0])}{group.decision === "defer" ? " · Deferred" : ""}</small></span><button type="button" className="hc-btn" onClick={() => setReviewing(group)}>{canManage ? "Review" : "View"}</button></li>;
      })}</ul>}
    </section>}

    <form className="hc-toolbar" role="search" onSubmit={event => event.preventDefault()}>
      <label className="hc-search"><span>Search</span><div><Search size={16} aria-hidden="true" /><input type="search" value={filters.query} onChange={event => update({ query: event.target.value })} placeholder="Name, category or supplier reference" /></div></label>
      <label><span>Category</span><select value={filters.category} onChange={event => update({ category: event.target.value })}><option value="">All categories</option>{categoriesOf(rows).map(category => <option key={category} value={category}>{category}</option>)}</select></label>
      <label><span>Production</span><select value={filters.route} onChange={event => update({ route: event.target.value as CatalogueFilters["route"] })}><option value="all">All routes</option>{ROUTING_CHOICES.map(choice => <option key={choice} value={choice}>{ROUTING_CHOICE_LABELS[choice]}</option>)}<option value="routing_required">Routing required</option><option value="routing_conflict">Routing conflict</option></select></label>
      <label><span>Site</span><select value={filters.oplocId} onChange={event => update({ oplocId: event.target.value })}><option value="">All sites</option>{payload.oplocs.filter(oploc => oploc.active).map(oploc => <option key={oploc.oplocId} value={oploc.oplocId}>{oploc.label}</option>)}</select></label>
      <label><span>Status</span><select value={filters.status} onChange={event => update({ status: event.target.value as CatalogueFilters["status"] })}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label>
      <label><span>Sort by</span><select value={`${sort.key}:${sort.direction}`} onChange={event => { const [key, direction] = event.target.value.split(":"); setSort({ key: key as SortKey, direction: direction as Sort["direction"] }); }}><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="category:asc">Category</option><option value="production:asc">Production</option><option value="price:asc">Price low–high</option><option value="price:desc">Price high–low</option></select></label>
      <fieldset className="hc-checks"><legend className="hc-sr">More filters</legend>
        <label><input type="checkbox" checked={filters.hasOverrides} onChange={event => update({ hasOverrides: event.target.checked })} /> Has site overrides</label>
        <label><input type="checkbox" checked={filters.needsReview} onChange={event => update({ needsReview: event.target.checked })} /> Needs review</label>
        <label><input type="checkbox" checked={filters.priceNotSet} onChange={event => update({ priceNotSet: event.target.checked })} /> Company default price not set</label>
      </fieldset>
      <button type="button" className="hc-btn hc-btn--text" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
    </form>

    <p className="hc-count" role="status" aria-live="polite">{countText}</p>

    {canManage && chosen.size > 0 && <div className="hc-bulkbar" role="region" aria-label="Bulk actions">
      <strong>{chosen.size} item{chosen.size === 1 ? "" : "s"} selected</strong>
      <span className="hc-bulkbar__scope">{chosen.size === selectableShown.length ? `All ${selectableShown.length} filtered items` : `of ${selectableShown.length} filtered`}</span>
      <div className="hc-bulkbar__actions">
        <button type="button" className="hc-btn" onClick={() => setBulk("edit")}>Production</button>
        <button type="button" className="hc-btn" onClick={() => setBulk("edit")}>Price</button>
        <button type="button" className="hc-btn" onClick={() => setBulk("edit")}>Minimum</button>
        <button type="button" className="hc-btn" onClick={() => setBulk("edit")}>Sites</button>
        <button type="button" className="hc-btn hc-btn--danger" onClick={() => setBulk("archive")}>Archive</button>
        <button type="button" className="hc-btn hc-btn--text" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
      </div>
    </div>}

    {visible.length === 0 ? <div className="hc-empty"><strong>{rows.length === 0 ? "The catalogue is empty." : "No items match these filters."}</strong><span>{rows.length === 0 ? (canManage ? "Use Add item to create the first product." : "Items will appear here once they are added.") : "Clear a filter or change the search to see more items."}</span></div> : <>
      <div className="hc-table-wrap"><table className="hc-table">
        <caption className="hc-sr">Hospitality catalogue items</caption>
        <thead><tr><th scope="col" className="hc-check-col">{canManage && <input type="checkbox" aria-label={`Select all ${selectableShown.length} filtered items`} checked={selectableShown.length > 0 && chosen.size === selectableShown.length} disabled={!selectableShown.length} onChange={event => setSelectedIds(event.target.checked ? selectAllShown(visible) : new Set())} />}</th>{sortHeader("name", "Item")}{sortHeader("category", "Category")}{sortHeader("production", "Production")}{sortHeader("price", "Default price")}<th scope="col">Minimum</th><th scope="col">Available at</th><th scope="col">Overrides</th><th scope="col">Status</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.itemId} className={row.itemId === selectedId ? "is-selected" : ""}>
          <td className="hc-check-col">{canManage && row.status === "active" && <input type="checkbox" aria-label={`Select ${row.name}`} checked={chosen.has(row.itemId)} onChange={() => setSelectedIds(toggleSelection(chosen, row.itemId))} />}</td>
          <th scope="row"><button type="button" className="hc-rowlink" onClick={() => setSelectedId(row.itemId)} aria-haspopup="dialog">{row.name}</button>{row.needsReview.length > 0 && <small className="hc-flag">Needs review</small>}</th>
          <td>{row.category}</td><td><RoutingBadge state={row.routing.state} /></td><td className="hc-num">{priceLabel(row)}</td><td className="hc-num">{minimumLabel(row)}</td>
          <td>{availability(row, payload.oplocs)}</td><td className="hc-num">{row.overrideCount || "—"}</td><td><span className={`hc-badge hc-badge--${row.status === "active" ? "ok" : "neutral"}`}>{row.status === "active" ? "Active" : "Archived"}</span></td>
        </tr>)}</tbody>
      </table></div>
      <ul className="hc-cards" aria-label="Hospitality catalogue items">{visible.map(row => <li key={row.itemId}>{canManage && row.status === "active" && <label className="hc-card-check"><input type="checkbox" checked={chosen.has(row.itemId)} onChange={() => setSelectedIds(toggleSelection(chosen, row.itemId))} /> Select {row.name}</label>}<button type="button" className="hc-card" onClick={() => setSelectedId(row.itemId)} aria-haspopup="dialog">
        <strong>{row.name}</strong><span>{row.category}</span><RoutingBadge state={row.routing.state} />
        <dl><div><dt>Default price</dt><dd>{priceLabel(row)}</dd></div><div><dt>Minimum</dt><dd>{minimumLabel(row)}</dd></div><div><dt>Available at</dt><dd>{availability(row, payload.oplocs)}</dd></div><div><dt>Overrides</dt><dd>{row.overrideCount || "None"}</dd></div></dl>
        {row.status === "archived" && <span className="hc-badge hc-badge--neutral">Archived</span>}
      </button></li>)}</ul>
    </>}

    {selected && <ItemPanel key={selected.itemId} row={selected} payload={payload} canManage={canManage} send={send} onClose={() => setSelectedId(null)} />}
    {adding && <AddItemModal payload={payload} send={send} onClose={() => setAdding(false)} />}
    {bulk && <BulkModal mode={bulk} rows={chosenRows} payload={payload} send={send} onClose={() => setBulk(null)} onFinished={report => { setBulkReport(report); setSelectedIds(new Set(report.results.filter(result => result.status === "failed").map(result => result.itemId))); }} />}
    {bulkReport && bulkReport.failed > 0 && !bulk && <div className="hc-alert" role="alert"><strong>{bulkReport.message}</strong><ul>{bulkReport.results.filter(result => result.status === "failed").map(result => <li key={result.itemId}>{rows.find(row => row.itemId === result.itemId)?.name || "Unknown item"}: {result.message}</li>)}</ul><button type="button" className="hc-btn" onClick={() => setBulkReport(null)}>Dismiss</button></div>}
    {reviewing && <ReviewGroupModal group={reviewing} payload={payload} canManage={canManage} send={send} onClose={() => setReviewing(null)} />}
  </section>;
}

/* ------------------------------------------------------------------------------------------------------------ */
function useDialog(onClose: () => void, busy: boolean) {
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  useEffect(() => { busyRef.current = busy; closeRef.current = onClose; });
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current && !document.querySelector(".confirmation-modal")) closeRef.current();
      if (event.key === "Tab" && ref.current) {
        const focusable = [...ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])")].filter(element => element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener.current?.focus(); };
  }, []);
  return ref;
}

/** State that re-initialises when `key` changes (e.g. after a saved version arrives) without an effect. */
function useSyncedState<T>(initial: T, key: string) {
  const [store, setStore] = useState({ key, value: initial });
  let current = store;
  if (store.key !== key) { current = { key, value: initial }; setStore(current); }
  const set = (value: T | ((previous: T) => T)) => setStore(previous => ({ key, value: typeof value === "function" ? (value as (previous: T) => T)(previous.key === key ? previous.value : initial) : value }));
  return [current.value, set] as const;
}

function useAction(send: Send) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (command: Command, after?: () => void) => {
    if (busy) return false;
    setBusy(true); setError("");
    try { await send(command); after?.(); return true; } catch (caught) { setError((caught as Error).message); return false; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

const numberOrUndefined = (value: string) => { const trimmed = value.trim(); if (!trimmed) return undefined; const parsed = Number(trimmed); return Number.isFinite(parsed) ? parsed : NaN; };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="hc-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function RoutingEditor({ row, canManage, send }: { row: CatalogueRow; canManage: boolean; send: Send }) {
  const current = (ROUTING_CHOICES as readonly string[]).includes(row.routing.state) ? row.routing.state as RoutingChoice : undefined;
  const [choice, setChoice] = useSyncedState<RoutingChoice | undefined>(current, `${current}:${row.routing.version}`);
  const { busy, error, run } = useAction(send);
  const unresolved = row.routing.state === "routing_required", conflict = row.routing.state === "routing_conflict";
  return <section className="hc-section" aria-labelledby={`hc-prod-${row.itemId}`}>
    <h3 id={`hc-prod-${row.itemId}`}>Production</h3>
    {unresolved && <p className="hc-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /> <strong>ROUTING REQUIRED.</strong> Bookings containing this item cannot be handed to CPU until you choose a route.</p>}
    {conflict && <p className="hc-warning hc-warning--danger" role="status"><AlertTriangle size={15} aria-hidden="true" /> <strong>Routing conflict.</strong> It is set to both Sandwiches and Hospitality. Choose exactly one route.</p>}
    {unresolved && row.routingSuggestion && <p className="hc-hint">Suggestion from an exact supplier reference: <strong>{ROUTING_CHOICE_LABELS[row.routingSuggestion.choice]}</strong>. {row.routingSuggestion.reason} It has not been applied.</p>}
    <fieldset disabled={!canManage || busy} className="hc-radios"><legend className="hc-sr">Production route</legend>
      {ROUTING_CHOICES.map(option => <label key={option}><input type="radio" name={`route-${row.itemId}`} checked={choice === option} onChange={() => setChoice(option)} /> {ROUTING_CHOICE_LABELS[option]}</label>)}
    </fieldset>
    <p className="hc-hint">This route applies at every site.</p>
    {error && <p role="alert" className="hc-error">{error}</p>}
    {canManage && <button type="button" className="hc-btn hc-btn--primary" disabled={busy || !choice || choice === current} onClick={() => choice && void run({ action: "set-routing", itemId: row.itemId, routing: choice, expectedRoutingVersion: row.routing.version })}>{busy ? "Saving…" : unresolved ? "Confirm route" : "Save route"}</button>}
  </section>;
}

/** One site's sparse exception (or a synthetic inherit-everything view while the operator is about to create one). */
function SiteExceptionEditor({ row, oplocId, offering, label, canManage, send, itemInactive, startOpen = false }: { row: CatalogueRow; oplocId: string; offering?: CatalogueOfferingView; label: string; canManage: boolean; send: Send; itemInactive: boolean; startOpen?: boolean }) {
  const view: CatalogueOfferingView = offering ?? { offeringId: "", version: 0, oplocId, mode: "standard", status: "active", available: true, noEffect: true, price: row.defaultPrice ? { source: "inherits", effective: row.defaultPrice } : { source: "none" }, minimum: row.defaultMinimumQuantity !== undefined ? { source: "inherits", effective: row.defaultMinimumQuantity } : { source: "none" } };
  const [open, setOpen] = useState(startOpen);
  const [fields, setFields] = useSyncedState({ price: view.price.override ? String(view.price.override.amount) : "", minimum: view.minimum.override !== undefined ? String(view.minimum.override) : "", displayName: view.displayName || "", description: view.description || "" }, `${row.itemId}:${row.version}:${oplocId}`);
  const { price, minimum, displayName, description } = fields;
  const setPrice = (value: string) => setFields(previous => ({ ...previous, price: value })), setMinimum = (value: string) => setFields(previous => ({ ...previous, minimum: value })), setDisplayName = (value: string) => setFields(previous => ({ ...previous, displayName: value })), setDescription = (value: string) => setFields(previous => ({ ...previous, description: value }));
  const { busy, error, setError, run } = useAction(send);
  const disabled = !canManage || busy || itemInactive;
  const base = { itemId: row.itemId, expectedVersion: row.version, oplocId };
  async function savePrice() {
    const amount = numberOrUndefined(price); if (amount === undefined || Number.isNaN(amount)) { setError("Enter a site price, for example 4.50."); return; }
    await run({ action: "set-site-override", ...base, price: { amount } });
  }
  async function saveMinimum() {
    const value = numberOrUndefined(minimum); if (value === undefined || Number.isNaN(value)) { setError("Enter a whole-number site minimum."); return; }
    await run({ action: "set-site-override", ...base, minimumQuantity: value });
  }
  return <li className={`hc-offering ${view.available ? "" : "is-off"}`}>
    <div className="hc-offering__head">
      <strong>{label}{view.operationalAreaId ? " · specific area" : ""}</strong>
      <label className="hc-switch"><input type="checkbox" checked={view.available} disabled={disabled || Boolean(view.operationalAreaId)} onChange={event => void run({ action: "set-site-availability", ...base, available: event.target.checked })} /> {view.available ? "Available" : "Not available"}</label>
    </div>
    {view.available && <dl className="hc-offering__values">
      <div><dt>Price</dt><dd>{view.mode === "quote_only" ? <SourceTag source="quote_only" /> : <><SourceTag source={view.price.source} /> {view.price.effective ? formatMoney(view.price.effective.amount) : ""}{view.price.redundant ? <small> (same as company default)</small> : null}</>}</dd></div>
      <div><dt>Minimum</dt><dd><SourceTag source={view.minimum.source} /> {view.minimum.effective ?? ""}</dd></div>
      {(view.displayName || view.description) && <div><dt>Local wording</dt><dd><SourceTag source="overrides" /> {view.displayName || "Custom description"}</dd></div>}
    </dl>}
    {view.available && canManage && !itemInactive && <>
      <button type="button" className="hc-btn hc-btn--text" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Hide site settings" : "Site settings"}</button>
      {open && <div className="hc-override">
        {view.mode === "standard" && <div className="hc-override__row"><Field label="Site price (£, ex VAT)" hint={view.price.source === "overrides" ? "This site overrides the company default." : "Leave empty to inherit the company default."}><input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} disabled={disabled} /></Field>
          <div className="hc-override__actions"><button type="button" className="hc-btn" disabled={disabled || !price.trim()} onClick={() => void savePrice()}>Save price override</button>{view.price.source === "overrides" && <button type="button" className="hc-btn hc-btn--text" disabled={disabled} onClick={() => void run({ action: "set-site-override", ...base, price: null })}>Reset to company default</button>}</div></div>}
        <div className="hc-override__row"><Field label="Site minimum quantity" hint={view.minimum.source === "overrides" ? "This site overrides the company default." : "Leave empty to inherit the company default."}><input inputMode="numeric" value={minimum} onChange={event => setMinimum(event.target.value)} disabled={disabled} /></Field>
          <div className="hc-override__actions"><button type="button" className="hc-btn" disabled={disabled || !minimum.trim()} onClick={() => void saveMinimum()}>Save minimum override</button>{view.minimum.source === "overrides" && <button type="button" className="hc-btn hc-btn--text" disabled={disabled} onClick={() => void run({ action: "set-site-override", ...base, minimumQuantity: null })}>Reset to company default</button>}</div></div>
        <div className="hc-override__row"><Field label="Name shown at this site" hint="Optional. Leave empty to use the company item name."><input value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={disabled} maxLength={240} /></Field>
          <Field label="Description shown at this site" hint="Optional."><textarea value={description} onChange={event => setDescription(event.target.value)} disabled={disabled} maxLength={1000} rows={2} /></Field>
          <div className="hc-override__actions"><button type="button" className="hc-btn" disabled={disabled} onClick={() => void run({ action: "set-site-override", ...base, displayName: displayName.trim() || null, description: description.trim() || null })}>Save site wording</button></div></div>
        {error && <p role="alert" className="hc-error">{error}</p>}
      </div>}
    </>}
    {!open && error && <p role="alert" className="hc-error">{error}</p>}
    <span className="hc-sr">{row.name} at {label}</span>
  </li>;
}

function AdoptDefault({ row, send, oplocs }: { row: CatalogueRow; send: Send; oplocs: CataloguePayload["oplocs"] }) {
  const migration = row.priceMigration;
  const uniform = migration.status === "uniform";
  const [price, setPrice] = useState(uniform ? String(migration.amount) : "");
  const [minimum, setMinimum] = useState(uniform && migration.minimumQuantity !== undefined ? String(migration.minimumQuantity) : "");
  const [confirmed, setConfirmed] = useState(false);
  const { busy, error, setError, run } = useAction(send);
  if (migration.status === "not_needed" || row.defaultPrice) return null;
  const submit = async () => {
    const amount = numberOrUndefined(price); const min = numberOrUndefined(minimum);
    if (amount === undefined || Number.isNaN(amount)) { setError("Enter the company default price."); return; }
    if (Number.isNaN(min)) { setError("Enter a whole-number minimum, or leave it empty."); return; }
    await run({ action: "adopt-company-default", itemId: row.itemId, expectedVersion: row.version, price: { amount, ...(uniform ? { vatRate: migration.vatRate } : {}) }, minimumQuantity: min ?? null, confirmed });
  };
  return <section className="hc-section hc-adopt" aria-label="Set company default from site values">
    <h3>Set the company default</h3>
    {uniform ? <p className="hc-hint">Every site currently charges {formatMoney(migration.amount)}. Making that the company default means those sites inherit it.</p>
      : <><p className="hc-hint">{migration.reason}</p><table className="hc-mini"><thead><tr><th scope="col">Site</th><th scope="col">Price</th><th scope="col">Minimum</th></tr></thead><tbody>{migration.values.map(value => <tr key={value.offeringId}><th scope="row">{oplocLabel(oplocs, value.oplocId)}</th><td>{formatMoney(value.amount)}</td><td>{value.minimumQuantity ?? "—"}</td></tr>)}</tbody></table></>}
    <div className="hc-grid2"><Field label="Company default price (£, ex VAT)"><input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></Field><Field label="Company default minimum (optional)"><input inputMode="numeric" value={minimum} onChange={event => setMinimum(event.target.value)} /></Field></div>
    <label className="hc-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I confirm this is the company default. Sites with an equal value will inherit it; different site values stay as overrides.</label>
    {error && <p role="alert" className="hc-error">{error}</p>}
    <button type="button" className="hc-btn hc-btn--primary" disabled={busy || !confirmed || !price.trim()} onClick={() => void submit()}>{busy ? "Saving…" : "Set company default"}</button>
  </section>;
}

function ItemPanel({ row, payload, canManage, send, onClose }: { row: CatalogueRow; payload: CataloguePayload; canManage: boolean; send: Send; onClose: () => void }) {
  const [form, setForm] = useSyncedState({ name: row.name, category: row.category, description: row.description, price: row.defaultPrice ? String(row.defaultPrice.amount) : "", minimum: row.defaultMinimumQuantity !== undefined ? String(row.defaultMinimumQuantity) : "" }, `${row.itemId}:${row.version}:${row.defaultPrice?.priceId}`);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const currentSites = row.availableAt.filter(id => selectableSites(payload.oplocs).some(oploc => oploc.oplocId === id));
  const [siteSet, setSiteSet] = useSyncedState<string[]>(currentSites, `${row.itemId}:${row.version}`);
  const [newSite, setNewSite] = useState("");
  const exceptionOfferings = row.offerings.filter(offering => offering.status === "active" && !offering.noEffect);
  const sameSites = siteSet.length === currentSites.length && siteSet.every(id => currentSites.includes(id));
  const save = useAction(send), archive = useAction(send), add = useAction(send);
  const dialog = useDialog(onClose, save.busy || archive.busy || add.busy);
  const inactive = row.status === "archived";
  const dirty = form.name !== row.name || form.category !== row.category || form.description !== row.description || form.price !== (row.defaultPrice ? String(row.defaultPrice.amount) : "") || form.minimum !== (row.defaultMinimumQuantity !== undefined ? String(row.defaultMinimumQuantity) : "");
  async function submit() {
    const amount = numberOrUndefined(form.price), minimum = numberOrUndefined(form.minimum);
    if (!form.name.trim() || !form.category.trim()) { save.setError("Name and category are required."); return; }
    if (Number.isNaN(amount)) { save.setError("Enter the default price as a number, for example 4.50."); return; }
    if (Number.isNaN(minimum)) { save.setError("Enter the default minimum as a whole number."); return; }
    await save.run({ action: "update-item", itemId: row.itemId, expectedVersion: row.version, name: form.name, category: form.category, description: form.description || undefined, defaultMinimumQuantity: minimum ?? null, ...(amount !== undefined ? { defaultPrice: { amount } } : {}) });
  }
  return <div className="hc-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="hc-drawer" role="dialog" aria-modal="true" aria-labelledby="hc-panel-title" ref={dialog}>
      <header><div><h2 id="hc-panel-title">{row.name}</h2><RoutingBadge state={row.routing.state} /> {inactive && <span className="hc-badge hc-badge--neutral">Archived</span>}</div><button type="button" className="hc-icon" onClick={onClose} aria-label="Close item panel"><X size={18} aria-hidden="true" /></button></header>
      <div className="hc-drawer__body">
        {row.needsReview.includes("duplicate_candidate") && <p className="hc-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /> This may be a duplicate of another item. Check “Possible duplicates to review”.</p>}
        <section className="hc-section" aria-labelledby="hc-company-title"><h3 id="hc-company-title">Company item</h3>
          <form onSubmit={event => { event.preventDefault(); void submit(); }}>
            <Field label="Name"><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} disabled={!canManage || inactive} maxLength={240} required /></Field>
            <Field label="Category"><input list="hc-categories" value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} disabled={!canManage || inactive} maxLength={160} required /></Field>
            <datalist id="hc-categories">{categoriesOf(payload.rows).map(category => <option key={category} value={category} />)}</datalist>
            <Field label="Description"><textarea rows={2} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} disabled={!canManage || inactive} maxLength={4000} /></Field>
            <div className="hc-grid2">
              <Field label="Default price (£, ex VAT)" hint={row.defaultPrice ? "Sites without an override use this." : "Not set yet."}><input inputMode="decimal" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} disabled={!canManage || inactive} /></Field>
              <Field label="Default minimum quantity" hint="Optional."><input inputMode="numeric" value={form.minimum} onChange={event => setForm({ ...form, minimum: event.target.value })} disabled={!canManage || inactive} /></Field>
            </div>
            {save.error && <p role="alert" className="hc-error">{save.error}</p>}
            {canManage && !inactive && <button type="submit" className="hc-btn hc-btn--primary" disabled={save.busy || !dirty}>{save.busy ? "Saving…" : "Save changes"}</button>}
          </form>
        </section>

        {!inactive && <RoutingEditor row={row} canManage={canManage} send={send} />}
        {!inactive && canManage && <AdoptDefault row={row} send={send} oplocs={payload.oplocs} />}

        <section className="hc-section" aria-labelledby="hc-sites-title"><h3 id="hc-sites-title">Available at</h3>
          <p className="hc-hint">{inactive ? "Archived items are not available anywhere." : row.unavailableAt.length === 0 ? `Available at all ${selectableSites(payload.oplocs).length} sites by default. Only exceptions are stored.` : `Available at ${row.availableAt.length} of ${selectableSites(payload.oplocs).length} sites. Not available at: ${row.unavailableAt.map(id => oplocLabel(payload.oplocs, id)).join(", ")}.`}</p>
          {canManage && !inactive && selectableSites(payload.oplocs).length > 0 && <div className="hc-add-site">
            <SitePicker legend="Site availability" sites={selectableSites(payload.oplocs)} value={siteSet} onChange={setSiteSet} disabled={add.busy} />
            <p className="hc-hint">{siteSet.length === 0 ? "Choose at least one site." : `Saving makes ${row.name} available at exactly these ${siteSet.length} site${siteSet.length === 1 ? "" : "s"}. Only the sites left out are recorded, as exceptions; site overrides and history are kept.`}</p>
            <button type="button" className="hc-btn" disabled={add.busy || siteSet.length === 0 || sameSites} onClick={() => void add.run({ action: "bulk-update", operationId: newRequestId(), itemIds: [row.itemId], expectedVersions: { [row.itemId]: row.version }, sites: { mode: "replace", oplocIds: siteSet } })}>{add.busy ? "Saving…" : "Save availability"}</button></div>}
          {add.error && <p role="alert" className="hc-error">{add.error}</p>}
        </section>

        <section className="hc-section" aria-labelledby="hc-exc-title"><h3 id="hc-exc-title">Site exceptions</h3>
          <p className="hc-hint">Sites that differ from the company item (price, minimum, wording, notice or availability). A site with no exception simply uses the company defaults.</p>
          {exceptionOfferings.length === 0 && !newSite ? <p className="hc-hint">No site exceptions.</p> : <ul className="hc-offerings">
            {exceptionOfferings.map(offering => <SiteExceptionEditor key={offering.offeringId} row={row} oplocId={offering.oplocId} offering={offering} label={oplocLabel(payload.oplocs, offering.oplocId)} canManage={canManage} send={send} itemInactive={inactive} />)}
            {newSite && <SiteExceptionEditor key={`new-${newSite}`} row={row} oplocId={newSite} label={oplocLabel(payload.oplocs, newSite)} canManage={canManage} send={send} itemInactive={inactive} startOpen />}
          </ul>}
          {canManage && !inactive && <div className="hc-add-site"><Field label="Add an exception for a site"><select value={newSite} onChange={event => setNewSite(event.target.value)}><option value="">Choose a site…</option>{selectableSites(payload.oplocs).filter(oploc => !exceptionOfferings.some(offering => offering.oplocId === oploc.oplocId)).map(oploc => <option key={oploc.oplocId} value={oploc.oplocId}>{oploc.label}</option>)}</select></Field></div>}
        </section>

        <details className="hc-section hc-advanced"><summary>Source and governance details</summary>
          <dl>
            <div><dt>Supplier / platform references</dt><dd>{row.providerMappings.length ? row.providerMappings.map(mapping => `${mapping.provider}: ${mapping.sourceItemId}`).join("; ") : "None recorded"}</dd></div>
            <div><dt>Allergens (read-only)</dt><dd>{row.allergenInformation.length ? row.allergenInformation.join(", ") : "None recorded"}</dd></div>
            <div><dt>Dietary (read-only)</dt><dd>{row.dietaryInformation.length ? row.dietaryInformation.join(", ") : "None recorded"}</dd></div>
            {row.siteCopyOf && <div><dt>Originally created for</dt><dd>{row.siteCopyOf.toUpperCase()}</dd></div>}
            <div><dt>Catalogue ID</dt><dd><code>{row.itemId}</code></dd></div>
            <div><dt>Record version</dt><dd>{row.version}</dd></div>
          </dl>
          <p className="hc-hint">Allergen and dietary data is safety-critical and is not editable here.</p>
        </details>

        {canManage && <section className="hc-section hc-danger-zone"><h3>{inactive ? "Restore" : "Archive"}</h3>
          <p className="hc-hint">{inactive ? "Restoring puts the item back on booking menus where it is still available." : "Archiving removes the item from booking menus. Existing bookings, quotes, orders and the audit trail are kept, and you can restore it later."}</p>
          {archive.error && <p role="alert" className="hc-error">{archive.error}</p>}
          <button type="button" className={`hc-btn ${inactive ? "" : "hc-btn--danger"}`} disabled={archive.busy} onClick={() => inactive ? void archive.run({ action: "set-item-status", itemId: row.itemId, expectedVersion: row.version, status: "active" }) : setConfirmArchive(true)}>{inactive ? "Restore item" : "Archive item"}</button>
        </section>}
      </div>
    </aside>
    {confirmArchive && <ConfirmationModal title={`Archive ${row.name}?`} description="It will disappear from booking menus at every site. Existing bookings, quotes, orders and history are not changed, and the item can be restored later." confirmLabel="Archive item" destructive busy={archive.busy} onCancel={() => setConfirmArchive(false)} onConfirm={async () => { await archive.run({ action: "set-item-status", itemId: row.itemId, expectedVersion: row.version, status: "archived" }, () => setConfirmArchive(false)); }} />}
  </div>;
}

function AddItemModal({ payload, send, onClose }: { payload: CataloguePayload; send: Send; onClose: () => void }) {
  const [requestId] = useState(newRequestId);
  const [form, setForm] = useState({ name: "", category: "", description: "", price: "", minimum: "" });
  const [route, setRoute] = useState<RoutingChoice | "">("");
  const [sites, setSites] = useState<string[]>(() => selectableSites(payload.oplocs).map(oploc => oploc.oplocId)); // default: every active Hospitality site, current registry
  const { busy, error, setError, run } = useAction(send);
  const dialog = useDialog(onClose, busy);
  const ready = form.name.trim() && form.category.trim() && form.price.trim() && route && sites.length > 0;
  async function submit() {
    const amount = numberOrUndefined(form.price), minimum = numberOrUndefined(form.minimum);
    if (amount === undefined || Number.isNaN(amount)) { setError("Enter the default price as a number, for example 4.50."); return; }
    if (Number.isNaN(minimum)) { setError("Enter the minimum as a whole number, or leave it empty."); return; }
    if (!route) { setError("Choose a production route."); return; }
    await run({ action: "create-item", requestId, name: form.name, category: form.category, description: form.description || undefined, routing: route, defaultPrice: { amount }, ...(minimum !== undefined ? { defaultMinimumQuantity: minimum } : {}), oplocIds: sites }, () => onClose());
  }
  return <div className="hc-modal-backdrop" role="presentation">
    <form className="hc-modal" role="dialog" aria-modal="true" aria-labelledby="hc-add-title" ref={dialog as never} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <header><h2 id="hc-add-title">Add item</h2><button type="button" className="hc-icon" onClick={onClose} disabled={busy} aria-label="Close add item"><X size={18} aria-hidden="true" /></button></header>
      <div className="hc-modal__body">
        <Field label="Name"><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} maxLength={240} required /></Field>
        <Field label="Category"><input list="hc-add-categories" value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} maxLength={160} required /></Field>
        <datalist id="hc-add-categories">{categoriesOf(payload.rows).map(category => <option key={category} value={category} />)}</datalist>
        <Field label="Description (optional)"><textarea rows={2} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} maxLength={4000} /></Field>
        <Field label="Default price (£, ex VAT)" hint="Every site uses this unless it has an override."><input inputMode="decimal" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} required /></Field>
        <Field label="Default minimum quantity (optional)"><input inputMode="numeric" value={form.minimum} onChange={event => setForm({ ...form, minimum: event.target.value })} /></Field>
        <fieldset className="hc-radios"><legend>Production route (required)</legend>
          {ROUTING_CHOICES.map(option => <label key={option}><input type="radio" name="add-route" checked={route === option} onChange={() => setRoute(option)} /> {ROUTING_CHOICE_LABELS[option]}</label>)}
        </fieldset>
        <SitePicker legend="Available at (all sites by default; untick to exclude)" sites={selectableSites(payload.oplocs)} value={sites} onChange={setSites} disabled={busy} />
        {error && <p role="alert" className="hc-error">{error}</p>}
      </div>
      <footer><button type="button" className="hc-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="hc-btn hc-btn--primary" disabled={busy || !ready}>{busy ? "Creating…" : "Create item"}</button></footer>
    </form>
  </div>;
}

function ReviewGroupModal({ group, payload, canManage, send, onClose }: { group: ReviewGroupView; payload: CataloguePayload; canManage: boolean; send: Send; onClose: () => void }) {
  const members = group.memberIds.map(id => payload.rows.find(row => row.itemId === id)).filter((row): row is CatalogueRow => Boolean(row));
  const [survivor, setSurvivor] = useState(members[0]?.itemId || "");
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction(send);
  const dialog = useDialog(onClose, busy);
  const same = (pick: (row: CatalogueRow) => string) => new Set(members.map(pick)).size <= 1;
  const sitePrices = (row: CatalogueRow) => `Company default ${row.defaultPrice ? formatMoney(row.defaultPrice.amount) : "not set"}${row.defaultMinimumQuantity !== undefined ? `, min ${row.defaultMinimumQuantity}` : ""}${row.offerings.filter(offering => offering.status === "active" && !offering.noEffect).map(offering => `; ${oplocLabel(payload.oplocs, offering.oplocId)}: ${offering.price.effective ? formatMoney(offering.price.effective.amount) : "no price"}${offering.minimum.effective !== undefined ? `, min ${offering.minimum.effective}` : ""}`).join("")}`;
  const lines: Array<[string, (row: CatalogueRow) => string]> = [
    ["Name", row => row.name], ["Category", row => row.category],
    ["Supplier references", row => row.providerMappings.map(mapping => `${mapping.provider}: ${mapping.sourceItemId}`).join("; ") || row.sourceIds.join("; ") || "None"],
    ["Allergens", row => row.allergenInformation.join(", ") || "None recorded"], ["Dietary", row => row.dietaryInformation.join(", ") || "None recorded"],
    ["Available at", row => sitesSummary(row, payload.oplocs)], ["Prices and minimums", sitePrices],
    ["Production", row => ROUTING_STATE_LABELS[row.routing.state]],
  ];
  const safetyDiffers = !same(row => row.allergenInformation.join("|")) || !same(row => row.dietaryInformation.join("|"));
  const versions = Object.fromEntries(members.map(member => [member.itemId, member.version]));
  return <div className="hc-modal-backdrop" role="presentation">
    <section className="hc-modal hc-modal--wide" role="dialog" aria-modal="true" aria-labelledby="hc-review-title" ref={dialog}>
      <header><h2 id="hc-review-title">Are these the same product?</h2><button type="button" className="hc-icon" onClick={onClose} disabled={busy} aria-label="Close review"><X size={18} aria-hidden="true" /></button></header>
      <div className="hc-modal__body">
        <p className="hc-hint">{sentence(group.reasons.join(" · "))}. Nothing is merged unless you choose to.</p>
        {safetyDiffers && <p className="hc-warning hc-warning--danger" role="alert"><AlertTriangle size={15} aria-hidden="true" /> Allergen or dietary data differs. These items cannot be merged until that data matches. Keep them separate or fix the data first.</p>}
        <div className="hc-compare-wrap"><table className="hc-compare">
          <thead><tr><th scope="col"><span className="hc-sr">Field</span></th>{members.map(member => <th scope="col" key={member.itemId}>{canManage && <label><input type="radio" name="survivor" checked={survivor === member.itemId} onChange={() => setSurvivor(member.itemId)} /> Keep this one</label>}<span>{member.name}</span></th>)}</tr></thead>
          <tbody>{lines.map(([label, pick]) => <tr key={label} className={same(pick) ? "" : "is-diff"}><th scope="row">{label}{!same(pick) && <small> · differs</small>}</th>{members.map(member => <td key={member.itemId}>{pick(member)}</td>)}</tr>)}</tbody>
        </table></div>
        {error && <p role="alert" className="hc-error">{error}</p>}
      </div>
      <footer>
        <button type="button" className="hc-btn hc-btn--text" onClick={onClose} disabled={busy}>Close</button>
        {canManage && <>
          <button type="button" className="hc-btn" disabled={busy} onClick={() => void run({ action: "record-review-decision", memberIds: group.memberIds, decision: "defer" }, onClose)}>Defer</button>
          <button type="button" className="hc-btn" disabled={busy} onClick={() => void run({ action: "record-review-decision", memberIds: group.memberIds, decision: "keep_separate" }, onClose)}>Keep separate</button>
          <button type="button" className="hc-btn hc-btn--primary" disabled={busy || safetyDiffers || members.length < 2} onClick={() => setConfirming(true)}>Same product — merge</button>
        </>}
      </footer>
    </section>
    {confirming && <ConfirmationModal title="Merge these items?" description={`They become one catalogue item. Every site offering, price override and production route is kept, and the other ${members.length - 1} record${members.length === 2 ? " is" : "s are"} archived. This is recorded in the audit trail.`} confirmLabel="Merge items" busy={busy} onCancel={() => setConfirming(false)} onConfirm={async () => { const ok = await run({ action: "merge-items", survivorItemId: survivor, sourceItemIds: members.filter(member => member.itemId !== survivor).map(member => member.itemId), expectedVersions: versions, groupId: group.id }, onClose); if (!ok) setConfirming(false); }} />}
  </div>;
}

function SitePicker({ legend, sites, value, onChange, disabled }: { legend: string; sites: CataloguePayload["oplocs"]; value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const shown = sites.filter(site => site.label.toLocaleLowerCase("en-GB").includes(query.trim().toLocaleLowerCase("en-GB")));
  return <fieldset className="hc-radios hc-sites"><legend>{legend}</legend>
    <div className="hc-sites__bar">
      <span role="status" aria-live="polite">{value.length} of {sites.length} site{sites.length === 1 ? "" : "s"} selected</span>
      <button type="button" className="hc-btn hc-btn--text" disabled={disabled || value.length === sites.length} onClick={() => onChange(sites.map(site => site.oplocId))}>Select all sites</button>
      <button type="button" className="hc-btn hc-btn--text" disabled={disabled || value.length === 0} onClick={() => onChange([])}>Clear all</button>
    </div>
    {sites.length > 8 && <input type="search" className="hc-sites__search" aria-label="Search sites" placeholder="Search sites" value={query} onChange={event => setQuery(event.target.value)} />}
    <div className="hc-sites__list">{shown.map(site => <label key={site.oplocId}><input type="checkbox" disabled={disabled} checked={value.includes(site.oplocId)} onChange={event => onChange(event.target.checked ? [...value, site.oplocId] : value.filter(id => id !== site.oplocId))} /> {site.label}</label>)}</div>
  </fieldset>;
}

function BulkModal({ mode, rows: selectedRows, payload, send, onClose, onFinished }: { mode: "edit" | "archive"; rows: CatalogueRow[]; payload: CataloguePayload; send: Send; onClose: () => void; onFinished: (report: BulkResultView) => void }) {
  const [operationId] = useState(newRequestId);
  const [rows] = useState(selectedRows); // snapshot: the parent clears its selection after a successful run
  const [production, setProduction] = useState<RoutingChoice | "">("");
  const [priceMode, setPriceMode] = useState<"keep" | "set">("keep"); const [priceValue, setPriceValue] = useState("");
  const [minimumMode, setMinimumMode] = useState<"keep" | "set" | "clear">("keep"); const [minimumValue, setMinimumValue] = useState("");
  const [siteMode, setSiteMode] = useState<"keep" | "add" | "remove" | "replace">("keep"); const [siteIds, setSiteIds] = useState<string[]>([]);
  const [step, setStep] = useState<"edit" | "review">(mode === "archive" ? "review" : "edit");
  const [report, setReport] = useState<BulkResultView | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const dialog = useDialog(onClose, busy);
  const sites = selectableSites(payload.oplocs);
  const currentRoutes = new Set(rows.map(row => ROUTING_STATE_LABELS[row.routing.state]));
  function buildDraft(): BulkDraft | null {
    if (mode === "archive") return { archive: true };
    const draft: BulkDraft = {};
    if (production) draft.production = production;
    if (priceMode === "set") { const amount = numberOrUndefined(priceValue); if (amount === undefined || Number.isNaN(amount) || amount < 0) { setError("Enter the default price as a number, for example 4.50."); return null; } draft.price = { amount }; }
    if (minimumMode === "set") { const value = numberOrUndefined(minimumValue); if (value === undefined || !Number.isInteger(value) || value < 1) { setError("Enter the minimum as a whole number of 1 or more."); return null; } draft.minimum = { mode: "set", value }; }
    if (minimumMode === "clear") draft.minimum = { mode: "clear" };
    if (siteMode !== "keep") { if (!siteIds.length) { setError("Choose at least one site, or set Sites to Leave unchanged."); return null; } draft.sites = { mode: siteMode, oplocIds: siteIds }; }
    if (!Object.keys(draft).length) { setError("Nothing to change yet. Every field is left unchanged until you choose a value."); return null; }
    return draft;
  }
  const [draft, setDraft] = useState<BulkDraft | null>(mode === "archive" ? { archive: true } : null);
  function review() { setError(""); const next = buildDraft(); if (next) { setDraft(next); setStep("review"); } }
  async function applyAndReport() {
    if (!draft || busy) return;
    const result = await sendBulk();
    if (result) { setReport(result); onFinished(result); }
  }
  async function sendBulk() {
    if (!draft) return null;
    setBusy(true); setError("");
    try {
      const outcome = await send({ action: "bulk-update", operationId, itemIds: rows.map(row => row.itemId), expectedVersions: Object.fromEntries(rows.map(row => [row.itemId, row.version])), expectedRoutingVersions: Object.fromEntries(rows.map(row => [row.itemId, row.routing.version])), ...draft });
      return outcome.bulk ?? null;
    } catch (caught) { setError((caught as Error).message); return null; } finally { setBusy(false); }
  }
  const lines = draft ? bulkImpact(draft, rows, payload.oplocs) : [];
  const archive = Boolean(draft?.archive);
  return <div className="hc-modal-backdrop" role="presentation">
    <section className="hc-modal hc-modal--wide" role="dialog" aria-modal="true" aria-labelledby="hc-bulk-title" ref={dialog}>
      <header><h2 id="hc-bulk-title">{report ? "Bulk update result" : step === "review" ? `Apply changes to ${rows.length} item${rows.length === 1 ? "" : "s"}?` : `Edit ${rows.length} selected item${rows.length === 1 ? "" : "s"}`}</h2><button type="button" className="hc-icon" onClick={onClose} disabled={busy} aria-label="Close bulk editor"><X size={18} aria-hidden="true" /></button></header>
      <div className="hc-modal__body">
        {report ? <>
          <p className={report.failed ? "hc-warning hc-warning--danger" : "hc-success"} role="status">{report.message}</p>
          <ul className="hc-results">{report.results.map(result => <li key={result.itemId} className={result.status === "failed" ? "is-failed" : ""}><strong>{rows.find(row => row.itemId === result.itemId)?.name || "Item"}</strong> <span>{result.status === "failed" ? "Not changed" : result.status === "unchanged" ? "Already matched" : "Updated"}</span>{result.status === "failed" && <small>{result.message}</small>}</li>)}</ul>
        </> : step === "edit" ? <>
          <p className="hc-hint">Every field starts as Leave unchanged. Site price and minimum overrides are always preserved.</p>
          <Field label="Production"><select value={production} onChange={event => setProduction(event.target.value as RoutingChoice | "")}><option value="">Leave unchanged</option>{ROUTING_CHOICES.map(choice => <option key={choice} value={choice}>{ROUTING_CHOICE_LABELS[choice]}</option>)}</select></Field>
          {production && currentRoutes.size > 1 && <p className="hc-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /> The selected items currently have different routes: {[...currentRoutes].join(", ")}. They will all be set to {ROUTING_CHOICE_LABELS[production]}.</p>}
          <div className="hc-grid2">
            <Field label="Company default price"><select value={priceMode} onChange={event => setPriceMode(event.target.value as "keep" | "set")}><option value="keep">Leave unchanged</option><option value="set">Set price</option></select></Field>
            {priceMode === "set" && <Field label="Price (£, ex VAT)"><input inputMode="decimal" value={priceValue} onChange={event => setPriceValue(event.target.value)} /></Field>}
          </div>
          <div className="hc-grid2">
            <Field label="Company default minimum"><select value={minimumMode} onChange={event => setMinimumMode(event.target.value as "keep" | "set" | "clear")}><option value="keep">Leave unchanged</option><option value="set">Set minimum</option><option value="clear">Clear default minimum</option></select></Field>
            {minimumMode === "set" && <Field label="Minimum quantity"><input inputMode="numeric" value={minimumValue} onChange={event => setMinimumValue(event.target.value)} /></Field>}
          </div>
          <Field label="Site availability"><select value={siteMode} onChange={event => setSiteMode(event.target.value as typeof siteMode)}><option value="keep">Leave unchanged</option><option value="add">Add selected sites</option><option value="remove">Remove selected sites</option><option value="replace">Replace availability with selected sites</option></select></Field>
          {siteMode !== "keep" && <SitePicker legend={siteMode === "add" ? "Sites to add" : siteMode === "remove" ? "Sites to remove" : "Available at exactly these sites"} sites={sites} value={siteIds} onChange={setSiteIds} />}
        </> : <>
          <dl className="hc-impact">{lines.map(line => <div key={line.label} className={line.tone ? `is-${line.tone}` : ""}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl>
          <p className="hc-hint">Each item is changed in its own safe step. If any item cannot be changed (for example it was edited elsewhere), you will see exactly which ones; nothing fails silently.</p>
        </>}
        {error && <p role="alert" className="hc-error">{error}</p>}
      </div>
      <footer>
        {report ? <button type="button" className="hc-btn hc-btn--primary" onClick={onClose}>Close</button> : <>
          <button type="button" className="hc-btn" onClick={onClose} disabled={busy}>Cancel</button>
          {step === "review" && mode === "edit" && <button type="button" className="hc-btn" onClick={() => { setStep("edit"); setError(""); }} disabled={busy}>Back</button>}
          {step === "edit" ? <button type="button" className="hc-btn hc-btn--primary" onClick={review}>Review changes</button>
            : <button type="button" className={`hc-btn ${archive ? "hc-btn--danger-solid" : "hc-btn--primary"}`} disabled={busy} onClick={() => void applyAndReport()}>{busy ? "Applying…" : archive ? `Archive ${rows.length} item${rows.length === 1 ? "" : "s"}` : `Apply to ${rows.length} item${rows.length === 1 ? "" : "s"}`}</button>}
        </>}
      </footer>
    </section>
  </div>;
}
