"use client";

import { useId, useRef, useState } from "react";
import { SERVICE_IDS } from "@fika/server-shared/hospitality-service-layout";
import { Button } from "./studio-ui";
import type { CataloguePayload, CatalogueSend } from "./catalogue-wire";
import {
  BOOKING_SERVICE_LABELS,
  renameCategoryImpact,
  serviceCategoryOptions,
} from "./catalogue-service-editor-model";
import { useSiteOperation } from "./catalogue-site-operation";
import styles from "./catalogue-site-editor.module.css";

export function CatalogueCategoryRename({
  payload,
  send,
  reload,
}: {
  payload: CataloguePayload;
  send: CatalogueSend;
  reload: () => Promise<void>;
}) {
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const reasonInput = useId();
  const [confirmedPlan, setConfirmedPlan] = useState("");
  const receipt = useRef<{ plan: string; operationId: string }>(null);
  const operation = useSiteOperation(send, reload);
  const layout = payload.serviceLayout;

  if (!layout || !payload.canManage) return null;

  const categoryNames = [
    ...new Set([
      ...payload.rows.map((row) => row.category),
      ...SERVICE_IDS.flatMap((id) =>
        layout.company.version > 0
          ? (layout.company.services[id]?.categories ?? [])
          : [],
      ),
      ...Object.values(layout.sites).flatMap((site) =>
        SERVICE_IDS.flatMap((id) => site.services[id]?.categories ?? []),
      ),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "en-GB"));
  const impact = renameCategoryImpact(payload, category);
  const newCategory = name.trim();
  const nameTaken = [
    ...categoryNames,
    ...serviceCategoryOptions(layout),
  ].includes(newCategory);
  const canConfirm = Boolean(
    category &&
      newCategory &&
      !nameTaken &&
      reason.trim().length >= 8 &&
      (impact.items.length ||
        impact.companyServices.length ||
        impact.sites.length),
  );
  const command = {
    action: "rename-category" as const,
    category,
    newCategory,
    expectedItemVersions: impact.expectedItemVersions,
    expectedLayoutVersions: impact.expectedLayoutVersions,
    reason: reason.trim(),
  };
  const plan = JSON.stringify(command);
  const locked = operation.busy || operation.conflict;

  function edit(set: (value: string) => void, value: string) {
    operation.resetFeedback();
    setConfirmedPlan("");
    set(value);
  }

  function clear() {
    setCategory("");
    setName("");
    setReason("");
    setConfirmedPlan("");
    receipt.current = null;
  }

  async function rename() {
    if (locked || !canConfirm || confirmedPlan !== plan) return;
    if (receipt.current?.plan !== plan)
      receipt.current = { plan, operationId: crypto.randomUUID() };
    await operation.submit(
      { ...command, operationId: receipt.current.operationId },
      clear,
    );
  }

  return (
    <details className={styles.panel}>
      <summary>Rename a catalogue category</summary>
      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault();
          void rename();
        }}
      >
        <p>
          Hub applies a rename across current and archived products and the
          stored booking service layouts that use the category.
        </p>
        <label className="fika-field">
          Current category
          <select
            className="fika-select"
            value={category}
            disabled={locked}
            onChange={(event) => edit(setCategory, event.target.value)}
          >
            <option value="">Choose the current category</option>
            {categoryNames.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="fika-field">
          New category name
          <input
            className="fika-input"
            value={name}
            disabled={locked}
            maxLength={120}
            onChange={(event) => edit(setName, event.target.value)}
          />
        </label>
        {newCategory && nameTaken && (
          <p role="status">This category name is already in use.</p>
        )}
        {category && (
          <div className={styles.stack}>
            <h4>Review the company-wide impact</h4>
            <p>
              {impact.items.filter((item) => item.status === "active").length}{" "}
              active products and{" "}
              {impact.items.filter((item) => item.status === "archived").length}{" "}
              archived products.
            </p>
            <p>
              {impact.companyServices.length
                ? "Company services affected"
                : "No stored company service uses this category."}
            </p>
            {impact.companyServices.length > 0 && (
              <ul>
                {impact.companyServices.map((id) => (
                  <li key={id}>{BOOKING_SERVICE_LABELS[id]}</li>
                ))}
              </ul>
            )}
            {impact.sites.length > 0 && (
              <ul>
                {impact.sites.map(({ id, serviceIds }) => (
                  <li key={id}>
                    {(payload.oplocs.find((site) => site.oplocId === id)
                      ?.label ?? id) +
                      " · " +
                      serviceIds
                        .map((service) => BOOKING_SERVICE_LABELS[service])
                        .join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="fika-field">
          <label htmlFor={reasonInput}>Reason for the rename</label>
          <input
            id={reasonInput}
            aria-describedby={reasonInput + "-help"}
            className="fika-input"
            value={reason}
            disabled={locked}
            maxLength={500}
            onChange={(event) => edit(setReason, event.target.value)}
          />
          <span id={reasonInput + "-help"} className="fika-help">
            Enter at least eight characters.
          </span>
        </div>
        <label className={styles.choice}>
          <input
            type="checkbox"
            disabled={locked || !canConfirm}
            checked={confirmedPlan === plan}
            onChange={(event) =>
              setConfirmedPlan(event.target.checked ? plan : "")
            }
          />
          I reviewed the affected products and service layouts.
        </label>
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
        {operation.conflict && (
          <Button
            disabled={operation.busy}
            onClick={() =>
              void operation.refresh(() => {
                receipt.current = null;
                setConfirmedPlan("");
              })
            }
          >
            Refresh category details
          </Button>
        )}
        <div className={styles.actions}>
          <Button
            primary
            type="submit"
            disabled={locked || !canConfirm || confirmedPlan !== plan}
          >
            {operation.busy ? "Renaming…" : "Rename category"}
          </Button>
        </div>
      </form>
    </details>
  );
}
