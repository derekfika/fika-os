"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isServiceId } from "@fika/server-shared/hospitality-service-layout";
import { CatalogueProductEditor } from "./catalogue-product-editor";
import { CatalogueBulk } from "./catalogue-bulk";
import {
  CatalogueDuplicateReview,
  CatalogueProductGovernance,
} from "./catalogue-governance";
import type { StudioSectionLink } from "./catalogue-governance-model";
import { StudioAssignmentLinks } from "./studio-assignment-links";
import { CatalogueSiteEditor } from "./catalogue-site-editor";
import { CatalogueServiceEditor } from "./catalogue-service-editor";
import { confirmsSiteCommand } from "./catalogue-site-operation";
import { productReceipt, type ProductCommand } from "./catalogue-product-model";
import {
  CatalogueCommandError,
  requestCatalogueCommand,
} from "./catalogue-state";
import type {
  CatalogueCommand,
  CatalogueCommandResult,
  CataloguePayload,
  CataloguePrice,
} from "./catalogue-wire";
import { Button, PageHeading, Pill } from "./studio-ui";
import { indexAdminCatalogue, normalizeCatalogueSearch } from "./studio-catalogue-index";
import { useStudioRead, useStudioReads } from "./studio-reads";
import styles from "./studio.module.css";

const pounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});
const vat = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 4,
});
const money = (price?: CataloguePrice) =>
  price
    ? pounds.format(price.amount) +
      " ex VAT · " +
      vat.format(price.vatRate) +
      " VAT · effective " +
      price.effectiveFrom
    : "No company price recorded";
const words = (value: string) => value.replaceAll("_", " ");
type CatalogueSortKey = "name" | "category" | "price" | "vat" | "sites" | "status";

export function CatalogueView({
  area,
  initialItemId,
  back,
  loadSectionLinks,
  sectionsFor,
  openSection,
}: {
  area: "products" | "sites";
  initialItemId?: string;
  back?: () => void;
  loadSectionLinks: () => Promise<void>;
  sectionsFor: (itemId: string) => StudioSectionLink[];
  openSection: (menuId: string, sectionId: string) => void;
}) {
  const reads = useStudioReads();
  const admin = useStudioRead(reads.admin);
  const data = admin.value;
  const error = admin.error?.message;
  const loading = admin.status === "idle" || admin.status === "loading";
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState<CatalogueCommandResult | null>(null);
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<CatalogueSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [itemId, setItemId] = useState(initialItemId || "");
  const [siteId, setSiteId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [verification, setVerification] = useState("");
  const [checking, setChecking] = useState(false);
  const pendingWrite = useRef(false);
  const catalogueRevision = useRef(0);
  const selection = useRef("");
  selection.current = JSON.stringify([itemId, siteId, serviceId, eventDate]);

  const reload = useCallback(async (requireSuccess = false) => {
    if (pendingWrite.current) {
      if (requireSuccess)
        throw new Error("Wait for the catalogue change to finish.");
      return;
    }
    setNotice(null);
    setVerification("");
    catalogueRevision.current++;
    try {
      await reads.loadAdmin("full");
      void reads.loadPublic(true).catch(() => undefined);
    } catch (failure) {
      if (requireSuccess) throw failure;
    }
  }, [reads]);

  useEffect(() => reads.showAdmin(), [reads]);

  useEffect(() => {
    setItemId(initialItemId || "");
  }, [initialItemId]);
  useEffect(() => {
    setVerification("");
  }, [itemId, siteId, serviceId, eventDate, admin]);
  useEffect(() => {
    if (itemId) void loadSectionLinks();
  }, [itemId, loadSectionLinks]);

  async function send(
    command: CatalogueCommand,
    confirm?: (receipt: CatalogueCommandResult) => boolean,
    announce = true,
  ) {
    if (data?.canManage !== true) {
      throw new CatalogueCommandError(
        "This action requires Hub catalogue management access.",
        403,
      );
    }
    if (pendingWrite.current || loading) {
      throw new CatalogueCommandError(
        "Wait for the current catalogue request to finish.",
        400,
      );
    }
    pendingWrite.current = true;
    setWriting(true);
    setNotice(null);
    try {
      await reads.loadPublic().catch(() => undefined);
      const receipt = await requestCatalogueCommand(command, reads.fetch);
      if (confirm && !confirm(receipt)) {
        throw new CatalogueCommandError(
          "Hub did not confirm the requested catalogue change.",
        );
      }
      reads.catalogueChanged(receipt, admin);
      if (announce) setNotice(receipt);
      setVerification("");
      catalogueRevision.current++;
      return receipt;
    } catch (error) {
      if (error instanceof CatalogueCommandError && (!error.status || error.status === 409)) {
        reads.catalogueChanged();
      }
      throw error;
    } finally {
      pendingWrite.current = false;
      setWriting(false);
    }
  }

  function sendSite(command: CatalogueCommand) {
    return send(
      command,
      (receipt) => confirmsSiteCommand(receipt, command),
      false,
    );
  }

  async function sendProduct(command: ProductCommand) {
    const receipt = await send(command, (result) =>
      Boolean(productReceipt(result, command)),
    );
    return productReceipt(receipt, command)!;
  }

  async function verify() {
    const requestedSelection = selection.current;
    const revision = catalogueRevision.current;
    const stillCurrent = () =>
      selection.current === requestedSelection &&
      catalogueRevision.current === revision && reads.admin.snapshot() === admin;
    setChecking(true);
    setVerification("");
    try {
      if (notice?.package === "stale") throw new Error("The booking catalogue is awaiting refresh.");
      const query = new URLSearchParams({
        itemId,
        siteId,
        serviceId,
        eventDate,
      });
      const response = await reads.fetch("/api/catalogue/availability?" + query, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!["standard", "quote_only", "unavailable"].includes(result.status))
        throw new Error();
      if (!stillCurrent()) return;
      const parts = [
        "Verified catalogue result " + words(result.status),
        result.reason,
        typeof result.amount === "number"
          ? pounds.format(result.amount) + " ex VAT"
          : undefined,
        typeof result.vatRate === "number"
          ? vat.format(result.vatRate) + " VAT"
          : undefined,
      ];
      setVerification(
        parts.filter((part) => typeof part === "string" && part).join(" · ") +
          ". Booking acceptance is checked separately.",
      );
    } catch {
      if (stillCurrent())
        setVerification(
          "Availability could not be verified. Booking eligibility remains unknown.",
        );
    } finally {
      setChecking(false);
    }
  }

  const index = useMemo(() => indexAdminCatalogue(data), [data]);
  const selected = index.rowsById.get(itemId);
  const { sites, categories, siteLabels } = index;
  const companyRules = data?.serviceLayout?.company.services;
  const matchingRows = useMemo(() => {
    const query = normalizeCatalogueSearch(search);
    const candidates = [
      categoryFilter === "all" ? index.rows : index.byCategory.get(categoryFilter) ?? [],
      availabilityFilter === "all" ? index.rows : index.bySite.get(availabilityFilter) ?? [],
      statusFilter === "all" ? index.rows : index.byStatus.get(statusFilter) ?? [],
    ].sort((first, second) => first.length - second.length)[0];
    return candidates.filter((row) =>
      index.searchable.get(row.itemId)!.includes(query) &&
      (categoryFilter === "all" || row.category === categoryFilter) &&
      (availabilityFilter === "all" || row.availableAt.includes(availabilityFilter)) &&
      (statusFilter === "all" || row.status === statusFilter),
    ).sort((left, right) => {
    const leftMetric = sortKey === "price" ? left.defaultPrice?.amount : sortKey === "vat" ? left.defaultPrice?.vatRate : undefined;
    const rightMetric = sortKey === "price" ? right.defaultPrice?.amount : sortKey === "vat" ? right.defaultPrice?.vatRate : undefined;
    if ((sortKey === "price" || sortKey === "vat") && (leftMetric === undefined || rightMetric === undefined) && leftMetric !== rightMetric) return leftMetric === undefined ? 1 : -1;
    const compare = sortKey === "name" ? left.name.localeCompare(right.name, "en-GB")
      : sortKey === "category" ? left.category.localeCompare(right.category, "en-GB")
      : sortKey === "price" ? leftMetric! - rightMetric!
      : sortKey === "vat" ? leftMetric! - rightMetric!
      : sortKey === "sites" ? left.availableAt.length - right.availableAt.length
      : left.status.localeCompare(right.status, "en-GB");
    return (sortDirection === "asc" ? compare : -compare) || left.itemId.localeCompare(right.itemId, "en-GB");
    });
  }, [index, search, categoryFilter, availabilityFilter, statusFilter, sortKey, sortDirection]);
  const pageCount = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pageRows = matchingRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const availabilityLabel = (row: CataloguePayload["rows"][number]) => {
    const activeIds = sites.map((site) => site.oplocId);
    if (activeIds.length && activeIds.every((id) => row.availableAt.includes(id))) return `All active sites (${activeIds.length})`;
    const labels = row.availableAt.map((id) => siteLabels.get(id)).filter((label): label is string => Boolean(label));
    return labels.length ? labels.length <= 2 ? labels.join(", ") : `${labels.length} sites` : "No active sites";
  };
  function changeSort(key: CatalogueSortKey) {
    if (sortKey === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("asc"); }
  }

  return (
    <>
      <PageHeading
        title={area === "products" ? "Catalogue" : "Sites & services"}
      >
        {back && <Button onClick={back}>Back to section</Button>}
        {data && (
          <Button disabled={loading || writing} onClick={() => void reload()}>
            Refresh catalogue
          </Button>
        )}
        {area === "products" && data?.canManage === true && (
          <Button
            primary
            disabled={writing}
            onClick={() => setEditor("create")}
          >
            Add product
          </Button>
        )}
      </PageHeading>
      {area === "products" && <p>Search company products and view their current catalogue details.</p>}
      {loading && <p role="status">Loading catalogue…</p>}
      {error && (
        <div className="fika-notice fika-notice--danger" role="alert">
          {error} <Button onClick={() => void reload()}>Try again</Button>
        </div>
      )}
      {notice && (
        <div className="fika-notice" role="status">
          {notice.message}
          {notice.package === "stale" && (
            <p>The booking catalogue is awaiting refresh.</p>
          )}
        </div>
      )}
      {data && (
        <div className={styles.panelBody}>
          {area === "products" ? (
            <>
              <div className={styles.catalogueFilters}>
                <label className="fika-field">Search products<input className="fika-input" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPageIndex(0); }} placeholder="Search products" /></label>
                <label className="fika-field">Category<select className="fika-select" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPageIndex(0); }}><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                <label className="fika-field">Site availability<select className="fika-select" value={availabilityFilter} onChange={(event) => { setAvailabilityFilter(event.target.value); setPageIndex(0); }}><option value="all">All sites</option>{sites.map((site) => <option key={site.oplocId} value={site.oplocId}>{site.label}</option>)}</select></label>
                <label className="fika-field">Status<select className="fika-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPageIndex(0); }}><option value="all">All statuses</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
              </div>
              {data.canManage === false && (
                <p className="fika-help">Read-only access. Catalogue changes require Hub management permission.</p>
              )}
              {itemId && !selected && <p role="status">The saved mapping points to an item missing from the current catalogue.</p>}
              {!data.rows.length ? <p>No products are available.</p> : (
                <div className={styles.tableScroll}>
                  <table className={`${styles.table} ${styles.catalogueTable}`}>
                    <thead><tr>
                      {([ ["name", "Product name"], ["category", "Category"], ["price", "Price (ex VAT)"], ["vat", "VAT"], ["sites", "Site availability"], ["status", "Status"] ] as const).map(([key, label]) => <th key={key} scope="col" aria-sort={sortKey === key ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className={styles.catalogueSort} type="button" onClick={() => changeSort(key)}>{label}<span aria-hidden="true"> {sortKey === key ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</span></button></th>)}
                      <th scope="col"><span className={styles.srOnly}>Action</span></th>
                    </tr></thead>
                    <tbody>
                      {pageRows.map((row) => (
                        <tr key={row.itemId}>
                          <th scope="row">{row.name}</th>
                          <td>{row.category || "—"}</td>
                          <td>{row.defaultPrice ? pounds.format(row.defaultPrice.amount) : "Not set"}</td>
                          <td>{row.defaultPrice ? vat.format(row.defaultPrice.vatRate) : "Not set"}</td>
                          <td>{availabilityLabel(row)}</td>
                          <td><Pill>{words(row.status)}</Pill></td>
                          <td className={styles.catalogueAction}>
                            <button className={styles.catalogueSelect} type="button" aria-label={`View ${row.name} details`} aria-pressed={itemId === row.itemId} disabled={writing} onClick={() => setItemId(row.itemId)}>
                              {itemId === row.itemId ? "Selected" : "View"}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!matchingRows.length && <tr><td colSpan={7} className={styles.catalogueEmpty} role="status">No products match these filters.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              <div className={styles.cataloguePagination}>
                <span>Showing {matchingRows.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, matchingRows.length)} of {matchingRows.length} products</span>
                <label className="fika-field">Rows per page<select className="fika-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPageIndex(0); }}><option value={25}>25</option><option value={50}>50</option></select></label>
                <Button disabled={currentPage === 0} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}>Previous page</Button>
                <span aria-live="polite">Page {currentPage + 1} of {pageCount}</span>
                <Button disabled={currentPage + 1 >= pageCount} onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}>Next page</Button>
              </div>
              {selected && (
                <details className={styles.disclosure} open={Boolean(initialItemId && selected)}>
                  <summary>Product details and settings · {selected.name}</summary>
                  <section aria-label="Product details">
                    <h2>{selected.name}</h2>
                    <Pill>{words(selected.status)}</Pill>
                    <p>{selected.description || "No description recorded"}</p>
                    <dl>
                      <dt>Category</dt><dd>{selected.category}</dd>
                      <dt>Company price</dt><dd>{money(selected.defaultPrice)}</dd>
                      <dt>Company minimum</dt><dd>{selected.defaultMinimumQuantity ?? "Not set"}</dd>
                      {selected.defaultMode === "quote_only" && <><dt>Company booking mode</dt><dd>Quote only</dd></>}
                      <dt>Production routing</dt><dd>{words(selected.routing.state)}</dd>
                    </dl>
                    {selected.needsReview.length > 0 && <p>Needs review · {selected.needsReview.map(words).join(", ")}</p>}
                    {data.canManage === true && <Button disabled={writing} onClick={() => setEditor("edit")}>Edit product</Button>}
                  </section>
                  <StudioAssignmentLinks assignments={sectionsFor(selected.itemId)} open={openSection} />
                  <CatalogueProductGovernance row={selected} payload={data} send={send} />
                  <CatalogueSiteEditor key={selected.itemId} row={selected} oplocs={data.oplocs} canManage={data.canManage} send={sendSite} reload={() => reload(true)} />
                </details>
              )}
              <details className={styles.disclosure}>
                <summary>Catalogue review</summary>
                <CatalogueDuplicateReview payload={data} send={send} />
              </details>
            </>
          ) : (
            <>
              <label className="fika-field">
                Product
                <select className="fika-select" value={itemId} disabled={writing} onChange={(event) => setItemId(event.target.value)}>
                  <option value="">Choose a product</option>
                  {data.rows.map((row) => <option key={row.itemId} value={row.itemId}>{row.name} · {row.category} · {row.status}</option>)}
                </select>
              </label>
              <label className="fika-field">
                Site
                <select className="fika-select" value={siteId} disabled={writing} onChange={(event) => setSiteId(event.target.value)}>
                  <option value="">Choose a site</option>
                  {sites.map((site) => <option key={site.oplocId} value={site.oplocId}>{site.label}</option>)}
                </select>
              </label>
              {selected && siteId && <CatalogueSiteEditor key={selected.itemId + ":" + siteId} row={selected} oplocs={data.oplocs} canManage={data.canManage} send={sendSite} reload={() => reload(true)} fixedSiteId={siteId} />}
              {selected && siteId && companyRules && (
                <section aria-label="Verify catalogue availability">
                  <h2>Verify catalogue availability</h2>
                  <label className="fika-field">
                    Booking service
                    <select className="fika-select" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                      <option value="">Choose a service</option>
                      {Object.keys(companyRules).map((id) => <option key={id} value={id}>{words(id)}</option>)}
                    </select>
                  </label>
                  <label className="fika-field">Event date<input className="fika-input" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
                  <Button disabled={!serviceId || !eventDate || checking || writing} onClick={() => void verify()}>{checking ? "Checking…" : "Check availability"}</Button>
                  {verification && <p role="status">{verification}</p>}
                </section>
              )}
              <CatalogueServiceEditor key={JSON.stringify([siteId, serviceId, itemId])} payload={data} canManage={data.canManage} send={sendSite} reload={() => reload(true)} initialSiteId={siteId || undefined} initialServiceId={isServiceId(serviceId) ? serviceId : undefined} initialItemId={itemId || undefined} />
            </>
          )}
        </div>
      )}
      {data && (
        <details
          className={styles.disclosure}
          hidden={area !== "products" || !data}
        >
          <summary>Bulk catalogue operations</summary>
          <CatalogueBulk payload={data} send={send} />
        </details>
      )}
      {area === "products" &&
        data?.canManage === true &&
        editor &&
        (editor === "create" || selected) && (
          <CatalogueProductEditor
            row={editor === "create" ? null : selected!}
            oplocs={data.oplocs}
            categories={data.rows
              .filter((row) => row.status === "active")
              .map((row) => row.category)}
            send={sendProduct}
            onSaved={(result) => setItemId(result.rows[0].itemId)}
            onClose={() => setEditor(null)}
          />
        )}
    </>
  );
}
