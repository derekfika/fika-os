"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductionOrder } from "@fika/contracts";
import type {
  AllergenCellState,
  InternalMatrixSignature,
  PlannedMenuItem,
  PlannedSubItem,
  ProductionPlan,
} from "../lib/production-plan";
import "./liana.css";
import { allergenMatrixHtml, mayContainNotes } from "./allergen-matrix";
import { CANONICAL_ALLERGEN_COLUMNS, normaliseOperationalAllergens, toggleOperationalAllergen, type CanonicalAllergenKey } from "@fika/contracts";
import { matrixColumns } from "./allergen-matrix";
import { DELI_STYLE_PARENT_KEY, isDeliStyleParent } from "../../lib/production-item-scope";
const allergenColumns = matrixColumns;

function menuItemLibraryKey(name: string) {
  if (isDeliStyleParent(name)) return DELI_STYLE_PARENT_KEY;
  const slug = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `menu-item:${slug || "untitled"}`;
}

function emptyAllergens(): Record<string, AllergenCellState> {
  return Object.fromEntries(CANONICAL_ALLERGEN_COLUMNS.map(([key]) => [key, "clear"]));
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
}: {
  role: InternalMatrixSignature["role"];
  onCancel: () => void;
  onConfirm: (printedName: string, signatureDataUrl: string) => void;
  busy?: boolean;
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
        {error && (
          <p className="signature-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

export default function LianaOrderDetail({
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

  useEffect(() => {
    void fetch(
      `/api/production-plan?orderId=${encodeURIComponent(order.canonicalId)}`,
      { cache: "no-store" },
    )
      .then((response) => response.json())
      .then((body) => {
        if (body.plan?.menuItems) {
          setMenuItems(mergeOriginalItems(order, body.plan.menuItems));
          setPlanningNotes(body.plan.planningNotes || "");
          setSignatures(body.plan.signatures || []);
          setPlanStatus(body.plan.status || "draft");
        }
      })
      .catch(() =>
        setMessage("Could not load the saved draft; a new draft is shown."),
      );
    void fetch("/api/sandwiches", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        const items = Array.isArray(body.productionItems) ? body.productionItems : body.sandwiches;
        if (Array.isArray(items)) setSavedProductionItems(items);
      })
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

  const updateMenuItem = (id: string, change: Partial<PlannedMenuItem>) =>
    setMenuItems((items) =>
      items.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  const updateSubItem = (
    menuId: string,
    subId: string,
    change: Partial<PlannedSubItem>,
  ) =>
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
  const addMenuItem = () =>
    setMenuItems((items) => [
      ...items,
      { id: `menu-item:${Date.now()}`, name: "", note: "", subItems: [] },
    ]);
  const addRows = (menuId: string, count: number) =>
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
  const removeSubItem = (menuId: string, subId: string) =>
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
  const removeMenuItem = (id: string) =>
    setMenuItems((items) => items.filter((item) => item.id !== id));
  const toggleCell = (menuId: string, sub: PlannedSubItem, key: string) => {
    const allergens = toggleOperationalAllergen(sub.allergens, key as CanonicalAllergenKey);
    updateSubItem(menuId, sub.id, {
      allergens,
      evidenceStatus: "not_completed",
    });
  };
  const completeSubItem = (menuId: string, sub: PlannedSubItem) => {
    if (planStatus === "planned") return;
    const nextItems = menuItems.map((item) =>
      item.id === menuId
        ? { ...item, subItems: item.subItems.map((candidate) => candidate.id === sub.id ? { ...candidate, evidenceStatus: "completed" as const } : candidate) }
        : item,
    );
    setMenuItems(nextItems);
    const allComplete = nextItems.length > 0 && nextItems.every((item) => item.name.trim() && item.subItems.length > 0 && item.subItems.every((candidate) => candidate.name.trim() && candidate.evidenceStatus === "completed"));
    if (allComplete) void planCommand("mark-planned", {}, nextItems);
  };
  const applySandwich = (menuId: string, sub: PlannedSubItem, id: string) => {
    const productionItem = savedProductionItems.find((item) => item.id === id);
    if (productionItem)
      updateSubItem(menuId, sub.id, {
        name: productionItem.title,
        allergens: { ...emptyAllergens(), ...normaliseOperationalAllergens(productionItem.allergens) },
        mayContainNotes: productionItem.mayContainNotes || "",
        evidenceStatus: "not_completed",
      });
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
  ) => {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/production-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: order.canonicalId,
        actor: "production-chef",
        action,
        menuItems: menuItemsOverride || menuItems,
        planningNotes,
        ...extra,
      }),
    });
    const body = await response.json();
    if (!response.ok)
      setMessage(
        body.error?.message || "The production plan could not be saved.",
      );
    else {
      setPlanStatus(
        body.plan?.status ||
          (action === "mark-planned" ? "planned" : "planning"),
      );
      setMessage(
        action === "mark-planned"
          ? "Plan marked Planned. The menu planning team can now generate the menu."
          : "Partial plan saved. The booking status is now Planning.",
      );
      // Keep the detail panel open after planning so the signature controls
      // become available in the same view.
      await onSaved(false);
    }
    setBusy(false);
  };

  const signMatrix = async (
    role: InternalMatrixSignature["role"],
    printedName: string,
    signatureDataUrl: string,
  ) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/production-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "sign-matrix",
          orderId: order.canonicalId,
          role,
          printedName,
          signatureDataUrl,
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
      const nextSignatures = (body.plan?.signatures || [
          ...signatures,
          {
            role,
            printedName,
            signedAt: new Date().toISOString(),
            actor: "production-chef",
            attestation: "",
            signatureDataUrl,
          },
        ]) as InternalMatrixSignature[];
      setSignatures(nextSignatures);
      const fullySigned = nextSignatures.some(signature => signature.role === "production_chef") && nextSignatures.some(signature => signature.role === "head_chef_site_manager");
      setMessage(fullySigned ? "Both signatures recorded. Generating the signed PDF…" : `${role === "production_chef" ? "Production chef" : "Head chef / site manager"} signature recorded.`);
      if (fullySigned) {
        void fetch("/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-matrix", orderId: order.canonicalId }) }).then(async artifactResponse => {
          if (!artifactResponse.ok) { const artifactBody = await artifactResponse.json().catch(() => ({})); throw new Error(artifactBody.error?.message || "The signed PDF could not be generated."); }
          setMessage("Signed PDF generated and ready to open.");
        }).catch(error => setMessage(error instanceof Error ? error.message : "The signed PDF could not be generated."));
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
    setBusy(false);
    setSigningRole(undefined);
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
    const popup = window.open("", "_blank", "popup,width=1200,height=850");
    if (!popup) {
      setMessage("Allow pop-ups to save the allergen matrix PDF.");
      return;
    }
    popup.document.open();
    popup.document.write(allergenMatrixHtml(order, menuItems, signatures));
    popup.document.close();
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
              {order.serviceWindow.startTime}
              {order.serviceWindow.endTime
                ? `–${order.serviceWindow.endTime}`
                : ""}
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
                                value=""
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
                              const state = sub.allergens[key] || "clear";
                              return (
                                <td key={key}>
                                  <button
                                    type="button"
                                    aria-label={`${label} for ${sub.name || "sub-item"}: ${state}`}
                                    className={`allergen-cell allergen-cell--${state}`}
                                    onClick={() =>
                                      toggleCell(menuItem.id, sub, key)
                                    }
                                  >
                                    {state === "may_contain"
                                      ? "MC"
                                      : ""}
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
                                onClick={() =>
                                  completeSubItem(menuItem.id, sub)
                                }
                              >
                                {sub.evidenceStatus === "completed"
                                  ? "Checked"
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
                        disabled={busy || planStatus !== "planned"}
                        onClick={() => setSigningRole(role)}
                      >
                        Sign matrix
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
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
          onCancel={() => setSigningRole(undefined)}
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
              Accepted means the production chef can produce this order. Planned means every
              sub-item has been checked.
            </span>
          )}
        </div>
        <div>
          <button className="button button-soft" onClick={close}>
            Close
          </button>
          <button
            className="button button-soft"
            disabled={busy}
            onClick={() => void planCommand("save-plan")}
          >
            Save partial plan
          </button>
          <button
            className="button button-mint"
            disabled
            aria-disabled="true"
            aria-label="Mark as Planned"
          >
            {planStatus === "planned" ? "Planned automatically" : "Complete every check to plan"}
          </button>
        </div>
      </footer>
    </div>
  );
}
