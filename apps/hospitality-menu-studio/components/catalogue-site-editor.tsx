"use client";

import { useId, useState } from "react";
import { Button, Pill } from "./studio-ui";
import type {
  CataloguePrice,
  CatalogueRow,
  CatalogueSend,
  CatalogueSite,
} from "./catalogue-wire";
import {
  siteOverrideDraft,
  siteOverridePatch,
  siteValues,
  type SiteMode,
  type SiteOverrideDraft,
} from "./catalogue-site-editor-model";
import { useSiteOperation } from "./catalogue-site-operation";
import styles from "./catalogue-site-editor.module.css";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});
const percent = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 2,
});

function priceLabel(price: CataloguePrice) {
  return (
    money.format(price.amount) +
    " ex VAT · " +
    percent.format(price.vatRate) +
    " VAT"
  );
}

type Props = {
  row: CatalogueRow;
  oplocs: readonly CatalogueSite[];
  canManage: boolean;
  send: CatalogueSend;
  reload: () => Promise<void>;
  fixedSiteId?: string;
};

export function CatalogueSiteEditor({
  row,
  oplocs,
  canManage,
  send,
  reload,
  fixedSiteId,
}: Props) {
  const sites = oplocs.filter((site) => site.active);
  const [chosenSiteId, setSiteId] = useState("");
  const siteId = fixedSiteId ?? chosenSiteId;
  const site = sites.find((entry) => entry.oplocId === siteId);
  const operation = useSiteOperation(send, reload);

  return (
    <details className={styles.panel} open={fixedSiteId ? true : undefined}>
      <summary>Product settings by site</summary>
      <div className={styles.stack}>
        {!fixedSiteId && (
          <label className="fika-field">
            Site
            <select
              className="fika-select"
              value={site ? siteId : ""}
              disabled={operation.busy}
              onChange={(event) => {
                operation.reset();
                setSiteId(event.target.value);
              }}
            >
              <option value="">Choose a site</option>
              {sites.map((entry) => (
                <option key={entry.oplocId} value={entry.oplocId}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {!sites.length && (
          <p role="status">No active sites were returned by Hub.</p>
        )}
        {site && (
          <SiteSettings
            key={row.itemId + ":" + siteId}
            row={row}
            site={site}
            canManage={canManage}
            operation={operation}
          />
        )}
      </div>
    </details>
  );
}

type SiteDraft = {
  version: number;
  original: SiteOverrideDraft;
  values: SiteOverrideDraft;
};

function SiteSettings({
  row,
  site,
  canManage,
  operation,
}: {
  row: CatalogueRow;
  site: CatalogueSite;
  canManage: boolean;
  operation: ReturnType<typeof useSiteOperation>;
}) {
  const siteId = site.oplocId;
  const guestsInput = useId();
  const noticeInput = useId();
  const { available, mode, offering, ambiguous } = siteValues(row, siteId);
  const modeKnown = Boolean(offering || row.defaultMode || row.defaultPrice);
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [availabilityDraft, setAvailabilityDraft] = useState<{
    version: number;
    available: boolean;
  } | null>(null);
  const values =
    draft?.values ??
    siteOverrideDraft(row, { available, mode, offering, ambiguous });
  const price = offering ? offering.price.effective : row.defaultPrice;
  const minimum = offering?.minimum.effective ?? row.defaultMinimumQuantity;
  const archived = row.status === "archived";
  const outOfDate =
    (draft !== null && draft.version !== row.version) ||
    (availabilityDraft !== null && availabilityDraft.version !== row.version);
  const locked = operation.busy || operation.conflict || outOfDate;
  const areaRules = row.offerings.filter(
    (entry) =>
      entry.oplocId === siteId &&
      entry.status === "active" &&
      entry.operationalAreaId,
  );

  function update<K extends keyof SiteOverrideDraft>(
    field: K,
    value: SiteOverrideDraft[K],
  ) {
    operation.resetFeedback();
    setDraft((current) => {
      const original = current?.original ?? values;
      return {
        version: current?.version ?? row.version,
        original,
        values: { ...(current?.values ?? original), [field]: value },
      };
    });
  }

  async function saveOverride() {
    if (!draft || locked || !canManage || archived || ambiguous) return;
    try {
      const patch = siteOverridePatch(
        draft.original,
        draft.values,
        row.defaultPrice,
      );
      if (!Object.keys(patch).length) {
        operation.report("No site override changes to save.");
        return;
      }
      await operation.submit(
        {
          action: "set-site-override",
          itemId: row.itemId,
          oplocId: siteId,
          expectedVersion: draft.version,
          ...patch,
        },
        () => setDraft(null),
      );
    } catch (error) {
      operation.report(
        error instanceof Error ? error.message : "Check the site settings.",
      );
    }
  }

  return (
    <div className={styles.stack}>
      <div className={styles.scope}>
        <h3>{site.label}</h3>
        <Pill tone={available ? "success" : "neutral"}>
          {available ? "Site permission granted" : "Site permission denied"}
        </Pill>
      </div>
      <p className="fika-help">
        Booking services and event-date prices are checked separately.
      </p>
      {ambiguous ? (
        <p className="fika-notice fika-notice--warning" role="status">
          Hub has more than one active site-wide record here. Review the
          conflicting catalogue records before editing this site.
        </p>
      ) : (
        <dl className={styles.metrics}>
          <div>
            <dt>Configured price</dt>
            <dd>
              {!modeKnown
                ? "Company offering mode unavailable"
                : mode === "quote_only"
                  ? "Quote only"
                  : price
                    ? priceLabel(price)
                    : "No current price"}
            </dd>
          </div>
          <div>
            <dt>Price source</dt>
            <dd>
              {mode === "quote_only"
                ? "Quote only"
                : price
                  ? offering?.price.override
                    ? "Site price"
                    : "Company price"
                  : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Minimum quantity</dt>
            <dd>
              {minimum !== undefined
                ? minimum +
                  (offering?.minimum.override !== undefined
                    ? " · Site minimum"
                    : " · Company minimum")
                : "No minimum set"}
            </dd>
          </div>
          {modeKnown && mode === "standard" && price?.effectiveFrom && (
            <div>
              <dt>Price effective from</dt>
              <dd>{price.effectiveFrom}</dd>
            </div>
          )}
        </dl>
      )}
      {areaRules.length > 0 && (
        <details className={styles.panel}>
          <summary>Operational area settings</summary>
          <p className="fika-help">
            The site controls below apply to the site-wide setting.
          </p>
          <ul>
            {areaRules.map((rule) => (
              <li key={rule.offeringId}>
                <strong>{rule.operationalAreaId}</strong>
                <p>
                  {rule.available
                    ? "Configured as available in this area"
                    : "Configured as unavailable in this area"}
                </p>
                <p>
                  {rule.mode === "quote_only"
                    ? "Quote only"
                    : rule.price.effective
                      ? priceLabel(rule.price.effective)
                      : "No current price"}
                </p>
                {rule.minimum.effective !== undefined && (
                  <p>Minimum quantity {rule.minimum.effective}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {archived && (
        <p role="status">
          Restore this product before changing its site settings.
        </p>
      )}
      {!canManage && (
        <p role="status">
          View only. Editing site settings requires catalogue management
          permission.
        </p>
      )}
      {operation.message && (
        <p className="fika-notice" role="status">
          {operation.message}
        </p>
      )}
      {operation.error && (
        <p className="fika-notice fika-notice--warning" role="alert">
          {operation.error}
        </p>
      )}
      {(operation.conflict || outOfDate) && (
        <div className={styles.stack}>
          <p role="status">
            Refresh the current Hub settings and review the site again before
            saving.
          </p>
          <Button
            disabled={operation.busy}
            onClick={() =>
              void operation.refresh(() => {
                setDraft(null);
                setAvailabilityDraft(null);
              })
            }
          >
            Refresh site settings
          </Button>
        </div>
      )}
      {canManage && !archived && !ambiguous && (
        <>
          <form
            className={styles.stack}
            onSubmit={(event) => {
              event.preventDefault();
              if (
                locked ||
                !availabilityDraft ||
                availabilityDraft.available === available
              )
                return;
              void operation.submit(
                {
                  action: "set-site-availability",
                  itemId: row.itemId,
                  oplocId: siteId,
                  expectedVersion: availabilityDraft.version,
                  available: availabilityDraft.available,
                },
                () => setAvailabilityDraft(null),
              );
            }}
          >
            <label className={styles.choice}>
              <input
                type="checkbox"
                checked={availabilityDraft?.available ?? available}
                disabled={locked}
                onChange={(event) => {
                  operation.resetFeedback();
                  const permitted = event.target.checked;
                  setAvailabilityDraft(
                    permitted === available
                      ? null
                      : {
                          version: availabilityDraft?.version ?? row.version,
                          available: permitted,
                        },
                  );
                }}
              />
              Permit this product at {site.label}
            </label>
            {availabilityDraft && availabilityDraft.available !== available && (
              <Button type="submit" primary disabled={locked}>
                {operation.busy ? "Saving…" : "Save site permission"}
              </Button>
            )}
          </form>
          <details className={styles.panel}>
            <summary>Edit site overrides</summary>
            <form
              className={styles.stack}
              onSubmit={(event) => {
                event.preventDefault();
                void saveOverride();
              }}
            >
              <p className="fika-help">
                Leave an override blank to follow company settings. Hub applies
                new prices from the current UK business date.
              </p>
              <fieldset className={styles.fields} disabled={locked}>
                <div className={styles.stack}>
                  <label className="fika-field">
                    Offering mode
                    <select
                      className="fika-select"
                      value={modeKnown ? values.mode : ""}
                      disabled={!modeKnown}
                      onChange={(event) =>
                        update("mode", event.target.value as SiteMode)
                      }
                    >
                      {!modeKnown && (
                        <option value="">Company mode unavailable</option>
                      )}
                      <option value="standard">Standard</option>
                      <option value="quote_only">Quote only</option>
                    </select>
                  </label>
                  {modeKnown && values.mode === "standard" && (
                    <div className={styles.pair}>
                      <label className="fika-field">
                        Site price excluding VAT (£)
                        <input
                          className="fika-input"
                          type="number"
                          min="0"
                          step=".01"
                          value={values.price}
                          onChange={(event) =>
                            update("price", event.target.value)
                          }
                        />
                      </label>
                      <label className="fika-field">
                        VAT percentage
                        <input
                          className="fika-input"
                          type="number"
                          min="0"
                          max="100"
                          step=".01"
                          value={values.vat}
                          disabled={!values.price.trim()}
                          onChange={(event) =>
                            update("vat", event.target.value)
                          }
                        />
                      </label>
                    </div>
                  )}
                  {values.mode === "quote_only" &&
                    draft?.original.price.trim() &&
                    draft.original.mode !== "quote_only" && (
                      <p className="fika-notice fika-notice--warning">
                        Saving quote only removes the site price override in the
                        same change.
                      </p>
                    )}
                  <label className="fika-field">
                    Minimum quantity override
                    <input
                      className="fika-input"
                      type="number"
                      min="1"
                      step="1"
                      value={values.minimum}
                      onChange={(event) =>
                        update("minimum", event.target.value)
                      }
                    />
                  </label>
                  <details className={styles.panel}>
                    <summary>Guest limits, notice and site wording</summary>
                    <div className={styles.stack}>
                      <div className={styles.pair}>
                        <div className="fika-field">
                          <label htmlFor={guestsInput}>
                            Minimum guests override
                          </label>
                          <input
                            id={guestsInput}
                            aria-describedby={guestsInput + "-default"}
                            className="fika-input"
                            type="number"
                            min="1"
                            step="1"
                            value={values.guests}
                            onChange={(event) =>
                              update("guests", event.target.value)
                            }
                          />
                          <span
                            id={guestsInput + "-default"}
                            className="fika-help"
                          >
                            Company minimum guests{" "}
                            {row.defaultMinimumGuests ?? "unset"}
                          </span>
                        </div>
                        <div className="fika-field">
                          <label htmlFor={noticeInput}>
                            Required notice override in days
                          </label>
                          <input
                            id={noticeInput}
                            aria-describedby={noticeInput + "-default"}
                            className="fika-input"
                            type="number"
                            min="0"
                            step="1"
                            value={values.notice}
                            onChange={(event) =>
                              update("notice", event.target.value)
                            }
                          />
                          <span
                            id={noticeInput + "-default"}
                            className="fika-help"
                          >
                            Company notice in days{" "}
                            {row.defaultNoticeRequiredDays ?? "unset"}
                          </span>
                        </div>
                      </div>
                      <label className="fika-field">
                        Customer-visible name override
                        <input
                          className="fika-input"
                          maxLength={240}
                          value={values.displayName}
                          onChange={(event) =>
                            update("displayName", event.target.value)
                          }
                        />
                      </label>
                      <label className="fika-field">
                        Customer-visible description override
                        <textarea
                          className="fika-textarea"
                          maxLength={1000}
                          rows={3}
                          value={values.description}
                          onChange={(event) =>
                            update("description", event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </details>
                </div>
              </fieldset>
              <div className={styles.actions}>
                <Button type="submit" primary disabled={!draft || locked}>
                  {operation.busy ? "Saving…" : "Save site overrides"}
                </Button>
                {draft && (
                  <Button
                    disabled={operation.busy}
                    onClick={() => {
                      setDraft(null);
                      operation.resetFeedback();
                    }}
                  >
                    Discard override edits
                  </Button>
                )}
              </div>
            </form>
          </details>
        </>
      )}
    </div>
  );
}
