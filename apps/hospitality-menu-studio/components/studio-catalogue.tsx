"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CatalogueProductEditor } from "./catalogue-product-editor";
import { productReceipt, type ProductCommand } from "./catalogue-product-model";
import {
  applyCatalogueReceipt,
  CatalogueCommandError,
  isCataloguePayload,
  requestCatalogueCommand,
} from "./catalogue-state";
import type {
  CatalogueCommand,
  CatalogueCommandResult,
  CataloguePayload,
  CataloguePrice,
} from "./catalogue-wire";
import { Button, PageHeading, Pill } from "./studio-ui";
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

export function CatalogueView({
  area,
  initialItemId,
  back,
}: {
  area: "products" | "sites";
  initialItemId?: string;
  back?: () => void;
}) {
  const [data, setData] = useState<CataloguePayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState<CatalogueCommandResult | null>(null);
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [search, setSearch] = useState("");
  const [itemId, setItemId] = useState(initialItemId || "");
  const [siteId, setSiteId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [verification, setVerification] = useState("");
  const [checking, setChecking] = useState(false);
  const pendingWrite = useRef(false);
  const pendingRead = useRef<AbortController | null>(null);
  const catalogueRevision = useRef(0);
  const selection = useRef("");
  selection.current = JSON.stringify([itemId, siteId, serviceId, eventDate]);

  const reload = useCallback(async () => {
    if (pendingWrite.current) return;
    pendingRead.current?.abort();
    const controller = new AbortController();
    pendingRead.current = controller;
    setLoading(true);
    setError("");
    setData(null);
    setNotice(null);
    setVerification("");
    catalogueRevision.current++;
    try {
      const response = await fetch("/api/catalogue", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          "Catalogue access is unavailable. Check your access or try again.",
        );
      const value: unknown = await response.json();
      if (!isCataloguePayload(value))
        throw new Error("Catalogue information is unavailable. Try again.");
      if (!controller.signal.aborted) setData(value);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(
          (failure as Error).message || "Catalogue information is unavailable.",
        );
      }
    } finally {
      if (pendingRead.current === controller) {
        pendingRead.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => pendingRead.current?.abort();
  }, [reload]);

  useEffect(() => {
    setItemId(initialItemId || "");
  }, [initialItemId]);
  useEffect(() => {
    setVerification("");
  }, [itemId, siteId, serviceId, eventDate]);

  async function send(
    command: CatalogueCommand,
    confirm?: (receipt: CatalogueCommandResult) => boolean,
  ) {
    if (data?.canManage !== true) {
      throw new CatalogueCommandError(
        "This action requires Hub catalogue management access.",
        403,
      );
    }
    if (pendingWrite.current || pendingRead.current) {
      throw new CatalogueCommandError(
        "Wait for the current catalogue request to finish.",
        400,
      );
    }
    pendingWrite.current = true;
    setWriting(true);
    setNotice(null);
    try {
      const receipt = await requestCatalogueCommand(command);
      if (confirm && !confirm(receipt)) {
        throw new CatalogueCommandError(
          "Hub did not confirm the target product or version.",
        );
      }
      setData((previous) =>
        previous ? applyCatalogueReceipt(previous, receipt) : previous,
      );
      setNotice(receipt);
      setVerification("");
      catalogueRevision.current++;
      return receipt;
    } finally {
      pendingWrite.current = false;
      setWriting(false);
    }
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
      catalogueRevision.current === revision;
    setChecking(true);
    setVerification("");
    try {
      const query = new URLSearchParams({
        itemId,
        siteId,
        serviceId,
        eventDate,
      });
      const response = await fetch("/api/catalogue/availability?" + query, {
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

  const selected = data?.rows.find((row) => row.itemId === itemId);
  const sites = data?.oplocs.filter((site) => site.active) ?? [];
  const siteWide =
    selected?.offerings.filter(
      (row) =>
        row.oplocId === siteId &&
        !row.operationalAreaId &&
        row.status === "active",
    ) ?? [];
  const offering = siteWide.length === 1 ? siteWide[0] : undefined;
  const layout = data?.serviceLayout;
  const companyRules = layout?.company.services;
  const siteRules = layout?.sites[siteId]?.services;
  const query = search.trim().toLocaleLowerCase("en-GB");

  return (
    <>
      <PageHeading
        title={area === "products" ? "Products & pricing" : "Sites & services"}
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
            Create product
          </Button>
        )}
      </PageHeading>
      <p>
        Products control commercial settings. Menu sections control the dishes
        and rotation linked to them.
      </p>
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
          {data.canManage === false && (
            <p className="fika-help">
              Read-only access. Changes require Hub catalogue management
              permission.
            </p>
          )}
          <label className="fika-field">
            Search products
            <input
              className="fika-input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="fika-field">
            Product
            <select
              className="fika-select"
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
            >
              <option value="">Choose a product</option>
              {data.rows
                .filter(
                  (row) =>
                    row.itemId === itemId ||
                    (row.name + " " + row.category)
                      .toLocaleLowerCase("en-GB")
                      .includes(query),
                )
                .map((row) => (
                  <option key={row.itemId} value={row.itemId}>
                    {row.name} · {row.category} · {row.status}
                  </option>
                ))}
            </select>
          </label>
          {itemId && !selected && (
            <p role="status">
              The saved mapping points to an item missing from the current
              catalogue.
            </p>
          )}
          {!data.rows.length && <p>No products are available.</p>}
          {selected && (
            <section aria-label="Product details">
              <h2>{selected.name}</h2>
              <Pill>{words(selected.status)}</Pill>
              <p>{selected.description || "No description recorded"}</p>
              <dl>
                <dt>Category</dt>
                <dd>{selected.category}</dd>
                <dt>Company price</dt>
                <dd>{money(selected.defaultPrice)}</dd>
                <dt>Company minimum</dt>
                <dd>{selected.defaultMinimumQuantity ?? "Not set"}</dd>
                {selected.defaultMode === "quote_only" && (
                  <>
                    <dt>Company booking mode</dt>
                    <dd>Quote only</dd>
                  </>
                )}
                <dt>Production routing</dt>
                <dd>{words(selected.routing.state)}</dd>
              </dl>
              {selected.needsReview.length > 0 && (
                <p>
                  Needs review · {selected.needsReview.map(words).join(", ")}
                </p>
              )}
              {area === "products" && data.canManage === true && (
                <Button disabled={writing} onClick={() => setEditor("edit")}>
                  Edit product
                </Button>
              )}
            </section>
          )}
          {area === "sites" && (
            <>
              <label className="fika-field">
                Site
                <select
                  className="fika-select"
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value)}
                >
                  <option value="">Choose a site</option>
                  {sites.map((site) => (
                    <option key={site.oplocId} value={site.oplocId}>
                      {site.label}
                    </option>
                  ))}
                </select>
              </label>
              {selected && siteId && (
                <section aria-label="Site availability">
                  <h2>Site availability</h2>
                  <p>
                    {selected.availableAt.includes(siteId)
                      ? "Configured as available"
                      : "Unavailable in site settings"}
                  </p>
                  {siteWide.length > 1 ? (
                    <p>
                      Several active site exceptions exist. Check catalogue
                      availability for the event date.
                    </p>
                  ) : (
                    <dl>
                      <dt>Price</dt>
                      <dd>
                        {offering
                          ? words(offering.price.source) +
                            (offering.price.effective
                              ? " · " + money(offering.price.effective)
                              : "")
                          : selected.defaultMode === "quote_only"
                            ? "Quote only"
                            : "Company default · " +
                              money(selected.defaultPrice)}
                      </dd>
                      <dt>Minimum</dt>
                      <dd>
                        {offering
                          ? words(offering.minimum.source) +
                            (offering.minimum.effective != null
                              ? " · " + offering.minimum.effective
                              : "")
                          : "Company default · " +
                            (selected.defaultMinimumQuantity ?? "Not set")}
                      </dd>
                    </dl>
                  )}
                </section>
              )}
              {selected && siteId && companyRules && (
                <section aria-label="Verify catalogue availability">
                  <h2>Verify catalogue availability</h2>
                  <label className="fika-field">
                    Booking service
                    <select
                      className="fika-select"
                      value={serviceId}
                      onChange={(event) => setServiceId(event.target.value)}
                    >
                      <option value="">Choose a service</option>
                      {Object.keys(companyRules).map((id) => (
                        <option key={id} value={id}>
                          {words(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="fika-field">
                    Event date
                    <input
                      className="fika-input"
                      type="date"
                      value={eventDate}
                      onChange={(event) => setEventDate(event.target.value)}
                    />
                  </label>
                  <Button
                    disabled={!serviceId || !eventDate || checking || writing}
                    onClick={() => void verify()}
                  >
                    {checking ? "Checking…" : "Check availability"}
                  </Button>
                  {verification && <p role="status">{verification}</p>}
                </section>
              )}
              {siteId && (
                <section aria-label="Booking service configuration">
                  <h2>Booking services</h2>
                  <p>
                    These settings show configured category permissions. Check
                    catalogue availability by product, service and event date.
                  </p>
                  {!companyRules ? (
                    <p role="status">Service configuration is unavailable.</p>
                  ) : (
                    Object.entries(companyRules).map(([id, company]) => {
                      const rule = siteRules?.[id] || company;
                      return (
                        <div key={id}>
                          <h3>{words(id)}</h3>
                          <p>
                            {rule.hidden ? "Hidden" : "Visible"} ·{" "}
                            {siteRules?.[id]
                              ? "Site override"
                              : "Company default"}
                          </p>
                          <p>
                            Category order ·{" "}
                            {rule.categories.join(", ") || "None"}
                          </p>
                          {selected && (
                            <p>
                              {rule.hidden
                                ? "Service hidden"
                                : rule.categories.includes(selected.category)
                                  ? "Product category configured for this service"
                                  : "Product category excluded from this service"}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </section>
              )}
            </>
          )}
        </div>
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
