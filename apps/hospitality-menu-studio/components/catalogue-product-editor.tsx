"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Button, formatDate, Pill } from "./studio-ui";
import {
  createProductCommand,
  currentRoute,
  initialProductCreation,
  productDetails,
  productRoutes,
  updateProductCommand,
  type ProductCommand,
  type ProductCreation,
  type ProductDetails,
  type ProductEditorRow,
  type ProductEditorSite,
  type ProductRoute,
  type ProductSaveResult,
} from "./catalogue-product-model";
import { CatalogueCommandError } from "./catalogue-state";
import styles from "./catalogue-product-editor.module.css";

type Props = {
  row: ProductEditorRow | null;
  oplocs: readonly ProductEditorSite[];
  categories: readonly string[];
  send: (command: ProductCommand) => Promise<ProductSaveResult>;
  onSaved: (result: ProductSaveResult) => void;
  onClose: () => void;
};

const pounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});
const vatPercent = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 4,
});

function InputField({
  label,
  ...input
}: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="fika-field">
      {label}
      <input {...input} className="fika-input" />
    </label>
  );
}

function RouteChoice({
  value,
  onChange,
}: {
  value: ProductRoute | "";
  onChange: (choice: ProductRoute | "") => void;
}) {
  const id = useId();
  return (
    <div className="fika-field">
      <label htmlFor={id}>Production route</label>
      <select
        id={id}
        className="fika-select"
        value={value}
        onChange={(event) => onChange(event.target.value as ProductRoute | "")}
      >
        <option value="">Choose a route</option>
        {Object.entries(productRoutes).map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

function CreationSettings({
  settings,
  setSettings,
  sites,
}: {
  settings: ProductCreation;
  setSettings: (settings: ProductCreation) => void;
  sites: readonly ProductEditorSite[];
}) {
  const [query, setQuery] = useState("");
  const activeSites = sites.filter((site) => site.active);
  const matchingSites = activeSites.filter((site) =>
    site.label
      .toLocaleLowerCase("en-GB")
      .includes(query.trim().toLocaleLowerCase("en-GB")),
  );
  const selected = new Set(settings.siteIds);
  const change = <K extends keyof ProductCreation>(
    key: K,
    value: ProductCreation[K],
  ) => setSettings({ ...settings, [key]: value });
  return (
    <>
      <RouteChoice
        value={settings.route}
        onChange={(choice) => change("route", choice)}
      />
      <section className={styles.group} aria-label="Initial site availability">
        <h3>Initial site availability</h3>
        <p className="fika-help">
          {selected.size} of {activeSites.length} active sites selected.
        </p>
        {activeSites.length > 5 && (
          <InputField
            label="Find an active site"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <div className={styles.actions}>
          <Button
            onClick={() =>
              change(
                "siteIds",
                activeSites.map((site) => site.oplocId),
              )
            }
          >
            Select all sites
          </Button>
          <Button
            disabled={!selected.size}
            onClick={() => change("siteIds", [])}
          >
            Clear selection
          </Button>
        </div>
        <div className={styles.siteList}>
          {matchingSites.map((site) => (
            <label className="fika-choice" key={site.oplocId}>
              <input
                type="checkbox"
                checked={selected.has(site.oplocId)}
                onChange={(event) =>
                  change(
                    "siteIds",
                    event.target.checked
                      ? [...settings.siteIds, site.oplocId]
                      : settings.siteIds.filter((id) => id !== site.oplocId),
                  )
                }
              />
              {site.label}
            </label>
          ))}
          {matchingSites.length === 0 && (
            <p>
              {activeSites.length
                ? "No active sites match this search."
                : "No active sites are available."}
            </p>
          )}
        </div>
        <label className="fika-choice">
          <input
            type="checkbox"
            checked={settings.restrictToSites}
            onChange={(event) =>
              change("restrictToSites", event.target.checked)
            }
          />
          Limit the product to selected sites, including when new sites are
          added
        </label>
      </section>
      <details className={styles.group}>
        <summary>Advanced product defaults</summary>
        <div className={styles.fields}>
          <div className={styles.grid}>
            <InputField
              label="Minimum guests"
              inputMode="numeric"
              value={settings.minimumGuests}
              onChange={(event) => change("minimumGuests", event.target.value)}
            />
            <InputField
              label="Minimum notice (days)"
              inputMode="numeric"
              value={settings.noticeDays}
              onChange={(event) => change("noticeDays", event.target.value)}
            />
          </div>
          {settings.mode === "quote_only" && (
            <InputField
              label="Indicative starting price (£)"
              inputMode="decimal"
              value={settings.indicativeFrom}
              onChange={(event) => change("indicativeFrom", event.target.value)}
            />
          )}
          <InputField
            label="Selling unit"
            maxLength={80}
            value={settings.salesUnit}
            onChange={(event) => change("salesUnit", event.target.value)}
          />
          <div className={styles.grid}>
            <InputField
              label="Production quantity per selling unit"
              inputMode="decimal"
              value={settings.productionMultiplier}
              onChange={(event) =>
                change("productionMultiplier", event.target.value)
              }
            />
            <InputField
              label="Production unit"
              maxLength={80}
              value={settings.productionUnit}
              onChange={(event) => change("productionUnit", event.target.value)}
            />
          </div>
          <p className="fika-help">
            Enter all three unit fields to convert the sold quantity into
            kitchen units.
          </p>
        </div>
      </details>
    </>
  );
}

export function CatalogueProductEditor({
  row,
  oplocs,
  categories,
  send,
  onSaved,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const confirmationCancel = useRef<HTMLButtonElement>(null);
  const archiveTrigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const id = useId();
  const [product, setProduct] = useState(row);
  const [details, setDetails] = useState(() => productDetails(row));
  const [creation, setCreation] = useState(() =>
    initialProductCreation(oplocs),
  );
  const [route, setRoute] = useState(() => currentRoute(row));
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<ProductCommand | null>(null);
  const [receipt, setReceipt] = useState<ProductSaveResult | null>(null);

  useEffect(() => {
    const surface = dialog.current;
    if (!surface) return;
    surface.showModal();
    title.current?.focus();
    return () => surface.close();
  }, []);

  useEffect(() => {
    if (archiveOpen) confirmationCancel.current?.focus();
  }, [archiveOpen]);

  const original = productDetails(product);
  const changed = (Object.keys(original) as Array<keyof ProductDetails>).some(
    (key) => details[key] !== original[key],
  );
  const newerVersion = Boolean(
    product &&
      row &&
      (product.itemId !== row.itemId ||
        product.version < row.version ||
        product.routing.version < row.routing.version),
  );
  const locked = busy || conflict || newerVersion || Boolean(unconfirmed);
  const archived = product?.status === "archived";
  const quoteOnly = product
    ? product.defaultMode === "quote_only"
    : creation.mode === "quote_only";
  const priceModeUnavailable = Boolean(product && !product.defaultMode);
  const change = (key: keyof ProductDetails, value: string) =>
    setDetails((current) => ({ ...current, [key]: value }));

  function close() {
    if (inFlight.current) return;
    dialog.current?.close();
    onClose();
  }

  function cancelArchive() {
    setArchiveOpen(false);
    archiveTrigger.current?.focus();
  }

  async function submit(command: ProductCommand) {
    if (inFlight.current || conflict || newerVersion) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setReceipt(null);
    let saved: ProductSaveResult;
    try {
      saved = await send(command);
    } catch (failure) {
      const reported =
        failure instanceof CatalogueCommandError &&
        failure.status !== undefined;
      setError(
        reported
          ? failure.message
          : "Hub did not confirm this change. The outcome is unknown. Retry this exact request or check the catalogue.",
      );
      setUnconfirmed(reported ? null : command);
      if (
        reported &&
        failure.status === 409 &&
        /changed elsewhere/i.test(failure.message)
      )
        setConflict(true);
      return;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    const next = saved.rows[0];
    setProduct(next);
    setDetails(productDetails(next));
    setRoute(currentRoute(next));
    setUnconfirmed(null);
    setArchiveOpen(false);
    setReceipt(saved);
    onSaved(saved);
    if (
      command.action === "set-item-status" ||
      command.action === "create-item"
    ) {
      requestAnimationFrame(() => title.current?.focus());
    }
  }

  function saveDetails() {
    if (locked || archived) return;
    setError("");
    try {
      const command = product
        ? updateProductCommand(details, product)
        : createProductCommand(
            details,
            creation,
            oplocs,
            (requestId.current ??= crypto.randomUUID()),
          );
      if (command) void submit(command);
      else setDetails(original);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  function setStatus(status: ProductEditorRow["status"]) {
    if (!product || locked || changed) return;
    void submit({
      action: "set-item-status",
      itemId: product.itemId,
      expectedVersion: product.version,
      status,
    });
  }

  return (
    <dialog
      ref={dialog}
      className={
        "fika-dialog-surface fika-dialog-surface--large " + styles.dialog
      }
      aria-labelledby={id + "-title"}
      onCancel={(event) => {
        event.preventDefault();
        if (inFlight.current) return;
        if (archiveOpen) {
          cancelArchive();
          return;
        }
        close();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 ref={title} id={id + "-title"} tabIndex={-1}>
            {product?.name ?? "Create product"}
          </h2>
          {product && (
            <Pill tone={archived ? "neutral" : "info"}>
              {archived ? "Archived" : "Active"}
            </Pill>
          )}
        </div>
        <Button onClick={close} disabled={busy}>
          Close
        </Button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          saveDetails();
        }}
        className={styles.form}
        aria-busy={busy}
      >
        <div className={styles.feedback}>
          {busy && <p role="status">Saving to the Hub catalogue…</p>}
          {receipt && (
            <div className="fika-notice" role="status">
              <strong>{receipt.message}</strong>
              {receipt.package === "stale" && (
                <p>
                  Product changes are saved. The booking catalogue is awaiting
                  refresh.
                </p>
              )}
            </div>
          )}
          {newerVersion && (
            <p className="fika-notice fika-notice--warning" role="alert">
              This product changed elsewhere. Reopen it from the refreshed
              catalogue.
            </p>
          )}
          {error && (
            <p className="fika-notice fika-notice--danger" role="alert">
              {error}
            </p>
          )}
          {unconfirmed && (
            <Button onClick={() => void submit(unconfirmed)} disabled={busy}>
              Retry the same request
            </Button>
          )}
        </div>
        <fieldset className={styles.fields} disabled={locked || archived}>
          <legend>Product details</legend>
          <div className={styles.grid}>
            <InputField
              label="Product name"
              value={details.name}
              onChange={(event) => change("name", event.target.value)}
              required
              maxLength={240}
            />
            <InputField
              label="Category"
              list={id + "-categories"}
              value={details.category}
              onChange={(event) => change("category", event.target.value)}
              required
              maxLength={160}
            />
            <datalist id={id + "-categories"}>
              {[...new Set(categories)].map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </div>
          <label className="fika-field">
            Product description
            <textarea
              className="fika-textarea"
              value={details.description}
              onChange={(event) => change("description", event.target.value)}
              maxLength={4000}
              rows={2}
            />
          </label>
          {!product && (
            <div className="fika-field">
              <label htmlFor={id + "-booking-mode"}>Booking mode</label>
              <select
                id={id + "-booking-mode"}
                className="fika-select"
                value={creation.mode}
                onChange={(event) =>
                  setCreation({
                    ...creation,
                    mode:
                      event.target.value === "quote_only"
                        ? "quote_only"
                        : "standard",
                  })
                }
              >
                <option value="standard">Standard purchase</option>
                <option value="quote_only">Quote only</option>
              </select>
            </div>
          )}
          {quoteOnly && !product ? (
            <p className="fika-help">
              Quote only. Operators agree the price during quotation.
            </p>
          ) : (
            <>
              <div className={styles.grid}>
                <InputField
                  label="Company net price (£)"
                  inputMode="decimal"
                  value={details.price}
                  onChange={(event) => change("price", event.target.value)}
                  required={!product}
                  disabled={priceModeUnavailable}
                />
                <InputField
                  label="VAT (%)"
                  inputMode="decimal"
                  value={details.vat}
                  onChange={(event) => change("vat", event.target.value)}
                  required={!product || Boolean(details.price.trim())}
                  disabled={priceModeUnavailable}
                />
              </div>
              {product?.defaultPrice && (
                <p className="fika-help">
                  Current company price{" "}
                  {pounds.format(product.defaultPrice.amount)} ex VAT ·{" "}
                  {vatPercent.format(product.defaultPrice.vatRate)} VAT ·
                  effective from{" "}
                  {formatDate(product.defaultPrice.effectiveFrom)}
                </p>
              )}
              <p className="fika-help">
                {priceModeUnavailable
                  ? "The product booking mode is unavailable. Refresh the catalogue before changing the price."
                  : quoteOnly
                    ? "Standard-purchase sites without a price override inherit this company price. Quote-only sites keep their quotation workflow."
                    : "Sites without an override inherit this price. Price changes take effect on the current UK business date."}
              </p>
            </>
          )}
          <InputField
            label="Company minimum quantity"
            inputMode="numeric"
            value={details.minimum}
            onChange={(event) => change("minimum", event.target.value)}
          />
          {!product && (
            <CreationSettings
              settings={creation}
              setSettings={setCreation}
              sites={oplocs}
            />
          )}
        </fieldset>
        {!archived && (
          <div className={styles.actions}>
            <Button
              type="submit"
              primary
              disabled={locked || Boolean(product && !changed)}
            >
              {product ? "Save product details" : "Create product"}
            </Button>
          </div>
        )}
      </form>
      {product && !archived && (
        <fieldset className={styles.group} disabled={locked || changed}>
          <legend>Production routing</legend>
          <RouteChoice value={route} onChange={setRoute} />
          {product.routingSuggestion && (
            <p className="fika-help">
              Suggested route {productRoutes[product.routingSuggestion.choice]}.{" "}
              {product.routingSuggestion.reason}
            </p>
          )}
          {changed && (
            <p className="fika-help">
              Save the product details before changing the production route.
            </p>
          )}
          <Button
            disabled={
              locked || changed || !route || route === currentRoute(product)
            }
            onClick={() =>
              route &&
              void submit({
                action: "set-routing",
                itemId: product.itemId,
                expectedRoutingVersion: product.routing.version,
                routing: route,
              })
            }
          >
            Save production route
          </Button>
        </fieldset>
      )}
      {product && (
        <section className={styles.group} aria-label="Product lifecycle">
          {archived ? (
            <>
              <p>
                Restoring a product reapplies its saved company and site
                settings.
              </p>
              <Button disabled={locked} onClick={() => setStatus("active")}>
                Restore product
              </Button>
            </>
          ) : (
            <>
              <button
                ref={archiveTrigger}
                type="button"
                className="fika-button fika-button--secondary"
                aria-expanded={archiveOpen}
                disabled={locked || changed}
                onClick={() => setArchiveOpen(true)}
              >
                Archive product
              </button>
              {archiveOpen && (
                <div className="fika-notice fika-notice--warning">
                  <h3>Archive this product?</h3>
                  <p>
                    It will disappear from all booking menus. Existing quotes
                    and bookings keep their saved details.
                  </p>
                  <div className={styles.actions}>
                    <button
                      ref={confirmationCancel}
                      type="button"
                      className="fika-button fika-button--secondary"
                      onClick={cancelArchive}
                      disabled={busy}
                    >
                      Cancel archive
                    </button>
                    <button
                      type="button"
                      className="fika-button fika-button--danger"
                      onClick={() => setStatus("archived")}
                      disabled={locked || changed}
                    >
                      Confirm archive
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </dialog>
  );
}
