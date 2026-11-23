import { useState } from "react";
import { CatalogueCommandError } from "./catalogue-state";
import type {
  CatalogueCommand,
  CatalogueCommandResult,
  CataloguePayload,
  CatalogueSend,
} from "./catalogue-wire";
import {
  categoryEffects,
  exVat,
  importProblems,
  importRows,
  routes,
  type ImportRow,
} from "./catalogue-bulk-model";
import { Button } from "./studio-ui";

type Report = NonNullable<
  CatalogueCommandResult["bulk"] | CatalogueCommandResult["bulkCreate"]
>;
export type CatalogueBulkProps = {
  payload: CataloguePayload;
  send: CatalogueSend;
};
const label = (s: string) => s.replaceAll("_", " ");
const id = () => crypto.randomUUID();

function reviewedOutcome(
  command: CatalogueCommand,
  result: CatalogueCommandResult,
): Report | undefined {
  const create = command.action === "bulk-create";
  const outcome = create ? result.bulkCreate : result.bulk;
  if (!outcome || outcome.operationId !== command.operationId) return undefined;
  const expected = create
    ? (command.items as { requestId: string }[]).map((item) => item.requestId)
    : (command.itemIds as string[]);
  const received = outcome.results.map((item) =>
    create ? ("requestId" in item ? item.requestId : undefined) : item.itemId,
  );
  if (
    received.length !== expected.length ||
    new Set(received).size !== expected.length ||
    expected.some((value) => !received.includes(value)) ||
    outcome.results.some(
      (item) =>
        !["applied", "already_applied", "unchanged", "failed"].includes(
          item.status,
        ),
    )
  ) {
    return undefined;
  }
  return outcome;
}

export function CatalogueBulk({ payload, send }: CatalogueBulkProps) {
  const [mode, setMode] = useState<"update" | "create">("update");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [production, setProduction] = useState("");
  const [price, setPrice] = useState("");
  const [vat, setVat] = useState("");
  const [minimum, setMinimum] = useState("keep");
  const [minimumValue, setMinimumValue] = useState("");
  const [siteMode, setSiteMode] = useState("keep");
  const [sites, setSites] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [archive, setArchive] = useState(false);
  const [source, setSource] = useState("");
  const [delimiter, setDelimiter] = useState<"," | "\t">(",");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [acceptedCategories, setAcceptedCategories] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [command, setCommand] = useState<CatalogueCommand | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [packageWarning, setPackageWarning] = useState("");
  if (!payload.canManage)
    return <p>Catalogue management access is required for bulk changes.</p>;
  const active = payload.rows.filter((row) => row.status === "active");
  const shown = active.filter((row) =>
    `${row.name} ${row.category}`
      .toLocaleLowerCase("en-GB")
      .includes(query.trim().toLocaleLowerCase("en-GB")),
  );
  const selectedRows = active.filter((row) => selected.includes(row.itemId));
  const activeSites = payload.oplocs.filter((site) => site.active);
  const categories = new Set(payload.rows.map((row) => row.category));
  const missingCategories = [
    ...new Set(
      rows
        .map((row) => row.category.trim())
        .filter((value) => value && !categories.has(value)),
    ),
  ];
  const problems = importProblems(rows, payload);
  const effects = category.trim()
    ? categoryEffects(payload, selectedRows, category.trim())
    : null;
  const toggle = (list: string[], value: string, checked: boolean) =>
    checked ? [...list, value] : list.filter((item) => item !== value);
  function prepareUpdate() {
    setError("");
    if (
      !selectedRows.length ||
      selectedRows.length > 50 ||
      selectedRows.length !== selected.length
    )
      return setError("Select 1–50 current active products.");
    const change: Record<string, unknown> = {};
    if (archive) change.archive = true;
    else {
      if (production) change.production = production;
      if (price.trim()) {
        const value = Number(price);
        const rate = Number(vat);
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          (vat.trim() && (!Number.isFinite(rate) || rate < 0 || rate > 100))
        )
          return setError(
            "Enter a valid price and VAT percentage from 0 to 100.",
          );
        change.price = {
          amount: value,
          ...(vat.trim() ? { vatRate: rate / 100 } : {}),
        };
      }
      if (minimum === "clear") change.minimum = { mode: "clear" };
      if (minimum === "set") {
        const n = Number(minimumValue);
        if (!Number.isInteger(n) || n < 1)
          return setError("Enter a positive whole minimum quantity.");
        change.minimum = { mode: "set", value: n };
      }
      if (siteMode !== "keep") {
        if (!sites.length) return setError("Select at least one active site.");
        change.sites = { mode: siteMode, oplocIds: sites };
      }
      if (category.trim()) {
        if (
          category.trim().length > 160 ||
          (!categories.has(category.trim()) && !newCategory)
        )
          return setError("Confirm the new category name.");
        if (!effects?.safe)
          return setError(
            "Category change is held because a selected site has no visible target service mapping, or service configuration is unavailable.",
          );
        if (effects.changes.length && !confirmed)
          return setError(
            "Review and confirm every service visibility effect.",
          );
        change.category = category.trim();
        change.categoryVisibilityConfirmed = confirmed;
      }
    }
    if (!Object.keys(change).length)
      return setError("Choose at least one change.");
    setCommand({
      action: "bulk-update",
      operationId: id(),
      itemIds: selectedRows.map((row) => row.itemId),
      expectedVersions: Object.fromEntries(
        selectedRows.map((row) => [row.itemId, row.version]),
      ),
      expectedRoutingVersions: Object.fromEntries(
        selectedRows.map((row) => [row.itemId, row.routing.version]),
      ),
      ...change,
    });
  }
  function prepareCreate() {
    setError("");
    if (!rows.length || rows.length > 50 || problems.some(Boolean))
      return setError("Review every product row before continuing.");
    if (!sites.length) return setError("Choose at least one site.");
    if (missingCategories.some((value) => !acceptedCategories.includes(value)))
      return setError("Confirm each new category name.");
    setCommand({
      action: "bulk-create",
      operationId: id(),
      items: rows.map((row) => ({
        requestId: row.requestId,
        name: row.name.trim(),
        category: row.category.trim(),
        routing: row.routing,
        defaultPrice: {
          amount: exVat(row.gross, row.vat),
          vatRate: Number(row.vat) / 100,
        },
        ...(row.description.trim()
          ? { description: row.description.trim() }
          : {}),
        oplocIds: sites,
        restrictToSelectedOplocs: true,
      })),
    });
  }
  async function apply() {
    if (!command || busy) return;
    setAttempted(true);
    setBusy(true);
    setError("");
    try {
      const result = await send(command, (receipt) =>
        Boolean(reviewedOutcome(command, receipt)),
      );
      setReport(reviewedOutcome(command, result)!);
      setPackageWarning(
        result.package === "stale"
          ? "Catalogue package refresh is pending; availability may not reflect these changes."
          : "",
      );
    } catch (failure) {
      if (
        failure instanceof CatalogueCommandError &&
        failure.status &&
        failure.status >= 400 &&
        failure.status < 500
      ) {
        setAttempted(false);
      }
      setError(
        (failure as Error).message ||
          "The result is unknown. Retry the same request safely.",
      );
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setAttempted(false);
    setCommand(null);
    setReport(null);
    setError("");
    setSelected([]);
    setRows([]);
    setSites([]);
    setAcceptedCategories([]);
    setPackageWarning("");
  }
  const sitePicker = (
    <fieldset disabled={busy || !!command}>
      <legend>Sites ({sites.length} selected)</legend>
      {activeSites.map((site) => (
        <label className="fika-choice" key={site.oplocId}>
          <input
            type="checkbox"
            checked={sites.includes(site.oplocId)}
            onChange={(event) =>
              setSites(toggle(sites, site.oplocId, event.target.checked))
            }
          />
          {site.label}
        </label>
      ))}
    </fieldset>
  );
  return (
    <section aria-label="Bulk catalogue maintenance">
      <h2>Bulk catalogue maintenance</h2>
      {!command && (
        <>
          <div role="group" aria-label="Bulk action">
            <Button
              onClick={() => {
                setMode("update");
                setSites([]);
              }}
            >
              Edit products
            </Button>{" "}
            <Button
              onClick={() => {
                setMode("create");
                setSites([]);
              }}
            >
              Create from CSV
            </Button>
          </div>
          {mode === "update" ? (
            <>
              <label className="fika-field">
                Search active products
                <input
                  className="fika-input"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <p>
                {selected.length} selected; {shown.length} shown. Maximum 50 per
                operation.
              </p>
              <Button
                onClick={() => {
                  setSelected([
                    ...new Set([
                      ...selected,
                      ...shown.map((row) => row.itemId),
                    ]),
                  ]);
                  setConfirmed(false);
                }}
                disabled={
                  new Set([...selected, ...shown.map((row) => row.itemId)])
                    .size > 50
                }
              >
                Select all shown
              </Button>{" "}
              <Button
                onClick={() => {
                  setSelected([]);
                  setConfirmed(false);
                }}
              >
                Clear selection
              </Button>
              <fieldset>
                <legend>Products</legend>
                {shown.map((row) => (
                  <label className="fika-choice" key={row.itemId}>
                    <input
                      type="checkbox"
                      checked={selected.includes(row.itemId)}
                      disabled={
                        !selected.includes(row.itemId) && selected.length >= 50
                      }
                      onChange={(e) => {
                        setSelected(
                          toggle(selected, row.itemId, e.target.checked),
                        );
                        setConfirmed(false);
                      }}
                    />
                    {row.name} · {row.category}
                  </label>
                ))}
              </fieldset>
              <label className="fika-choice">
                <input
                  type="checkbox"
                  checked={archive}
                  onChange={(e) => setArchive(e.target.checked)}
                />
                Archive selected products (separate action)
              </label>
              {!archive && (
                <>
                  <label className="fika-field">
                    Production route
                    <select
                      className="fika-select"
                      value={production}
                      onChange={(e) => setProduction(e.target.value)}
                    >
                      <option value="">Leave unchanged</option>
                      {routes.map((route) => (
                        <option key={route} value={route}>
                          {label(route)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="fika-field">
                    Company price (£ ex VAT; blank leaves unchanged)
                    <input
                      className="fika-input"
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </label>
                  <label className="fika-field">
                    VAT % (blank retains current rate)
                    <input
                      className="fika-input"
                      inputMode="decimal"
                      value={vat}
                      onChange={(e) => setVat(e.target.value)}
                    />
                  </label>
                  <label className="fika-field">
                    Company minimum
                    <select
                      className="fika-select"
                      value={minimum}
                      onChange={(e) => setMinimum(e.target.value)}
                    >
                      <option value="keep">Leave unchanged</option>
                      <option value="set">Set</option>
                      <option value="clear">Clear</option>
                    </select>
                  </label>
                  {minimum === "set" && (
                    <label className="fika-field">
                      Minimum quantity
                      <input
                        className="fika-input"
                        inputMode="numeric"
                        value={minimumValue}
                        onChange={(e) => setMinimumValue(e.target.value)}
                      />
                    </label>
                  )}
                  <label className="fika-field">
                    Site availability
                    <select
                      className="fika-select"
                      value={siteMode}
                      onChange={(e) => setSiteMode(e.target.value)}
                    >
                      <option value="keep">Leave unchanged</option>
                      <option value="add">Add selected</option>
                      <option value="remove">Remove selected</option>
                      <option value="replace">Replace with selected</option>
                    </select>
                  </label>
                  {siteMode !== "keep" && sitePicker}
                  <label className="fika-field">
                    Category (blank leaves unchanged)
                    <input
                      className="fika-input"
                      value={category}
                      maxLength={160}
                      onChange={(e) => {
                        setCategory(e.target.value);
                        setConfirmed(false);
                        setNewCategory(false);
                      }}
                    />
                  </label>
                  {category.trim() && !categories.has(category.trim()) && (
                    <label className="fika-choice">
                      <input
                        type="checkbox"
                        checked={newCategory}
                        onChange={(e) => setNewCategory(e.target.checked)}
                      />
                      Confirm new category; services are not enabled
                      automatically
                    </label>
                  )}
                  {effects && (
                    <>
                      <p>
                        {effects.safe
                          ? "Review stored service visibility effects below."
                          : "This category is held because service visibility is missing at a selected site."}
                      </p>
                      <ul>
                        {effects.changes.map((effect, index) => (
                          <li key={index}>{effect}</li>
                        ))}
                      </ul>
                      {effects.changes.length > 0 && effects.safe && (
                        <label className="fika-choice">
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                          />
                          I reviewed all listed site and service changes
                        </label>
                      )}
                    </>
                  )}
                </>
              )}
              <p>
                Company defaults do not overwrite site price or minimum
                exceptions. Booking acceptance is separate.
              </p>
              <Button onClick={prepareUpdate}>Review selected changes</Button>
            </>
          ) : (
            <>
              <p>
                Paste or upload CSV or tab-separated rows: name, category, price
                including VAT, VAT percentage, description, production route.
                Header is optional; use route values {routes.join(", ")}.
              </p>
              <label className="fika-field">
                Separator
                <select
                  className="fika-select"
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value as "," | "\t")}
                >
                  <option value=",">Comma (CSV)</option>
                  <option value="\t">Tab</option>
                </select>
              </label>
              <label className="fika-field">
                Upload text file
                <input
                  type="file"
                  accept=".csv,.tsv,text/csv,text/tab-separated-values"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && file.size > 1000000)
                      setError("Choose a file smaller than 1 MB.");
                    else if (file)
                      void file
                        .text()
                        .then(setSource)
                        .catch(() => setError("The file could not be read."));
                  }}
                />
              </label>
              <label className="fika-field">
                Product rows
                <textarea
                  className="fika-textarea"
                  rows={8}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <Button
                onClick={() => {
                  try {
                    setRows(importRows(source, delimiter, id));
                    setAcceptedCategories([]);
                    setError("");
                  } catch (failure) {
                    setError((failure as Error).message);
                  }
                }}
              >
                Load rows for review
              </Button>
              {rows.length > 0 && (
                <>
                  <p>
                    {rows.length} rows. Edit the source and reload to correct
                    any errors.
                  </p>
                  <div className="fika-table-wrap">
                    <table className="fika-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Category</th>
                          <th>Gross / VAT</th>
                          <th>Ex VAT</th>
                          <th>Route</th>
                          <th>Description</th>
                          <th>Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={row.requestId}>
                            <td>{row.name}</td>
                            <td>{row.category}</td>
                            <td>
                              {row.gross} / {row.vat}%
                            </td>
                            <td>
                              {exVat(row.gross, row.vat)?.toFixed(2) ?? "—"}
                            </td>
                            <td>{label(row.routing)}</td>
                            <td>{row.description || "—"}</td>
                            <td>{problems[i] || "Ready"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {sitePicker}
                  {missingCategories.map((value) => (
                    <label className="fika-choice" key={value}>
                      <input
                        type="checkbox"
                        checked={acceptedCategories.includes(value)}
                        onChange={(e) =>
                          setAcceptedCategories(
                            toggle(acceptedCategories, value, e.target.checked),
                          )
                        }
                      />
                      Confirm new category “{value}”; no service is enabled
                      automatically
                    </label>
                  ))}
                  <Button onClick={prepareCreate}>Review creation</Button>
                </>
              )}
            </>
          )}
        </>
      )}
      {command && !report && (
        <>
          <h3>
            Confirm{" "}
            {command.action === "bulk-create"
              ? `creation of ${rows.length} products`
              : `${selectedRows.length} selected products`}
          </h3>
          <p>
            Each product is processed separately; the result will identify
            partial failures. Existing bookings and quotations retain their
            historical information.
          </p>
          <p>
            {command.action === "bulk-create"
              ? `Create ${rows.length} products at ${sites.length} selected sites.`
              : archive
                ? "Archive the selected products and retire their active site offerings."
                : `Apply the selected changes to ${selectedRows.length} products.`}
          </p>
          <details open>
            <summary>Products in this operation</summary>
            <ul>
              {command.action === "bulk-create"
                ? rows.map((row) => (
                    <li key={row.requestId}>
                      {row.name} · {row.category} · £
                      {exVat(row.gross, row.vat)?.toFixed(2)} ex VAT · VAT{" "}
                      {row.vat}% · {label(row.routing)}
                    </li>
                  ))
                : selectedRows.map((row) => (
                    <li key={row.itemId}>
                      {row.name} · {row.category}
                    </li>
                  ))}
            </ul>
          </details>
          {command.action === "bulk-create" && (
            <p>
              Available at:{" "}
              {sites
                .map(
                  (site) =>
                    activeSites.find((item) => item.oplocId === site)?.label ||
                    site,
                )
                .join(", ")}
            </p>
          )}
          {command.action === "bulk-update" && !archive && (
            <ul>
              {production && <li>Production: {label(production)}</li>}
              {price.trim() && (
                <li>
                  Company price: £{price} ex VAT
                  {vat.trim()
                    ? `, VAT ${vat}%`
                    : ", retain each current VAT rate"}
                </li>
              )}
              {minimum !== "keep" && (
                <li>Minimum: {minimum === "clear" ? "clear" : minimumValue}</li>
              )}
              {siteMode !== "keep" && (
                <li>
                  Sites: {label(siteMode)} —{" "}
                  {sites
                    .map(
                      (site) =>
                        activeSites.find((item) => item.oplocId === site)
                          ?.label || site,
                    )
                    .join(", ")}
                </li>
              )}
              {category.trim() && <li>Category: {category.trim()}</li>}
            </ul>
          )}
          <Button
            disabled={busy || attempted}
            onClick={() => {
              setCommand(null);
              setError("");
            }}
          >
            Back to edit
          </Button>{" "}
          <Button primary disabled={busy} onClick={() => void apply()}>
            {busy ? "Applying…" : "Apply reviewed operation"}
          </Button>
        </>
      )}
      {report && (
        <>
          <h3>Operation result</h3>
          <p role="status">{report.message}</p>
          <ul>
            {report.results.map((result, index) => (
              <li
                key={
                  result.itemId ||
                  ("requestId" in result ? result.requestId : index)
                }
              >
                {("name" in result ? result.name : undefined) ||
                  payload.rows.find((row) => row.itemId === result.itemId)
                    ?.name ||
                  result.itemId}
                : {label(result.status)} — {result.message}
              </li>
            ))}
          </ul>
          {report.failed > 0 && (
            <Button disabled={busy} onClick={() => void apply()}>
              Retry same operation
            </Button>
          )}{" "}
          <Button disabled={busy} onClick={reset}>
            Start another operation
          </Button>
        </>
      )}
      {packageWarning && <p role="status">{packageWarning}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
