"use client";

import { useEffect, useRef, useState } from "react";
import { CANONICAL_ALLERGEN_COLUMNS, resolveNoKeyAllergenState, toggleOperationalAllergen, type CanonicalAllergenKey, type OperationalAllergenState } from "../../../shared/allergen-contract";
import type { ProductionOrder } from "../../lib/production-types";
import type { AllergenReviewRow } from "../../lib/production-day";
import { bookingContextEntries } from "./BookingContext";
import { titleCaseDish } from "../../lib/production-presentation";
import { clearLocalDraft, loadLocalChecked, loadLocalDraft, saveLocalChecked, saveLocalDraft, type AllergenReviewLineage } from "../lib/allergen-review-local";
import { checkpointAllergenReviewRow, completeAllergenReviewMap, unresolvedNamedAllergenKeys } from "../lib/allergen-review-state";
import "./allergen-review.css";

type SignatureRole = "production_chef" | "head_chef_site_manager";
type MatrixLineage = AllergenReviewLineage;
type ReviewSyncStatus = "clean" | "draft" | "saving" | "saved" | "error";

function sameLineage(left: MatrixLineage | undefined, right: MatrixLineage | undefined) {
  return Boolean(left && right && left.productionOrderId === right.productionOrderId && left.serviceDate === right.serviceDate && left.sourceDayId === right.sourceDayId && left.sourcePublicationId === right.sourcePublicationId && left.sourcePublicationDayId === right.sourcePublicationDayId && left.sourceVersion === right.sourceVersion && left.sourceContentHash === right.sourceContentHash && left.matrixContentHash === right.matrixContentHash);
}

function displayState(states: Record<string, OperationalAllergenState> | undefined, key: string): OperationalAllergenState | "none" {
  if (key === "no_key_allergens") {
    const completion = completeAllergenReviewMap(states);
    return completion.complete ? completion.states.no_key_allergens : resolveNoKeyAllergenState(states);
  }
  const state = states?.[key];
  if (state) return state;
  return "unrecorded";
}

export default function AllergenReviewMatrix({
  rows,
  orders,
  scopeKey,
  busy = false,
  locked = false,
  onCheckedChange,
  onReviewChanged,
  onRegisterSave,
  onRegisterReviewState,
  onSignatureRolesChange,
  onOrderSignatureRolesChange,
  onMatrixStatusChange,
  onFinalizationChange,
  onLineageChange,
  onHydrationChange,
  onDirtyChange,
  onPersistenceChange,
  onReviewSyncChange,
}: {
  rows: AllergenReviewRow[];
  orders: ProductionOrder[];
  scopeKey: string;
  busy?: boolean;
  locked?: boolean;
  onCheckedChange?: (checked: number, total: number, keys: Set<string>) => void;
  onReviewChanged?: () => void;
  onRegisterSave?: (save: () => Promise<void>) => void;
  onRegisterReviewState?: (get: () => unknown[]) => void;
  onSignatureRolesChange?: (roles: SignatureRole[]) => void;
  onOrderSignatureRolesChange?: (rolesByOrderId: Record<string, SignatureRole[]>) => void;
  onMatrixStatusChange?: (matrixStatusByOrderId: Record<string, string | undefined>) => void;
  onFinalizationChange?: (finalized: boolean) => void;
  onLineageChange?: (lineageByOrderId: Record<string, MatrixLineage>) => void;
  onHydrationChange?: (hydrating: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPersistenceChange?: (pending: boolean) => void;
  onReviewSyncChange?: (status: ReviewSyncStatus) => void;
}) {
  const [states, setStates] = useState<Record<string, Record<string, OperationalAllergenState>>>(
    () => Object.fromEntries(rows.map(row => [row.key, { ...(row.snapshot?.allergens || {}) }])) as Record<string, Record<string, OperationalAllergenState>>,
  );
  const [checkedRows, setCheckedRows] = useState<Set<string>>(() => new Set());
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [reviewSyncStatus, setReviewSyncStatus] = useState<ReviewSyncStatus>("clean");
  const latestSave = useRef<() => Promise<void>>(() => Promise.resolve());
  const latestStatesRef = useRef(states);
  const latestCheckedRowsRef = useRef(checkedRows);
  const latestLineageRef = useRef<Record<string, MatrixLineage>>({});
  const inFlightSave = useRef<Promise<void> | undefined>(undefined);
  const pendingSaveCountRef = useRef(0);
  const checkpointCompletionRef = useRef<Promise<void> | undefined>(undefined);
  const hydratedRef = useRef(false);
  const checkpointSequenceRef = useRef(0);
  const latestDraftWriteRef = useRef<Promise<void> | undefined>(undefined);
  const editVersionRef = useRef(0);
  const dirtyRef = useRef(false);
  const authoritativeReviewedRef = useRef(false);
  const bookingDietaries = [...new Set(orders.flatMap(order => bookingContextEntries(order.bookingDietaries)))];
  const bookingNotes = [...new Set(orders.map(order => order.bookingNotes).filter((note): note is string => Boolean(note?.trim())))];

  const setSyncStatus = (status: ReviewSyncStatus) => {
    setReviewSyncStatus(status);
    onReviewSyncChange?.(status);
  };

  const persistDraft = (nextStates: Record<string, Record<string, OperationalAllergenState>>, nextCheckedRows: Set<string>) => {
    const draft = {
      states: nextStates,
      checkedRows: [...nextCheckedRows],
      lineageByOrderId: latestLineageRef.current,
      savedAt: new Date().toISOString(),
    } satisfies import("../lib/allergen-review-local").AllergenReviewDraft;
    const write = saveLocalDraft(scopeKey, draft).then(() => saveLocalChecked(scopeKey, nextCheckedRows));
    latestDraftWriteRef.current = write;
    void write;
  };

  useEffect(() => {
    let cancelled = false;
    onHydrationChange?.(true);

    const hydrate = async () => {
      hydratedRef.current = false;
      const orderIds = [...new Set(orders.map(order => order.canonicalId))];
      if (!orderIds.length) {
        dirtyRef.current = false;
        authoritativeReviewedRef.current = false;
        latestLineageRef.current = {};
        setDirty(false);
        setSyncStatus("clean");
        onDirtyChange?.(false);
        onSignatureRolesChange?.([]);
        onOrderSignatureRolesChange?.({});
        onMatrixStatusChange?.({});
        onFinalizationChange?.(false);
        onLineageChange?.({});
        latestCheckedRowsRef.current = new Set();
        setCheckedRows(new Set());
        hydratedRef.current = true;
        return;
      }

      const response = await fetch(`/api/production-plan?matrixStatus=1&orderIds=${encodeURIComponent(orderIds.join(","))}`, { cache: "no-store" });
      const responseBody = response.ok
        ? await response.json() as {
            matrixStatuses?: Array<{
              orderId: string;
              signatureRoles: SignatureRole[];
              reviewed: boolean;
              matrixStatus?: string;
              sourceLineage?: MatrixLineage;
              matrixItems?: Array<{
                sourceLineId: string;
                allergens: Record<string, OperationalAllergenState>;
                evidenceStatus: string;
              }>;
            }>;
          }
        : { matrixStatuses: [] as Array<{
            orderId: string;
            signatureRoles: SignatureRole[];
            reviewed: boolean;
            matrixStatus?: string;
            sourceLineage?: MatrixLineage;
            matrixItems?: Array<{
              sourceLineId: string;
              allergens: Record<string, OperationalAllergenState>;
              evidenceStatus: string;
            }>;
          }> };

      const statuses = responseBody.matrixStatuses || [];
      const saved = new Map<string, { allergens: Record<string, OperationalAllergenState>; completed: boolean }>();
      const lineage = Object.fromEntries(
        statuses.flatMap(status => status.sourceLineage ? [[status.orderId, status.sourceLineage] as const] : []),
      );
      const rolesByOrderId = Object.fromEntries(
        orderIds.map(orderId => [orderId, statuses.find(status => status.orderId === orderId)?.signatureRoles || []]),
      ) as Record<string, SignatureRole[]>;
      const matrixStatusByOrderId = Object.fromEntries(
        orderIds.map(orderId => [orderId, statuses.find(status => status.orderId === orderId)?.matrixStatus]),
      ) as Record<string, string | undefined>;
      const allStatusesPresent = statuses.length === orderIds.length;
      const commonRoles = (["production_chef", "head_chef_site_manager"] as SignatureRole[])
        .filter(role => allStatusesPresent && statuses.every(status => status.signatureRoles.includes(role)));
      const authoritativeReviewed = allStatusesPresent && statuses.every(status => status.reviewed);

      if (cancelled) return;
      dirtyRef.current = false;
      authoritativeReviewedRef.current = authoritativeReviewed;
      latestLineageRef.current = lineage;
      setDirty(false);
      setSyncStatus("clean");
      onDirtyChange?.(false);
      onLineageChange?.(lineage);
      onOrderSignatureRolesChange?.(rolesByOrderId);
      onMatrixStatusChange?.(matrixStatusByOrderId);
      onSignatureRolesChange?.(commonRoles);
      onFinalizationChange?.(allStatusesPresent && statuses.every(status => status.matrixStatus === "ready"));

      for (const status of statuses) {
        const order = orders.find(candidate => candidate.canonicalId === status.orderId);
        if (!order) continue;
        for (const item of status.matrixItems || []) {
          const state = { allergens: item.allergens || {}, completed: item.evidenceStatus === "completed" };
          saved.set(`${order.origin}:${item.sourceLineId}`, state);
          const line = order.lines.find(candidate => candidate.canonicalId === item.sourceLineId);
          if (line) saved.set(`${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`, state);
        }
      }

      const hydratedStates = Object.fromEntries(rows.map(row => {
        const savedState = saved.get(row.key);
        // Newly-created CPU plans intentionally start with an empty allergen
        // object. They must not erase the approved Menu Planning snapshot.
        const hasSavedEvidence = Boolean(savedState && (savedState.completed || Object.keys(savedState.allergens).length > 0));
        return [row.key, hasSavedEvidence ? savedState!.allergens : { ...(row.snapshot?.allergens || {}) }];
      })) as Record<string, Record<string, OperationalAllergenState>>;
      const localDraft = await loadLocalDraft(scopeKey);
      const hasSignedAuthority = statuses.some(status => status.signatureRoles.length > 0 || ["ready", "generating", "failed"].includes(status.matrixStatus || ""));
      const draftMatchesCurrentLineage = Boolean(localDraft && !hasSignedAuthority && Object.keys(localDraft.lineageByOrderId).length === orderIds.length && orderIds.every(orderId => sameLineage(localDraft.lineageByOrderId[orderId], lineage[orderId])));
      if (localDraft && !draftMatchesCurrentLineage) void clearLocalDraft(scopeKey);
      const restoredStates = draftMatchesCurrentLineage
        ? Object.fromEntries(rows.map(row => [row.key, localDraft!.states[row.key] || hydratedStates[row.key] || {}])) as Record<string, Record<string, OperationalAllergenState>>
        : hydratedStates;
      latestStatesRef.current = restoredStates;
      setStates(restoredStates);

      // The pre-draft checklist store is still read for backwards-compatible
      // cleanup, but it cannot override server state without a matching draft
      // lineage. New persistence always uses the lineage-bound draft above.
      await loadLocalChecked(scopeKey);
      if (!cancelled) {
        const serverChecked = new Set(rows.map(row => row.key).filter(key => saved.get(key)?.completed));
        const nextCheckedRows = draftMatchesCurrentLineage
          ? new Set(localDraft!.checkedRows.filter(key => rows.some(row => row.key === key)))
          : serverChecked;
        latestCheckedRowsRef.current = nextCheckedRows;
        setCheckedRows(nextCheckedRows);
        const restoredDraft = draftMatchesCurrentLineage;
        dirtyRef.current = restoredDraft;
        authoritativeReviewedRef.current = authoritativeReviewed && !restoredDraft;
        setDirty(restoredDraft);
        setSyncStatus(restoredDraft ? "draft" : "clean");
        onDirtyChange?.(restoredDraft);
        hydratedRef.current = true;
      }
    };

    void hydrate().catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "The allergen review could not be hydrated.");
    }).finally(() => {
      if (!cancelled) onHydrationChange?.(false);
    });
    return () => { cancelled = true; };
  }, [rows, orders, scopeKey]);

  useEffect(() => {
    if (!locked) return;
    editVersionRef.current += 1;
  }, [locked]);

  useEffect(() => {
    latestCheckedRowsRef.current = checkedRows;
    onCheckedChange?.(checkedRows.size, rows.length, checkedRows);
  }, [checkedRows, rows.length, onCheckedChange]);

  const saveReview = async (nextStates: Record<string, Record<string, OperationalAllergenState>>, nextCheckedRows: Set<string>, action: "save-plan" | "mark-planned") => {
    const makeOperation = (order: ProductionOrder, action: "save-plan" | "mark-planned") => ({
      action,
      orderId: order.canonicalId,
      planningNotes: "CPU Delivered-In allergen review",
      menuItems: order.lines.map((line, index) => {
        const key = `${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`;
        return {
          id: `menu-item:${order.canonicalId}:${index + 1}`,
          sourceLineId: line.canonicalId,
          name: line.itemName,
          note: "",
          subItems: [{
            id: `sub-item:${order.canonicalId}:${index + 1}:1`,
            name: line.itemName,
            quantity: line.customerQuantity,
            allergens: nextStates[key] || {},
            note: "",
            evidenceStatus: nextCheckedRows.has(`${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`) ? "completed" as const : "not_completed" as const,
          }],
        };
      }),
    });

    const submit = async (action: "save-plan" | "mark-planned") => {
      const response = await fetch("/api/production-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "batch-plan", operations: orders.map(order => makeOperation(order, action)) }),
      });
      const body = await response.json() as {
        results?: Array<{ ok: boolean; error?: string }>;
        partialFailure?: boolean;
      };
      if (!response.ok || body.results?.some(result => !result.ok)) {
        throw new Error(body.results?.find(result => !result.ok)?.error || "The Delivered-In allergen review could not be saved.");
      }
    };

    await submit(action);
  };

  const latestReviewState = () => orders.map(order => ({
    action: "mark-planned" as const,
    orderId: order.canonicalId,
    planningNotes: "CPU Delivered-In allergen review",
    menuItems: order.lines.map((line, index) => {
      const key = `${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`;
      return {
        id: `menu-item:${order.canonicalId}:${index + 1}`,
        sourceLineId: line.canonicalId,
        name: line.itemName,
        note: "",
        subItems: [{
          id: `sub-item:${order.canonicalId}:${index + 1}:1`,
          name: line.itemName,
          quantity: line.customerQuantity,
          allergens: latestStatesRef.current[key] || {},
          note: "",
            evidenceStatus: latestCheckedRowsRef.current.has(`${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`) ? "completed" as const : "not_completed" as const,
        }],
      };
    }),
  }));

  const startSave = (nextStates: Record<string, Record<string, OperationalAllergenState>>, nextCheckedRows: Set<string>, action: "save-plan" | "mark-planned") => {
    const prior = inFlightSave.current;
    const checkpointSequence = ++checkpointSequenceRef.current;
    pendingSaveCountRef.current += 1;
    if (pendingSaveCountRef.current === 1) onPersistenceChange?.(true);
    setSyncStatus("saving");
    const operation = (prior ? prior.catch(() => undefined) : Promise.resolve()).then(() => saveReview(nextStates, nextCheckedRows, action));
    inFlightSave.current = operation;
    void operation.then(
      () => { if (checkpointSequence === checkpointSequenceRef.current) setSyncStatus("saved"); },
      cause => {
        if (checkpointSequence === checkpointSequenceRef.current) {
          setSyncStatus("error");
          setError(cause instanceof Error ? cause.message : "The allergen review could not be synchronised. Use Retry save to try again.");
        }
      },
    ).finally(() => {
      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
      if (pendingSaveCountRef.current === 0) onPersistenceChange?.(false);
      if (inFlightSave.current === operation) inFlightSave.current = undefined;
    });
    return operation;
  };

  const queueCheckpointCompletion = (operation: Promise<void>, editVersion: number, action: "save-plan" | "mark-planned") => {
    const completion = operation.then(async () => {
      if (editVersion !== editVersionRef.current) return;
      await latestDraftWriteRef.current;
      await clearLocalDraft(scopeKey);
      dirtyRef.current = false;
      authoritativeReviewedRef.current = action === "mark-planned";
      setDirty(false);
      onDirtyChange?.(false);
    }).catch(() => undefined);
    checkpointCompletionRef.current = completion;
    void completion.then(() => {
      if (checkpointCompletionRef.current === completion) checkpointCompletionRef.current = undefined;
    });
  };

  latestSave.current = async () => {
    if (inFlightSave.current) {
      await inFlightSave.current;
    }
    if (checkpointCompletionRef.current) {
      await checkpointCompletionRef.current;
    }
    // A locally clean matrix still needs one authoritative completion commit
    // when the server has not recorded this review yet.
    if (!dirtyRef.current && authoritativeReviewedRef.current) return;
    const nextCheckedRows = new Set(latestCheckedRowsRef.current);
    const action = nextCheckedRows.size === rows.length ? "mark-planned" as const : "save-plan" as const;
    const editVersion = editVersionRef.current;
    await startSave(latestStatesRef.current, nextCheckedRows, action);
    if (editVersion !== editVersionRef.current) return;
    await latestDraftWriteRef.current;
    await clearLocalDraft(scopeKey);
    dirtyRef.current = false;
    authoritativeReviewedRef.current = action === "mark-planned";
    setDirty(false);
    onDirtyChange?.(false);
  };

  useEffect(() => {
    onRegisterSave?.(() => latestSave.current());
  }, [onRegisterSave]);

  useEffect(() => {
    onRegisterReviewState?.(latestReviewState);
  }, [onRegisterReviewState, orders]);

  const markChecked = async (rowKey: string) => {
    if (busy || locked) return;
    const currentCheckedRows = latestCheckedRowsRef.current;
    const checkpoint = checkpointAllergenReviewRow(latestStatesRef.current, currentCheckedRows, rowKey, rows.length);
    if (checkpoint.blocked) {
      setRowErrors(current => ({ ...current, [rowKey]: checkpoint.message || "Resolve the remaining allergen states before marking this dish checked." }));
      setError(checkpoint.message || "Resolve the remaining allergen states before marking this dish checked.");
      return;
    }
    const nextStates = checkpoint.states;
    const nextCheckedRows = checkpoint.checkedRows;
    latestStatesRef.current = nextStates;
    setStates(nextStates);
    setRowErrors(current => {
      if (!(rowKey in current)) return current;
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    latestCheckedRowsRef.current = nextCheckedRows;
    setCheckedRows(nextCheckedRows);
    onCheckedChange?.(nextCheckedRows.size, rows.length, nextCheckedRows);
    dirtyRef.current = true;
    authoritativeReviewedRef.current = false;
    setDirty(true);
    setSyncStatus("draft");
    onDirtyChange?.(true);
    editVersionRef.current += 1;
    const editVersion = editVersionRef.current;
    const action = checkpoint.action!;
    persistDraft(nextStates, nextCheckedRows);
    queueCheckpointCompletion(startSave(nextStates, nextCheckedRows, action), editVersion, action);
  };

  const toggle = async (rowKey: string, key: string) => {
    if (busy || locked) return;
    const nextStates = {
      ...latestStatesRef.current,
      [rowKey]: toggleOperationalAllergen(latestStatesRef.current[rowKey] || {}, key as CanonicalAllergenKey),
    };
    latestStatesRef.current = nextStates;
    const nextCheckedRows = new Set(latestCheckedRowsRef.current);
    nextCheckedRows.delete(rowKey);
    latestCheckedRowsRef.current = nextCheckedRows;
    setStates(nextStates);
    setRowErrors(current => {
      if (!(rowKey in current)) return current;
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    dirtyRef.current = true;
    authoritativeReviewedRef.current = false;
    setDirty(true);
    setSyncStatus("draft");
    onDirtyChange?.(true);
    setCheckedRows(nextCheckedRows);
    onCheckedChange?.(nextCheckedRows.size, rows.length, nextCheckedRows);
    persistDraft(nextStates, nextCheckedRows);
    onReviewChanged?.();
    setError("");
    editVersionRef.current += 1;
  };

  const retryCheckpoint = () => {
    if (busy || locked) return;
    const nextCheckedRows = new Set(latestCheckedRowsRef.current);
    const action = nextCheckedRows.size === rows.length ? "mark-planned" as const : "save-plan" as const;
    const editVersion = editVersionRef.current;
    persistDraft(latestStatesRef.current, nextCheckedRows);
    queueCheckpointCompletion(startSave(latestStatesRef.current, nextCheckedRows, action), editVersion, action);
  };

  return (
    <section className="cpu-allergen-matrix-panel" aria-label="CPU allergen matrix">
      {(bookingDietaries.length > 0 || bookingNotes.length > 0) && (
        <section style={{ display: "grid", gap: 5, padding: "13px 15px", border: "1px solid #d8d0f2", borderRadius: 10, background: "#fbfaff", color: "#51486a" }}>
          <h3 style={{ margin: 0, color: "#24115c", fontSize: ".9rem" }}>Booking dietary & notes</h3>
          {bookingDietaries.length > 0 && <p style={{ margin: 0, fontSize: ".78rem" }}><strong>Dietary / allergen requests:</strong> {bookingDietaries.join(" · ")}</p>}
          {bookingNotes.length > 0 && <p style={{ margin: 0, fontSize: ".78rem" }}><strong>Booking notes:</strong> {bookingNotes.join(" · ")}</p>}
        </section>
      )}
      {reviewSyncStatus === "draft" && <p role="status">Review changes saved on this device. Confirm the row to checkpoint them to CPU.</p>}
      {reviewSyncStatus === "saving" && <p role="status">Saving review…</p>}
      {reviewSyncStatus === "saved" && !dirty && <p role="status">Review saved.</p>}
      {reviewSyncStatus === "error" && <p role="alert">Review is saved on this device but not yet synchronised to CPU. <button type="button" onClick={retryCheckpoint} disabled={busy || locked}>Retry save</button></p>}
      <div className="cpu-allergen-legend" aria-label="Allergen matrix legend">
        <span><i className="cpu-allergen-state cpu-allergen-state--contains" />Contains</span>
        <span><i className="cpu-allergen-state cpu-allergen-state--contains cpu-allergen-state--explicit">Yes</i>Explicit no key allergens</span>
        <span><i className="cpu-allergen-state cpu-allergen-state--may_contain" />May contain</span>
        <span><i className="cpu-allergen-state cpu-allergen-state--clear" />No declaration</span>
        <span><i className="cpu-allergen-state cpu-allergen-state--none" />Not recorded</span>
        <em>Click a cell to cycle its CPU review value.</em>
      </div>
      <div className="cpu-allergen-table-wrap">
        <table className="cpu-allergen-table">
          <thead>
            <tr>
              <th>Dish / product</th>
              {CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}
              <th>Approval</th>
              <th>CPU review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className={rowErrors[row.key] ? "cpu-allergen-row--error" : undefined}>
                <th>
                  {titleCaseDish(row.name)}
                  <small>{row.quantity.toLocaleString()} required · {row.destinations.map(item => item.label).join(" · ")}</small>
                  {bookingContextEntries(row.dietaries).length > 0 && <small>Dietary: {bookingContextEntries(row.dietaries).join(" · ")}</small>}
                  {row.notes.map(note => <small key={note}>Note: {note}</small>)}
                </th>
                {CANONICAL_ALLERGEN_COLUMNS.map(([key]) => {
                  const state = displayState(states[row.key], key);
                  const unresolved = key !== "no_key_allergens" && unresolvedNamedAllergenKeys(states[row.key]).includes(key);
                  return (
                    <td key={key}>
                      <button
                        type="button"
                        disabled={busy || locked || key === "no_key_allergens"}
                        className={`cpu-allergen-state cpu-allergen-state--${state}${unresolved && rowErrors[row.key] ? " cpu-allergen-state--unresolved" : ""}`}
                        aria-invalid={unresolved && Boolean(rowErrors[row.key]) || undefined}
                        aria-label={`${titleCaseDish(row.name)}, ${key === "no_key_allergens" ? "No key allergens" : key}: ${key === "no_key_allergens" && state === "contains" ? "explicitly recorded" : state}`}
                        title={key === "no_key_allergens" && state === "contains" ? "Explicitly recorded: no key allergens" : key === "no_key_allergens" && state === "unrecorded" ? "No key allergen decision is not recorded" : undefined}
                        onClick={() => void toggle(row.key, key)}
                      >
                        {key === "no_key_allergens" ? (state === "contains" ? "Yes" : state === "unrecorded" ? "?" : "") : state === "may_contain" ? "MC" : ""}
                      </button>
                    </td>
                  );
                })}
                <td><span className={row.snapshot ? "cpu-allergen-approved" : "cpu-allergen-missing"}>{row.snapshot ? "Published" : "Not recorded"}</span></td>
                <td>
                  {rowErrors[row.key] && <small className="cpu-allergen-row-error" role="alert">{rowErrors[row.key]}</small>}
                  {(() => {
                    const unresolvedCount = unresolvedNamedAllergenKeys(states[row.key]).length;
                    const checked = checkedRows.has(row.key);
                    const actionLabel = checked
                      ? "Checked"
                      : unresolvedCount > 0
                        ? `Confirm ${unresolvedCount} as clear & mark checked`
                        : "Mark checked";
                    return (
                      <button
                        type="button"
                        className={`cpu-allergen-check ${checked ? "cpu-allergen-check--done" : ""}`}
                        onClick={() => void markChecked(row.key)}
                        disabled={busy || locked}
                        aria-label={`${titleCaseDish(row.name)}: ${actionLabel}`}
                        title={checked || unresolvedCount === 0 ? undefined : `This confirms ${unresolvedCount} not recorded named allergen state${unresolvedCount === 1 ? "" : "s"} as clear.`}
                      >
                        {actionLabel}
                      </button>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="cpu-allergen-matrix-footer">
        <span>Review each dish, amend the black/white/MC cells if needed, then mark the dish checked. CPU production chefs and the signing owners are the final allergen authority.</span>
        {error && <strong role="alert">{error}</strong>}
      </footer>
    </section>
  );
}
