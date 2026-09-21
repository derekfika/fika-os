"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductionOrder } from "../../lib/production-types";
import { cpuProjectionToOrders } from "../../lib/cpu-dashboard-adapter";
import { loadCpuAllergenProjection } from "../lib/cpu-allergen-projection-loader";
import AllergenReviewMatrix from "../ui/AllergenReviewMatrix";
import { SignatureModal } from "../ui/HospitalityAllergenDetail";
import { buildAllergenReviewRows, deliveredInMenuOrdersForServiceDate, destination, orderDate } from "../../lib/production-day";
import { captureSigningLineage, signingLineageUnavailableMessage } from "./signing-lineage";
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
const MATERIALIZATION_GRACE_MS = 15_000;
const MAX_PARALLEL_RETRIES = 4;

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

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
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
  const [matrixStatusByOrderId, setMatrixStatusByOrderId] = useState<Record<string, string | undefined>>({});
  const [lineageByOrderId, setLineageByOrderId] = useState<Record<string, MatrixLineage>>({});
  const [finalizationComplete, setFinalizationComplete] = useState(false);
  const [reviewFrozen, setReviewFrozen] = useState(false);
  const [signatureMessage, setSignatureMessage] = useState("");
  const [signatureBusy, setSignatureBusy] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [reviewPersistencePending, setReviewPersistencePending] = useState(false);
  const checkedCountRef = useRef(0);
  const [retryEligible, setRetryEligible] = useState(false);
  const signingReviewRef = useRef<(() => unknown[]) | undefined>(undefined);
  const saveReviewRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const signingSnapshotRef = useRef<Record<string, MatrixLineage> | undefined>(undefined);
  const signingAttemptRef = useRef<{ role: SignatureRole; id: string } | undefined>(undefined);
  const releasePollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const releasePollRunRef = useRef(0);

  const newSigningAttemptId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  const load = async (selectedDate: string) => {
    setError("");
    setHydrating(true);
    setOrders([]);
    setCheckedCount(0);
    checkedCountRef.current = 0;
    setSignatureRoles([]);
    setSignatureRolesByOrderId({});
    setMatrixStatusByOrderId({});
    setLineageByOrderId({});
    signingSnapshotRef.current = undefined;
    setFinalizationComplete(false);
    setReviewFrozen(false);
    setReviewDirty(false);
    setRetryEligible(false);
    signingReviewRef.current = undefined;
    saveReviewRef.current = undefined;
    signingAttemptRef.current = undefined;
    if (releasePollTimerRef.current) clearTimeout(releasePollTimerRef.current);
    releasePollRunRef.current += 1;
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

  useEffect(() => () => {
    if (releasePollTimerRef.current) clearTimeout(releasePollTimerRef.current);
    releasePollRunRef.current += 1;
  }, [date]);

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
  const allChecked = visibleOrders.length > 0 && rows.length > 0 && checkedCountRef.current === rows.length;
  const productionSigned = signatureRoles.includes("production_chef");
  const headChefSigned = signatureRoles.includes("head_chef_site_manager");
  const bothSigned = productionSigned && headChefSigned;
  const fullySigned = finalizationComplete && bothSigned;

  const refreshReviewStatus = async () => {
    const orderIds = masterOrders.map(order => order.canonicalId);
    const orderLabels = Object.fromEntries(masterOrders.map(order => [order.canonicalId, destination(order)]));
    const response = await fetch(`/api/production-plan?matrixStatus=1&orderIds=${encodeURIComponent(orderIds.join(","))}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Signature status could not be refreshed. Reload the review before continuing.");
    const body = await response.json() as { matrixStatuses?: MatrixStatus[] };
    const statuses = body.matrixStatuses || [];
    const rolesByOrderId = Object.fromEntries(orderIds.map(orderId => [orderId, statuses.find(status => status.orderId === orderId)?.signatureRoles || []])) as Record<string, SignatureRole[]>;
    const nextMatrixStatusByOrderId = Object.fromEntries(orderIds.map(orderId => [orderId, statuses.find(status => status.orderId === orderId)?.matrixStatus])) as Record<string, string | undefined>;
    const commonRoles = (["production_chef", "head_chef_site_manager"] as SignatureRole[]).filter(role => statuses.length === orderIds.length && statuses.every(status => status.signatureRoles.includes(role)));
    const freshLineage = captureSigningLineage(orderIds, date, statuses, orderLabels);
    const frozenLineage = signingSnapshotRef.current;
    if (frozenLineage && orderIds.some(orderId => !sameLineage(frozenLineage[orderId], freshLineage[orderId]))) {
      setSignatureMessage("The reviewed Menu publication changed after this review was frozen. Reopen the review and review the current matrix before signing.");
    }
    const lineageMatchesFrozen = !frozenLineage || orderIds.every(orderId => sameLineage(frozenLineage[orderId], freshLineage[orderId]));
    setSignatureRolesByOrderId(rolesByOrderId);
    setMatrixStatusByOrderId(nextMatrixStatusByOrderId);
    setSignatureRoles(commonRoles);
    setFinalizationComplete(statuses.length === orderIds.length && statuses.every(status => status.matrixStatus === "ready"));
    setLineageByOrderId(lineageMatchesFrozen ? frozenLineage || freshLineage : freshLineage);
    return { statuses, rolesByOrderId, commonRoles, freshLineage, lineageMatchesFrozen };
  };

  const pollReleaseStatus = async () => {
    const run = ++releasePollRunRef.current;
    const startedAt = Date.now();
    const refresh = async (): Promise<void> => {
      if (run !== releasePollRunRef.current) return;
      const refreshed = await refreshReviewStatus();
      if (run !== releasePollRunRef.current) return;
      const currentCount = refreshed.statuses.filter(status => status.matrixStatus === "ready").length;
      const allReady = refreshed.statuses.length === masterOrders.length && currentCount === masterOrders.length;
      const hasFailure = refreshed.statuses.some(status => status.matrixStatus === "failed");
      const hasUnconfigured = refreshed.statuses.some(status => status.matrixStatus === "not_configured");
      if (allReady) {
        setRetryEligible(false);
        setSignatureMessage(`${currentCount} OPLOC release${currentCount === 1 ? "" : "s"} current.`);
      } else {
        const eligible = hasFailure || (!hasUnconfigured && Date.now() - startedAt >= MATERIALIZATION_GRACE_MS);
        setRetryEligible(eligible);
        if (eligible && hasFailure) setSignatureMessage("One or more OPLOC releases need materialisation retry.");
      }
      const terminal = refreshed.statuses.length === masterOrders.length && refreshed.statuses.every(status => ["ready", "failed", "not_configured"].includes(status.matrixStatus || ""));
      if (!terminal) releasePollTimerRef.current = setTimeout(() => void refresh().catch(() => undefined), 2500);
    };
    await refresh();
  };

  useEffect(() => {
    if (!bothSigned || fullySigned || !masterOrders.length) return;
    void pollReleaseStatus().catch(() => undefined);
  }, [bothSigned, fullySigned, masterOrders.length]);

  const pendingReleaseOrders = useMemo(
    () => masterOrders.filter(order => matrixStatusByOrderId[order.canonicalId] !== "ready"),
    [masterOrders, matrixStatusByOrderId],
  );

  const retryPendingOplocReleases = async () => {
    if (site || signatureBusy || hydrating || !bothSigned || !masterOrders.length) return;
    setSignatureBusy(true);
    setRetryEligible(false);
    setSignatureMessage("Refreshing current Menu publication lineage before retrying pending OPLOC releases…");
    const failures: Array<{ orderId: string; message: string }> = [];
    try {
      const refreshed = await refreshReviewStatus();
      if (signingSnapshotRef.current && !refreshed.lineageMatchesFrozen) {
        throw new Error("The reviewed Menu publication changed. Reload, reopen the review, and review the current matrix before retrying.");
      }
      const statusByOrderId = new Map(refreshed.statuses.map(status => [status.orderId, status]));
      const retryOrders = masterOrders.filter(order => statusByOrderId.get(order.canonicalId)?.matrixStatus !== "ready");
      const retryResults = await mapWithConcurrency(retryOrders, MAX_PARALLEL_RETRIES, async order => {
        const expectedLineage = refreshed.freshLineage[order.canonicalId];
        if (!expectedLineage) {
          return { orderId: order.canonicalId, message: signingLineageUnavailableMessage([order.canonicalId], { [order.canonicalId]: destination(order) }) };
        }
        try {
          const response = await fetch("/api/production-plan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "retry-materialization", orderId: order.canonicalId, expectedLineage }),
          });
          const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string }; materializationDelivery?: { status?: string } | null } | undefined;
          const deliveryStatus = body?.materializationDelivery?.status;
          if (body?.error?.code === "CPU_RELEASE_ALREADY_CURRENT") return undefined;
          if (!response.ok || (deliveryStatus && deliveryStatus !== "delivered")) return { orderId: order.canonicalId, message: `${destination(order)}: ${body?.error?.message || (deliveryStatus ? `Materialisation delivery ${deliveryStatus}.` : "The OPLOC release retry failed.")}` };
          return undefined;
        } catch (cause) {
          return { orderId: order.canonicalId, message: `${destination(order)}: ${cause instanceof Error ? cause.message : "The OPLOC release retry failed."}` };
        }
      });
      failures.push(...retryResults.filter((failure): failure is { orderId: string; message: string } => Boolean(failure)));
      const final = await refreshReviewStatus();
      const currentCount = final.statuses.filter(status => status.matrixStatus === "ready").length;
      const stillPending = masterOrders.filter(order => final.statuses.find(status => status.orderId === order.canonicalId)?.matrixStatus !== "ready");
      const currentMessage = `${currentCount} OPLOC release${currentCount === 1 ? "" : "s"} current.`;
      const pendingIds = new Set(stillPending.map(order => order.canonicalId));
      const unresolvedFailures = failures.filter(failure => pendingIds.has(failure.orderId)).map(failure => failure.message);
      if (stillPending.length === 0) {
        setRetryEligible(false);
        setSignatureMessage(currentMessage);
      } else if (unresolvedFailures.length) {
        setRetryEligible(true);
        setSignatureMessage(`${currentMessage} ${unresolvedFailures.join(" · ")}`);
      } else if (stillPending.length) {
        setRetryEligible(true);
        setSignatureMessage(`${currentMessage} ${stillPending.map(order => destination(order)).join(", ")} retry still pending.`);
      } else {
        setSignatureMessage(currentMessage);
      }
    } catch (cause) {
      setSignatureMessage(cause instanceof Error ? cause.message : "Pending OPLOC releases could not be retried.");
    } finally {
      setSignatureBusy(false);
    }
  };

  const sign = async (printedName: string, signatureDataUrl: string) => {
    if (!signing || signatureBusy || site) return;
    const role = signing.role;
    if (!masterOrders.length) {
      setSignatureMessage("There is no Delivered-In master matrix to sign for this service date.");
      return;
    }
    if (masterOrders.every(order => (signatureRolesByOrderId[order.canonicalId] || []).includes(role))) {
      setSigning(undefined);
      setSignatureMessage("This signature is already recorded across every OPLOC in the service-date master matrix.");
      return;
    }

    setSignatureBusy(true);
    setSignatureMessage("");
    const failures: string[] = [];
    const signingAttempt = signingAttemptRef.current;
    if (!signingAttempt || signingAttempt.role !== role) {
      setSignatureBusy(false);
      setSignatureMessage("This signing attempt is no longer available. Start the signature again after reviewing the current matrix.");
      return;
    }
    try {
      // The matrix component serialises autosaves. Await its latest save
      // before refreshing the signing snapshot so a slow autosave cannot
      // arrive after the authoritative signature command.
      await saveReviewRef.current?.();
      const beforeSign = await refreshReviewStatus();
      if (signingSnapshotRef.current && !beforeSign.lineageMatchesFrozen) {
        throw new Error("The reviewed Menu publication changed while the signature was being prepared. Reopen the review and review the current matrix before signing.");
      }
      const signingSnapshot = beforeSign.freshLineage;
      const missing = masterOrders.filter(order => !signingSnapshot[order.canonicalId]).map(order => order.canonicalId);
      if (missing.length) {
        const labels = Object.fromEntries(masterOrders.map(order => [order.canonicalId, destination(order)]));
        throw new Error(signingLineageUnavailableMessage(masterOrders.map(order => order.canonicalId), labels, missing));
      }
      const reviewOperations = signingReviewRef.current?.();
      if (!reviewOperations || reviewOperations.length !== masterOrders.length) {
        throw new Error("The current reviewed matrix is unavailable. Reload the review before signing.");
      }
      const response = await fetch("/api/production-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "sign-master-matrix",
          serviceDate: date,
          role,
          printedName,
          signatureDataUrl,
          orderIds: masterOrders.map(order => order.canonicalId),
          expectedLineages: masterOrders.map(order => signingSnapshot[order.canonicalId]),
          reviewOperations,
          commandId: ["cpu-master-sign", signingAttempt.id, role].join(":"),
          attestation: "I confirm that I reviewed the complete CPU Delivered-In service-date allergen matrix and the recorded evidence is accurate to the best of my knowledge.",
        }),
      });
      const body = await response.json() as {
        error?: { message?: string };
        results?: Array<{ orderId: string; ok: boolean; error?: string }>;
      };
      if (!response.ok) {
        failures.push(body.error?.message || "The master matrix could not be signed.");
      } else {
        for (const result of body.results || []) {
          if (!result.ok) failures.push(`${destination(masterOrders.find(order => order.canonicalId === result.orderId) || masterOrders[0])}: ${result.error || "The matrix could not be signed."}`);
        }
      }

      setSigning(undefined);
      const refreshed = await refreshReviewStatus();
      if (!refreshed.lineageMatchesFrozen) {
        setReviewFrozen(false);
        signingSnapshotRef.current = undefined;
        signingAttemptRef.current = undefined;
        failures.push("The reviewed Menu publication changed while the signature was being confirmed.");
      }
      const roleAuthoritativelyPresent = refreshed.statuses.length === masterOrders.length
        && masterOrders.every(order => (refreshed.rolesByOrderId[order.canonicalId] || []).includes(role));
      if (!roleAuthoritativelyPresent) failures.push("The authoritative matrix status did not confirm this signature for every OPLOC.");
      if (failures.length) {
        signingSnapshotRef.current = undefined;
        setSignatureMessage(
          `The master signature was not applied to every OPLOC. ${failures.join(" · ")} Reload and retry; already-committed OPLOC signatures are idempotent.`,
        );
      } else {
        setSignatureRoles(current => [...new Set([...current, role])]);
        setSignatureMessage(role === "production_chef" ? "Production chef signature recorded once across the complete service-date master matrix." : "Fully signed · generating OPLOC releases");
        signingAttemptRef.current = undefined;
      }
    } catch (cause) {
      setSigning(undefined);
      signingSnapshotRef.current = undefined;
      signingAttemptRef.current = undefined;
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
    if (site) {
      setSignatureMessage("Return to All sites to sign the complete Delivered-In service-date master matrix.");
      return;
    }
    if (hydrating) {
      setSignatureMessage("The allergen review is still loading. Wait for the current matrix before signing.");
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
    if (role === "production_chef" && productionSigned) {
      setSignatureMessage("The production chef signature is already recorded.");
      return;
    }
    if (role === "head_chef_site_manager" && headChefSigned) {
      setSignatureMessage("The head chef / site manager signature is already recorded.");
      return;
    }
    if (bothSigned) {
      setSignatureMessage("Both required signatures are already recorded.");
      return;
    }
    if (signatureBusy) {
      setSignatureMessage("Another signing action is already in progress. Wait for it to finish.");
      return;
    }

    setSignatureBusy(true);
    setSignatureMessage("Saving the completed allergen review before opening signature…");
    try {
      await saveReviewRef.current?.();
      const refreshed = await refreshReviewStatus();
      if (signingSnapshotRef.current && !refreshed.lineageMatchesFrozen) {
        signingSnapshotRef.current = undefined;
        signingAttemptRef.current = undefined;
        setReviewFrozen(false);
        throw new Error("The reviewed Menu publication changed. Reopen the review and review the current matrix before signing.");
      }
      const missing = masterOrders.filter(order => !refreshed.freshLineage[order.canonicalId]).map(order => order.canonicalId);
      if (missing.length) {
        const labels = Object.fromEntries(masterOrders.map(order => [order.canonicalId, destination(order)]));
        throw new Error(signingLineageUnavailableMessage(masterOrders.map(order => order.canonicalId), labels, missing));
      }
      if (masterOrders.every(order => (refreshed.rolesByOrderId[order.canonicalId] || []).includes(role))) {
        setSignatureMessage("This signature is already recorded across every OPLOC in the service-date master matrix.");
        return;
      }
      signingSnapshotRef.current = refreshed.freshLineage;
      setReviewFrozen(true);
      signingAttemptRef.current = signingAttemptRef.current?.role === role
        ? signingAttemptRef.current
        : { role, id: newSigningAttemptId() };
      setSignatureMessage("");
      setSigning({ role });
    } catch (cause) {
      setSignatureMessage(cause instanceof Error ? cause.message : "The current allergen review could not be prepared for signing.");
    } finally {
      setSignatureBusy(false);
    }
  };

  const signatureSummary = site
    ? "Filtered OPLOC view — return to All sites to sign the service-date master matrix."
    : fullySigned
      ? "Both signatures recorded and every OPLOC-scoped release is current."
      : bothSigned
        ? "Fully signed · generating OPLOC releases"
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
          onCheckedChange={count => { checkedCountRef.current = count; setCheckedCount(count); }}
          onReviewChanged={() => undefined}
          onSignatureRolesChange={roles => setSignatureRoles(roles)}
          onOrderSignatureRolesChange={setSignatureRolesByOrderId}
          onMatrixStatusChange={setMatrixStatusByOrderId}
          onFinalizationChange={setFinalizationComplete}
          onLineageChange={setLineageByOrderId}
          onHydrationChange={setHydrating}
          onDirtyChange={setReviewDirty}
          onPersistenceChange={setReviewPersistencePending}
          onRegisterReviewState={get => { signingReviewRef.current = get; }}
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
                  {bothSigned && retryEligible && pendingReleaseOrders.length > 0 && <button type="button" className="cpu-allergen-retry" disabled={signatureBusy || hydrating} onClick={() => void retryPendingOplocReleases()}>Retry pending OPLOC releases</button>}
                </>
              )}
              {reviewFrozen && <button type="button" disabled={signatureBusy || hydrating} onClick={() => void reopenForAmendment()}>Reopen for amendment</button>}
            </div>
          )}
          {signatureBusy && <p role="status">{signatureMessage || "Saving review…"}</p>}
          {signatureMessage && !signatureBusy && <p className="cpu-allergen-signature-alert" role="alert">{signatureMessage}</p>}
        </section>
      </section>

      {signing && (
        <SignatureModal
          role={signing.role}
          busy={signatureBusy || reviewPersistencePending}
          onCancel={() => { setSigning(undefined); signingSnapshotRef.current = undefined; signingAttemptRef.current = undefined; }}
          onConfirm={(name, dataUrl) => void sign(name, dataUrl)}
        />
      )}
    </main>
  );
}
