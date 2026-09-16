"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductionOrder } from "../../lib/production-types";
import type { InternalMatrixSignature } from "../lib/production-plan";
import { cpuProjectionToOrders } from "../../lib/cpu-dashboard-adapter";
import { loadCpuAllergenProjection } from "../lib/cpu-allergen-projection-loader";
import AllergenReviewMatrix from "../ui/AllergenReviewMatrix";
import { SignatureModal } from "../ui/HospitalityAllergenDetail";
import { buildAllergenReviewRows, deliveredInMenuOrdersForServiceDate, destination, orderDate } from "../../lib/production-day";
import { captureSigningLineage } from "./signing-lineage";
import "./page.css";

type SignatureRole = "production_chef" | "head_chef_site_manager";
type MatrixLineage = {
  productionOrderId: string;
  serviceDate: string;
  sourceDayId: string;
  sourcePublicationId?: string;
  sourcePublicationDayId: string;
  sourceVersion: number;
  sourceContentHash: string;
  matrixContentHash: string;
};
type MatrixStatus = { orderId: string; signatureRoles: SignatureRole[]; matrixStatus?: string; sourceLineage?: MatrixLineage };

function sameLineage(left: MatrixLineage | undefined, right: MatrixLineage | undefined) {
  return Boolean(left && right && left.productionOrderId === right.productionOrderId && left.serviceDate === right.serviceDate && left.sourceDayId === right.sourceDayId && left.sourcePublicationId === right.sourcePublicationId && left.sourcePublicationDayId === right.sourcePublicationDayId && left.sourceVersion === right.sourceVersion && left.sourceContentHash === right.sourceContentHash && left.matrixContentHash === right.matrixContentHash);
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function CpuAllergenReviewPage() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [date, setDate] = useState("");
  const [site, setSite] = useState("");
  const [review, setReview] = useState("all");
  const [error, setError] = useState("");
  const [signing, setSigning] = useState<{ role: SignatureRole }>();
  const [checkedCount, setCheckedCount] = useState(0);
  const [signatureRoles, setSignatureRoles] = useState<SignatureRole[]>([]);
  const [signatureRolesByOrderId, setSignatureRolesByOrderId] = useState<Record<string, SignatureRole[]>>({});
  const [lineageByOrderId, setLineageByOrderId] = useState<Record<string, MatrixLineage>>({});
  const [finalizationComplete, setFinalizationComplete] = useState(false);
  const [reviewFrozen, setReviewFrozen] = useState(false);
  const [signatureMessage, setSignatureMessage] = useState("");
  const [signatureBusy, setSignatureBusy] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const saveReviewRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const signingSnapshotRef = useRef<Record<string, MatrixLineage> | undefined>(undefined);

  const load = async (selectedDate: string) => {
    setError("");
    setHydrating(true);
    setOrders([]);
    setCheckedCount(0);
    setSignatureRoles([]);
    setSignatureRolesByOrderId({});
    setLineageByOrderId({});
    signingSnapshotRef.current = undefined;
    setFinalizationComplete(false);
    setReviewFrozen(false);
    setReviewDirty(false);
    try {
      const loaded = await loadCpuAllergenProjection(selectedDate, "delivered_in");
      setOrders(cpuProjectionToOrders(loaded.projection).filter(order => order.origin === "menu_planning"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load allergen review.");
      setHydrating(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDate(params.get("date") || new Date().toISOString().slice(0, 10));
  }, []);

  useEffect(() => {
    if (date) void load(date);
  }, [date]);

  useEffect(() => {
    if (!reviewDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [reviewDirty]);

  const dateOrders = useMemo(
    () => orders.filter(order => !date || orderDate(order) === date),
    [orders, date],
  );
  const masterOrders = useMemo(
    () => deliveredInMenuOrdersForServiceDate(dateOrders, date || undefined),
    [dateOrders, date],
  );
  const visibleOrders = useMemo(
    () => site ? masterOrders.filter(order => (order.destinationOplocId || destination(order)) === site) : masterOrders,
    [masterOrders, site],
  );
  const rows = useMemo(() => buildAllergenReviewRows(visibleOrders), [visibleOrders]);
  const sites = [...new Map(masterOrders.map(order => [order.destinationOplocId || destination(order), destination(order)])).entries()];
  const approved = rows.filter(row => row.snapshot).length;
  const attention = rows.filter(row => row.attention).length;
  const allChecked = visibleOrders.length > 0 && rows.length > 0 && checkedCount === rows.length;
  const productionSigned = signatureRoles.includes("production_chef");
  const headChefSigned = signatureRoles.includes("head_chef_site_manager");
  const bothSigned = productionSigned && headChefSigned;
  const fullySigned = finalizationComplete && bothSigned;

  const refreshReviewStatus = async () => {
    const orderIds = masterOrders.map(order => order.canonicalId);
    const response = await fetch(`/api/production-plan?matrixStatus=1&orderIds=${encodeURIComponent(orderIds.join(","))}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Signature status could not be refreshed. Reload the review before continuing.");
    const body = await response.json() as { matrixStatuses?: MatrixStatus[] };
    const statuses = body.matrixStatuses || [];
    const rolesByOrderId = Object.fromEntries(orderIds.map(orderId => [orderId, statuses.find(status => status.orderId === orderId)?.signatureRoles || []])) as Record<string, SignatureRole[]>;
    const commonRoles = (["production_chef", "head_chef_site_manager"] as SignatureRole[]).filter(role => statuses.length === orderIds.length && statuses.every(status => status.signatureRoles.includes(role)));
    const freshLineage = captureSigningLineage(orderIds, date, statuses);
    const frozenLineage = signingSnapshotRef.current;
    if (frozenLineage && orderIds.some(orderId => !sameLineage(frozenLineage[orderId], freshLineage[orderId]))) {
      setSignatureMessage("The reviewed Menu publication changed after this review was frozen. Reopen the review and review the current matrix before signing.");
    }
    setSignatureRolesByOrderId(rolesByOrderId);
    setSignatureRoles(commonRoles);
    setFinalizationComplete(statuses.length === orderIds.length && statuses.every(status => status.matrixStatus === "ready"));
    setLineageByOrderId(frozenLineage || freshLineage);
  };

  const sign = async (printedName: string, signatureDataUrl: string) => {
    if (!signing || signatureBusy || site) return;
    const role = signing.role;
    const targets = masterOrders.filter(order => !(signatureRolesByOrderId[order.canonicalId] || []).includes(role));
    if (!masterOrders.length) {
      setSignatureMessage("There is no Delivered-In master matrix to sign for this service date.");
      return;
    }
    const signingSnapshot = signingSnapshotRef.current;
    if (!signingSnapshot || masterOrders.some(order => !signingSnapshot[order.canonicalId])) {
      setSignatureMessage("The current Menu publication lineage is unavailable for one or more OPLOCs. Reload the review before signing.");
      return;
    }
    if (!targets.length) {
      setSigning(undefined);
      setSignatureMessage("This signature is already recorded across every OPLOC in the service-date master matrix.");
      return;
    }

    setSignatureBusy(true);
    setSignatureMessage("");
    const failures: string[] = [];
    try {
      for (const order of targets) {
        const expectedLineage = signingSnapshot[order.canonicalId];
        const commandId = [
          "cpu-master-sign",
          date,
          role,
          order.canonicalId,
          expectedLineage.sourceContentHash,
          expectedLineage.matrixContentHash,
        ].join(":");
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
            commandId,
            attestation: "I confirm that I reviewed the complete CPU Delivered-In service-date allergen matrix and the recorded evidence is accurate to the best of my knowledge.",
            actor: "production-chef",
          }),
        });
        const body = await response.json() as {
          error?: { message?: string };
          matrixStatus?: string;
          plan?: { signatures?: InternalMatrixSignature[] };
        };
        if (!response.ok) {
          failures.push(`${destination(order)}: ${body.error?.message || "The matrix could not be signed."}`);
        }
      }

      setSigning(undefined);
      if (failures.length) {
        signingSnapshotRef.current = undefined;
        setSignatureMessage(
          `The master signature was not applied to every OPLOC. ${failures.join(" · ")} Reload and retry; already-committed OPLOC signatures are idempotent.`,
        );
      } else {
        setSignatureRoles(current => [...new Set([...current, role])]);
        setSignatureMessage(
          role === "production_chef"
            ? "Production chef signature recorded once across the complete service-date master matrix."
            : "Head chef / site manager signature recorded once across the complete service-date master matrix. OPLOC-scoped releases are refreshing.",
        );
      }
      await refreshReviewStatus();
    } catch (cause) {
      setSigning(undefined);
      signingSnapshotRef.current = undefined;
      setSignatureMessage(cause instanceof Error ? cause.message : "The master matrix could not be signed.");
    } finally {
      setSignatureBusy(false);
    }
  };

  const reopenForAmendment = async () => {
    if (!reviewFrozen || signatureBusy || hydrating || !masterOrders.length) return;
    setSignatureBusy(true);
    setSignatureMessage("Revoking prior signature authority and reopening the review…");
    try {
      const response = await fetch("/api/production-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "batch-plan",
          operations: masterOrders.map(order => ({ action: "reopen-review", orderId: order.canonicalId })),
        }),
      });
      const body = await response.json() as { results?: Array<{ ok: boolean; error?: string }> };
      if (!response.ok || body.results?.some(result => !result.ok)) {
        throw new Error(body.results?.find(result => !result.ok)?.error || "The allergen review could not be reopened.");
      }
      await load(date);
      setSignatureMessage("Review reopened for amendment. Save the amended matrix once before signing again.");
    } catch (cause) {
      setSignatureMessage(cause instanceof Error ? cause.message : "The allergen review could not be reopened.");
    } finally {
      setSignatureBusy(false);
    }
  };

  const beginSigning = async (role: SignatureRole) => {
    if (site || hydrating) {
      setSignatureMessage("Return to All sites to sign the complete Delivered-In service-date master matrix.");
      return;
    }
    if (!masterOrders.length) {
      setSignatureMessage("There is no Delivered-In master matrix to sign for this service date.");
      return;
    }
    if (!allChecked) {
      setSignatureMessage(`Please mark all ${rows.length} dishes as checked before signing. ${checkedCount} of ${rows.length} are checked.`);
      return;
    }
    if (masterOrders.some(order => !lineageByOrderId[order.canonicalId])) {
      setSignatureMessage("The current Menu publication lineage is unavailable for one or more OPLOCs. Reload the review before signing.");
      return;
    }
    if ((role === "production_chef" && productionSigned) || (role === "head_chef_site_manager" && headChefSigned) || bothSigned || signatureBusy || hydrating) return;

    setSignatureMessage("");
    setSignatureBusy(true);
    try {
      if (!reviewFrozen) {
        if (reviewDirty) {
          setSignatureMessage("Syncing allergen edits before signature…");
          await saveReviewRef.current();
        }
        setReviewFrozen(true);
      }
      setSignatureMessage("Refreshing current Menu publication lineage before signature…");
      const orderIds = masterOrders.map(order => order.canonicalId);
      const response = await fetch(`/api/production-plan?matrixStatus=1&orderIds=${encodeURIComponent(orderIds.join(","))}`, { cache: "no-store" });
      if (!response.ok) throw new Error("The current Menu publication lineage could not be refreshed. Reload the review before signing.");
      const body = await response.json() as { matrixStatuses?: Array<{ orderId: string; sourceLineage?: MatrixLineage }> };
      const freshLineage = captureSigningLineage(orderIds, date, body.matrixStatuses || []);
      const frozenLineage = signingSnapshotRef.current;
      if (frozenLineage && orderIds.some(orderId => !sameLineage(frozenLineage[orderId], freshLineage[orderId]))) {
        throw new Error("The reviewed Menu publication changed after this review was frozen. Reload, reopen the review, and review the current matrix before signing.");
      }
      const signingLineage = frozenLineage || freshLineage;
      signingSnapshotRef.current = signingLineage;
      setLineageByOrderId(signingLineage);
      setSigning({ role });
    } catch (cause) {
      signingSnapshotRef.current = undefined;
      setSignatureMessage(cause instanceof Error ? cause.message : "The allergen review could not be synchronised before signing.");
    } finally {
      setSignatureBusy(false);
    }
  };

  const signatureSummary = site
    ? "Filtered OPLOC view — return to All sites to sign the service-date master matrix."
    : fullySigned
      ? "Both signatures recorded and every OPLOC-scoped release is current."
      : bothSigned
        ? "Both signatures recorded. OPLOC-scoped releases are generating or refreshing."
        : allChecked
          ? "Every dish is checked. Capture the remaining required master signature."
          : `Check every dish before signing · ${checkedCount} of ${rows.length} checked.`;

  return (
    <main className="cpu-allergen-page">
      <header className="cpu-allergen-page-header">
        <div>
          <a href="/">← CPU Production</a>
          <small>CPU · Delivered-In lunch</small>
          <h1>ALLERGEN REVIEW</h1>
          <h2>{date ? formatDate(date) : "Select a production day"}</h2>
          <p>{rows.length} dishes · {approved} published · {checkedCount}/{rows.length} checked</p>
        </div>
        <div className="cpu-allergen-page-actions">
          <a href={`/?date=${date}`}>Back to production</a>
        </div>
      </header>

      <section className="cpu-allergen-page-content">
        <div className="cpu-allergen-filters" aria-label="Allergen review filters">
          <label>
            Date
            <input type="date" value={date} disabled={signatureBusy || hydrating || reviewDirty || Boolean(signing)} onChange={event => setDate(event.target.value)} />
          </label>
          <label>
            Site
            <select value={site} disabled={signatureBusy || hydrating || reviewDirty || Boolean(signing)} onChange={event => setSite(event.target.value)}>
              <option value="">All sites</option>
              {sites.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label>
            Review status
            <select value={review} disabled={signatureBusy || hydrating || reviewDirty || Boolean(signing)} onChange={event => setReview(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="attention">Needs attention</option>
              <option value="reviewed">Checked</option>
              <option value="pending">Unchecked</option>
            </select>
          </label>
        </div>

        {site && (
          <p className="cpu-allergen-filter-notice" role="status">
            This is a filtered OPLOC review view. Return to All sites to sign the complete Delivered-In service-date master matrix. FIKA OS still materialises a separate governed release for each OPLOC.
          </p>
        )}
        {!site && masterOrders.length > 1 && (
          <p className="cpu-allergen-filter-notice" role="status">
            Review the complete service-date matrix once. Both CPU signatures apply to this master review; FIKA OS then materialises separate governed OPLOC releases automatically.
          </p>
        )}

        <div className="cpu-allergen-page-summary">
          <span><strong>{rows.length}</strong> Delivered-In dishes</span>
          <span><strong>{approved}</strong> published</span>
          <span className={attention ? "attention" : ""}><strong>{attention}</strong> require attention</span>
          <span><strong>{checkedCount}/{rows.length}</strong> checked</span>
        </div>

        {error && <p role="alert">{error}</p>}

        <AllergenReviewMatrix
          rows={rows}
          orders={visibleOrders}
          scopeKey={`${date || "unknown"}:${site || "all"}`}
          busy={signatureBusy || hydrating}
          locked={hydrating || reviewFrozen || bothSigned || Boolean(signing)}
          onCheckedChange={setCheckedCount}
          onReviewChanged={() => undefined}
          onSignatureRolesChange={roles => setSignatureRoles(roles)}
          onOrderSignatureRolesChange={setSignatureRolesByOrderId}
          onFinalizationChange={setFinalizationComplete}
          onLineageChange={setLineageByOrderId}
          onHydrationChange={setHydrating}
          onDirtyChange={setReviewDirty}
          onRegisterSave={save => { saveReviewRef.current = save; }}
        />

        <section className="cpu-allergen-signatures">
          <div>
            <small>CPU chef sign-off</small>
            <h3>Sign the Delivered-In service-date master matrix</h3>
            <p>{signatureSummary}</p>
          </div>
          {!site && masterOrders.length > 0 && (
            <div className="cpu-allergen-signature-row">
              <span>
                {date ? formatDate(date) : "Published menu day"} · {rows.length} dishes · {sites.length} OPLOC{sites.length === 1 ? "" : "s"}
              </span>
              {fullySigned ? (
                <strong>Fully signed · scoped releases current</strong>
              ) : (
                <>
                  <button type="button" disabled={signatureBusy || hydrating || productionSigned} onClick={() => void beginSigning("production_chef")}>
                    {productionSigned ? "Production chef signed" : "Sign as production chef"}
                  </button>
                  <button type="button" disabled={signatureBusy || hydrating || headChefSigned} onClick={() => void beginSigning("head_chef_site_manager")}>
                    {headChefSigned ? "Head chef signed" : "Sign as head chef / site manager"}
                  </button>
                </>
              )}
              {reviewFrozen && <button type="button" disabled={signatureBusy || hydrating} onClick={() => void reopenForAmendment()}>Reopen for amendment</button>}
            </div>
          )}
          {signatureBusy && <p role="status">Syncing allergen edits before signature…</p>}
          {signatureMessage && !signatureBusy && <p className="cpu-allergen-signature-alert" role="alert">{signatureMessage}</p>}
        </section>
      </section>

      {signing && (
        <SignatureModal
          role={signing.role}
          busy={signatureBusy}
          onCancel={() => { setSigning(undefined); signingSnapshotRef.current = undefined; }}
          onConfirm={(name, dataUrl) => void sign(name, dataUrl)}
        />
      )}
    </main>
  );
}
