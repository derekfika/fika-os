"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { CanonicalRecord } from "@/lib/types";
import {
  CanonicalFormFields,
  type CanonicalFormField,
} from "@/lib/canonical-form";
import type { EditableEntityType } from "@/lib/canonical-editor";
import {
  CountryCodes,
  countryLabel,
  type LegacyAddressEvidence,
} from "@/lib/address";
import { canonicalRecordFromMutationResponse } from "@/lib/canonical-mutation-state";

type RelationshipOption = {
  canonicalId: string;
  entityType: string;
  label: string;
  lifecycleStatus: string;
  schemaValid: boolean;
  reusable?: boolean;
  recordVersion: number;
  approvalState?: string;
  address?: Record<string, unknown>;
  fieldLocks?: string[];
};
type Context = {
  relationships: RelationshipOption[];
  legacySites: {
    canonicalId: string;
    label: string;
    address?: string;
    addressEvidence?: LegacyAddressEvidence;
    mappingStatus: string;
    mappedOplocId?: string;
  }[];
  generatedIds: Record<EditableEntityType, string>;
  permissions: string[];
};
type Duplicate = {
  canonicalId: string;
  label: string;
  reason: string;
  confidence: number;
  exact?: boolean;
  published?: boolean;
};
type Preview = {
  operation: string;
  lifecycleAfterSave: string;
  publicationAfterSave: string;
  generatedReason: string;
  changes: { field: string; previousValue: unknown; newValue: unknown }[];
  additionalWrites: string[];
  duplicateCandidates?: Duplicate[];
  reusedAddress?: { canonicalId: string; label: string; willPublish: boolean };
  inlineAddress?: {
    changes: { field: string; previousValue: unknown; newValue: unknown }[];
    generatedReason: string;
    duplicateCandidates: Duplicate[];
  };
};
type InlineAddress = {
  mode: "create" | "edit";
  canonicalId: string;
  expectedVersion: number;
  values: Record<string, unknown>;
  decisionReason: string;
  allowDistinctDuplicate: boolean;
  evidence?: LegacyAddressEvidence;
};
const entityTypes: EditableEntityType[] = [
  "OPLOC",
  "Address",
  "Legend",
  "Employment",
  "Operational Assignment",
  "Operational Capability",
  "Capability Enablement",
];

export default function CanonicalEditorModal({
  record,
  initialEntityType,
  prefillValues,
  legacySourceCanonicalId,
  refreshSession,
  close,
  saved,
}: {
  record?: CanonicalRecord;
  initialEntityType?: EditableEntityType;
  prefillValues?: Record<string, unknown>;
  legacySourceCanonicalId?: string;
  refreshSession: () => Promise<boolean>;
  close: () => void;
  saved: (record: CanonicalRecord) => Promise<void>;
}) {
  const initialType = supported(record?.entityType)
    ? record!.entityType
    : initialEntityType || "OPLOC";
  const [entityType, setEntityType] = useState<EditableEntityType>(initialType),
    [canonicalId, setCanonicalId] = useState(record?.canonicalId || "");
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
      ...initialValues(initialType, record),
      ...prefillValues,
      ...(legacySourceCanonicalId ? { legacySourceCanonicalId } : {}),
    })),
    [decisionReason, setDecisionReason] = useState("");
  const [context, setContext] = useState<Context | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [allowDistinctDuplicate, setAllowDistinctDuplicate] = useState(false),
    [inlineAddress, setInlineAddress] = useState<InlineAddress | null>(null),
    [standaloneEvidence, setStandaloneEvidence] =
      useState<LegacyAddressEvidence | null>(null);
  const fields = CanonicalFormFields[entityType];
  const locked = useMemo(() => new Set(fieldLocks(record)), [record]);
  async function request(body: Record<string, unknown>) {
    const send = () =>
      fetch("/api/canonical-records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    let response = await send();
    if (response.status === 401 && (await refreshSession()))
      response = await send();
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error?.message || "Canonical operation failed.");
    return payload;
  }
  const loadContext = useCallback(async () => {
    try {
      let response = await fetch("/api/canonical-records", {
        cache: "no-store",
      });
      if (response.status === 401 && (await refreshSession()))
        response = await fetch("/api/canonical-records", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message || "Editor options could not be loaded.",
        );
      setContext(body);
      if (!record) setCanonicalId(body.generatedIds[initialType]);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [initialType, record, refreshSession]);
  useEffect(() => {
    void (async () => {
      await loadContext();
    })();
  }, [loadContext]);
  function changeType(next: EditableEntityType) {
    setEntityType(next);
    setCanonicalId(context?.generatedIds[next] || "");
    setValues(initialValues(next));
    setPreview(null);
    setInlineAddress(null);
    setStandaloneEvidence(null);
    setAllowDistinctDuplicate(false);
    setFieldErrors({});
    setError("");
  }
  function change(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => withoutKey(current, name));
    setPreview(null);
  }
  function command(action: "preview" | "save") {
    return {
      action,
      entityType,
      canonicalId,
      expectedVersion: record ? Number(record.record.version) : 0,
      values: serialiseValues(entityType, {
        ...values,
        ...(inlineAddress
          ? { addressReference: inlineAddress.canonicalId }
          : {}),
      }),
      decisionReason,
      ...(entityType === "Address" ? { allowDistinctDuplicate } : {}),
      ...(entityType === "OPLOC" && values.legacySourceCanonicalId
        ? { legacySourceCanonicalId: String(values.legacySourceCanonicalId) }
        : {}),
      ...(inlineAddress
        ? {
            inlineAddress: {
              canonicalId: inlineAddress.canonicalId,
              expectedVersion: inlineAddress.expectedVersion,
              values: serialiseValues("Address", inlineAddress.values),
              decisionReason: inlineAddress.decisionReason,
              allowDistinctDuplicate: inlineAddress.allowDistinctDuplicate,
            },
          }
        : {}),
    };
  }
  async function runPreview() {
    if (!validateVisibleFields()) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await request(command("preview")));
    } catch (cause) {
      handleValidationFailure(cause);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!validateVisibleFields()) return;
    setBusy(true);
    setError("");
    try {
      const result = await request(command("save"));
      const authoritative =
        canonicalRecordFromMutationResponse(result) ||
        (await fetchAuthoritativeRecord(canonicalId));
      await saved(authoritative);
      window.dispatchEvent(
        new CustomEvent("fika:canonical-record-mutated", {
          detail: { canonicalId: authoritative.canonicalId },
        }),
      );
      close();
    } catch (cause) {
      handleValidationFailure(cause);
    } finally {
      setBusy(false);
    }
  }
  async function fetchAuthoritativeRecord(id: string) {
    const send = () =>
      fetch(
        `/api/registry?search=${encodeURIComponent(id)}&page=1&pageSize=25`,
        { cache: "no-store" },
      );
    let response = await send();
    if (response.status === 401 && (await refreshSession()))
      response = await send();
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        body.error?.message ||
          "The saved record could not be refreshed. Retry to confirm its current status.",
      );
    const authoritative = (body.records as CanonicalRecord[] | undefined)?.find(
      (candidate) => candidate.canonicalId === id,
    );
    if (!authoritative)
      throw new Error(
        "The change was saved, but the authoritative record could not be refreshed. Retry before continuing.",
      );
    return authoritative;
  }
  function validateVisibleFields() {
    const next: Record<string, string> = {};
    for (const field of fields.filter(
      (field) =>
        field.name !== "mergedIntoOplocId" ||
        values.lifecycleState === "merged",
    ))
      if (field.required && emptyValue(values[field.name]))
        next[field.name] = `${field.label} is required.`;
    if (inlineAddress)
      for (const field of CanonicalFormFields.Address)
        if (field.required && emptyValue(inlineAddress.values[field.name]))
          next[`inline.${field.name}`] = `${field.label} is required.`;
    setFieldErrors(next);
    const first = Object.keys(next)[0];
    if (first) focusInvalidField(first);
    return !first;
  }
  function handleValidationFailure(cause: unknown) {
    const message = (cause as Error).message;
    const field = schemaErrorField(message);
    if (field) {
      const key =
        inlineAddress &&
        CanonicalFormFields.Address.some((item) => item.name === field)
          ? `inline.${field}`
          : field;
      setFieldErrors((current) => ({
        ...current,
        [key]: plainValidationMessage(message, field),
      }));
      focusInvalidField(key);
    } else setError(message);
  }
  function selectedEvidence() {
    return context?.legacySites.find(
      (site) => site.canonicalId === values.legacySourceCanonicalId,
    )?.addressEvidence;
  }
  function createAddress() {
    const evidence = selectedEvidence();
    const addressId = context?.generatedIds.Address;
    if (!addressId) {
      setError(
        "The Address identity is still being prepared. Try again in a moment.",
      );
      return;
    }
    setInlineAddress({
      mode: "create",
      canonicalId: addressId,
      expectedVersion: 0,
      values: { ...initialValues("Address"), ...(evidence?.proposed || {}) },
      decisionReason: "",
      allowDistinctDuplicate: false,
      evidence,
    });
    setPreview(null);
  }
  async function publishLinkedAddress(option: RelationshipOption) {
    setBusy(true);
    setError("");
    try {
      const currentCanonicalId = canonicalId;
      const result = await request({
        action: "approve-address",
        canonicalId: option.canonicalId,
        expectedVersion: option.recordVersion,
        note: "Published the valid Address linked by this OPLOC workflow.",
      });
      const authoritative =
        canonicalRecordFromMutationResponse(result) ||
        (await fetchAuthoritativeRecord(option.canonicalId));
      window.dispatchEvent(
        new CustomEvent("fika:canonical-record-mutated", {
          detail: { canonicalId: authoritative.canonicalId },
        }),
      );
      await loadContext();
      setCanonicalId(currentCanonicalId);
      setPreview(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function applyLegacyEvidence(sourceId: string) {
    const evidence = context?.legacySites.find(
      (site) => site.canonicalId === sourceId,
    )?.addressEvidence;
    if (!evidence) return;
    setStandaloneEvidence(evidence);
    setValues((current) => ({ ...current, ...evidence.proposed }));
    setPreview(null);
  }
  const addressAuthorised = Boolean(
    context?.permissions.includes(record ? "address.edit" : "address.create") &&
    context.permissions.includes("address.approve") &&
    context.permissions.includes("address.publish"),
  );
  const canSave = Boolean(
    entityType === "Address"
      ? addressAuthorised
      : context?.permissions.includes(approvalPermission(entityType)) &&
          (!inlineAddress || addressAuthorised),
  );
  const duplicateReviewBlocked = Boolean(
    (preview?.duplicateCandidates?.length && !allowDistinctDuplicate) ||
    (preview?.inlineAddress?.duplicateCandidates.length &&
      !inlineAddress?.allowDistinctDuplicate),
  );
  return (
    <div
      className="detail-backdrop canonical-editor-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="canonical-editor-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="detail-modal canonical-structured-modal">
        <header>
          <div>
            <small>Governed canonical decision</small>
            <h2 id="canonical-editor-title">
              {record ? `Edit ${entityType}` : "Create canonical candidate"}
            </h2>
          </div>
          <button
            className="icon"
            aria-label="Close canonical editor"
            onClick={close}
          >
            <X />
          </button>
        </header>
        {error && (
          <div className="error" role="alert">
            <AlertTriangle />
            {error}
          </div>
        )}
        {!record && !initialEntityType && (
          <label>
            Entity definition
            <select
              value={entityType}
              onChange={(event) =>
                changeType(event.target.value as EditableEntityType)
              }
            >
              {entityTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
        )}
        {record && (
          <div className="detail-summary">
            <span>{record.lifecycleStatus || "needs-review"}</span>
          </div>
        )}
        {(record || preview) && (
          <details className="technical-details">
            <summary>Technical details</summary>
            <p>{canonicalId}</p>
            {record && (
              <p>
                Schema {String(record.record.schemaVersion)} · version{" "}
                {String(record.record.version)}
              </p>
            )}
          </details>
        )}
        {entityType === "OPLOC" && !record && (
          <label>
            Preserved legacy Site evidence (optional)
            <select
              value={String(values.legacySourceCanonicalId || "")}
              onChange={(event) =>
                change("legacySourceCanonicalId", event.target.value)
              }
            >
              <option value="">No provider evidence</option>
              {context?.legacySites.map((site) => (
                <option
                  key={site.canonicalId}
                  value={site.canonicalId}
                  disabled={site.mappingStatus === "confirmed"}
                >
                  {site.label} · {site.canonicalId} · {site.mappingStatus}
                </option>
              ))}
            </select>
            <small>
              The source candidate is preserved unchanged. Selecting it proposes
              a deterministic mapping; it never publishes the OPLOC.
            </small>
          </label>
        )}
        {entityType === "Address" &&
          !record &&
          context?.legacySites.some((site) => site.addressEvidence) && (
            <label>
              Prefill from preserved Site evidence (optional)
              <select
                defaultValue=""
                onChange={(event) => applyLegacyEvidence(event.target.value)}
              >
                <option value="">Choose preserved evidence…</option>
                {context.legacySites
                  .filter((site) => site.addressEvidence)
                  .map((site) => (
                    <option key={site.canonicalId} value={site.canonicalId}>
                      {site.label}
                    </option>
                  ))}
              </select>
              <small>
                Prefill is evidence-derived. Review it before saving; a valid
                Address is then approved and published automatically.
              </small>
            </label>
          )}
        {standaloneEvidence && (
          <AddressEvidence evidence={standaloneEvidence} />
        )}
        {entityType === "OPLOC" && (
          <div className="info">
            <CheckCircle2 />
            <span>
              The OPLOC stores only the selected stable Address ID. A valid new
              Address is approved, published and linked in the same transaction.
            </span>
          </div>
        )}
        <div className="editor-grid">
          {fields
            .filter(
              (field) =>
                field.name !== "mergedIntoOplocId" ||
                values.lifecycleState === "merged",
            )
            .map((field) =>
              field.control === "address-relationship" ? (
                <AddressRelationshipField
                  key={field.name}
                  value={String(
                    values[field.name] || inlineAddress?.canonicalId || "",
                  )}
                  inlineAddress={inlineAddress}
                  disabled={locked.has(field.name)}
                  context={context}
                  change={(value) => change(field.name, value)}
                  create={createAddress}
                  publish={publishLinkedAddress}
                />
              ) : (
                <EditorField
                  key={field.name}
                  field={field}
                  value={values[field.name]}
                  disabled={locked.has(field.name)}
                  context={context}
                  error={fieldErrors[field.name]}
                  change={(value) => change(field.name, value)}
                />
              ),
            )}
        </div>
        {inlineAddress && (
          <InlineAddressEditor
            state={inlineAddress}
            preview={preview?.inlineAddress}
            context={context}
            errors={fieldErrors}
            clearError={(name) =>
              setFieldErrors((current) => withoutKey(current, `inline.${name}`))
            }
            update={(next) => {
              setInlineAddress(next);
              setPreview(null);
            }}
            onUseExisting={(canonicalId) => {
              change("addressReference", canonicalId);
              setInlineAddress(null);
              setPreview(null);
            }}
            cancel={() => {
              if (inlineAddress.mode === "create")
                change("addressReference", "");
              setInlineAddress(null);
              setFieldErrors((current) =>
                Object.fromEntries(
                  Object.entries(current).filter(
                    ([key]) => !key.startsWith("inline."),
                  ),
                ),
              );
              setPreview(null);
            }}
          />
        )}
        {locked.size > 0 && (
          <p>
            <b>Locked fields:</b> {[...locked].join(", ")}. The editor will not
            bypass these locks.
          </p>
        )}
        <label>
          Add a note <span>(optional)</span>
          <textarea
            value={decisionReason}
            onChange={(event) => {
              setDecisionReason(event.target.value);
              setPreview(null);
            }}
            maxLength={1000}
            placeholder="Add exceptional context that is not already shown above."
          />
          <small>
            The Integration Hub creates the routine audit wording from the
            action and displayed evidence.
          </small>
        </label>
        {preview && (
          <section className="canonical-preview" aria-live="polite">
            <h3>
              <CheckCircle2 /> Preview ready
            </h3>
            <p>
              Save creates a <b>{preview.lifecycleAfterSave}</b>,{" "}
              <b>{preview.publicationAfterSave}</b> record.
              {preview.publicationAfterSave === "published"
                ? " The valid Address will be approved and published automatically."
                : " It will not publish the OPLOC."}
            </p>
            {preview.reusedAddress && (
              <p>
                <b>Existing Address reused:</b> {preview.reusedAddress.label}
                {preview.reusedAddress.willPublish
                  ? " — it will be published before linking."
                  : ""}
              </p>
            )}
            <p>
              <b>Audit summary:</b> {preview.generatedReason}
            </p>
            <ChangeTable changes={preview.changes} />
            {preview.inlineAddress && (
              <>
                <h4>Address write</h4>
                <p>
                  <b>Address audit summary:</b>{" "}
                  {preview.inlineAddress.generatedReason}
                </p>
                <ChangeTable changes={preview.inlineAddress.changes} />
              </>
            )}
            <ul>
              {preview.additionalWrites.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {entityType === "Address" && (
              <DuplicateWarning
                duplicates={preview.duplicateCandidates || []}
                checked={allowDistinctDuplicate}
                change={setAllowDistinctDuplicate}
                onUseExisting={() => close()}
              />
            )}
          </section>
        )}
        {!canSave && context && (
          <div className="warning">
            <AlertTriangle />
            <span>
              Your role may preview this decision but cannot approve its
              governed save.
            </span>
          </div>
        )}
        <div className="actions canonical-modal-actions">
          <button onClick={close}>Cancel</button>
          <button
            disabled={busy || !canonicalId}
            onClick={() => void runPreview()}
          >
            {busy ? "Validating…" : "Preview change"}
          </button>
          <button
            className="primary"
            disabled={busy || !preview || !canSave || duplicateReviewBlocked}
            title={
              duplicateReviewBlocked
                ? "Confirm whether this is genuinely a different Address before saving."
                : undefined
            }
            onClick={() => void save()}
          >
            Save reviewed candidate
          </button>
        </div>
      </section>
    </div>
  );
}

function AddressRelationshipField({
  value,
  inlineAddress,
  disabled,
  context,
  change,
  create,
  publish,
}: {
  value: string;
  inlineAddress: InlineAddress | null;
  disabled: boolean;
  context: Context | null;
  change: (value: string) => void;
  create: () => void;
  publish: (option: RelationshipOption) => Promise<void>;
}) {
  const creating = inlineAddress?.mode === "create";
  return (
    <section
      className="address-relationship-control"
      aria-labelledby="oploc-address-label"
    >
      {creating ? (
        <div className="info inline-address-pending" role="status">
          <CheckCircle2 />
          <span>
            <b>New address being created</b> — it will be validated, approved,
            published and linked when you save this OPLOC. The Address and OPLOC
            are saved together in one transaction.
          </span>
        </div>
      ) : (
        <AddressSelector
          value={value}
          options={
            context?.relationships.filter(
              (option) => option.entityType === "Address",
            ) || []
          }
          disabled={disabled}
          canCreate={Boolean(context?.permissions.includes("address.create"))}
          canPublish={Boolean(context?.permissions.includes("address.publish"))}
          change={change}
          create={create}
          publish={publish}
        />
      )}
    </section>
  );
}

function AddressSelector({
  value,
  options,
  disabled,
  canCreate,
  canPublish,
  change,
  create,
  publish,
}: {
  value: string;
  options: RelationshipOption[];
  disabled: boolean;
  canCreate: boolean;
  canPublish: boolean;
  change: (value: string) => void;
  create: () => void;
  publish: (option: RelationshipOption) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.canonicalId === value);
  const matches = options
    .filter(
      (option) =>
        option.reusable &&
        `${option.label} ${JSON.stringify(option.address || {})}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .slice(0, 12);
  return (
    <section className="relationship-selector">
      <label htmlFor="canonical-field-addressReference-search">
        Address
        <input
          id="canonical-field-addressReference-search"
          value={query}
          disabled={disabled || Boolean(selected)}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search building, address, town or postcode…"
          autoComplete="off"
        />
        <small>Choose a reusable published Address or add a new one.</small>
      </label>
      {selected && (
        <div className="relationship-selection">
          <b>{selected.label}</b>
          <span>
            {selected.reusable
              ? "Published reusable Address"
              : selected.schemaValid
                ? "Valid Address awaiting publication"
                : "Incomplete Address requiring review"}
          </span>
          <div className="actions">
            {!selected.reusable && selected.schemaValid && canPublish && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void publish(selected)}
              >
                Publish linked address and continue
              </button>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                change("");
                setQuery("");
              }}
            >
              Change address
            </button>
          </div>
          <details className="technical-details">
            <summary>Technical details</summary>
            <p>{selected.canonicalId}</p>
          </details>
        </div>
      )}
      {!selected && query && (
        <div
          className="relationship-results"
          role="listbox"
          aria-label="Address results"
        >
          {matches.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={option.canonicalId}
              onClick={() => {
                change(option.canonicalId);
                setQuery("");
              }}
            >
              <b>{option.label}</b>
              <span>Published Address</span>
            </button>
          ))}
          {!matches.length && <p>No reusable Address matches this search.</p>}
        </div>
      )}
      {!selected && !value && (
        <button
          type="button"
          disabled={disabled || !canCreate}
          onClick={create}
        >
          Add new address
        </button>
      )}
      {!selected && value && (
        <div className="error" role="alert">
          <AlertTriangle />
          The linked Address is unavailable or incomplete. Choose a reusable
          Address or add a valid new one.
        </div>
      )}
    </section>
  );
}

function RelationshipSelector({
  id,
  label,
  value,
  options,
  disabled,
  required,
  help,
  error,
  change,
}: {
  id: string;
  label: string;
  value: string;
  options: RelationshipOption[];
  disabled: boolean;
  required?: boolean;
  help?: string;
  error?: string;
  change: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.canonicalId === value);
  const matches = options
    .filter((option) =>
      `${option.label} ${option.entityType} ${option.lifecycleStatus}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .slice(0, 12);
  return (
    <section className="relationship-selector">
      <label htmlFor={`${id}-search`}>
        {label}
        {required ? " *" : ""}
        <input
          id={`${id}-search`}
          value={query}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()} by name…`}
          autoComplete="off"
        />
        {error && (
          <small className="field-error" id={`${id}-error`} role="alert">
            {error}
          </small>
        )}
        {help && <small>{help}</small>}
      </label>
      {selected && (
        <div className="relationship-selection">
          <b>{selected.label}</b>
          <span>
            {selected.entityType} · {selected.lifecycleStatus}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              change("");
              setQuery("");
            }}
          >
            Change selection
          </button>
        </div>
      )}
      {!selected && query && (
        <div
          className="relationship-results"
          role="listbox"
          aria-label={`${label} results`}
        >
          {matches.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={option.canonicalId}
              onClick={() => {
                change(option.canonicalId);
                setQuery("");
              }}
            >
              <b>{option.label}</b>
              <span>
                {option.entityType} · {option.lifecycleStatus}
                {option.approvalState ? ` · ${option.approvalState}` : ""}
              </span>
            </button>
          ))}
          {!matches.length && <p>No accessible matching records.</p>}
        </div>
      )}
      {!selected && !query && <p>No {label.toLowerCase()} selected.</p>}
    </section>
  );
}

function InlineAddressEditor({
  state,
  preview,
  context,
  errors,
  clearError,
  update,
  onUseExisting,
  cancel,
}: {
  state: InlineAddress;
  preview?: Preview["inlineAddress"];
  context: Context | null;
  errors: Record<string, string>;
  clearError: (name: string) => void;
  update: (state: InlineAddress) => void;
  onUseExisting: (canonicalId: string) => void;
  cancel: () => void;
}) {
  const locks = new Set(
    context?.relationships.find(
      (option) => option.canonicalId === state.canonicalId,
    )?.fieldLocks || [],
  );
  function change(name: string, value: unknown) {
    clearError(name);
    update({ ...state, values: { ...state.values, [name]: value } });
  }
  return (
    <section
      className="inline-address-editor"
      aria-labelledby="inline-address-title"
    >
      <div className="section-heading">
        <div>
          <small>
            {state.mode === "create"
              ? "New separate canonical record"
              : "Governed Address change"}
          </small>
          <h3 id="inline-address-title">
            {state.mode === "create" ? "Create address" : "Edit address"}
          </h3>
        </div>
        <button type="button" onClick={cancel}>
          Cancel address changes
        </button>
      </div>
      {preview && (
        <details className="technical-details">
          <summary>Technical details</summary>
          <p>{state.canonicalId}</p>
        </details>
      )}
      {state.evidence && <AddressEvidence evidence={state.evidence} />}
      <div className="editor-grid">
        {CanonicalFormFields.Address.map((field) => (
          <div
            key={field.name}
            className={
              state.evidence?.derivedFields.includes(field.name)
                ? "evidence-derived-field"
                : ""
            }
          >
            <EditorField
              field={field}
              value={state.values[field.name]}
              disabled={locks.has(field.name)}
              context={context}
              idPrefix="inline-address-field"
              error={errors[`inline.${field.name}`]}
              change={(value) => change(field.name, value)}
            />
            {state.evidence?.derivedFields.includes(field.name) && (
              <small>Prefilled from evidence — review required</small>
            )}
          </div>
        ))}
      </div>
      {locks.size > 0 && (
        <p>
          <b>Locked Address fields:</b> {[...locks].join(", ")}.
        </p>
      )}
      <label>
        Add an Address note <span>(optional)</span>
        <textarea
          maxLength={1000}
          value={state.decisionReason}
          onChange={(event) =>
            update({ ...state, decisionReason: event.target.value })
          }
          placeholder="Add exceptional context not already represented by the structured address."
        />
      </label>
      {preview && (
        <>
          <h4>Address preview</h4>
          <ChangeTable changes={preview.changes} />
          <DuplicateWarning
            duplicates={preview.duplicateCandidates}
            checked={state.allowDistinctDuplicate}
            change={(checked) =>
              update({ ...state, allowDistinctDuplicate: checked })
            }
            onUseExisting={onUseExisting}
          />
        </>
      )}
    </section>
  );
}

function AddressEvidence({ evidence }: { evidence: LegacyAddressEvidence }) {
  return (
    <section className="address-evidence">
      <h4>Preserved source evidence</h4>
      {evidence.originals.map((item) => (
        <p key={`${item.source}:${item.value}`}>
          <b>{item.source}:</b> {item.value}
        </p>
      ))}
      {evidence.warnings.map((warning) => (
        <p key={warning}>
          <AlertTriangle /> {warning}
        </p>
      ))}
      {evidence.conflicts.map((conflict) => (
        <div key={conflict} className="error">
          <AlertTriangle />
          {conflict}
        </div>
      ))}
    </section>
  );
}

function DuplicateWarning({
  duplicates,
  checked,
  change,
  onUseExisting,
}: {
  duplicates: Duplicate[];
  checked: boolean;
  change: (checked: boolean) => void;
  onUseExisting?: (canonicalId: string) => void;
}) {
  if (!duplicates.length)
    return (
      <p>
        <CheckCircle2 /> No normalised Address match was found.
      </p>
    );
  if (checked)
    return (
      <div className="info" role="status">
        <CheckCircle2 />
        <div>
          <b>Confirmed as a genuinely different Address</b>
          <p>
            The prefilled address will be retained. You can now save it as a
            separate canonical Address.
          </p>
          <button type="button" onClick={() => change(false)}>
            Review the possible match again
          </button>
        </div>
      </div>
    );
  return (
    <div className="warning">
      <AlertTriangle />
      <div>
        <b>Likely existing Address</b>
        <ul>
          {duplicates.map((candidate) => (
            <li key={candidate.canonicalId}>
              {candidate.label} <small>{candidate.reason}</small>
              {onUseExisting && (
                <button
                  type="button"
                  onClick={() => onUseExisting(candidate.canonicalId)}
                >
                  Use this address
                </button>
              )}
            </li>
          ))}
        </ul>
        <label>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => change(event.target.checked)}
          />{" "}
          I reviewed these matches and this is a genuinely different Address.
        </label>
        <p>Materially different addresses are never merged automatically.</p>
      </div>
    </div>
  );
}

function ChangeTable({
  changes,
}: {
  changes: { field: string; previousValue: unknown; newValue: unknown }[];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Current</th>
            <th>Proposed</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.field}>
              <td>{change.field}</td>
              <td>
                <code>{compact(change.previousValue)}</code>
              </td>
              <td>
                <code>{compact(change.newValue)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditorField({
  field,
  value,
  disabled,
  context,
  idPrefix = "canonical-field",
  error,
  change,
}: {
  field: CanonicalFormField;
  value: unknown;
  disabled: boolean;
  context: Context | null;
  idPrefix?: string;
  error?: string;
  change: (value: unknown) => void;
}) {
  const id = `${idPrefix}-${field.name}`;
  const message = error ? (
    <small className="field-error" id={`${id}-error`} role="alert">
      {error}
    </small>
  ) : null;
  const describedBy = error ? `${id}-error` : undefined;
  if (field.control === "select")
    return (
      <label htmlFor={id}>
        {field.label}
        <select
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          value={String(value || "")}
          disabled={disabled}
          required={field.required}
          onChange={(event) => change(event.target.value)}
        >
          <option value="">Choose…</option>
          {field.values?.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        {message}
        {field.help && <small>{field.help}</small>}
      </label>
    );
  if (field.control === "country")
    return (
      <label htmlFor={id}>
        {field.label}
        <select
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          value={String(value || "")}
          disabled={disabled}
          required={field.required}
          onChange={(event) => change(event.target.value)}
        >
          <option value="">Choose a country…</option>
          {CountryCodes.map((code) => (
            <option key={code} value={code}>
              {countryLabel(code)}
            </option>
          ))}
        </select>
        {message}
        <small>The governed country code is stored automatically.</small>
      </label>
    );
  if (field.control === "relationship") {
    const options =
      context?.relationships.filter(
        (option) => option.entityType === field.relationshipType,
      ) || [];
    return (
      <RelationshipSelector
        id={id}
        label={field.label}
        value={String(value || "")}
        options={options}
        disabled={disabled}
        required={field.required}
        help={field.help}
        error={error}
        change={change}
      />
    );
  }
  if (field.control === "textarea" || field.control === "repeatable-text")
    return (
      <label htmlFor={id}>
        {field.label}
        <textarea
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          value={Array.isArray(value) ? value.join("\n") : String(value || "")}
          disabled={disabled}
          required={field.required}
          onChange={(event) =>
            change(
              field.control === "repeatable-text"
                ? event.target.value.split(/\r?\n/).filter(Boolean)
                : event.target.value,
            )
          }
        />
        {message}
        {field.help && <small>{field.help}</small>}
      </label>
    );
  return (
    <label htmlFor={id}>
      {field.label}
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        type={
          field.control === "email"
            ? "email"
            : field.control === "date"
              ? "date"
              : field.control === "number"
                ? "number"
              : "text"
        }
        value={String(value || "")}
        disabled={disabled}
        required={field.required}
        onChange={(event) => change(event.target.value)}
      />
      {message}
      {field.help && <small>{field.help}</small>}
    </label>
  );
}
function supported(type: unknown): type is EditableEntityType {
  return entityTypes.includes(type as EditableEntityType);
}
function initialValues(type: EditableEntityType, record?: CanonicalRecord) {
  const source = record?.record || {};
  const values = Object.fromEntries(
    CanonicalFormFields[type].map((field) => [
      field.name,
      field.name === "locationTypeEffectiveFrom"
        ? today()
        : (source[field.name] ?? defaultValue(field)),
    ]),
  );
  if (type === "OPLOC" && Array.isArray(source.aliases))
    values.aliases = source.aliases
      .map((alias) =>
        typeof alias === "object" && alias
          ? String((alias as Record<string, unknown>).alias || "")
          : String(alias),
      )
      .filter(Boolean);
  return values;
}
function defaultValue(field: CanonicalFormField) {
  if (field.name === "lifecycleState") return "active";
  if (field.name === "designation") return "primary";
  if (field.name === "state") return "enabled";
  if (field.name === "primaryLocationType") return "Site";
  if (field.name === "effectiveFrom") return today();
  if (field.control === "repeatable-text") return [];
  return "";
}
function serialiseValues(
  type: EditableEntityType,
  values: Record<string, unknown>,
) {
  const allowed = new Set(CanonicalFormFields[type].map((field) => field.name));
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => allowed.has(key)),
  );
}
function fieldLocks(record?: CanonicalRecord) {
  const ownership = record?.record.ownership as
    { fikaOwned?: { fieldLocks?: unknown[] } } | undefined;
  return Array.isArray(ownership?.fikaOwned?.fieldLocks)
    ? ownership!.fikaOwned!.fieldLocks!.map(String)
    : [];
}
function approvalPermission(type: EditableEntityType) {
  if (type === "OPLOC") return "oploc.approve-identity";
  if (type === "Address") return "address.approve";
  if (type === "Legend") return "legend.approve";
  if (type === "Employment") return "employment.manage";
  if (type === "Operational Assignment")
    return "operational-assignment.approve";
  if (type === "Operational Capability")
    return "operational-capability.approve-catalogue";
  return "operational-capability.approve-enablement";
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function compact(value: unknown) {
  const text = JSON.stringify(value);
  return text === undefined
    ? "—"
    : text.length > 160
      ? `${text.slice(0, 157)}…`
      : text;
}
function emptyValue(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && !value.length)
  );
}
function withoutKey(values: Record<string, string>, key: string) {
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => name !== key),
  );
}
function schemaErrorField(message: string) {
  return message
    .match(/Schema validation failed at ([^:]+):/)?.[1]
    ?.split(".")
    .at(-1);
}
function plainValidationMessage(message: string, field: string) {
  return (
    message.replace(`Schema validation failed at ${field}:`, "").trim() ||
    "Review this value."
  );
}
function focusInvalidField(key: string) {
  const id = key.startsWith("inline.")
    ? `inline-address-field-${key.slice(7)}`
    : `canonical-field-${key}`;
  window.setTimeout(() => {
    const element =
      document.getElementById(id) || document.getElementById(`${id}-search`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus();
  }, 0);
}
