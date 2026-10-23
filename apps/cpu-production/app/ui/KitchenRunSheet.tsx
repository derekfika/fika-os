"use client";
import {
  dayProductionPrintHtml,
  paginateDayProduction,
} from "./day-production-print";
import { loadWholeDay } from "./whole-day-production";
import { useEffect, useId, useRef, useState } from "react";
import type {
  ProductionLine,
  ProductionOrder,
} from "../../lib/production-types";
import {
  cpuDestinationLabel,
  cpuSourceLabel,
  cpuServiceWindow,
} from "../../lib/production-presentation";
import {
  CANONICAL_ALLERGEN_COLUMNS,
  normaliseOperationalAllergens,
} from "../../../shared/allergen-contract";
import {
  printKitchenDocument,
  collectionQuantity,
  collectionDate,
  collectionTime,
} from "./kitchen-print";
export function collectionOrders(orders: ProductionOrder[]) {
  const unique = new Map<string, ProductionOrder>();
  for (const o of orders)
    if (
      !unique.has(o.canonicalId) ||
      unique.get(o.canonicalId)!.version < o.version
    )
      unique.set(o.canonicalId, o);
  return [...unique.values()].sort(
    (a, b) =>
      a.requiredBy.localeCompare(b.requiredBy) ||
      a.canonicalId.localeCompare(b.canonicalId),
  );
}
export type PackingView = {
  revision: number;
  orderVersion: number;
  lines: Array<{
    lineId: string;
    fingerprint: string;
    packed: boolean;
    changed: boolean;
  }>;
  packedCount: number;
};
export type PackingControls = {
  view?: PackingView;
  busy: boolean;
  error: string;
  toggle: (id: string, packed: boolean) => void;
  retry?: () => void;
};
export function CollectionCard({
  order,
  packing,
}: {
  order: ProductionOrder;
  packing?: PackingControls;
}) {
  const [selected, setSelected] = useState<ProductionLine>();
  const dialog = useRef<HTMLDialogElement>(null);
  const focus = useRef<HTMLButtonElement | null>(null);
  const heading = useId();
  useEffect(() => {
    if (selected) {
      dialog.current?.showModal();
      return () => dialog.current?.close();
    }
  }, [selected]);
  const inactive =
    !!order.supersededBy || ["cancelled", "rejected"].includes(order.status);
  const snapshot = selected?.approvedAllergenSnapshot;
  const verified =
    selected?.allergenEvidenceStatus === "confirmed" &&
    !!snapshot &&
    (!snapshot.allergenEvidenceStatus ||
      snapshot.allergenEvidenceStatus === "confirmed");
  const allergens = normaliseOperationalAllergens(snapshot?.allergens);
  return (
    <article
      className="kitchen-collection"
      aria-label={cpuDestinationLabel(order) + " collection"}
    >
      <header>
        <div>
          <h3>{cpuDestinationLabel(order)}</h3>
          <p>
            <strong>
              {collectionDate(order)} · {collectionTime(order)}
            </strong>
          </p>
          <p className="kitchen-meta">
            {[
              cpuSourceLabel(order),
              order.serviceType,
              order.sourcePublicationDayId ||
                order.sourceEntityId ||
                order.sourceBookingId,
              order.sourceVersion !== undefined
                ? "v" + order.sourceVersion
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>
      <p className="kitchen-progress" role="status">
        {inactive
          ? "Cancelled or superseded — packing unavailable"
          : packing?.view
            ? packing.view.packedCount +
              "/" +
              order.lines.length +
              " dishes packed"
            : packing
              ? "Loading saved checklist…"
              : "Printable collection · digital checklist not enabled"}
        {packing?.busy ? " · Saving…" : ""}
      </p>
      {packing?.error && (
        <p className="kitchen-error" role="alert">
          {packing.error}
          {packing.retry && (
            <button
              type="button"
              className="kitchen-button"
              onClick={packing.retry}
              disabled={packing.busy}
            >
              Retry
            </button>
          )}
        </p>
      )}
      <ul className="kitchen-dishes">
        {order.lines.map((line) => {
          const saved = packing?.view?.lines.find(
            (x) => x.lineId === line.canonicalId,
          );
          return (
            <li key={line.canonicalId}>
              <label className="kitchen-check">
                <input
                  type="checkbox"
                  checked={saved?.packed || false}
                  disabled={!saved || packing?.busy || inactive}
                  onChange={(e) =>
                    packing?.toggle(line.canonicalId, e.target.checked)
                  }
                />
                <span className="sr-only">Packed: {line.itemName}</span>
              </label>
              <div>
                <button
                  type="button"
                  className="kitchen-dish-name"
                  onClick={(e) => {
                    focus.current = e.currentTarget;
                    setSelected(line);
                  }}
                >
                  {line.itemName}
                </button>
                {saved?.changed && (
                  <small className="kitchen-warning">
                    Changed since packing — check again
                  </small>
                )}
              </div>
              <strong className="kitchen-quantity">
                {collectionQuantity(line)}
              </strong>
            </li>
          );
        })}
      </ul>
      <dialog
        className="kitchen-inspector"
        ref={dialog}
        aria-labelledby={heading}
        onClose={() => {
          setSelected(undefined);
          focus.current?.focus();
        }}
      >
        <header>
          <h2 id={heading}>{selected?.itemName}</h2>
          <button
            type="button"
            className="kitchen-button"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </header>
        {selected && (
          <>
            <p>
              <strong>{collectionQuantity(selected)}</strong>
            </p>
            <h3>Description / preparation</h3>
            <p>{selected.description || "No description recorded."}</p>
            <p>
              {selected.productionInstructions ||
                selected.servingGuidance ||
                "No preparation instructions recorded."}
            </p>
            <h3>Dietary requirements</h3>
            <p>
              {Object.entries(selected.dietaries || {})
                .filter(([, v]) => Boolean(v))
                .map(([k, v]) => k + ": " + String(v))
                .join(" · ") ||
                "No dietary requirements recorded; this does not confirm allergen clearance."}
            </p>
            <h3>Source allergen evidence</h3>
            <p className={!verified ? "kitchen-warning" : ""}>
              {verified
                ? "Confirmed source evidence. Unrecorded allergens remain unknown."
                : "Missing or unverified allergen evidence — do not treat as clear."}
            </p>
            <dl className="kitchen-allergens">
              {CANONICAL_ALLERGEN_COLUMNS.filter(
                ([k]) => k !== "no_key_allergens",
              ).map(([k, label]) => (
                <div key={k}>
                  <dt>{label}</dt>
                  <dd>
                    {verified
                      ? {
                          clear: "Clear",
                          contains: "Contains",
                          may_contain: "May contain",
                          unrecorded: "Unrecorded",
                        }[allergens[k] || "unrecorded"]
                      : "Unverified"}
                  </dd>
                </div>
              ))}
            </dl>
            {snapshot?.mayContainNotes && <p>{snapshot.mayContainNotes}</p>}
            <p>Packing does not approve allergens or sign a release.</p>
          </>
        )}
      </dialog>
    </article>
  );
}
function SavedCollection({ order }: { order: ProductionOrder }) {
  const [view, setView] = useState<PackingView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<Record<string, unknown> | undefined>(undefined);
  const serial = useRef(0);
  const sending = useRef(false);
  const load = async () => {
    const version = ++serial.current;
    try {
      const response = await fetch(
        "/api/packing?orderId=" + encodeURIComponent(order.canonicalId),
        { cache: "no-store", redirect: "error" },
      );
      const body = await response.json();
      if (!response.ok)
        throw Error(body.error?.message || "Checklist could not be loaded.");
      if (version === serial.current) {
        setView(body);
        setError("");
      }
    } catch (e) {
      if (version === serial.current) {
        setView(undefined);
        setError(
          e instanceof Error ? e.message : "Checklist could not be loaded.",
        );
      }
    }
  };
  useEffect(() => {
    setView(undefined);
    setError("");
    pending.current = undefined;
    void load();
    const focus = () => {
      if (!sending.current) void load();
    };
    window.addEventListener("focus", focus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !sending.current)
        void load();
    }, 300000);
    return () => {
      serial.current++;
      window.removeEventListener("focus", focus);
      clearInterval(timer);
    };
  }, [order]);
  const send = async (body: Record<string, unknown>) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    pending.current = body;
    const generation = ++serial.current;
    try {
      const response = await fetch("/api/packing", {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (generation !== serial.current) return;
      if (!response.ok) {
        if (response.status === 409) {
          pending.current = undefined;
          await load();
        }
        throw Error(result.error?.message || "Packing was not saved.");
      }
      setView(result);
      pending.current = undefined;
    } catch (e) {
      if (generation === serial.current || !pending.current)
        setError(
          e instanceof Error ? e.message : "Packing was not saved. Retry.",
        );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const toggle = (lineId: string, packed: boolean) => {
    const line = view?.lines.find((l) => l.lineId === lineId);
    if (!line || !view) return;
    void send({
      orderId: order.canonicalId,
      orderVersion: view.orderVersion,
      lineId,
      fingerprint: line.fingerprint,
      packed,
      expectedRevision: view.revision,
      commandId: crypto.randomUUID(),
    });
  };
  return (
    <CollectionCard
      order={order}
      packing={{
        view,
        busy,
        error,
        toggle,
        retry: pending.current ? () => void send(pending.current!) : undefined,
      }}
    />
  );
}
export default function KitchenRunSheet({
  orders,
  productionDate = "",
  onProductionDateChange,
}: {
  orders: ProductionOrder[];
  productionDate?: string;
  onProductionDateChange?: (date: string) => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const printDay = async () => {
    if (printing || !productionDate) return;
    setPrinting(true);
    setPrintError("");
    try {
      const allOrders = await loadWholeDay(productionDate);
      await printKitchenDocument(
        dayProductionPrintHtml(allOrders, productionDate),
        paginateDayProduction,
      );
    } catch (error) {
      setPrintError(
        error instanceof Error
          ? error.message
          : "The complete day's production could not be printed. Refresh and retry.",
      );
    } finally {
      setPrinting(false);
    }
  };
  return (
    <>
      <div className="kitchen-print-toolbar">
        <label>
          Production date for printing
          <input
            type="date"
            value={productionDate}
            onChange={(e) => onProductionDateChange?.(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="kitchen-button kitchen-print-primary"
          disabled={!productionDate || printing}
          onClick={() => void printDay()}
        >
          {printing ? "Preparing complete day…" : "Print day's production"}
        </button>
        <p>
          {productionDate
            ? "Prints the complete selected day across all sites, origins and production scopes. Screen filters do not limit printing; cancelled and superseded orders are excluded."
            : "Select a production date before printing. Only that day will be printed."}
        </p>
        {printError && (
          <p className="kitchen-error" role="alert">
            {printError}
          </p>
        )}
      </div>
      <section
        className="kitchen-run-sheet"
        aria-label="Collection packing workspace"
      >
        {!orders.length ? (
          <div className="cpu-empty">
            <h3>No collections in this selection.</h3>
            <p>Choose a date or clear filters.</p>
          </div>
        ) : (
          collectionOrders(orders).map((o) => (
            <SavedCollection key={o.canonicalId + ":" + o.version} order={o} />
          ))
        )}
      </section>
    </>
  );
}
