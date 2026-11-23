import { useId, useRef, useState } from "react";
import {
  adoptionPrice,
  defaultAssessment,
  governanceReceipt,
  mergeSelection,
} from "./catalogue-governance-model";
import type {
  CataloguePayload,
  CatalogueRow,
  CatalogueSend,
} from "./catalogue-wire";
import { Button, Pill } from "./studio-ui";
import styles from "./studio.module.css";
import governanceStyles from "./catalogue-governance.module.css";

type Send = CatalogueSend;
const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});
const providers = [
  ["cfc-hospitality-brochure", "CFC Hospitality brochure"],
  ["munich-re-generic-brochure", "Munich Re Hospitality brochure"],
] as const;

function useCatalogueAction(send: Send) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(command: Parameters<Send>[0]) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await send(command, (receipt) => governanceReceipt(command, receipt));
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The catalogue change could not be confirmed.",
      );
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error };
}

function ProviderReferences({
  row,
  canManage,
  send,
}: {
  row: CatalogueRow;
  canManage: boolean;
  send: Send;
}) {
  const [provider, setProvider] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceVersion, setSourceVersion] = useState("");
  const { run, busy, error } = useCatalogueAction(send);
  return (
    <section
      className={governanceStyles.section}
      aria-label="Source references"
    >
      <h3>Source references</h3>
      <p>
        Catalogue Item ID <code>{row.itemId}</code>
      </p>
      {row.providerMappings.length > 0 && (
        <ul>
          {row.providerMappings.map((mapping, index) => (
            <li
              key={mapping.provider + ":" + mapping.sourceItemId + ":" + index}
            >
              {providers.find(([id]) => id === mapping.provider)?.[1] ??
                mapping.provider}{" "}
              · {mapping.sourceItemId}
              {mapping.sourceVersion ? " · " + mapping.sourceVersion : ""}
            </li>
          ))}
        </ul>
      )}
      {row.sourceIds.length > 0 && (
        <p>Recorded reference IDs {row.sourceIds.join(", ")}</p>
      )}
      {row.siteCopyOf && (
        <Pill tone="warning">Historical site copy · {row.siteCopyOf}</Pill>
      )}
      {canManage && row.status === "active" && (
        <form
          className={governanceStyles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!provider || !sourceId.trim()) return;
            const changed = await run({
              action: "link-provider-item",
              itemId: row.itemId,
              expectedVersion: row.version,
              provider,
              sourceItemId: sourceId.trim(),
              ...(sourceVersion.trim()
                ? { sourceVersion: sourceVersion.trim() }
                : {}),
            });
            if (changed) {
              setSourceId("");
              setSourceVersion("");
            }
          }}
        >
          <label className="fika-field">
            Provider to link
            <select
              className="fika-select"
              value={provider}
              required
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="">Choose a provider</option>
              {providers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="fika-field">
            Provider’s product reference
            <input
              className="fika-input"
              value={sourceId}
              required
              maxLength={240}
              onChange={(event) => setSourceId(event.target.value)}
            />
          </label>
          <label className="fika-field">
            Source version (optional)
            <input
              className="fika-input"
              value={sourceVersion}
              maxLength={240}
              onChange={(event) => setSourceVersion(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={busy || !provider || !sourceId.trim()}
          >
            {busy ? "Linking…" : "Link source reference"}
          </Button>
        </form>
      )}
      {error && (
        <p className="fika-notice fika-notice--danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function CompanyDefault({
  row,
  payload,
  send,
}: {
  row: CatalogueRow;
  payload: CataloguePayload;
  send: Send;
}) {
  const review = defaultAssessment(row);
  const proposal = review.status === "uniform" ? review : undefined;
  const [amount, setAmount] = useState(proposal ? String(proposal.amount) : "");
  const suggestedVat = proposal ? String(proposal.vatRate * 100) : "";
  const [vat, setVat] = useState(suggestedVat);
  const [minimum, setMinimum] = useState(
    review.status === "not_needed"
      ? ""
      : String(review.minimumQuantity ?? row.defaultMinimumQuantity ?? ""),
  );
  const [confirm, setConfirm] = useState(false);
  const typedPrice = adoptionPrice(amount, vat);
  const price =
    typedPrice && proposal && vat === suggestedVat
      ? { ...typedPrice, vatRate: proposal.vatRate }
      : typedPrice;
  const numericMinimum = Number(minimum);
  const validMinimum =
    !minimum || (Number.isSafeInteger(numericMinimum) && numericMinimum > 0);
  const { run, busy, error } = useCatalogueAction(send);
  if (review.status === "not_needed") return null;
  return (
    <section
      className={governanceStyles.section}
      aria-label="Adopt company default"
    >
      <h3>Adopt a company default</h3>
      {review.status === "uniform" ? (
        <p>
          Recorded site prices agree at {money.format(review.amount)} before
          VAT. Confirm the company default to make matching site prices inherit
          it.
        </p>
      ) : (
        <>
          <p>{review.reason}</p>
          <ul>
            {review.values.map((site) => (
              <li key={site.offeringId}>
                {payload.oplocs.find(
                  (option) => option.oplocId === site.oplocId,
                )?.label || "Unlisted site"}
                {" · "}
                {site.amount === undefined
                  ? "Price unavailable"
                  : money.format(site.amount)}
                {" · "}
                {site.vatRate === undefined
                  ? "VAT unavailable"
                  : "VAT " + site.vatRate * 100 + "%"}
                {" · "}
                {site.minimumQuantity === undefined
                  ? "No site minimum"
                  : "Minimum " + site.minimumQuantity}
              </li>
            ))}
          </ul>
        </>
      )}
      {payload.canManage && row.status === "active" && (
        <form
          className={governanceStyles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!price || !validMinimum || !confirm) return;
            const changed = await run({
              action: "adopt-company-default",
              itemId: row.itemId,
              expectedVersion: row.version,
              price,
              ...(minimum ? { minimumQuantity: numericMinimum } : {}),
              confirmed: true,
            });
            if (changed) setConfirm(false);
          }}
        >
          <label className="fika-field">
            Company price before VAT (£)
            <input
              className="fika-input"
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setConfirm(false);
              }}
            />
          </label>
          <label className="fika-field">
            VAT (%)
            <input
              className="fika-input"
              type="number"
              min="0"
              max="100"
              step="any"
              required
              value={vat}
              onChange={(event) => {
                setVat(event.target.value);
                setConfirm(false);
              }}
            />
          </label>
          <label className="fika-field">
            Company minimum quantity (leave blank to clear)
            <input
              className="fika-input"
              type="number"
              min="1"
              step="1"
              value={minimum}
              onChange={(event) => {
                setMinimum(event.target.value);
                setConfirm(false);
              }}
            />
          </label>
          <label className="fika-choice">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(event) => setConfirm(event.target.checked)}
            />
            Confirm the default for {row.name}. Different site values remain
            overrides.
          </label>
          <Button
            type="submit"
            disabled={busy || !price || !validMinimum || !confirm}
          >
            {busy ? "Saving…" : "Adopt default"}
          </Button>
        </form>
      )}
      {error && (
        <p className="fika-notice fika-notice--danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function CatalogueProductGovernance({
  row,
  payload,
  send,
}: {
  row: CatalogueRow;
  payload: CataloguePayload;
  send: Send;
}) {
  const key = row.itemId + ":" + row.version;
  return (
    <details className={styles.disclosure}>
      <summary>Source references and company defaults</summary>
      <ProviderReferences
        key={"provider:" + key}
        row={row}
        canManage={payload.canManage}
        send={send}
      />
      <CompanyDefault
        key={"default:" + key}
        row={row}
        payload={payload}
        send={send}
      />
    </details>
  );
}

export function CatalogueDuplicateReview({
  payload,
  send,
}: {
  payload: CataloguePayload;
  send: Send;
}) {
  const [groupId, setGroupId] = useState("");
  const [survivor, setSurvivor] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const selectId = useId();
  const { run, busy, error } = useCatalogueAction(send);
  const group = payload.reviewGroups.find(
    (candidate) => candidate.id === groupId,
  );
  const members =
    group?.memberIds.map((id) =>
      payload.rows.find((row) => row.itemId === id),
    ) ?? [];
  const merge = mergeSelection(payload, groupId, survivor);
  const reviewKey = merge ? JSON.stringify(merge) : "";
  const confirmed = Boolean(reviewKey && confirmation === reviewKey);
  const siteNames = new Map(
    payload.oplocs.map((site) => [site.oplocId, site.label]),
  );
  return (
    <details className={styles.disclosure}>
      <summary>Duplicate review and catalogue diagnostics</summary>
      <div className={governanceStyles.section}>
        <p>
          {payload.canonicalisation.itemsAwaitingConsolidation} items awaiting
          approved consolidation
        </p>
        {payload.reviewGroups.length === 0 ? (
          <p>No duplicate groups to review.</p>
        ) : (
          <label className="fika-field" htmlFor={selectId}>
            Review group
            <select
              id={selectId}
              className="fika-select"
              value={group?.id ?? ""}
              onChange={(event) => {
                setGroupId(event.target.value);
                setSurvivor("");
                setConfirmation("");
              }}
            >
              <option value="">Choose products to compare</option>
              {payload.reviewGroups.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.memberIds
                    .map(
                      (id) =>
                        payload.rows.find((row) => row.itemId === id)?.name ||
                        "Unavailable item",
                    )
                    .join(" / ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {group && (
          <>
            <p>{group.reasons.join(" · ")}</p>
            {group.decision && (
              <Pill>{group.decision.replaceAll("_", " ")}</Pill>
            )}
            <div className={styles.formGrid}>
              {members.map((row, index) =>
                row ? (
                  <section
                    key={row.itemId}
                    className={governanceStyles.comparison}
                    aria-label={row.name}
                  >
                    <h3>{row.name}</h3>
                    <Pill>{row.status}</Pill>
                    <p>{row.description || "No description recorded"}</p>
                    <p>
                      {row.category} · {row.routing.state.replaceAll("_", " ")}
                    </p>
                    <p>
                      {row.defaultPrice
                        ? money.format(row.defaultPrice.amount) + " before VAT"
                        : "No company price"}
                    </p>
                    <p>
                      Minimum {row.defaultMinimumQuantity ?? "unset"} ·{" "}
                      {row.availableAt
                        .map((id) => siteNames.get(id) || "Unlisted site")
                        .join(", ") || "No available sites"}
                    </p>
                    <p>
                      Recorded dietary information{" "}
                      {row.dietaryInformation.join(", ") || "unavailable"}
                    </p>
                    <p>
                      Recorded allergens{" "}
                      {row.allergenInformation.join(", ") || "unavailable"}
                    </p>
                    {row.sourceIds.length > 0 && (
                      <p>Source references {row.sourceIds.join(", ")}</p>
                    )}
                  </section>
                ) : (
                  <p key={group.memberIds[index]}>
                    A group member could not be loaded. Refresh the catalogue
                    before merging.
                  </p>
                ),
              )}
            </div>
            {payload.canManage && (
              <div className={governanceStyles.form}>
                <div className={styles.actions}>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run({
                        action: "record-review-decision",
                        memberIds: group.memberIds,
                        decision: "keep_separate",
                      })
                    }
                  >
                    Keep separate
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run({
                        action: "record-review-decision",
                        memberIds: group.memberIds,
                        decision: "defer",
                      })
                    }
                  >
                    Defer decision
                  </Button>
                </div>
                <label className="fika-field">
                  Product to keep
                  <select
                    className="fika-select"
                    value={survivor}
                    onChange={(event) => {
                      setSurvivor(event.target.value);
                      setConfirmation("");
                    }}
                  >
                    <option value="">Choose the product to keep</option>
                    {members.map(
                      (row) =>
                        row && (
                          <option key={row.itemId} value={row.itemId}>
                            {row.name} · {row.category}
                          </option>
                        ),
                    )}
                  </select>
                </label>
                {survivor && !merge && (
                  <p role="status">
                    All current product versions are needed for a supported
                    merge. Check the group after refreshing the catalogue.
                  </p>
                )}
                {merge && (
                  <label className="fika-choice">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) =>
                        setConfirmation(event.target.checked ? reviewKey : "")
                      }
                    />
                    Confirm the source products will be archived and their site
                    settings moved to the selected product.
                  </label>
                )}
                <button
                  type="button"
                  className="fika-button fika-button--destructive"
                  disabled={busy || !merge || !confirmed}
                  onClick={async () => {
                    if (merge && confirmed && (await run(merge))) {
                      setGroupId("");
                      setSurvivor("");
                      setConfirmation("");
                    }
                  }}
                >
                  {busy ? "Saving decision…" : "Merge products"}
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="fika-notice fika-notice--danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
