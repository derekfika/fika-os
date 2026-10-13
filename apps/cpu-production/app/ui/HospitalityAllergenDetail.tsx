"use client";

import { ReusedAllergenAuthorityNotice } from "./ReusedAllergenAuthorityNotice";
import type { ReuseView } from "../../lib/allergen-reuse-service";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductionOrder } from "../../lib/production-types";
import { cpuServiceWindow } from "../../lib/production-presentation";
import type {
  AllergenCellState,
  InternalMatrixSignature,
  PlannedMenuItem,
  PlannedSubItem,
  ProductionPlan,
  MatrixSignatureScope,
} from "../lib/production-plan";
import { effectiveProductionPlanStatus, hasAllergenAuthority } from "../lib/production-plan-state";
import "./hospitality-allergen-detail.css";
import { mayContainNotes } from "./allergen-matrix";
import { CANONICAL_ALLERGEN_COLUMNS, isCompleteOperationalAllergenMap, normaliseOperationalAllergens, toggleOperationalAllergen, type CanonicalAllergenKey } from "../../../shared/allergen-contract";
import { matrixColumns } from "./allergen-matrix";
import { DELI_STYLE_PARENT_KEY, isDeliStyleParent } from "../../lib/production-item-scope";
import { canonicalAllergenMatrixForHash } from "../../../shared/allergen-matrix-hash";
import { ALLERGEN_STATE_WORDS, autosaveAction, checkRowInItems, createAutosaveController, displayAllergenMap, reviewProgress, reviewStatusCopy, rowCanBeChecked, rowUncheckedCount, signButtonState, signingGate, toggleCellInItems, unrecordedAllergenMap, type AutosaveState, type SigningBlock } from "./allergen-review-persistence";
const allergenColumns = matrixColumns;
const productionPlanEndpoint = "/api/production-plan";

type ReviewedLineage = MatrixSignatureScope;
type SavePayload = { menuItems: PlannedMenuItem[]; planningNotes: string };
const BLOCK_MESSAGES: Record<SigningBlock, string> = {
  read_only: "This matrix is already approved. Reopen the allergen review to change it.",
  incomplete: "Mark every row as checked before chef approval.",
  unchecked: "Every allergen must be checked before chef approval.",
  dirty: "Your latest changes are still being saved. Try again in a moment.",
  saving: "Your latest changes are still being saved. Try again in a moment.",
  error: "Your latest changes could not be saved. Retry saving before chef approval.",
  not_planned: "The saved review is not complete yet. Wait for “Saved”, then try again.",
};

async function sha256Json(value: unknown) {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function reviewedLineage(order: ProductionOrder, items: PlannedMenuItem[], authoritative?: ReviewedLineage): Promise<ReviewedLineage | undefined> {
  if (order.origin === "hospitality_booking") {
    if (!authoritative || authoritative.sourceOrigin !== "hospitality_booking") return undefined;
    return { ...authoritative, matrixContentHash: await sha256Json(canonicalAllergenMatrixForHash(items)) };
  }
  const serviceDate = order.serviceDate || order.requiredBy?.slice(0, 10);
  if (!serviceDate || !order.sourceEntityId || !order.sourcePublicationDayId || !order.sourceVersion || !order.sourceContentHash) return undefined;
  return { productionOrderId: order.canonicalId, serviceDate, sourceDayId: order.sourceEntityId, ...(order.sourcePublicationId ? { sourcePublicationId: order.sourcePublicationId } : {}), sourcePublicationDayId: order.sourcePublicationDayId, sourceVersion: order.sourceVersion, sourceContentHash: order.sourceContentHash, matrixContentHash: await sha256Json(canonicalAllergenMatrixForHash(items)) };
}

function menuItemLibraryKey(name: string) {
  if (isDeliStyleParent(name)) return DELI_STYLE_PARENT_KEY;
  const slug = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `menu-item:${slug || "untitled"}`;
}

// New review rows start with every allergen UNRECORDED (shown as "Not checked"); a chef must explicitly review each one.
function emptyAllergens(): Record<string, AllergenCellState> {
  return unrecordedAllergenMap(CANONICAL_ALLERGEN_COLUMNS.map(([key]) => key));
}

function initialMenuItems(order: ProductionOrder): PlannedMenuItem[] {
  return order.lines.map((line, index) => ({
    id: `menu-item:${line.canonicalId}:${index}`,
    sourceLineId: line.canonicalId,
    name: line.itemName,
    note: "",
    subItems: [
      {
        id: `sub-item:${line.canonicalId}:${index}`,
        name: "",
        quantity: line.customerQuantity,
        allergens: emptyAllergens(),
        note: "",
        evidenceStatus: "not_completed",
      },
    ],
  }));
}

function mergeOriginalItems(
  order: ProductionOrder,
  saved: PlannedMenuItem[],
): PlannedMenuItem[] {
  const existing = new Set(saved.map((item) => item.sourceLineId || item.id));
  const originals = order.lines
    .filter((line) => !existing.has(line.canonicalId))
    .map((line, index) => ({
      id: `menu-item:${line.canonicalId}:original:${index}`,
      sourceLineId: line.canonicalId,
      name: line.itemName,
      note: "",
      subItems: [
        {
          id: `sub-item:${line.canonicalId}:original`,
          name: "",
          quantity: line.customerQuantity,
          allergens: emptyAllergens(),
          note: "",
          evidenceStatus: "not_completed" as const,
        },
      ],
    }));
  return [...saved, ...originals];
}

function dietarySummary(order: ProductionOrder) {
  const values = new Map<string, number>();
  for (const line of order.lines)
    for (const [key, value] of Object.entries(line.dietaries || {})) {
      const amount =
        typeof value === "number"
          ? value
          : value === true
            ? 1
            : Number(value) || 0;
      if (amount > 0) values.set(key, (values.get(key) || 0) + amount);
    }
  return [...values.entries()]
    .map(
      ([key, value]) =>
        `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}: ${value}`,
    )
    .join(" · ");
}

export function SignatureModal({
  role,
  onCancel,
  onConfirm,
  busy = false,
  submissionError = "",
}: {
  role: InternalMatrixSignature["role"];
  onCancel: () => void;
  onConfirm: (printedName: string, signatureDataUrl: string) => void;
  busy?: boolean;
  submissionError?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [printedName, setPrintedName] = useState("");
  const [attest, setAttest] = useState(false);
  const [error, setError] = useState("");
  const label =
    role === "production_chef" ? "Production chef" : "Head chef / site manager";
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext("2d")!;
    const p = point(event);
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(p.x, p.y);
    drawing.current = true;
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = canvasRef.current!.getContext("2d")!;
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
    hasInk.current = true;
  };
  const finish = () => {
    drawing.current = false;
  };
  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
  };
  const confirm = () => {
    if (!printedName.trim() || !hasInk.current || !attest) {
      setError(
        "Enter a printed name, draw the signature and confirm the attestation.",
      );
      return;
    }
    setError("");
    onConfirm(printedName.trim(), canvasRef.current!.toDataURL("image/png"));
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d")!;
    context.strokeStyle = "#24115c";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, []);
  return (
    <div className="signature-modal-backdrop" role="presentation">
      <section
        className="signature-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-modal-title"
      >
        <header>
          <div>
            <small>Internal FIKA sign-off</small>
            <h3 id="signature-modal-title">Sign as {label}</h3>
          </div>
          <button
            type="button"
            className="liana-close"
            style={{ background: "#eeeaff", color: "#4329b2", borderRadius: 8, width: 38, height: 38, fontSize: "1.35rem", fontWeight: 900, lineHeight: 1 }}
            onClick={onCancel}
            disabled={busy}
            aria-label="Close signature pad"
          >
            ×
          </button>
        </header>
        <p>
          Use your finger, stylus or mouse to sign below. Your signature is
          stored with the allergen matrix audit record.
        </p>
        <label>
          Printed name
          <input
            value={printedName}
            onChange={(event) => setPrintedName(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <canvas
          ref={canvasRef}
          width={900}
          height={280}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          aria-label="Signature drawing area"
        />
        <div className="signature-modal-actions">
          <button type="button" className="button button-soft" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button button-soft" onClick={clear} disabled={busy}>
            Clear
          </button>
          <label>
            <input
              type="checkbox"
              checked={attest}
              onChange={(event) => setAttest(event.target.checked)}
              disabled={busy}
            />{" "}
            I confirm this matrix is accurate
          </label>
          <button
            type="button"
            className="button button-purple"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? "Saving signature…" : "Save signature"}
          </button>
        </div>
        {(submissionError || error) && (
          <p className="signature-error" role="alert">
            {submissionError || error}
          </p>
        )}
      </section>
    </div>
  );
}

export function ReopenReviewDialog({ busy, error, signatureCount, reuse, onCancel, onConfirm }: { busy: boolean; error: string; signatureCount: number; reuse: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelHandler = useRef(onCancel);
  cancelHandler.current = onCancel;
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cancelHandler.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="signature-modal-backdrop" role="presentation">
      <section className="signature-modal reopen-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reopen-title" aria-describedby="reopen-body">
        <header><div><small>Allergen review</small><h3 id="reopen-title">Reopen allergen review?</h3></div></header>
        <div id="reopen-body">
          <p><strong>The current approval will no longer be valid.</strong></p>
          <ul>
            <li>{signatureCount ? `The ${signatureCount === 1 ? "chef signature" : `${signatureCount} chef signatures`} on this matrix will be invalidated.` : "The current release for this matrix will be invalidated."}</li>
            <li>Both chef roles (Production chef and Head chef / site manager) must approve the new review again.</li>
            <li>{reuse ? "This booking's reused approval will be withdrawn." : "Any shared approval created from this matrix is revoked, so other bookings that relied on it will need an allergen review again."}</li>
            <li>The signed record is kept as history; it is not edited.</li>
          </ul>
          {error && <p role="alert" className="reopen-dialog__error">{error}</p>}
        </div>
        <footer>
          <button ref={cancelRef} type="button" className="button button-soft" onClick={onCancel} disabled={busy}>Keep approval</button>
          <button type="button" className="button button-danger" onClick={onConfirm} disabled={busy} aria-busy={busy ? true : undefined}>{busy ? (<><span className="fika-spinner" aria-hidden="true" />Reopening…</>) : "Reopen and invalidate approval"}</button>
        </footer>
      </section>
    </div>
  );
}

export default function HospitalityAllergenDetail({
  order,
  close,
  onSaved,
}: {
  order: ProductionOrder;
  close: () => void;
  onSaved: (close?: boolean) => Promise<void>;
}) {
  const [menuItems, setMenuItems] = useState<PlannedMenuItem[]>(() =>
    initialMenuItems(order),
  );
  const [planningNotes, setPlanningNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowsToAdd, setRowsToAdd] = useState(1);
  const [signatures, setSignatures] = useState<InternalMatrixSignature[]>([]);
  const [matrixArtifact, setMatrixArtifact] = useState<ProductionPlan["matrixArtifact"]>();
  const [currentAllergenRelease, setCurrentAllergenRelease] = useState<ProductionPlan["currentAllergenRelease"]>();
  const [signingLineage, setSigningLineage] = useState<ReviewedLineage>();
  const [signingError, setSigningError] = useState("");
  const [reuse, setReuse] = useState<ReuseView>();
  const [matrixStorageStatus, setMatrixStorageStatus] = useState<"not_configured" | "ready" | "artifact_pending">();
  const [planStatus, setPlanStatus] =
    useState<ProductionPlan["status"]>("draft");
  const [signingRole, setSigningRole] =
    useState<InternalMatrixSignature["role"]>();
  const [savedProductionItems, setSavedProductionItems] = useState<
    Array<{
      id: string;
      title: string;
      allergens: Record<string, AllergenCellState>;
      mayContainNotes?: string;
      parentMenuItemKey?: string;
    }>
  >([]);
  const effectiveStatus = effectiveProductionPlanStatus({ status: planStatus, menuItems });
  const reviewLockedByAuthority = hasAllergenAuthority({ signatures, matrixArtifact, currentAllergenRelease });
  // Any signature, current release or signed artifact makes the review read-only. Nothing below can mutate it until the server has
  // completed an explicit reopen, so viewing or clicking a signed matrix can never clear signatures or trigger a save.
  const readOnly = reviewLockedByAuthority;
  const fullySigned = signatures.some((item) => item.role === "production_chef") && signatures.some((item) => item.role === "head_chef_site_manager");
  const fullySignedRef = useRef(fullySigned);
  fullySignedRef.current = fullySigned;
  const [autosave, setAutosave] = useState<AutosaveState>({ status: "saved" });
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState("");
  const [closeBlocked, setCloseBlocked] = useState(false);
  const sessionId = useRef(`s${Math.random().toString(36).slice(2, 10)}`);
  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;
  const planningNotesRef = useRef(planningNotes);
  planningNotesRef.current = planningNotes;
  const serverStatusRef = useRef<ProductionPlan["status"]>("draft");
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const changedRef = useRef(false);
  const saveRef = useRef<(payload: SavePayload, revision: number) => Promise<void>>(async () => undefined);
  const autosaveRef = useRef<ReturnType<typeof createAutosaveController<SavePayload>>>(undefined as never);
  if (!autosaveRef.current) autosaveRef.current = createAutosaveController<SavePayload>({ save: (payload, revision) => saveRef.current(payload, revision), onChange: setAutosave });
  // Persist through the existing commands: a partial review with `save-plan`, a complete review with `mark-planned`. The command ID is
  // unique per session and revision, so a retry of the same state is idempotent and a new session can never be mistaken for an old one.
  saveRef.current = async (payload, revision) => {
    const action = autosaveAction(payload.menuItems);
    const response = await fetch(productionPlanEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: order.canonicalId, actor: "production-chef", action, menuItems: payload.menuItems, planningNotes: payload.planningNotes, commandId: `autosave:${order.canonicalId}:${sessionId.current}:${revision}` }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || "The review could not be saved.");
    changedRef.current = true;
    const nextStatus: ProductionPlan["status"] = body.plan?.status || (action === "mark-planned" ? "planned" : "planning");
    serverStatusRef.current = nextStatus;
    setPlanStatus(nextStatus);
    if (body.signingLineage) setSigningLineage(body.signingLineage);
  };
  useEffect(() => { autosaveRef.current.setReadOnly(readOnly); }, [readOnly]);
  useEffect(() => () => autosaveRef.current.dispose(), []);
  // Normal unsaved-changes protection for a browser refresh/close; nothing asynchronous is attempted during unload.
  useEffect(() => {
    if (autosave.status === "saved") return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [autosave.status]);

  const hydrate = (body: { plan?: ProductionPlan; reuse?: ReuseView; signingLineage?: ReviewedLineage; matrixStatus?: string }) => {
    if (body.plan?.menuItems) {
        const hydratedItems = mergeOriginalItems(order, body.plan.menuItems);
        setMenuItems(hydratedItems);
        setPlanningNotes(body.plan.planningNotes || "");
        if ("signatures" in body.plan) setSignatures(body.plan.signatures || []);
        if ("matrixArtifact" in body.plan) setMatrixArtifact(body.plan.matrixArtifact);
        if ("currentAllergenRelease" in body.plan) setCurrentAllergenRelease(body.plan.currentAllergenRelease);
        setSigningLineage(body.signingLineage || undefined);
        setMatrixStorageStatus(body.matrixStatus === "not_configured" ? "not_configured" : body.plan.matrixArtifact ? "ready" : body.plan.signatures?.length === 2 ? "artifact_pending" : undefined);
        const hydratedStatus = effectiveProductionPlanStatus({ ...body.plan, menuItems: hydratedItems });
      serverStatusRef.current = hydratedStatus;
      setPlanStatus(hydratedStatus);
        setReuse(body.reuse || undefined);
      }
  };

  useEffect(() => {
    void fetch(
      `/api/production-plan?orderId=${encodeURIComponent(order.canonicalId)}`,
      { cache: "no-store" },
    )
      .then((response) => response.json())
      .then((body) => hydrate(body))
      .catch(() =>
        setMessage("Could not load the saved draft; a new draft is shown."),
      );
    const parentMenuItemKeys = [...new Set(initialMenuItems(order).map((item) => menuItemLibraryKey(item.name)))];
    void Promise.all(parentMenuItemKeys.map((key) =>
      fetch(`/api/sandwiches?parentMenuItemKey=${encodeURIComponent(key)}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((body) => Array.isArray(body.productionItems) ? body.productionItems : body.sandwiches)
    ))
      .then((groups) => setSavedProductionItems(groups.flat().filter(Boolean)))
      .catch(() =>
        setMessage(
          "Saved production items are unavailable; you can still create a new one.",
        ),
      );
  }, [order.canonicalId]);

  const subItems = useMemo(
    () => menuItems.flatMap((item) => item.subItems),
    [menuItems],
  );
  const completeCount = subItems.filter(
    (item) => item.evidenceStatus === "completed",
  ).length;
  const guestCount =
    order.guestCount ||
    order.lines.reduce((sum, line) => sum + (line.customerQuantity || 0), 0);

  // Every content edit goes through `edit`, which refuses while read-only and otherwise records the change for autosave.
  const edit = (next: PlannedMenuItem[], notes = planningNotesRef.current, immediate = false) => {
    if (readOnlyRef.current) return;
    menuItemsRef.current = next;
    setMenuItems(next);
    autosaveRef.current.edit({ menuItems: next, planningNotes: notes }, { immediate });
  };
  const mutate = (change: (items: PlannedMenuItem[]) => PlannedMenuItem[], immediate = false) => { if (!readOnlyRef.current) edit(change(menuItemsRef.current), planningNotesRef.current, immediate); };
  const updateMenuItem = (id: string, change: Partial<PlannedMenuItem>) =>
    mutate((items) => items.map((item) => (item.id === id ? { ...item, ...change } : item)));
  const updateSubItem = (menuId: string, subId: string, change: Partial<PlannedSubItem>) =>
    mutate((items) => items.map((item) => item.id === menuId ? { ...item, subItems: item.subItems.map((sub) => sub.id === subId ? { ...sub, ...change } : sub) } : item));
  const addMenuItem = () =>
    mutate((items) => [...items, { id: `menu-item:${Date.now()}`, name: "", note: "", subItems: [] }]);
  const addRows = (menuId: string, count: number) =>
    mutate((items) => items.map((item) => item.id === menuId ? {
      ...item,
      subItems: [...item.subItems, ...Array.from({ length: Math.max(1, Math.min(50, count)) }, (_, index) => ({
        id: `sub-item:${Date.now()}:${index}`, name: "", quantity: null, allergens: emptyAllergens(), note: "", evidenceStatus: "not_completed" as const,
      }))],
    } : item));
  const removeSubItem = (menuId: string, subId: string) =>
    mutate((items) => items.map((item) => item.id === menuId ? { ...item, subItems: item.subItems.filter((sub) => sub.id !== subId) } : item));
  const removeMenuItem = (id: string) => mutate((items) => items.filter((item) => item.id !== id));
  const toggleCell = (menuId: string, sub: PlannedSubItem, key: string) =>
    mutate((items) => toggleCellInItems(items, menuId, sub.id, key, readOnlyRef.current));
  // "Mark checked" never accepts a not-checked allergen: the row is only checked when every allergen has an explicit state. Saves immediately.
  const completeSubItem = (menuId: string, sub: PlannedSubItem) => {
    const result = checkRowInItems(menuItemsRef.current, menuId, sub.id, readOnlyRef.current);
    if (!result.changed) {
      if (result.reason === "not_checked") setMessage("Check every allergen in this row before marking it checked.");
      return;
    }
    setMessage("");
    edit(result.items, planningNotesRef.current, true);
  };
  const applySandwich = (menuId: string, sub: PlannedSubItem, id: string) => {
    const productionItem = savedProductionItems.find((item) => item.id === id);
    if (!productionItem || readOnlyRef.current) return;
    mutate((items) => items.map((item) => item.id === menuId ? { ...item, subItems: item.subItems.map((candidate) => candidate.id === sub.id ? {
      ...candidate,
      productionItemId: productionItem.id,
      name: productionItem.title,
      allergens: { ...emptyAllergens(), ...normaliseOperationalAllergens(productionItem.allergens) },
      mayContainNotes: productionItem.mayContainNotes || "",
      evidenceStatus: "not_completed" as const,
    } : candidate) } : item), true);
  };
  const saveSandwich = async (menuId: string, sub: PlannedSubItem) => {
    if (readOnlyRef.current) return; // the sandwich library is not mutated from a signed matrix
    if (!sub.name.trim()) {
      setMessage("Give the production item a title before saving it.");
      return;
    }
    setBusy(true);
    setMessage("");
    const parent = menuItems.find((item) => item.id === menuId);
    const parentMenuItemKey = menuItemLibraryKey(parent?.name || "");
    try {
      const response = await fetch("/api/sandwiches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: sub.name,
          allergens: sub.allergens,
          mayContainNotes: sub.mayContainNotes || "",
          parentMenuItemKey,
          updatedBy: "production-chef",
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message || "The production item could not be saved.",
        );
      const returnedItems = Array.isArray(body.sandwiches)
        ? body.sandwiches
        : [...savedProductionItems, body.productionItem || body.sandwich];
      setSavedProductionItems(returnedItems);
      setMessage(`Saved “${sub.name.trim()}” for next time.`);
    } catch (error) {
      setMessage((error as Error).message);
    }
    setBusy(false);
  };

  const retrySave = () => { setCloseBlocked(false); void autosaveRef.current.retry(); };
  // Sign: flush any pending save, re-evaluate the gate against the SAVED state, and only then open the signing dialog.
  const requestSigning = async (role: InternalMatrixSignature["role"]) => {
    setSigningError("");
    const saved = await autosaveRef.current.flush();
    const gate = signingGate({ menuItems: menuItemsRef.current, persistence: autosaveRef.current.state.status, serverPlanStatus: serverStatusRef.current, readOnly: fullySignedRef.current });
    if (!saved || !gate.canSign) { setMessage(BLOCK_MESSAGES[saved ? gate.block || "not_planned" : "error"]); return; }
    setMessage("");
    setSigningRole(role);
  };
  // Closing flushes and awaits pending work first. If the save fails the review stays open with a clear retry.
  const handleClose = async () => {
    const saved = await autosaveRef.current.flush();
    if (!saved) { setCloseBlocked(true); return; }
    if (changedRef.current) await onSaved(false).catch(() => undefined);
    close();
  };
  // Reopen uses the canonical `reopen-review` operation of the production-plan API (the same command and invalidation path used
  // everywhere else). Local state becomes editable only after the server confirms.
  const confirmReopen = async () => {
    setReopening(true); setReopenError("");
    try {
      const response = await fetch(productionPlanEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "batch-plan", operations: [{ action: "reopen-review", orderId: order.canonicalId, commandId: `reopen:${order.canonicalId}:${sessionId.current}:${Date.now()}` }] }) });
      const body = await response.json().catch(() => ({}));
      const result = Array.isArray(body.results) ? body.results[0] : undefined;
      if (!response.ok || !result?.ok) throw new Error(result?.error || body.error?.message || "The allergen review could not be reopened.");
      changedRef.current = true;
      const reloaded = await fetch(`${productionPlanEndpoint}?orderId=${encodeURIComponent(order.canonicalId)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => undefined);
      // The server has withdrawn the approval; reflect exactly that.
      setSignatures([]); setMatrixArtifact(undefined); setCurrentAllergenRelease(undefined); setMatrixStorageStatus(undefined); setReuse(undefined);
      serverStatusRef.current = "planning"; setPlanStatus("planning");
      if (reloaded?.plan?.menuItems) {
        hydrate(reloaded);
        // a still-complete review goes back to Planned through the same autosave (mark-planned), so it can be signed again
        const reopened = mergeOriginalItems(order, reloaded.plan.menuItems);
        if (reviewProgress(reopened).complete && reloaded.plan.status !== "planned") { readOnlyRef.current = false; autosaveRef.current.setReadOnly(false); autosaveRef.current.edit({ menuItems: reopened, planningNotes: reloaded.plan.planningNotes || "" }, { immediate: true }); }
      }
      setReopenOpen(false);
      setMessage("Allergen review reopened. The previous approval is no longer valid; both chef roles must approve the new review.");
    } catch (error) {
      setReopenError(error instanceof Error ? error.message : "The allergen review could not be reopened.");
    }
    setReopening(false);
  };

  const applyReusedAuthority = async () => {
    if (!(await autosaveRef.current.flush())) { setMessage(BLOCK_MESSAGES.error); return; }
    setBusy(true);
    setMessage("Applying the previously approved allergen states…");
    try {
      const response = await fetch("/api/production-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "apply-reused-authority", orderId: order.canonicalId, commandId: `reuse:${order.canonicalId}:${Date.now()}` }),
      });
      const body = await response.json();
      if (!response.ok) setMessage(body.error?.message || "The approved allergen states could not be applied. Review the matrix normally.");
      else {
        if (body.plan?.menuItems) setMenuItems(mergeOriginalItems(order, body.plan.menuItems));
        serverStatusRef.current = body.plan?.status || "planned";
        setPlanStatus(body.plan?.status || "planned");
        setReuse(body.plan?.reusedAllergenAuthority ? { applied: { valid: true, provenance: body.plan.reusedAllergenAuthority } } : undefined);
        setMessage("Previously approved allergen states applied. This booking has not been signed itself.");
        await onSaved(false);
      }
    } catch {
      setMessage("The approved allergen states could not be applied. Review the matrix normally.");
    }
    setBusy(false);
  };

  const signMatrix = async (
    role: InternalMatrixSignature["role"],
    printedName: string,
    signatureDataUrl: string,
  ) => {
    // Signing never operates on dirty, saving or failed persistence state (the server also re-checks the saved matrix hash).
    if (autosaveRef.current.state.status !== "saved" || fullySignedRef.current) { setSigningError(BLOCK_MESSAGES.dirty); return; }
    setBusy(true);
    setSigningError("");
    setMessage("");
    try {
      const expectedLineage = await reviewedLineage(order, menuItems, signingLineage);
      if (!expectedLineage) throw new Error("The current source lineage is unavailable. Reload the review before signing.");
      const response = await fetch("/api/production-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "sign-matrix",
          orderId: order.canonicalId,
          role,
          printedName,
          signatureDataUrl,
          expectedLineage,
          attestation:
            "I confirm that I reviewed the allergen matrix and the recorded evidence is accurate to the best of my knowledge.",
          actor: "production-chef",
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message || "The matrix could not be signed.",
        );
      const persistedSignatures = body.plan?.signatures;
      if (!Array.isArray(persistedSignatures) || !persistedSignatures.some((signature: InternalMatrixSignature) => signature.role === role)) throw new Error("The server did not confirm that this signature was persisted. Retry from the current review.");
      const nextSignatures = persistedSignatures as InternalMatrixSignature[];
      setSignatures(nextSignatures);
      setMatrixArtifact(body.matrixArtifact || body.plan?.matrixArtifact || undefined);
      if ("currentAllergenRelease" in (body.plan || {})) setCurrentAllergenRelease(body.plan.currentAllergenRelease);
      setMatrixStorageStatus(body.matrixStatus === "not_configured" ? "not_configured" : body.plan?.matrixArtifact ? "ready" : body.plan?.signatures?.length === 2 ? "artifact_pending" : undefined);
      setMessage(body.matrixStatus === "not_configured" ? "Matrix storage not configured. The signed workflow is complete; Drive persistence can be enabled later." : body.plan?.matrixArtifact ? "Both signatures recorded. The signed matrix is ready to open." : `${role === "production_chef" ? "Production chef" : "Head chef / site manager"} signature recorded.`);
      setSigningRole(undefined);
      void onSaved(false).catch(() => undefined);
    } catch (error) {
      setSigningError((error as Error).message);
    }
    setBusy(false);
  };

  const accept = async () => {
    setBusy(true);
    const response = await fetch("/api/production-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: order.canonicalId,
        actor: "production-chef",
        action: "accept",
      }),
    });
    const body = await response.json();
    if (!response.ok)
      setMessage(body.error?.message || "The order could not be accepted.");
    else {
      setMessage("Order accepted. Start filling in the production plan.");
      await onSaved();
    }
    setBusy(false);
  };

  const openAllergenMatrix = () => {
    if (!matrixArtifact?.driveUrl) {
      setMessage("The final signed matrix is not yet available in the configured Drive workspace.");
      return;
    }
    window.open(matrixArtifact.driveUrl, "_blank", "noopener,noreferrer");
  };

  const retryFinalArtifact = async () => {
    setBusy(true); setMessage("Retrying final signed matrix artifact…");
    try {
      const expectedLineage = await reviewedLineage(order, menuItems, signingLineage);
      if (!expectedLineage) throw new Error("The current source lineage is unavailable. Reload the review before retrying materialization.");
      const response = await fetch(productionPlanEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-matrix", orderId: order.canonicalId, expectedLineage }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The final signed matrix could not be generated.");
      const materialized = body.matrixStatus === "ready" && Boolean(body.matrixArtifact || body.plan?.matrixArtifact);
      setMatrixArtifact(body.matrixArtifact || body.plan?.matrixArtifact); setMatrixStorageStatus(body.matrixStatus === "not_configured" ? "not_configured" : materialized ? "ready" : "artifact_pending"); setSignatures(body.signatures || signatures); if ("currentAllergenRelease" in (body.plan || {})) setCurrentAllergenRelease(body.plan.currentAllergenRelease); setMessage(materialized ? "Signed PDF generated. The matrix is ready to open from the manager dashboard." : "Materialization is queued. The signed matrix will become available after the durable retry succeeds.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The final signed matrix could not be generated."); }
    finally { setBusy(false); }
  };

  // Sign is visibly disabled until the current matrix is complete AND durably saved (never during dirty / debounce / saving / error).
  const signState = signButtonState({ menuItems, persistence: autosave.status, serverPlanStatus: planStatus, fullySigned, busy });

  return (
    <div
      className="liana-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="Production plan editor"
    >
      <header className="liana-fullscreen-header">
        <div>
          <small>CPU Production · production planning workspace</small>
          <h2>{order.clientName || "Client not assigned"}</h2>
          <p>
            {order.sourceBookingId} ·{" "}
            {order.destinationLabel || "Destination not assigned"}
          </p>
        </div>
        <button
          className="liana-close"
          onClick={() => void handleClose()}
          aria-label="Close order"
        >
          ×
        </button>
      </header>
      <div className="liana-content">
        <section className="liana-booking-context">
          <div>
            <span>Site</span>
            <strong>
              {order.destinationLabel || "Destination not assigned"}
            </strong>
          </div>
          <div>
            <span>Service date</span>
            <strong>
              {order.serviceDate || order.requiredBy.slice(0, 10)}
            </strong>
          </div>
          <div>
            <span>Required ready</span>
            <strong>{order.requiredBy.slice(11, 16)}</strong>
          </div>
          <div>
            <span>Service time</span>
            <strong>
              {cpuServiceWindow(order)}
            </strong>
          </div>
          <div>
            <span>Guests</span>
            <strong>{guestCount}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>
              {(order.workflowStatus && order.workflowStatus !== "draft"
                ? order.workflowStatus
                : order.status
              ).replaceAll("_", " ")}
            </strong>
          </div>
        </section>
        {dietarySummary(order) && (
          <div className="liana-dietary-summary" role="status">
            <strong>Dietary requirements</strong>
            <span>{dietarySummary(order)}</span>
          </div>
        )}
        {order.version > 1 && (
          <div className="liana-warning">
            <strong>Amendment or production update recorded.</strong>
            <span>
              Review the booking context before reconfirming the plan.
            </span>
          </div>
        )}
        <ReusedAllergenAuthorityNotice reuse={reuse} busy={busy} onApply={() => void applyReusedAuthority()} />
        <section className="checker-shell">
          <div className="checker-title">
            <div>
              <small>Digital master allergen checker</small>
              <h3>Production menu and sub-items</h3>
              <p>
                Each menu item can contain multiple sub-items. Click a “Not checked” cell to record it as free from, then click again to
                cycle contains → may contain (MC) → free from. Every allergen must be checked before chef approval.
              </p>
            </div>
            <div className="checker-count">
              <strong>
                {completeCount}/{subItems.length || 0}
              </strong>
              <span>sub-items checked</span>
            </div>
          </div>
          {(() => {
            const progress = reviewProgress(menuItems);
            const approvedBy = signatures.map((signature) => `${signature.printedName} (${signature.role === "production_chef" ? "Production chef" : "Head chef / site manager"}, ${new Date(signature.signedAt).toLocaleString("en-GB")})`);
            const byReuse = currentAllergenRelease?.approvalMode === "reused_authority";
            return (
              <>
                {readOnly ? (
                  <section className="allergen-approval-banner" aria-label="Allergen approval">
                    <div>
                      <strong>{byReuse ? "Allergen matrix approved by reuse" : fullySigned ? "Allergen matrix approved" : signatures.length ? `Partly approved · ${signatures.length} of 2 chef signatures` : "Allergen release in progress"}</strong>
                      <p>{byReuse ? "This booking itself was not signed: the approved allergen states of a previously signed identical sandwich set were applied." : approvedBy.length ? `Approved by ${approvedBy.join("; ")}.` : "No chef signature is recorded on this release yet."} This matrix is read-only. Viewing it never changes the approval.{signatures.length === 1 ? " The other chef role can still sign." : ""}</p>
                      {currentAllergenRelease?.releaseId && <small>{currentAllergenRelease.approvalMode === "reused_authority" ? "Approved by reuse of a previously signed sandwich set (not signed for this booking) · " : ""}Release {currentAllergenRelease.releaseId} · version {currentAllergenRelease.version}</small>}
                    </div>
                    <div className="allergen-approval-banner__actions">
                      {matrixArtifact?.driveUrl && <a className="button button-soft" href={matrixArtifact.driveUrl} target="_blank" rel="noreferrer">View signed matrix (PDF)</a>}
                      {fullySigned && !byReuse && <a className="button button-soft" href={`${productionPlanEndpoint}?orderId=${encodeURIComponent(order.canonicalId)}&download=html`} target="_blank" rel="noreferrer">View signed matrix</a>}
                      <button type="button" className="button button-danger-soft" onClick={() => { setReopenError(""); setReopenOpen(true); }}>Reopen allergen review</button>
                    </div>
                  </section>
                ) : (
                  <section className="allergen-review-status" aria-label="Allergen review progress">
                    <strong role="status" aria-live="polite">{reviewStatusCopy({ progress, persistence: autosave.status, serverPlanStatus: planStatus, readOnly })}</strong>
                    <span className={`allergen-save-state allergen-save-state--${autosave.status}`} role={autosave.status === "error" ? "alert" : "status"} aria-live="polite">
                      {autosave.status === "saving" && (<><span className="fika-spinner" aria-hidden="true" />Saving…</>)}
                      {autosave.status === "dirty" && "Saving shortly…"}
                      {autosave.status === "saved" && "Saved"}
                      {autosave.status === "error" && (<>Couldn’t save: {autosave.error} <button type="button" className="button button-soft" onClick={retrySave}>Retry save</button></>)}
                    </span>
                  </section>
                )}
              </>
            );
          })()}
          <div className="checker-actions">
            <div className="row-controls">
              <label htmlFor="rows-to-add">Rows</label>
              <input
                id="rows-to-add"
                type="number"
                min="1"
                max="50"
                value={rowsToAdd}
                disabled={readOnly}
                onChange={(event) =>
                  setRowsToAdd(
                    Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                  )
                }
              />
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  if (menuItems[0]) addRows(menuItems[0].id, rowsToAdd);
                  else addMenuItem();
                }}
              >
                + Add rows
              </button>
              <button
                type="button"
                className="button button-soft"
                disabled={!matrixArtifact?.driveUrl}
                onClick={openAllergenMatrix}
              >
                Open matrix
              </button>
            </div>
            <span>
              {subItems.length} row{subItems.length === 1 ? "" : "s"} ·{" "}
              {guestCount} guests
            </span>
          </div>
          <div className="menu-items">
            {menuItems.map((menuItem, menuIndex) => (
              <article className="menu-item-panel" key={menuItem.id}>
                <div className="menu-item-heading">
                  <span className="menu-item-number">{menuIndex + 1}</span>
                  <input
                    aria-label="Menu item name"
                    readOnly={readOnly}
                    value={menuItem.name}
                    onChange={(event) =>
                      updateMenuItem(menuItem.id, { name: event.target.value })
                    }
                    placeholder="Menu item, e.g. Deli Style Sandwich Lunch"
                  />
                  <button
                    type="button"
                    className="remove-link"
                    disabled={readOnly}
                    onClick={() => removeMenuItem(menuItem.id)}
                  >
                    Remove menu item
                  </button>
                </div>
                <input
                  className="menu-item-note"
                  readOnly={readOnly}
                  value={menuItem.note}
                  onChange={(event) =>
                    updateMenuItem(menuItem.id, { note: event.target.value })
                  }
                  placeholder="Optional menu item note"
                />
                {!menuItem.subItems.length && (
                  <p className="checker-empty">
                    Add the individual menu items or other sub-items made for this
                    menu item.
                  </p>
                )}
                {menuItem.subItems.length > 0 && (
                  <div className="allergen-table-wrap">
                    <table className="allergen-checker">
                      <colgroup>
                        <col className="allergen-col--name" />
                        {allergenColumns.map(([key]) => (
                          <col className="allergen-col--allergen" key={key} />
                        ))}
                        <col className="allergen-col--notes" />
                        <col className="allergen-col--check" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Dish / food / product</th>
                          {allergenColumns.map(([, label]) => (
                            <th key={label}>{label}</th>
                          ))}
                          <th>
                            Notes
                            <br />
                            Gluten / tree nuts
                          </th>
                          <th>Check</th>
                        </tr>
                      </thead>
                      <tbody>
                        {menuItem.subItems.map((sub) => (
                          <tr key={sub.id}>
                            <th>
                              <select
                                className="saved-sandwich-select"
                                aria-label={`Saved menu item for ${sub.name || "new sub-item"}`}
                                disabled={readOnly}
                                value={sub.productionItemId || ""}
                                onChange={(event) =>
                                  applySandwich(
                                    menuItem.id,
                                    sub,
                                    event.target.value,
                                  )
                                }
                              >
                                <option value="">Choose a saved menu item…</option>
                                {savedProductionItems.filter((productionItem) => productionItem.parentMenuItemKey === menuItemLibraryKey(menuItem.name)).map((productionItem) => (
                                  <option key={productionItem.id} value={productionItem.id}>
                                    {productionItem.title}
                                  </option>
                                ))}
                              </select>
                              <textarea
                                className="subitem-name-cell"
                                rows={2}
                                aria-label="Sub-item name"
                                readOnly={readOnly}
                                value={sub.name}
                                onChange={(event) =>
                                  updateSubItem(menuItem.id, sub.id, {
                                    name: event.target.value,
                                    productionItemId: undefined,
                                    evidenceStatus: "not_completed",
                                  })
                                }
                                placeholder="New production item title"
                              />
                              <div className="subitem-actions">
                                <button
                                  type="button"
                                  className="save-sandwich"
                                  disabled={busy || readOnly || !sub.name.trim()}
                                  onClick={() => void saveSandwich(menuItem.id, sub)}
                                >
                                  Save menu item
                                </button>
                                <button
                                  type="button"
                                  className="remove-row"
                                  disabled={readOnly}
                                  onClick={() =>
                                    removeSubItem(menuItem.id, sub.id)
                                  }
                                >
                                  Remove row
                                </button>
                              </div>
                            </th>
                            {allergenColumns.map(([key, label]) => {
                              const state = displayAllergenMap(sub.allergens)[key];
                              const cellLabel = `${label} for ${sub.name || "sub-item"}: ${ALLERGEN_STATE_WORDS[state]}`;
                              const content = state === "may_contain" ? "MC" : state === "unrecorded" ? <span className="allergen-cell__unchecked">Not checked</span> : "";
                              return (
                                <td key={key}>
                                  {readOnly ? (
                                    <span role="img" aria-label={cellLabel} className={`allergen-cell allergen-cell--${state} allergen-cell--static`}>{content}</span>
                                  ) : (
                                    <button
                                      type="button"
                                      aria-label={cellLabel}
                                      className={`allergen-cell allergen-cell--${state}`}
                                      onClick={() => toggleCell(menuItem.id, sub, key)}
                                    >
                                      {content}
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                            <td className="may-contain-notes">
                              <textarea
                                aria-label={`Notes for ${sub.name || "sub-item"}`}
                                readOnly={readOnly}
                                value={sub.mayContainNotes || ""}
                                onChange={(event) =>
                                  updateSubItem(menuItem.id, sub.id, {
                                    mayContainNotes: event.target.value,
                                  })
                                }
                                placeholder="Enter specific gluten, tree nut or other details"
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className={`check-button ${sub.evidenceStatus === "completed" ? "check-button--done" : ""}`}
                                disabled={readOnly || sub.evidenceStatus === "completed" || !rowCanBeChecked(sub)}
                                aria-label={sub.evidenceStatus === "completed" ? `${sub.name || "Sub-item"}: checked` : readOnly ? `${sub.name || "Sub-item"}: approved, reopen the review to amend` : rowUncheckedCount(sub) ? `${sub.name || "Sub-item"}: ${rowUncheckedCount(sub)} allergens not checked yet` : !sub.name.trim() ? `${sub.name || "Sub-item"}: give the item a name before marking it checked` : `Mark ${sub.name} checked`}
                                title={readOnly ? "Reopen the allergen review before amending signed authority" : sub.evidenceStatus === "completed" ? "This row is already checked" : rowUncheckedCount(sub) ? "Check every allergen in this row first" : undefined}
                                onClick={() => completeSubItem(menuItem.id, sub)}
                              >
                                {sub.evidenceStatus === "completed"
                                  ? "Checked"
                                  : readOnly
                                    ? "Approved"
                                    : rowUncheckedCount(sub)
                                      ? `${rowUncheckedCount(sub)} not checked`
                                      : "Mark checked"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button
                  type="button"
                  className="add-subitem"
                  disabled={readOnly}
                  onClick={() => addRows(menuItem.id, rowsToAdd)}
                >
                  + Add {rowsToAdd} row{rowsToAdd === 1 ? "" : "s"}
                </button>
              </article>
            ))}
          </div>
          <textarea
            className="planning-notes"
            value={planningNotes}
            readOnly={readOnly}
            aria-label="Planning notes"
            onChange={(event) => { if (readOnlyRef.current) return; setPlanningNotes(event.target.value); autosaveRef.current.edit({ menuItems: menuItemsRef.current, planningNotes: event.target.value }); }}
            placeholder="Planning notes for production and menu planning"
          />
          <section
            className="matrix-signing"
            aria-labelledby="matrix-signing-title"
          >
            <div>
              <small>Internal FIKA sign-off</small>
              <h3 id="matrix-signing-title">Sign the allergen matrix</h3>
              <p>
                These internal attestations are recorded with the plan audit
                history. They are not an external e-signature service.
              </p>
              {signState.block && !fullySigned && !(readOnly && signState.block === "read_only") && <p id="sign-blocked-reason" className="allergen-sign-blocked" role="status">Chef approval is not available yet: {BLOCK_MESSAGES[signState.block]}</p>}
              {matrixStorageStatus === "not_configured" && <p role="status">Matrix storage not configured</p>}
              {matrixStorageStatus === "artifact_pending" && <p role="status">Both signatures are recorded; the final PDF is pending.</p>}
            </div>
            {(
              [
                ["production_chef", "Production chef"],
                ["head_chef_site_manager", "Head chef / site manager"],
              ] as const
            ).map(([role, label]) => {
              const signature = signatures.find((item) => item.role === role);
              return (
                <div className="matrix-signing-row" key={role}>
                  <div>
                    <strong>{label}</strong>
                    {signature && (
                      <span className="matrix-signed">
                        Signed by {signature.printedName} ·{" "}
                        {new Date(signature.signedAt).toLocaleString("en-GB")}
                      </span>
                    )}
                  </div>
                  {!signature && (
                    <div className="matrix-signing-controls">
                      <button
                        type="button"
                        className="button button-purple"
                        disabled={signState.disabled}
                        aria-describedby={signState.block ? "sign-blocked-reason" : undefined}
                        title={signState.block ? BLOCK_MESSAGES[signState.block] : undefined}
                        onClick={() => void requestSigning(role)}
                      >
                        Sign matrix
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
          {matrixStorageStatus === "artifact_pending" && <button type="button" className="button button-purple" disabled={busy} onClick={() => void retryFinalArtifact()}>Retry final signed PDF</button>}
        </section>
      </div>
      {message && (
        <p role="status" className="liana-message">
          {message}
        </p>
      )}
      {closeBlocked && (
        <div role="alert" className="liana-message allergen-close-blocked">
          <strong>Your latest changes could not be saved.</strong>
          <span> Retry saving, or discard the unsaved changes and close.</span>
          <button type="button" className="button button-soft" onClick={retrySave}>Retry save</button>
          <button type="button" className="button button-soft" onClick={() => { setCloseBlocked(false); close(); }}>Discard changes and close</button>
        </div>
      )}
      {reopenOpen && (
        <ReopenReviewDialog busy={reopening} error={reopenError} signatureCount={signatures.length} reuse={currentAllergenRelease?.approvalMode === "reused_authority"} onCancel={() => { if (!reopening) setReopenOpen(false); }} onConfirm={() => void confirmReopen()} />
      )}
      {signingRole && (
        <SignatureModal
          role={signingRole}
          busy={busy}
          submissionError={signingError}
          onCancel={() => { setSigningError(""); setSigningRole(undefined); }}
          onConfirm={(printedName, signatureDataUrl) =>
            void signMatrix(signingRole, printedName, signatureDataUrl)
          }
        />
      )}
      <footer className="liana-fixed-actions">
        <div>
          {order.status === "received" || order.status === "needs_review" ? (
            <button
              className="button button-purple"
              disabled={busy}
              onClick={() => void accept()}
            >
              Accept order
            </button>
          ) : (
            <span className="accepted-note">
              Accepted means the production chef can produce this order. Allergen changes are saved automatically; chef approval opens once every allergen is checked and saved.
            </span>
          )}
        </div>
        <div>
          <button className="button button-soft" onClick={() => void handleClose()}>
            Close
          </button>
          {!readOnly && (
            <span className={`allergen-save-state allergen-save-state--${autosave.status}`} role={autosave.status === "error" ? "alert" : "status"} aria-live="polite">
              {autosave.status === "saving" && (<><span className="fika-spinner" aria-hidden="true" />Saving…</>)}
              {autosave.status === "dirty" && "Saving shortly…"}
              {autosave.status === "saved" && "All changes saved"}
              {autosave.status === "error" && "Not saved"}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
