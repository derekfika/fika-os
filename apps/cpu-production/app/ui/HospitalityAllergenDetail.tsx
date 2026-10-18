"use client";

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
import { allergenReviewProblems, describeAllergenReviewProblem, effectiveProductionPlanStatus, hasAllergenAuthority } from "../lib/production-plan-state";
import { allergenReviewCompletionMessage, completeAllergenReviewMap } from "../lib/allergen-review-state";
import { isSigningAvailable, reviewFingerprint, savedFingerprintAfterSave } from "../lib/allergen-review-session";
import "./hospitality-allergen-detail.css";
import { mayContainNotes } from "./allergen-matrix";
import { isCompleteOperationalAllergenMap, toggleOperationalAllergen, type CanonicalAllergenKey } from "../../../shared/allergen-contract";
import { matrixColumns } from "./allergen-matrix";
import { applyHospitalityCellClick, cellLabel, cellState, derivedNoKeyState, emptyAllergens, hydrateSavedAllergens } from "./allergen-cell-state";
import { DELI_STYLE_PARENT_KEY, isDeliStyleParent } from "../../lib/production-item-scope";
import { canonicalAllergenMatrixForHash } from "../../../shared/allergen-matrix-hash";
const allergenColumns = matrixColumns;
const productionPlanEndpoint = "/api/production-plan";

type ReviewedLineage = MatrixSignatureScope;

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
  const [reviewProblems, setReviewProblems] = useState<string[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savedFingerprint, setSavedFingerprint] = useState<string>();
  // The persisted revision the browser loaded (string), or null when no plan was stored yet. undefined until the first read completes.
  const [planRevision, setPlanRevision] = useState<string | null | undefined>(undefined);
  const [reviewConflict, setReviewConflict] = useState(false);
  // Set while the Hub has not confirmed the Planned status. Comes from the stored plan, so it is shown after a reload without another Save.
  const [hubPending, setHubPending] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
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
  // Signatures are offered only for a complete matrix that the server has persisted as reviewed, unchanged since.
  const signingAvailable = isSigningAvailable({ reviewConflict, effectiveStatus, savedFingerprint, currentFingerprint: reviewFingerprint(menuItems, planningNotes) });

  useEffect(() => {
    void fetch(
      `/api/production-plan?orderId=${encodeURIComponent(order.canonicalId)}`,
      { cache: "no-store" },
    )
      .then((response) => response.json())
      .then((body) => {
        setPlanRevision(body.revision === undefined ? undefined : body.revision);
        setHubPending(body.hubLifecycle?.status === "pending" ? String(body.hubLifecycle.error || "The booking status update has not been confirmed.") : null);
        setReviewConflict(false);
        setSavedFingerprint(undefined);
        if (body.plan?.menuItems) {
          const hydratedItems = mergeOriginalItems(order, body.plan.menuItems);
          setMenuItems(hydratedItems);
          setPlanningNotes(body.plan.planningNotes || "");
          if ("signatures" in body.plan) setSignatures(body.plan.signatures || []);
          if ("matrixArtifact" in body.plan) setMatrixArtifact(body.plan.matrixArtifact);
          if ("currentAllergenRelease" in body.plan) setCurrentAllergenRelease(body.plan.currentAllergenRelease);
          setSigningLineage(body.signingLineage || undefined);
          setMatrixStorageStatus(body.matrixStatus === "not_configured" ? "not_configured" : body.plan.matrixArtifact ? "ready" : body.plan.signatures?.length === 2 ? "artifact_pending" : undefined);
          setPlanStatus(effectiveProductionPlanStatus({ ...body.plan, menuItems: hydratedItems }));
          if (effectiveProductionPlanStatus({ ...body.plan, menuItems: hydratedItems }) === "planned") setSavedFingerprint(reviewFingerprint(hydratedItems, body.plan.planningNotes || ""));
        }
      })
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
  }, [order.canonicalId, reloadNonce]);

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

  const markMatrixEdited = () => {
    const hadSignedAuthority = signatures.length > 0 || Boolean(matrixArtifact || currentAllergenRelease);
    if (!hadSignedAuthority) return;
    setSignatures([]);
    setMatrixArtifact(undefined);
    setCurrentAllergenRelease(undefined);
    setMatrixStorageStatus(undefined);
    setPlanStatus("planning");
    setMessage("The matrix changed. Save the amended plan and complete the new evidence before signing again.");
  };
  const updateMenuItem = (id: string, change: Partial<PlannedMenuItem>) => {
    markMatrixEdited();
    setMenuItems((items) =>
      items.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  };
  const updateSubItem = (
    menuId: string,
    subId: string,
    change: Partial<PlannedSubItem>,
  ) => {
    markMatrixEdited();
    setMenuItems((items) =>
      items.map((item) =>
        item.id === menuId
          ? {
              ...item,
              subItems: item.subItems.map((sub) =>
                sub.id === subId ? { ...sub, ...change } : sub,
              ),
            }
        : item,
      ),
    );
  };
  const addMenuItem = () => {
    markMatrixEdited();
    setMenuItems((items) => [
      ...items,
      { id: `menu-item:${Date.now()}`, name: "", note: "", subItems: [] },
    ]);
  };
  const addRows = (menuId: string, count: number) => {
    markMatrixEdited();
    setMenuItems((items) =>
      items.map((item) =>
        item.id === menuId
          ? {
              ...item,
              subItems: [
                ...item.subItems,
                ...Array.from(
                  { length: Math.max(1, Math.min(50, count)) },
                  (_, index) => ({
                    id: `sub-item:${Date.now()}:${index}`,
                    name: "",
                    quantity: null,
                    allergens: emptyAllergens(),
                    note: "",
                    evidenceStatus: "not_completed" as const,
                  }),
                ),
              ],
            }
        : item,
      ),
    );
  };
  const removeSubItem = (menuId: string, subId: string) => {
    markMatrixEdited();
    setMenuItems((items) =>
      items.map((item) =>
        item.id === menuId
          ? {
              ...item,
              subItems: item.subItems.filter((sub) => sub.id !== subId),
            }
        : item,
      ),
    );
  };
  const removeMenuItem = (id: string) => {
    markMatrixEdited();
    setMenuItems((items) => items.filter((item) => item.id !== id));
  };
  const toggleCell = (menuId: string, sub: PlannedSubItem, key: string) => {
    // "No key allergens" is derived from the named allergens and can never be edited, so it cannot overwrite named evidence.
    if (key === "no_key_allergens") return;
    markMatrixEdited();
    const allergens = applyHospitalityCellClick(sub.allergens, key);
    setRowErrors((current) => { if (!(sub.id in current)) return current; const next = { ...current }; delete next[sub.id]; return next; });
    updateSubItem(menuId, sub.id, {
      allergens,
      evidenceStatus: "not_completed",
    });
  };
  const completeSubItem = (menuId: string, sub: PlannedSubItem) => {
    if (reviewLockedByAuthority || sub.evidenceStatus === "completed") return;
    const completion = completeAllergenReviewMap(sub.allergens);
    if (!completion.complete) {
      const message = allergenReviewCompletionMessage(completion.unresolvedKeys);
      setRowErrors((current) => ({ ...current, [sub.id]: message }));
      setMessage(message);
      return;
    }
    markMatrixEdited();
    setRowErrors((current) => { const next = { ...current }; delete next[sub.id]; return next; });
    updateSubItem(menuId, sub.id, { allergens: completion.states, evidenceStatus: "completed" });
  };
  const applySandwich = (menuId: string, sub: PlannedSubItem, id: string) => {
    const productionItem = savedProductionItems.find((item) => item.id === id);
    if (!productionItem) return;
    markMatrixEdited();
    const nextItems = menuItems.map((item) => item.id === menuId ? { ...item, subItems: item.subItems.map((candidate) => candidate.id === sub.id ? {
      ...candidate,
      productionItemId: productionItem.id,
      name: productionItem.title,
      allergens: hydrateSavedAllergens(productionItem.allergens),
      mayContainNotes: productionItem.mayContainNotes || "",
      evidenceStatus: "not_completed" as const,
    } : candidate) } : item);
    setMenuItems(nextItems);
    void planCommand("save-plan", {}, nextItems);
  };
  const saveSandwich = async (menuId: string, sub: PlannedSubItem) => {
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

  const planCommand = async (
    action: "save-plan" | "mark-planned",
    extra: Record<string, unknown> = {},
    menuItemsOverride?: PlannedMenuItem[],
  ): Promise<boolean> => {
    if (planRevision === undefined) {
      setMessage("The saved review is still loading. Try again in a moment.");
      return false;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/production-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.canonicalId,
          actor: "production-chef",
          action,
          expectedRevision: planRevision,
          menuItems: menuItemsOverride || menuItems,
          planningNotes,
          ...extra,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409 && body.error?.code === "CPU_ALLERGEN_REVIEW_CONFLICT") {
          // Newer evidence exists. Keep the local edits on screen, withdraw signing and ask for an explicit reload.
          setReviewConflict(true);
          setSavedFingerprint(undefined);
        }
        setMessage(body.error?.message || "The production plan could not be saved.");
        return false;
      }
      setPlanRevision(body.revision === undefined ? (body.plan?.updatedAt ?? null) : body.revision);
      if (body.hubLifecycle) setHubPending(body.hubLifecycle.status === "pending" ? String(body.hubLifecycle.error || "The booking status update has not been confirmed.") : null);
      setPlanStatus(
        body.plan?.status ||
          (action === "mark-planned" ? "planned" : "planning"),
      );
      if ("matrixArtifact" in body) setMatrixArtifact(body.matrixArtifact || undefined);
      if ("signatures" in body) setSignatures(body.signatures || []);
      if (body.plan && "currentAllergenRelease" in body.plan) setCurrentAllergenRelease(body.plan.currentAllergenRelease);
      setMatrixStorageStatus(body.matrixStatus === "not_configured" ? "not_configured" : body.plan?.matrixArtifact ? "ready" : body.plan?.signatures?.length === 2 ? "artifact_pending" : undefined);
      setMessage(
        action === "mark-planned" && body.hubLifecycle?.status === "pending"
          ? "Allergen review saved in CPU, but the booking status update is still pending and has not been confirmed. Press Save allergen review again to retry it."
        : action === "mark-planned"
          ? "Allergen review saved. Signatures are now available."
          : "Draft saved. Signatures stay unavailable until every allergen is recorded and the review is saved.",
      );
      // Keep the detail panel open after planning so the signature controls
      // become available in the same view.
      await onSaved(false);
      return true;
    } catch {
      setMessage("The production plan could not be saved. Check the connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * The only way to reach signing: validate the whole matrix, show every missing requirement, persist, and only
   * then enable signatures. An incomplete matrix is kept as a draft so no entered allergen work is lost.
   */
  const saveAllergenReview = async () => {
    if (busy || reviewLockedByAuthority || reviewConflict) return;
    const problems = allergenReviewProblems(menuItems);
    setReviewProblems(problems.map(describeAllergenReviewProblem));
    const nextRowErrors: Record<string, string> = {};
    for (const problem of problems) if (problem.rowId && problem.kind === "allergens-not-recorded") nextRowErrors[problem.rowId] = `Record ${problem.allergens.join(", ")}.`;
    setRowErrors(nextRowErrors);
    if (problems.length) {
      setSavedFingerprint(undefined);
      const saved = await planCommand("save-plan");
      if (saved) setMessage(`Draft saved. ${problems.length} requirement${problems.length === 1 ? "" : "s"} remain before signing is available.`);
      return;
    }
    // The fingerprint is taken from the content that was sent, not from whatever is on screen when the response arrives:
    // edits made while the save is in flight therefore never inherit the unlock.
    const sentFingerprint = reviewFingerprint(menuItems, planningNotes);
    const saved = await planCommand("mark-planned");
    setSavedFingerprint(savedFingerprintAfterSave(sentFingerprint, saved));
  };

  const signMatrix = async (
    role: InternalMatrixSignature["role"],
    printedName: string,
    signatureDataUrl: string,
  ) => {
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
      if (body.revision !== undefined) setPlanRevision(body.revision);
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
      if (body.revision !== undefined) setPlanRevision(body.revision);
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
      if (body.revision !== undefined) setPlanRevision(body.revision);
      const materialized = body.matrixStatus === "ready" && Boolean(body.matrixArtifact || body.plan?.matrixArtifact);
      setMatrixArtifact(body.matrixArtifact || body.plan?.matrixArtifact); setMatrixStorageStatus(body.matrixStatus === "not_configured" ? "not_configured" : materialized ? "ready" : "artifact_pending"); setSignatures(body.signatures || signatures); if ("currentAllergenRelease" in (body.plan || {})) setCurrentAllergenRelease(body.plan.currentAllergenRelease); setMessage(materialized ? "Signed PDF generated. The matrix is ready to open from the manager dashboard." : "Materialization is queued. The signed matrix will become available after the durable retry succeeds.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The final signed matrix could not be generated."); }
    finally { setBusy(false); }
  };

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
          onClick={close}
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
        <section className="checker-shell">
          <div className="checker-title">
            <div>
              <small>Digital master allergen checker</small>
              <h3>Production menu and sub-items</h3>
              <p>
                Each menu item can contain multiple sub-items. Click each
                allergen cell to cycle white → contains → MC → white.
              </p>
            </div>
            <div className="checker-count">
              <strong>
                {completeCount}/{subItems.length || 0}
              </strong>
              <span>sub-items checked</span>
            </div>
          </div>
          <div className="checker-actions">
            <div className="row-controls">
              <label htmlFor="rows-to-add">Rows</label>
              <input
                id="rows-to-add"
                type="number"
                min="1"
                max="50"
                value={rowsToAdd}
                onChange={(event) =>
                  setRowsToAdd(
                    Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                  )
                }
              />
              <button
                type="button"
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
                    value={menuItem.name}
                    onChange={(event) =>
                      updateMenuItem(menuItem.id, { name: event.target.value })
                    }
                    placeholder="Menu item, e.g. Deli Style Sandwich Lunch"
                  />
                  <button
                    type="button"
                    className="remove-link"
                    onClick={() => removeMenuItem(menuItem.id)}
                  >
                    Remove menu item
                  </button>
                </div>
                <input
                  className="menu-item-note"
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
                                  disabled={busy || !sub.name.trim()}
                                  onClick={() => void saveSandwich(menuItem.id, sub)}
                                >
                                  Save menu item
                                </button>
                                <button
                                  type="button"
                                  className="remove-row"
                                  onClick={() =>
                                    removeSubItem(menuItem.id, sub.id)
                                  }
                                >
                                  Remove row
                                </button>
                              </div>
                            </th>
                            {allergenColumns.map(([key, label]) => {
                              if (key === "no_key_allergens") {
                                const derivedState = derivedNoKeyState(sub.allergens);
                                return (
                                  <td key={key}>
                                    <span
                                      role="img"
                                      aria-label={`${label} for ${sub.name || "sub-item"}: ${derivedState} (derived from the named allergens, read only)`}
                                      title="Derived from the named allergens"
                                      className={`allergen-cell allergen-cell--${derivedState} allergen-cell--derived`}
                                    >
                                      {cellLabel(derivedState)}
                                    </span>
                                  </td>
                                );
                              }
                              const state = cellState(sub.allergens, key);
                              return (
                                <td key={key}>
                                  <button
                                    type="button"
                                    aria-label={`${label} for ${sub.name || "sub-item"}: ${state}`}
                                    title={state === "unrecorded" ? "Not yet assessed" : undefined}
                                    className={`allergen-cell allergen-cell--${state}`}
                                    onClick={() =>
                                      toggleCell(menuItem.id, sub, key)
                                    }
                                  >
                                    {cellLabel(state)}
                                  </button>
                                </td>
                              );
                            })}
                            <td className="may-contain-notes">
                              <textarea
                                aria-label={`Notes for ${sub.name || "sub-item"}`}
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
                                disabled={busy || reviewLockedByAuthority || sub.evidenceStatus === "completed"}
                                aria-label={sub.evidenceStatus === "completed" ? `${sub.name || "Sub-item"}: checked` : reviewLockedByAuthority ? `${sub.name || "Sub-item"}: reopen review to amend` : `${sub.name || "Sub-item"}: mark checked`}
                                title={reviewLockedByAuthority ? "Reopen the allergen review before amending signed authority" : sub.evidenceStatus === "completed" ? "This row is already checked" : undefined}
                                onClick={() =>
                                  completeSubItem(menuItem.id, sub)
                                }
                              >
                                {sub.evidenceStatus === "completed"
                                  ? "Checked"
                                  : reviewLockedByAuthority
                                    ? "Reopen review to amend"
                                    : "Mark checked"}
                              </button>
                              {rowErrors[sub.id] && <p className="matrix-row-error" role="alert">{rowErrors[sub.id]}</p>}
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
            onChange={(event) => setPlanningNotes(event.target.value)}
            placeholder="Planning notes for production and menu planning"
          />
          {hubPending && (
            <section className="matrix-review-problems" role="alert" aria-labelledby="matrix-hub-pending-title">
              <h3 id="matrix-hub-pending-title">Booking status update not confirmed</h3>
              <p>The allergen review is saved in CPU, but the booking status in the Hub has not reached Planned. {hubPending} Press Save allergen review to retry.</p>
            </section>
          )}
          {reviewConflict && (
            <section className="matrix-review-problems" role="alert" aria-labelledby="matrix-review-conflict-title">
              <h3 id="matrix-review-conflict-title">This review changed elsewhere</h3>
              <p>Someone saved newer allergen evidence after you opened it. Your edits are still on screen but were not saved. Copy anything you need, then reload the latest review and re-apply your changes. Signatures stay unavailable until you have saved against the latest review.</p>
              <button type="button" className="button button-soft" disabled={busy} onClick={() => setReloadNonce((value) => value + 1)}>Reload latest review</button>
            </section>
          )}
          {reviewProblems.length > 0 && (
            <section className="matrix-review-problems" role="alert" aria-labelledby="matrix-review-problems-title">
              <h3 id="matrix-review-problems-title">Complete these before signing ({reviewProblems.length})</h3>
              <ul>{reviewProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </section>
          )}
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
              {!signingAvailable && !signatures.length && <p role="status">Save the allergen review to enable signatures. Signatures are available only once every allergen is recorded and the saved review is unchanged.</p>}
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
                        disabled={busy || !signingAvailable}
                        onClick={() => { setSigningError(""); setSigningRole(role); }}
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
              Accepted means the production chef can produce this order. Save the allergen review once every
              allergen is recorded to enable signatures.
            </span>
          )}
        </div>
        <div>
          <button className="button button-soft" onClick={close}>
            Close
          </button>
          <button
            className="button button-mint"
            disabled={busy || reviewLockedByAuthority || reviewConflict}
            onClick={() => void saveAllergenReview()}
          >
            Save allergen review
          </button>
        </div>
      </footer>
    </div>
  );
}
