"use client";

import { useId, useState } from "react";
import {
  isServiceId,
  MAX_CATEGORIES_PER_SERVICE,
  sameServiceRule,
  SERVICE_IDS,
  type ServiceId,
  type ServiceRule,
} from "@fika/server-shared/hospitality-service-layout";
import { Button, Pill } from "./studio-ui";
import type {
  CataloguePayload,
  CatalogueServiceLayout,
} from "./catalogue-wire";
import {
  BOOKING_SERVICE_LABELS,
  configuredService,
  moveServiceCategory,
  serviceCategoryOptions,
  serviceDraftProblem,
  serviceUpdateCommand,
  visibleServiceRule,
} from "./catalogue-service-editor-model";
import {
  useSiteOperation,
  type CatalogueEditSend,
} from "./catalogue-site-operation";
import { CatalogueCategoryRename } from "./catalogue-category-rename";
import styles from "./catalogue-site-editor.module.css";

type Props = {
  payload: CataloguePayload;
  canManage: boolean;
  send: CatalogueEditSend;
  reload: () => Promise<void>;
  initialSiteId?: string;
  initialServiceId?: ServiceId;
  initialItemId?: string;
};

export function CatalogueServiceEditor({
  payload,
  canManage,
  send,
  reload,
  initialSiteId,
  initialServiceId,
  initialItemId,
}: Props) {
  const [scope, setScope] = useState(initialSiteId ?? "company");
  const [serviceId, setServiceId] = useState<ServiceId | "">(
    initialServiceId ?? "",
  );
  const operation = useSiteOperation(send, reload);
  const activeSites = payload.oplocs.filter((site) => site.active);
  const site = activeSites.find((entry) => entry.oplocId === scope);
  const validScope = scope === "company" || Boolean(site);
  const layout = payload.serviceLayout;

  if (!layout)
    return (
      <p role="status">
        Hub has not returned the booking service settings. Refresh the catalogue
        before editing services.
      </p>
    );

  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-label="Booking service settings">
        <h3>Booking service settings</h3>
        <div className={styles.stack}>
          {!canManage && (
            <p role="status">
              View only. Editing services requires catalogue management
              permission.
            </p>
          )}
          <div className={styles.pair}>
            <label className="fika-field">
              Settings scope
              <select
                className="fika-select"
                value={validScope ? scope : ""}
                disabled={operation.busy}
                onChange={(event) => {
                  operation.reset();
                  setScope(event.target.value);
                }}
              >
                {!validScope && (
                  <option value="">Choose an active scope</option>
                )}
                <option value="company">Company defaults</option>
                {activeSites.map((entry) => (
                  <option value={entry.oplocId} key={entry.oplocId}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fika-field">
              Booking service
              <select
                className="fika-select"
                value={serviceId}
                disabled={!validScope || operation.busy}
                onChange={(event) => {
                  operation.reset();
                  setServiceId(
                    isServiceId(event.target.value) ? event.target.value : "",
                  );
                }}
              >
                <option value="">Choose a booking service</option>
                {SERVICE_IDS.map((id) => (
                  <option value={id} key={id}>
                    {BOOKING_SERVICE_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {validScope && serviceId && (
            <ServiceSettings
              key={scope + ":" + serviceId}
              payload={payload}
              layout={layout}
              serviceId={serviceId}
              siteId={site?.oplocId ?? ""}
              scopeLabel={site?.label ?? "Company defaults"}
              operation={operation}
              canManage={canManage}
              itemId={initialItemId}
            />
          )}
        </div>
      </section>
      {canManage && (
        <CatalogueCategoryRename
          payload={payload}
          send={send}
          reload={reload}
        />
      )}
    </div>
  );
}

type ServiceDraft = {
  rule: ServiceRule;
  version: number;
  companyVersion: number;
};

function ServiceSettings({
  payload,
  layout,
  serviceId,
  siteId,
  scopeLabel,
  canManage,
  operation,
  itemId,
}: {
  payload: CataloguePayload;
  layout: CatalogueServiceLayout;
  serviceId: ServiceId;
  siteId: string;
  scopeLabel: string;
  canManage: boolean;
  operation: ReturnType<typeof useSiteOperation>;
  itemId?: string;
}) {
  const current = configuredService(layout, siteId, serviceId);
  const reasonInput = useId();
  const [draft, setDraft] = useState<ServiceDraft | null>(null);
  const [confirmation, setConfirmation] = useState<{
    version: number;
    companyVersion: number;
  } | null>(null);
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const rule = draft?.rule ?? current.rule;
  const draftProblem = draft && serviceDraftProblem(current, rule, siteId);
  const siteVersion = current.version;
  const companyVersion = layout.company.version;
  const stale = [draft, confirmation].some(
    (snapshot) =>
      snapshot &&
      (snapshot.version !== siteVersion ||
        snapshot.companyVersion !== companyVersion),
  );
  const locked = operation.busy || operation.conflict || stale;
  const activeSiteCount = payload.oplocs.filter((site) => site.active).length;
  const inheritingCount = payload.oplocs.filter(
    (site) => site.active && !layout.sites[site.oplocId]?.services[serviceId],
  ).length;
  const possible = serviceCategoryOptions(layout).filter(
    (name) => !rule.categories.includes(name),
  );
  const item = payload.rows.find((row) => row.itemId === itemId);
  const itemAllowed =
    item?.status === "active" &&
    !current.rule.hidden &&
    current.rule.categories.includes(item.category) &&
    (!siteId || item.availableAt.includes(siteId));

  function update(change: (rule: ServiceRule) => ServiceRule) {
    operation.resetFeedback();
    setConfirmation(null);
    setDraft((previous) => ({
      version: previous?.version ?? siteVersion,
      companyVersion: previous?.companyVersion ?? companyVersion,
      rule: change(previous?.rule ?? current.rule),
    }));
  }

  function clearDraft() {
    setDraft(null);
    setConfirmation(null);
    setCategory("");
    setReason("");
  }

  async function save(inherit: boolean) {
    if (locked || !confirmation || !canManage || reason.trim().length < 8)
      return;
    if (
      inherit ? !siteId || !current.override : !draft || Boolean(draftProblem)
    )
      return;
    await operation.submit(
      serviceUpdateCommand(
        serviceId,
        siteId,
        confirmation.version,
        reason,
        inherit ? undefined : rule,
      ),
      clearDraft,
    );
  }

  const ready = Boolean(confirmation && reason.trim().length >= 8 && !locked);
  return (
    <div className={styles.stack}>
      <div className={styles.scope}>
        <h4>
          {BOOKING_SERVICE_LABELS[serviceId]} at {scopeLabel}
        </h4>
        <Pill tone={current.rule.hidden ? "neutral" : "info"}>
          {current.rule.hidden ? "Hidden" : "Visible"}
        </Pill>
        {siteId && (
          <Pill>
            {current.override ? "Site override" : "Company settings inherited"}
          </Pill>
        )}
      </div>
      {!siteId && (
        <p>
          {inheritingCount} active sites inherit this service.{" "}
          {activeSiteCount - inheritingCount} have their own settings.
        </p>
      )}
      {siteId && current.override && (
        <p className="fika-help">
          Company settings are{" "}
          {current.companyRule.hidden ? "hidden" : "visible"} with{" "}
          {current.companyRule.categories.join(", ") || "no categories"}.
        </p>
      )}
      {item && (
        <p>
          <strong>{item.name}</strong> ·{" "}
          {itemAllowed
            ? "Included by the saved configuration"
            : "Excluded by the saved configuration"}
          .
        </p>
      )}
      <p className="fika-help">
        Verify orderability for a site and event date in the availability check.
      </p>
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
      {(stale || operation.conflict) && (
        <div className={styles.stack}>
          <p role="status">
            This service layout needs to be reviewed against the latest Hub
            settings.
          </p>
          <Button
            disabled={operation.busy}
            onClick={() => void operation.refresh(clearDraft)}
          >
            Refresh service settings
          </Button>
        </div>
      )}
      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
      >
        {canManage && (
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={!rule.hidden}
              disabled={locked}
              onChange={(event) =>
                update((value) =>
                  visibleServiceRule(value, event.target.checked),
                )
              }
            />
            Show this service
          </label>
        )}
        {Boolean(rule.hidden) !== Boolean(current.rule.hidden) && (
          <p role="status">
            {rule.hidden
              ? "This draft hides the service."
              : "This draft shows the service."}{" "}
            The category order shown below is kept.
          </p>
        )}
        <h4>Category order</h4>
        {rule.categories.length ? (
          <ol className={styles.categories}>
            {rule.categories.map((name, index) => (
              <li key={name}>
                <div className={styles.category}>
                  <span>
                    {name}
                    {!layout.vocabulary.catalogueCategories.includes(name) && (
                      <small> · No active products</small>
                    )}
                  </span>
                  {canManage && (
                    <div className={styles.actions}>
                      <Button
                        label={"Move " + name + " up"}
                        disabled={locked || index === 0}
                        onClick={() =>
                          update((value) => ({
                            ...value,
                            categories: moveServiceCategory(
                              value.categories,
                              index,
                              -1,
                            ),
                          }))
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        label={"Move " + name + " down"}
                        disabled={
                          locked || index === rule.categories.length - 1
                        }
                        onClick={() =>
                          update((value) => ({
                            ...value,
                            categories: moveServiceCategory(
                              value.categories,
                              index,
                              1,
                            ),
                          }))
                        }
                      >
                        ↓
                      </Button>
                      <Button
                        label={"Remove " + name}
                        disabled={locked}
                        onClick={() =>
                          update((value) => ({
                            ...value,
                            categories: value.categories.filter(
                              (entry) => entry !== name,
                            ),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>No categories configured.</p>
        )}
        {canManage && (
          <>
            <div className={styles.actions}>
              <label className="fika-field">
                Add an existing category
                <select
                  className="fika-select"
                  value={category}
                  disabled={
                    locked ||
                    rule.categories.length >= MAX_CATEGORIES_PER_SERVICE
                  }
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="">Choose a category</option>
                  {possible.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={
                  locked ||
                  !possible.includes(category) ||
                  rule.categories.length >= MAX_CATEGORIES_PER_SERVICE
                }
                onClick={() => {
                  update((value) => ({
                    ...value,
                    categories: [...value.categories, category],
                  }));
                  setCategory("");
                }}
              >
                Add category
              </Button>
            </div>
            {(draft || current.override) && (
              <>
                {draft && draftProblem && (
                  <p className="fika-help" role="status">
                    {draftProblem}
                  </p>
                )}
                <div className="fika-field">
                  <label htmlFor={reasonInput}>Reason for the change</label>
                  <input
                    id={reasonInput}
                    aria-describedby={reasonInput + "-help"}
                    className="fika-input"
                    value={reason}
                    disabled={locked}
                    maxLength={500}
                    onChange={(event) => {
                      operation.resetFeedback();
                      setConfirmation(null);
                      setReason(event.target.value);
                    }}
                  />
                  <span id={reasonInput + "-help"} className="fika-help">
                    Enter at least eight characters.
                  </span>
                </div>
                <label className={styles.choice}>
                  <input
                    type="checkbox"
                    disabled={locked || reason.trim().length < 8}
                    checked={Boolean(confirmation)}
                    onChange={(event) =>
                      setConfirmation(
                        event.target.checked
                          ? { version: siteVersion, companyVersion }
                          : null,
                      )
                    }
                  />
                  I reviewed the change for {scopeLabel} and{" "}
                  {BOOKING_SERVICE_LABELS[serviceId]}.
                </label>
                <div className={styles.actions}>
                  {draft && (
                    <Button
                      primary
                      type="submit"
                      disabled={!ready || Boolean(draftProblem)}
                    >
                      {operation.busy ? "Saving…" : "Save service settings"}
                    </Button>
                  )}
                  {siteId &&
                    current.override &&
                    (!draft || sameServiceRule(current.companyRule, rule)) && (
                      <Button disabled={!ready} onClick={() => void save(true)}>
                        {operation.busy ? "Saving…" : "Use company settings"}
                      </Button>
                    )}
                  {draft && (
                    <Button
                      disabled={operation.busy}
                      onClick={() => {
                        operation.resetFeedback();
                        clearDraft();
                      }}
                    >
                      Discard service edits
                    </Button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </form>
    </div>
  );
}
