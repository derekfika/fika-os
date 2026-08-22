"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MailSearch, RefreshCw, Settings } from "lucide-react";
import type { CanonicalBooking } from "../../../integration-hub/lib/hospitality-booking-service";
import { dailyRunSheetHtml } from "../../lib/run-sheet";
import { quoteHtml } from "../../lib/quote-document";
import { amendmentPatchDto } from "../../lib/amendment-dto";
import type { ProductionOrder } from "../../../integration-hub/lib/hospitality-booking-service";
import type { DashboardQuoteSettings } from "../../../integration-hub/lib/quote-engine";
import { mnkMenuHtml } from "../../lib/mnk-menu-output";
import type { MenuOutput } from "../../lib/mnk-menu-output";
import styles from "./HospitalityDashboard.module.css";
import { portalSite, type PortalSiteKey } from "@/lib/portal-sites";
import { formatQuoteFilenameDate } from "../../../integration-hub/lib/quote-engine";

const statuses = [
  "New",
  "Reviewed",
  "Quoted",
  "Sent to CPU",
  "Completed",
  "Cancelled",
] as const;
type Status = CanonicalBooking["lifecycleStatus"];
type WorkflowAction = Exclude<Status, "New"> | "Production" | "Amend" | "QuotePdfRetry";
type Amendment = {
  client: CanonicalBooking["client"];
  service: CanonicalBooking["service"];
  order: CanonicalBooking["order"];
  notes: string;
  deliveryChargeRequired: boolean;
  reason: string;
};
type InboxScanPhase = "connecting" | "messages" | "attachments" | "staging" | "complete" | "error";
type AmendmentProgress = {
  status: "running" | "complete" | "error";
  currentStep: number;
  error?: string;
  steps: Array<{ label: string; state: "pending" | "active" | "complete" | "error"; detail?: string }>;
};
const inboxScanSteps: Array<{ key: Exclude<InboxScanPhase, "complete" | "error">; label: string }> = [
  { key: "connecting", label: "Connect to the authorised Gmail inbox" },
  { key: "messages", label: "Read messages newer than the last successful scan" },
  { key: "attachments", label: "Inspect booking attachments and extract source evidence" },
  { key: "staging", label: "Stage new Angel Court booking candidates" },
];

async function readDashboardJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`The booking update returned an unexpected server response (${response.status}). Please try again.`);
  }
}

function quoteFilename(eventDate: string, companyName: string, revision: number, extension: "pdf" | "html") {
  const revisionSuffix = revision > 1 ? `_Revision_${revision}` : "";
  return `Quote_${formatQuoteFilenameDate(eventDate)}_${companyName}${revisionSuffix}.${extension}`
    .replace(/[^A-Za-z0-9._-]+/g, "_");
}

export default function HospitalityDashboard({
  siteKey = "mnk",
}: {
  siteKey?: PortalSiteKey;
}) {
  const site = portalSite(siteKey);
  const [bookings, setBookings] = useState<CanonicalBooking[]>([]);
  const [productionOrders, setProductionOrders] = useState<
    Record<string, ProductionOrder | undefined>
  >({});
  const [selected, setSelected] = useState<CanonicalBooking | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStage, setActionStage] = useState("Working…");
  const [amendmentProgress, setAmendmentProgress] = useState<AmendmentProgress | null>(null);
  const [reason, setReason] = useState("");
  const [reviewChecks, setReviewChecks] = useState({
    commercialIntent: false,
    serviceTiming: false,
    deliveryContext: false,
    dietaryRequirements: false,
  });
  const [cancelOptions, setCancelOptions] = useState({
    removeCalendar: false,
    cancelProduction: false,
    notify: false,
  });
  const [loading, setLoading] = useState(true);
  const [scanBusy, setScanBusy] = useState(false);
  const [lastInboxScan, setLastInboxScan] = useState<string | null>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanPhase, setScanPhase] = useState<InboxScanPhase>("connecting");
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanElapsed, setScanElapsed] = useState(0);
  const [scanSummary, setScanSummary] = useState<{ attachments?: number; imported?: number; skipped?: number } | null>(null);
  const [scanError, setScanError] = useState("");
  const [calendarWeek, setCalendarWeek] = useState(() => mondayOf(new Date()));
  const [quoteSettings, setQuoteSettings] =
    useState<DashboardQuoteSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"quotes" | "drive">("quotes");
  const [amendment, setAmendment] = useState<Amendment | null>(null);
  const [runSheetOpen, setRunSheetOpen] = useState(false);
  const [runSheetError, setRunSheetError] = useState("");
  const [runSheetFrom, setRunSheetFrom] = useState(() =>
    localDateKey(mondayOf(new Date())),
  );
  const [runSheetTo, setRunSheetTo] = useState(() =>
    localDateKey(addDays(mondayOf(new Date()), 4)),
  );
  const [menuOutputs, setMenuOutputs] = useState<Record<string, MenuOutput>>(
    {},
  );
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuReadiness, setMenuReadiness] = useState<Record<string, { available: boolean; reason: string }>>({});
  const [matrixArtifacts, setMatrixArtifacts] = useState<
    Record<
      string,
      | {
          html?: string;
          localUrl?: string;
          driveUrl?: string;
          fileName: string;
          driveStatus: string;
        }
      | undefined
    >
  >({});
  // Menu outputs change only when a menu is regenerated. Avoid rereading the
  // whole output collection on every dashboard refresh.
  const menuCacheLoadedAt = useRef(0);

  const load = async (clearError = true) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/dashboard-bookings?site=${encodeURIComponent(site.key)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok)
        throw Error(body.error?.message || "Could not load Bookings.");
      setBookings(body.bookings);
      setProductionOrders(body.productionOrders || {});
      setQuoteSettings(body.quoteSettings || null);
      if (Date.now() - menuCacheLoadedAt.current >= 60_000) {
        const menuResponse = await fetch("/api/menus", { cache: "no-store" });
        if (menuResponse.ok) {
          const menuBody = (await menuResponse.json()) as {
            outputs?: MenuOutput[];
          };
          setMenuOutputs(
            Object.fromEntries(
              (menuBody.outputs || []).filter((output) => output.templateVersion === "mnk-hospitality-menu-v2").map((output) => [
                output.bookingId,
                output,
              ]),
            ),
          );
          menuCacheLoadedAt.current = Date.now();
        }
      }
      setSelected(
        (current) =>
          body.bookings.find(
            (item: CanonicalBooking) =>
              item.canonicalId === current?.canonicalId,
          ) || current,
      );
      if (clearError) setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [site.key]);

  useEffect(() => {
    if (site.key !== "angel-court") return;
    void fetch("/api/angel-court/inbox/scan", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setLastInboxScan(body.state?.lastScanAt || null))
      .catch(() => undefined);
  }, [site.key]);

  useEffect(() => {
    if (!scanModalOpen || !scanStartedAt) return;
    const timer = window.setInterval(
      () => setScanElapsed(Date.now() - scanStartedAt),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [scanModalOpen, scanStartedAt]);

  useEffect(() => {
    if (!scanBusy || !scanModalOpen) return;
    const timers = [
      window.setTimeout(() => setScanPhase("messages"), 500),
      window.setTimeout(() => setScanPhase("attachments"), 1400),
      window.setTimeout(() => setScanPhase("staging"), 2600),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [scanBusy, scanModalOpen]);

  const forceAngelCourtScan = async () => {
    setScanModalOpen(true);
    setScanPhase("connecting");
    setScanStartedAt(Date.now());
    setScanElapsed(0);
    setScanSummary(null);
    setScanError("");
    setScanBusy(true);
    try {
      const response = await fetch("/api/angel-court/inbox/scan", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Inbox scan failed.");
      setScanSummary(body.result || {});
      setScanPhase("complete");
      setLastInboxScan(body.result?.lastScanAt || null);
      await load();
    } catch (cause) {
      const message = (cause as Error).message;
      setScanError(message);
      setScanPhase("error");
      setError(message);
    }
    finally { setScanBusy(false); }
  };

  useEffect(() => {
    if (!selected) return;
    void fetch(
      `/api/allergen-matrix?bookingId=${encodeURIComponent(selected.canonicalId)}`,
      { cache: "no-store" },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.artifact)
          setMatrixArtifacts((current) => ({
            ...current,
            [selected.canonicalId]: body.artifact,
          }));
      })
      .catch(() => undefined);
  }, [selected?.canonicalId, selected?.version]);

  useEffect(() => {
    if (!selected) return;
    const bookingId = selected.canonicalId;
    void fetch(`/api/menus?bookingId=${encodeURIComponent(bookingId)}&readiness=1`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setMenuReadiness((current) => ({ ...current, [bookingId]: body.readiness || { available: false, reason: "Menu readiness is unavailable." } })))
      .catch(() => setMenuReadiness((current) => ({ ...current, [bookingId]: { available: false, reason: "Menu readiness is unavailable." } })));
  }, [selected?.canonicalId, selected?.version, productionOrders[selected?.canonicalId || ""]?.updatedAt]);

  // CPU planning is a shared projection, so keep an open manager panel current
  // while the production team is working without requiring a manual refresh.
  useEffect(() => {
    if (!selected) return;
    // Keep the manager view reasonably fresh without turning every open tab
    // into a high-frequency Firestore read loop.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [selected?.canonicalId, site.key]);

  const signInLocally = async () => {
    const response = await fetch("/api/local-session", { method: "POST" });
    const body = await readDashboardJson(response);
    if (!response.ok) {
      setError(body.error?.message || "Local sign-in was unavailable.");
      return;
    }
    await load();
  };

  const visible = useMemo(
    () => bookings.filter((item) => !filter || item.lifecycleStatus === filter),
    [bookings, filter],
  );
  const newCount = bookings.filter(
    (item) => item.lifecycleStatus === "New",
  ).length;
  const readyForCpuCount = bookings.filter((item) => item.deliveryChargeRequired !== false && quoteReadyForCpu(item)).length;
  const attentionCount = bookings.filter(
    (item) =>
      item.lifecycleStatus === "New" || item.lifecycleStatus === "Reviewed",
  ).length;
  const scanStepIndex = inboxScanSteps.findIndex(({ key }) => key === scanPhase);
  const scanProgress = scanPhase === "complete"
    ? "100%"
    : scanPhase === "error"
      ? "0%"
      : `${((scanStepIndex + 1) / inboxScanSteps.length) * 100}%`;

  const persistQuotePdf = async (booking: CanonicalBooking, quote: { id: string; revision: number }) => {
    const quoteResponse = await fetch("/api/quotes/drive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: quoteFilename(booking.service.eventDate, booking.client.companyName, quote.revision, "pdf"),
        html: quoteHtml(booking),
        siteKey: site.key,
      }),
    });
    const quoteBody = await readDashboardJson(quoteResponse) as { error?: { message?: string }; saved?: { fileId?: string; driveUrl?: string } };
    if (!quoteResponse.ok || !quoteBody.saved?.fileId) throw new Error(quoteBody.error?.message || "The quote PDF could not be saved to Drive.");
    const statusResponse = await fetch("/api/dashboard-bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonicalId: booking.canonicalId, expectedVersion: booking.version, action: "quote-pdf-status", revisionId: quote.id, status: "saved", driveFileId: quoteBody.saved.fileId, driveUrl: quoteBody.saved.driveUrl }),
    });
    const statusBody = await readDashboardJson(statusResponse) as { error?: { message?: string }; booking?: CanonicalBooking };
    if (!statusResponse.ok) throw new Error(statusBody.error?.message || "The quote PDF was saved but could not be recorded against the quote.");
    return statusBody.booking as CanonicalBooking;
  };

  const performAction = async () => {
    setError("");
    if (!selected || !pending) return;
    setActionStage(pending === "Quoted" || pending === "QuotePdfRetry" ? "Creating quote…" : "Saving changes…");
    if (pending === "QuotePdfRetry") {
      const current = selected.quoteState?.revisions.find((revision) => revision.id === selected.quoteState?.currentRevisionId);
      if (!current) return;
      try { setSelected(await persistQuotePdf(selected, current)); setError(""); } catch (cause) { setError((cause as Error).message); }
      setPending(null);
      await load(false);
      return;
    }
    const base = {
      canonicalId: selected.canonicalId,
      expectedVersion: selected.version,
    };
    const command =
      pending === "Amend" && amendment
        ? {
            ...base,
            action: "amend",
            reason: amendment.reason,
            patch: amendmentPatchDto(amendment),
          }
        : pending === "Reviewed"
          ? { ...base, action: "review", checks: reviewChecks, notes: reason }
          : pending === "Quoted"
            ? {
                ...base,
                action: "quote",
                regenerate: Boolean(selected.quoteState?.currentRevisionId),
              }
            : pending === "Production"
                ? { ...base, action: "production-handoff" }
                : pending === "Completed"
                  ? { ...base, action: "complete", notes: reason }
                  : { ...base, action: "cancel", reason, ...cancelOptions };
    if (pending === "Cancelled" && !reason.trim()) {
      setError("A cancellation reason is required.");
      return;
    }
    if (pending === "Amend" && !amendment?.reason.trim()) {
      setError("An amendment reason is required.");
      return;
    }
    const response = await fetch("/api/dashboard-bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message || "Could not update this Booking.");
      return;
    }
    setSelected(body.booking || selected);
    if (pending === "Quoted" && body.booking) {
      setActionStage("Saving quote PDF…");
      let pdfSaved = false;
      try {
        const quote = body.booking.quoteState?.revisions?.find(
          (revision: { id: string }) =>
            revision.id === body.booking.quoteState?.currentRevisionId,
        );
        if (quote) {
          const quoteResponse = await fetch("/api/quotes/drive", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: quoteFilename(body.booking.service.eventDate, body.booking.client.companyName, quote.revision, "html"),
              html: quoteHtml(body.booking),
              siteKey: site.key,
            }),
          });
          const quoteBody = (await quoteResponse.json()) as {
            error?: { message?: string };
            saved?: { fileId?: string; driveUrl?: string };
          };
          if (!quoteResponse.ok || !quoteBody.saved?.fileId) {
            setError(
              `Quote created, but Drive saving failed: ${quoteBody.error?.message || "unknown error"}`,
            );
          } else {
            setActionStage("Recording quote status…");
            const statusResponse = await fetch("/api/dashboard-bookings", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                canonicalId: body.booking.canonicalId,
                expectedVersion: body.booking.version,
                action: "quote-pdf-status",
                revisionId: quote.id,
                status: "saved",
                driveFileId: quoteBody.saved.fileId,
                driveUrl: quoteBody.saved.driveUrl,
              }),
            });
            const statusBody = await statusResponse.json();
            if (!statusResponse.ok) setError(statusBody.error?.message || "The quote PDF was saved but could not be recorded against the quote.");
            else { pdfSaved = true; setSelected(statusBody.booking || body.booking); }
          }
        }
      } catch (cause) {
        setError(
          `Quote created, but Drive saving failed: ${(cause as Error).message}`,
        );
      }
      if (!pdfSaved && body.booking.quoteState?.currentRevisionId) {
        await fetch("/api/dashboard-bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            canonicalId: body.booking.canonicalId,
            expectedVersion: body.booking.version,
            action: "quote-pdf-status",
            revisionId: body.booking.quoteState.currentRevisionId,
            status: "failed",
            error: "The quote PDF could not be persisted to Drive.",
          }),
        }).catch(() => undefined);
      }
    }
    setPending(null);
    setReason("");
    setAmendment(null);
    await load(pending !== "Quoted");
  };

  const act = async () => {
    setActionStage("Working…");
    setActionBusy(true);
    try {
      await performAction();
    } finally {
      setActionBusy(false);
    }
  };

  const openPrintSheet = (html: string) => {
    const popup = window.open("", "_blank", "popup,width=860,height=1000");
    if (!popup) {
      setError(
        "Your browser blocked the document window. Allow pop-ups for this local site and try again.",
      );
      return;
    }
    popup.opener = null;
    popup.document.open();
    const documentHtml = html
      .replace(
        "</head>",
        `<style id="fika-document-tools">.fika-document-tools{position:fixed;z-index:9999;top:12px;right:12px;display:flex;gap:7px;padding:7px;border:1px solid #ded8ed;border-radius:10px;background:#fff;box-shadow:0 8px 24px #180d4326;font:700 13px Arial,sans-serif}.fika-document-tools button{border:0;border-radius:7px;padding:8px 10px;background:#eeeaff;color:#24115c;cursor:pointer}.fika-document-tools button.primary{background:#4df7c2}.fika-document-tools button:hover{filter:brightness(.96)}@media print{.fika-document-tools{display:none!important}}</style></head>`,
      )
      .replace(
        "</body>",
        `<nav class="fika-document-tools" aria-label="Document actions"><button type="button" id="fika-download">Download document</button><button type="button" id="fika-share">Share</button><button type="button" class="primary" id="fika-pdf">Save as PDF</button></nav><script>(function(){const source=()=>document.documentElement.outerHTML;const download=()=>{const blob=new Blob([source()],{type:"text/html"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=document.title.replace(/[^A-Za-z0-9_-]+/g,"_")+".html";link.click();URL.revokeObjectURL(link.href)};document.getElementById("fika-download").onclick=download;document.getElementById("fika-pdf").onclick=()=>window.print();document.getElementById("fika-share").onclick=async()=>{if(!navigator.share){alert("Sharing is not available in this browser. Use Download document instead.");return}try{const file=new File([source()],document.title.replace(/[^A-Za-z0-9_-]+/g,"_")+".html",{type:"text/html"});await navigator.share({title:document.title,files:[file]})}catch(error){if(error.name!=="AbortError")alert("The document could not be shared. Use Download document instead.")}}})();</script></body>`,
      );
    popup.document.write(documentHtml);
    popup.document.close();
    const print = () => {
      popup.focus();
    };
    const images = Array.from(popup.document.images);
    if (images.length) {
      Promise.all(
        images.map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => resolve(), {
                  once: true,
                });
              }),
        ),
      ).finally(() => window.setTimeout(print, 80));
    } else {
      window.setTimeout(print, 80);
    }
  };
  const openQuote = (booking: CanonicalBooking) => {
    try {
      const current = booking.quoteState?.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId);
      if (current?.driveUrl && current.pdfStatus === "saved") window.open(current.driveUrl, "_blank", "noopener,noreferrer");
      else openPrintSheet(quoteHtml(booking));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const generateMenu = async (booking: CanonicalBooking) => {
    setMenuBusy(true);
    setError("");
    try {
      const response = await fetch("/api/menus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingId: booking.canonicalId,
          productionOrderId: productionOrders[booking.canonicalId]?.canonicalId,
          driveFolderId:
            quoteSettings?.googleMenuFolderId ||
            quoteSettings?.googleDriveFolderId,
          menuTemplateId: quoteSettings?.googleMenuTemplateId,
          actor: "menu-planning",
        }),
      });
      const body = (await response.json()) as {
        output?: MenuOutput;
        error?: { message?: string };
      };
      if (!response.ok || !body.output)
        throw Error(
          body.error?.message ||
            `The ${site.label} menu could not be generated.`,
        );
      setMenuOutputs((current) => ({
        ...current,
        [booking.canonicalId]: body.output!,
      }));
      if (body.output.google?.presentationUrl)
        window.open(
          body.output.google.presentationUrl,
          "_blank",
          "noopener,noreferrer",
        );
      else openPrintSheet(mnkMenuHtml(body.output));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setMenuBusy(false);
    }
  };
  const openMenu = (output: MenuOutput) =>
    output.google?.presentationUrl
      ? window.open(
          output.google.presentationUrl,
          "_blank",
          "noopener,noreferrer",
        )
      : openPrintSheet(mnkMenuHtml(output));
  const openRunSheetRange = () => {
    setRunSheetFrom(localDateKey(calendarWeek));
    setRunSheetTo(localDateKey(addDays(calendarWeek, 4)));
    setRunSheetError("");
    setRunSheetOpen(true);
  };
  const generateRunSheet = (event: FormEvent) => {
    event.preventDefault();
    if (!runSheetFrom || !runSheetTo || runSheetTo < runSheetFrom) {
      setRunSheetError(
        "Choose a valid date range. The end date must be on or after the start date.",
      );
      return;
    }
    const matching = bookings.filter(
      (booking) =>
        booking.service.eventDate >= runSheetFrom &&
        booking.service.eventDate <= runSheetTo,
    );
    if (!matching.length) {
      setRunSheetError(
        "No bookings found in that date range. Choose another range.",
      );
      return;
    }
    setRunSheetOpen(false);
    openPrintSheet(dailyRunSheetHtml(matching));
  };
  const openAmendment = (booking: CanonicalBooking) => {
    const order = structuredClone(booking.order);
    setAmendment({
      client: structuredClone(booking.client),
      service: structuredClone(booking.service),
      order: { ...order, items: order.items.map((item) => ({ ...item, quantity: Number(item.quantity) || 0 })) },
      notes: booking.notes || "",
      deliveryChargeRequired: booking.deliveryChargeRequired !== false,
      reason: "",
    });
  };
  const saveAmendment = async () => {
    if (!selected || !amendment) return;
    if (!amendment.reason.trim()) {
      setError("Explain why this Booking is being amended.");
      return;
    }
    const steps = [
      "Save amended booking",
      "Regenerate quote",
      "Save quote PDF",
      "Send updated order to CPU",
      "Update Logistics",
    ];
    setError("");
    setAmendmentProgress({
      status: "running",
      currentStep: 0,
      steps: steps.map((label, index) => ({ label, state: index === 0 ? "active" : "pending" })),
    });
    const setStep = (index: number, state: AmendmentProgress["steps"][number]["state"], detail?: string) => {
      setAmendmentProgress((current) => current ? {
        ...current,
        currentStep: index,
        steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, state, ...(detail ? { detail } : {}) } : step),
      } : current);
    };
    const post = async (body: Record<string, unknown>) => {
      const response = await fetch("/api/dashboard-bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await readDashboardJson(response) as { error?: { message?: string }; booking?: CanonicalBooking; productionOrder?: ProductionOrder };
      if (!response.ok) throw new Error(parsed.error?.message || "The booking workflow could not be completed.");
      return parsed;
    };
    try {
      const amended = await post({
        canonicalId: selected.canonicalId,
        expectedVersion: selected.version,
        action: "amend",
        reason: amendment.reason,
        patch: amendmentPatchDto(amendment),
      });
      if (!amended.booking) throw new Error("The amendment was saved but no updated booking was returned.");
      setSelected(amended.booking);
      setStep(0, "complete");

      setStep(1, "active");
      const quoted = await post({
        canonicalId: amended.booking.canonicalId,
        expectedVersion: amended.booking.version,
        action: "quote",
        regenerate: true,
      });
      if (!quoted.booking) throw new Error("The quote was regenerated but no updated booking was returned.");
      setSelected(quoted.booking);
      setStep(1, "complete");

      const quote = quoted.booking.quoteState?.revisions.find((revision) => revision.id === quoted.booking?.quoteState?.currentRevisionId);
      if (!quote) throw new Error("The regenerated quote revision could not be found.");
      setStep(2, "active");
      const withSavedPdf = await persistQuotePdf(quoted.booking, quote);
      setSelected(withSavedPdf);
      setStep(2, "complete");

      if (withSavedPdf.deliveryChargeRequired === false) {
        setStep(3, "complete", "No CPU hand-off is required for this site-produced booking.");
        setStep(4, "complete", "No Logistics movement is required.");
      } else {
        setStep(3, "active");
        const handoff = await post({
          canonicalId: withSavedPdf.canonicalId,
          expectedVersion: withSavedPdf.version,
          action: "production-handoff",
        });
        setStep(3, "complete");
        setStep(4, "active");
        await load(false);
        setStep(4, "complete", handoff.productionOrder ? "CPU and Logistics now use the amended date and service time." : undefined);
      }
      await load(false);
      setAmendment(null);
      setAmendmentProgress((current) => current ? { ...current, status: "complete", currentStep: steps.length - 1 } : current);
    } catch (cause) {
      const message = (cause as Error).message || "The amendment workflow could not be completed.";
      setError(message);
      setAmendmentProgress((current) => {
        if (!current) return current;
        const activeIndex = current.steps.findIndex((step) => step.state === "active");
        return {
          ...current,
          status: "error",
          error: message,
          currentStep: activeIndex >= 0 ? activeIndex : current.currentStep,
          steps: current.steps.map((step, index) => index === (activeIndex >= 0 ? activeIndex : current.currentStep) ? { ...step, state: "error", detail: message } : step),
        };
      });
    }
  };
  const saveQuoteSettings = async () => {
    if (!quoteSettings) return;
    const response = await fetch("/api/dashboard-bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save-quote-settings",
        dashboardId: quoteSettings.dashboardId,
        managementFee: quoteSettings.managementFee,
        deliveryCharge: quoteSettings.deliveryCharge,
        buildingCharges: quoteSettings.buildingCharges,
        vatRate: quoteSettings.vatRate,
        googleDriveFolderId: quoteSettings.googleDriveFolderId,
        googleMenuTemplateId: quoteSettings.googleMenuTemplateId,
        googleMenuFolderId: quoteSettings.googleMenuFolderId,
        googleQuoteFolderId: quoteSettings.googleQuoteFolderId,
        googleMatrixFolderId: quoteSettings.googleMatrixFolderId,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message || "Could not save quote settings.");
      return;
    }
    setQuoteSettings(body.quoteSettings);
    setSettingsOpen(false);
  };

  const selectedProductionOrder = selected
    ? productionOrders[selected.canonicalId]
    : undefined;
  const selectedMenuOutput = selected
    ? menuOutputs[selected.canonicalId]
    : undefined;
  const selectedMenuStale = Boolean(
    selectedMenuOutput?.planUpdatedAt &&
      selectedProductionOrder?.updatedAt &&
      selectedMenuOutput.planUpdatedAt < selectedProductionOrder.updatedAt,
  );

  return (
    <div className={styles.scope}>
      <main className={`hospitality-dashboard ${site.cssClass}`}>
        <header className="hospitality-dashboard__topbar">
          <a
            className="hospitality-dashboard__brand"
            href="/"
            aria-label="FIKA OS Hospitality home"
          >
            <strong>FIKA</strong>
            <span>OS</span>
            <i>·</i>
            <b>Hospitality</b>
          </a>
          <div>
            <small>{site.label} operational workspace</small>
            {site.key === "angel-court" && (
              <>
                <button type="button" onClick={() => void forceAngelCourtScan()} disabled={scanBusy}>
                  {scanBusy ? "Scanning inbox…" : "Scan inbox"}
                </button>
                <small>{lastInboxScan ? `Last scan ${new Date(lastInboxScan).toLocaleString("en-GB")}` : "Inbox not scanned yet"}</small>
              </>
            )}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh bookings"}
            </button>
          </div>
        </header>

        <button
          className="hospitality-dashboard__refresh-trigger"
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh bookings"
          title="Refresh bookings"
        >
          <RefreshCw aria-hidden="true" size={20} />
        </button>
        {siteKey === "angel-court" && (
          <button
            className="hospitality-dashboard__scan-trigger"
            type="button"
            onClick={() => void forceAngelCourtScan()}
            disabled={scanBusy}
            aria-label={scanBusy ? "Scanning Angel Court inbox" : "Scan Angel Court inbox"}
            title={scanBusy ? "Scanning inbox…" : "Scan inbox"}
          >
            <MailSearch aria-hidden="true" size={19} />
          </button>
        )}
        <button
          className="hospitality-dashboard__settings-trigger"
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open dashboard settings"
          title="Dashboard settings"
        >
          <Settings aria-hidden="true" size={20} />
        </button>
        {scanModalOpen && siteKey === "angel-court" && (
          <div className="modal-backdrop inbox-scan-backdrop" role="presentation">
            <section
              className="modal hospitality-action-modal inbox-scan-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="inbox-scan-title"
            >
              <p className="eyebrow">Angel Court inbox</p>
              <h2 id="inbox-scan-title">Scanning booking evidence</h2>
              <p>
                The scanner checks only messages received since the last successful
                scan, then stages new candidates for review. It does not publish or
                overwrite bookings automatically.
              </p>
              <ol className="inbox-scan-steps" aria-label="Inbox scan progress">
                {inboxScanSteps.map((step) => {
                  const currentIndex = inboxScanSteps.findIndex(({ key }) => key === scanPhase);
                  const stepIndex = inboxScanSteps.findIndex(({ key }) => key === step.key);
                  const state = scanPhase === "complete" || stepIndex < currentIndex ? "complete" : stepIndex === currentIndex ? "current" : "pending";
                  return (
                    <li className={`inbox-scan-step ${state}`} key={step.key}>
                      <span aria-hidden="true">{state === "complete" ? "✓" : stepIndex + 1}</span>
                      {step.label}
                    </li>
                  );
                })}
              </ol>
              <div className="inbox-scan-progress" aria-label="Scan progress">
                <span
                  style={{
                    width: scanProgress,
                  }}
                />
              </div>
              {scanBusy && (
                <p className="inbox-scan-live" role="status" aria-live="polite">
                  {inboxScanSteps.find(({ key }) => key === scanPhase)?.label || "Finishing scan…"}
                  <strong>{Math.floor(scanElapsed / 1000)}s</strong>
                </p>
              )}
              {scanPhase === "complete" && (
                <div className="inbox-scan-result" role="status" aria-live="polite">
                  <strong>Scan complete</strong>
                  <span>
                    {scanSummary?.attachments ?? 0} attachments inspected · {scanSummary?.imported ?? 0} new candidates staged · {scanSummary?.skipped ?? 0} already known or skipped.
                  </span>
                </div>
              )}
              {scanPhase === "error" && (
                <div className="inbox-scan-error" role="alert">
                  <strong>Scan could not be completed</strong>
                  <span>{scanError}</span>
                  <button type="button" onClick={() => void forceAngelCourtScan()}>
                    Retry scan
                  </button>
                </div>
              )}
              <footer>
                <button
                  type="button"
                  className="primary"
                  disabled={scanBusy}
                  onClick={() => setScanModalOpen(false)}
                >
                  {scanBusy ? "Scanning…" : scanPhase === "complete" ? "Done" : "Close"}
                </button>
              </footer>
            </section>
          </div>
        )}
        <section className="hospitality-dashboard__hero">
          <div>
            <p className="eyebrow">Operational overview</p>
            <h1>
              Hospitality, <em>in hand.</em>
            </h1>
            <p>
              Review every customer request, protect the commercial snapshot and
              keep the next operational action clear.
            </p>
          </div>
          <div
            className="hospitality-dashboard__metrics"
            aria-label="Booking summary"
          >
            <Metric value={newCount} label="New requests" tone="mint" />
            <Metric value={attentionCount} label="Need review" tone="violet" />
            <Metric value={readyForCpuCount} label="Ready for CPU" tone="paper" />
          </div>
        </section>

        <section className="hospitality-dashboard__workspace">
          <CalendarView
            bookings={visible}
            week={calendarWeek}
            onWeekChange={setCalendarWeek}
            onSelect={setSelected}
            selectedId={selected?.canonicalId}
          />
          <div className="hospitality-dashboard__controls">
            <div>
              <p className="eyebrow">Booking queue</p>
              <h2>Upcoming bookings</h2>
            </div>
            <div className="hospitality-dashboard__control-actions">
              <button
                type="button"
                className="hospitality-dashboard__run-sheet-trigger"
                onClick={openRunSheetRange}
              >
                Run sheet PDF
              </button>
              <label>
                Show
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="">All statuses</option>
                  {statuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {error && (
            <div className="hospitality-dashboard__error" role="alert">
              <span>{error}</span>
              {/synthetic local identity|local session expired/i.test(
                error,
              ) && (
                <button type="button" onClick={() => void signInLocally()}>
                  Sign in locally
                </button>
              )}
            </div>
          )}
          <div className="hospitality-dashboard__grid">
            <aside
              className="hospitality-dashboard__queue"
              aria-label="Booking queue"
            >
              {loading && (
                <p className="hospitality-dashboard__empty">
                  Refreshing canonical Bookings…
                </p>
              )}
              {!loading &&
                visible.map((booking) => (
                  <button
                    key={booking.canonicalId}
                    className={`booking-card ${selected?.canonicalId === booking.canonicalId ? "booking-card--selected" : ""}`}
                    onClick={() => setSelected(booking)}
                  >
                    <span className="booking-card__date">
                      {formatDate(booking.service.eventDate)}
                      <small>{booking.service.startTime}</small>
                    </span>
                    <span className="booking-card__content">
                      <strong>{booking.client.clientCompany || booking.client.companyName}</strong>
                      <small>
                        {booking.client.name} ·{" "}
                        {booking.service.portalSiteLabel || "MNK"}
                      </small>
                      <span>
                        {booking.service.guestCount} pax · £
                        {booking.order.grossTotal.toFixed(2)}
                      </span>
                    </span>
                    <StatusPill status={booking.lifecycleStatus} />
                  </button>
                ))}
              {!loading && !visible.length && (
                <p className="hospitality-dashboard__empty">
                  No canonical Bookings match this view.
                </p>
              )}
            </aside>

            <section
              className="hospitality-dashboard__detail"
              aria-live="polite"
            >
              {selected ? (
                <BookingPane
                  booking={selected}
                  siteKey={site.key}
                  siteLabel={site.label}
                  productionOrder={selectedProductionOrder}
                  menuOutput={selectedMenuOutput}
                  menuStale={selectedMenuStale}
                  menuReady={Boolean(menuReadiness[selected.canonicalId]?.available)}
                  menuReadyReason={menuReadiness[selected.canonicalId]?.reason || "Waiting for menu items and allergen information."}
                  matrixArtifact={matrixArtifacts[selected.canonicalId]}
                  menuBusy={menuBusy}
                  setPending={setPending}
                  amendment={amendment}
                  onAmend={openAmendment}
                  onChangeAmendment={setAmendment}
                  onCancelAmendment={() => setAmendment(null)}
                  onSaveAmendment={saveAmendment}
                  onOpenQuote={openQuote}
                  onGenerateMenu={generateMenu}
                  onOpenMenu={openMenu}
                />
              ) : (
                <div className="hospitality-dashboard__blank">
                  <p className="eyebrow">Ready when you are</p>
                  <h2>Select a booking</h2>
                  <p>
                    Its customer request, commercial snapshot and governed
                    operational actions will appear here.
                  </p>
                </div>
              )}
            </section>
          </div>
        </section>

        {pending && (
          <div className="modal-backdrop" role="presentation">
            <form
              className="modal hospitality-action-modal"
              onSubmit={(event) => {
                event.preventDefault();
                void act();
              }}
            >
              <p className="eyebrow">Governed workflow command</p>
              <h2>{commandTitle(pending)}</h2>
              <p>{commandHelp(pending)}</p>
              {pending === "Reviewed" && <p className="workflow-callout">Review the booking details and edit anything that needs correcting. This simply records that the manager has reviewed it; there is no separate intent checklist.</p>}
              {pending === "Cancelled" && (
                <fieldset className="workflow-checks">
                  <legend>Cancellation follow-up</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={cancelOptions.removeCalendar}
                      onChange={(event) =>
                        setCancelOptions((current) => ({
                          ...current,
                          removeCalendar: event.target.checked,
                        }))
                      }
                    />
                    Request legacy Calendar removal
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={cancelOptions.cancelProduction}
                      onChange={(event) =>
                        setCancelOptions((current) => ({
                          ...current,
                          cancelProduction: event.target.checked,
                        }))
                      }
                    />
                    Request production cancellation
                  </label>
                  <p className="workflow-help">
                    The client cancellation email is sent automatically.
                  </p>
                </fieldset>
              )}
              {pending !== "Quoted" && pending !== "Production" && pending !== "QuotePdfRetry" && (
                <label>
                  {pending === "Cancelled"
                    ? "Cancellation reason"
                    : "Operational notes (optional)"}
                  <textarea
                    autoFocus
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required={pending === "Cancelled"}
                  />
                </label>
              )}
              <footer>
                <button type="button" onClick={() => setPending(null)} disabled={actionBusy}>
                  Cancel
                </button>
                <button className="primary" disabled={actionBusy}>
                  {actionBusy && <span className={styles.spinner} aria-hidden="true" />}
                  {actionBusy
                    ? actionStage
                    : pending === "Production"
                    ? "Create production hand-off"
                    : pending === "QuotePdfRetry"
                      ? "Retry PDF save"
                    : "Confirm command"}
                </button>
              </footer>
            </form>
          </div>
        )}
        {amendmentProgress && (
          <div className="modal-backdrop" role="presentation">
            <section className={`modal ${styles.amendmentProgressModal}`} role="dialog" aria-modal="true" aria-labelledby="amendment-progress-title">
              <p className="eyebrow">Amendment workflow</p>
              <h2 id="amendment-progress-title">
                {amendmentProgress.status === "complete"
                  ? "Booking updated across FIKA OS"
                  : amendmentProgress.status === "error"
                    ? "Amendment needs attention"
                    : "Updating booking everywhere"}
              </h2>
              <p>
                {amendmentProgress.status === "complete"
                  ? "The amended quote, CPU order and Logistics timing are now aligned."
                  : "The amended booking is being reissued through the operational workflow."}
              </p>
              <div className={styles.amendmentProgressTrack} aria-hidden="true">
                <span style={{ width: `${((amendmentProgress.steps.filter((step) => step.state === "complete").length + (amendmentProgress.status === "running" ? 0.35 : 0)) / amendmentProgress.steps.length) * 100}%` }} />
              </div>
              <ol className={styles.amendmentProgressSteps}>
                {amendmentProgress.steps.map((step, index) => (
                  <li key={step.label} className={styles[`amendmentProgressStep--${step.state}`]} aria-current={step.state === "active" ? "step" : undefined}>
                    <span>{step.state === "complete" ? "✓" : step.state === "error" ? "!" : index + 1}</span>
                    <div><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</div>
                  </li>
                ))}
              </ol>
              {amendmentProgress.error && <p className={styles.amendmentProgressError} role="alert">{amendmentProgress.error}</p>}
              {amendmentProgress.status !== "running" && (
                <footer>
                  <button type="button" className="primary" onClick={() => setAmendmentProgress(null)}>
                    {amendmentProgress.status === "complete" ? "Done" : "Close and review"}
                  </button>
                </footer>
              )}
            </section>
          </div>
        )}
        {runSheetOpen && (
          <div className="modal-backdrop" role="presentation">
            <form
              className="modal hospitality-action-modal run-sheet-range-modal"
              onSubmit={generateRunSheet}
            >
              <p className="eyebrow">Operational run sheet</p>
              <h2>Choose a date range</h2>
              <p>
                Generate one scan-first PDF for the selected bookings. It
                defaults to the visible Monday-to-Friday week.
              </p>
              <div className="amendment-grid">
                <label>
                  From
                  <input
                    type="date"
                    value={runSheetFrom}
                    onChange={(event) => {
                      setRunSheetFrom(event.target.value);
                      setRunSheetError("");
                    }}
                    required
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={runSheetTo}
                    onChange={(event) => {
                      setRunSheetTo(event.target.value);
                      setRunSheetError("");
                    }}
                    required
                  />
                </label>
              </div>
              {runSheetError && (
                <p className="run-sheet-range-error" role="alert">
                  {runSheetError}
                </p>
              )}
              <p className="workflow-callout">
                {
                  bookings.filter(
                    (booking) =>
                      booking.service.eventDate >= runSheetFrom &&
                      booking.service.eventDate <= runSheetTo,
                  ).length
                }{" "}
                booking(s) in this range.
              </p>
              <footer>
                <button type="button" onClick={() => setRunSheetOpen(false)}>
                  Cancel
                </button>
                <button className="primary">Generate run sheet PDF</button>
              </footer>
            </form>
          </div>
        )}
        {settingsOpen && quoteSettings && (
          <DashboardSettingsModal
            activeTab={settingsTab}
            onTabChange={setSettingsTab}
            settings={quoteSettings}
            onChange={setQuoteSettings}
            onCancel={() => setSettingsOpen(false)}
            onSave={() => void saveQuoteSettings()}
          />
        )}
      </main>
    </div>
  );
}

function BookingPane({
  booking,
  siteKey,
  siteLabel,
  productionOrder,
  menuOutput,
  menuStale,
  menuReady,
  menuReadyReason,
  matrixArtifact,
  menuBusy,
  setPending,
  amendment,
  onAmend,
  onChangeAmendment,
  onCancelAmendment,
  onSaveAmendment,
  onOpenQuote,
  onGenerateMenu,
  onOpenMenu,
}: {
  booking: CanonicalBooking;
  siteKey: PortalSiteKey;
  siteLabel: string;
  productionOrder?: ProductionOrder;
  menuOutput?: MenuOutput;
  menuStale: boolean;
  menuReady: boolean;
  menuReadyReason: string;
  matrixArtifact?: {
    html?: string;
    localUrl?: string;
    driveUrl?: string;
    fileName: string;
    driveStatus: string;
  };
  menuBusy: boolean;
  setPending: (status: WorkflowAction) => void;
  amendment: Amendment | null;
  onAmend: (booking: CanonicalBooking) => void;
  onChangeAmendment: (value: Amendment) => void;
  onCancelAmendment: () => void;
  onSaveAmendment: () => Promise<void>;
  onOpenQuote: (booking: CanonicalBooking) => void;
  onGenerateMenu: (booking: CanonicalBooking) => Promise<void>;
  onOpenMenu: (output: MenuOutput) => void;
}) {
  if (amendment)
    return (
      <BookingAmendmentPanel
        booking={booking}
        siteKey={siteKey}
        amendment={amendment}
        onChange={onChangeAmendment}
        onCancel={onCancelAmendment}
        onSave={() => void onSaveAmendment()}
      />
    );
  return (
    <BookingDetail
      booking={booking}
      siteLabel={siteLabel}
      productionOrder={productionOrder}
      menuOutput={menuOutput}
      menuStale={menuStale}
      menuReady={menuReady}
      menuReadyReason={menuReadyReason}
      matrixArtifact={matrixArtifact}
      menuBusy={menuBusy}
      setPending={setPending}
      onAmend={onAmend}
      onOpenQuote={onOpenQuote}
      onGenerateMenu={onGenerateMenu}
      onOpenMenu={onOpenMenu}
    />
  );
}

function BookingDetail({
  booking,
  siteLabel,
  productionOrder,
  menuOutput,
  menuStale,
  menuReady,
  menuReadyReason,
  matrixArtifact,
  menuBusy,
  setPending,
  onAmend,
  onOpenQuote,
  onGenerateMenu,
  onOpenMenu,
}: {
  booking: CanonicalBooking;
  siteLabel: string;
  productionOrder?: ProductionOrder;
  menuOutput?: MenuOutput;
  menuStale: boolean;
  menuReady: boolean;
  menuReadyReason: string;
  matrixArtifact?: {
    html?: string;
    localUrl?: string;
    driveUrl?: string;
    fileName: string;
    driveStatus: string;
  };
  menuBusy: boolean;
  setPending: (status: WorkflowAction) => void;
  onAmend: (booking: CanonicalBooking) => void;
  onOpenQuote: (booking: CanonicalBooking) => void;
  onGenerateMenu: (booking: CanonicalBooking) => Promise<void>;
  onOpenMenu: (output: MenuOutput) => void;
}) {
  const location =
    booking.service.floorLevel ||
    booking.service.roomOrArea ||
    booking.service.deliveryPoint ||
    "Not supplied";
  const dietaryEntries = Object.entries(booking.dietaries).filter(
    ([, value]) => value !== 0 && value !== "" && value !== false,
  );
  return (
    <>
      <div className="booking-detail__actions">
        <button type="button" onClick={() => onAmend(booking)}>
          {["Completed", "Cancelled"].includes(booking.lifecycleStatus)
            ? "Reopen and amend booking"
            : "Edit booking"}
        </button>
        {!["Completed", "Cancelled"].includes(booking.lifecycleStatus) && (
          <button
            type="button"
            className="danger"
            onClick={() => setPending("Cancelled")}
          >
            Cancel booking
          </button>
        )}
        {availableActions(booking, productionOrder)
          .filter((action) => action !== "Production")
          .map((action) => (
            <button
              key={action}
              type="button"
              className="primary"
              onClick={() => setPending(action)}
            >
              {action === "Reviewed"
                ? "Review booking"
                : action === "Quoted"
                  ? booking.quoteState?.currentRevisionId && booking.quoteState.revisions.some((revision) => revision.id === booking.quoteState?.currentRevisionId && revision.stale)
                    ? "Regenerate quote"
                    : booking.quoteState?.currentRevisionId ? "Open quote" : "Generate quote"
                  : action === "QuotePdfRetry"
                    ? "Retry quote PDF save"
                    : action === "Completed"
                      ? "Mark complete"
                      : "Send to CPU"}
            </button>
          ))}
        {quoteReadyForCpu(booking) && !productionOrderMatchesCurrentQuote(booking, productionOrder) && booking.deliveryChargeRequired !== false && (
          <button
            type="button"
            className="primary"
            onClick={() => setPending("Production")}
          >
            Send to CPU
          </button>
        )}
      </div>
      <header className="booking-detail__header">
        <div>
          <p className="eyebrow">
            {booking.service.portalSiteLabel || "MNK"} ·{" "}
            {booking.lifecycleStatus}
          </p>
          <h2>{booking.client.clientCompany || booking.client.companyName}</h2>
          <p>
            {booking.client.name} · {booking.client.email}
          </p>
          {booking.client.invoiceReference && (
            <p className="booking-detail__reference">
              Invoice / PO · {booking.client.invoiceReference}
            </p>
          )}
        </div>
        <div className="booking-detail__header-actions">
          <StatusPill status={booking.lifecycleStatus} />
        </div>
      </header>
      <div className="booking-detail__facts">
        <Fact
          label="When"
          value={`${formatDate(booking.service.eventDate)} · ${booking.service.startTime}`}
        />
        <Fact label="Guests" value={`${booking.service.guestCount} pax`} />
        <Fact label="Where" value={location} />
        <Fact label="Request ID" value={booking.source.sourceBookingId} />
        {booking.client.invoiceReference && (
          <Fact label="Invoice / PO" value={booking.client.invoiceReference} />
        )}
        <Fact label="Produced by CPU" value={booking.deliveryChargeRequired === false ? "No" : "Yes"} />
      </div>
      <section className="booking-detail__section">
        <div className="booking-detail__section-title">
          <div>
            <p className="eyebrow">Commercial snapshot</p>
            <h3>What was requested</h3>
          </div>
          <strong>£{booking.order.grossTotal.toFixed(2)}</strong>
        </div>
        <ul className="booking-detail__items">
          {booking.order.items.map((item, index) => (
            <li key={`${item.itemId}-${index}`}>
              <span>
                <b>
                  {item.quantity} × {item.itemName || item.itemId}
                </b>
                {item.servingInfo && <small>{item.servingInfo}</small>}
              </span>
              <strong>£{item.lineTotal.toFixed(2)}</strong>
            </li>
          ))}
        </ul>
        <div className="booking-detail__total">
          <span>
            Net £{booking.order.netTotal.toFixed(2)} · VAT £
            {booking.order.vatTotal.toFixed(2)}
          </span>
          <b>Total £{booking.order.grossTotal.toFixed(2)}</b>
        </div>
      </section>
      <div className="booking-detail__split">
        <section>
          <p className="eyebrow">Dietaries</p>
          <h3>Important service notes</h3>
          {dietaryEntries.length ? (
            <ul className="booking-detail__tags">
              {dietaryEntries.map(([key, value]) => (
                <li key={key}>
                  {pretty(key)}: {String(value)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No dietary requirements recorded.</p>
          )}
          {booking.notes && (
            <p className="booking-detail__note">{booking.notes}</p>
          )}
        </section>
        <section>
          <p className="eyebrow">Manager workspace</p>
          <h3>Documents and status</h3>
          <div className="manager-status-list">
            <div>
              <span>Booking</span>
              <strong>{workflowLabel(booking.lifecycleStatus)}</strong>
            </div>
            <div>
              <span>CPU plan</span>
              <strong>{productionOrderMatchesCurrentQuote(booking, productionOrder) ? productionOrder?.state : productionOrder ? "Ready to reissue" : "Not started"}</strong>
            </div>
          </div>
          <button
            type="button"
            className="manager-cpu-action"
            disabled={Boolean(productionOrderMatchesCurrentQuote(booking, productionOrder)) || !quoteReadyForCpu(booking) || booking.deliveryChargeRequired === false}
            onClick={() => setPending("Production")}
          >
            <strong>{productionOrderMatchesCurrentQuote(booking, productionOrder) ? "Sent to CPU" : "Send to CPU"}</strong>
            <small>
              {productionOrderMatchesCurrentQuote(booking, productionOrder)
                ? "Production hand-off recorded"
                : booking.deliveryChargeRequired === false
                  ? "The site will produce this booking internally"
                  : quoteReadyForCpu(booking)
                    ? "Send this quoted booking to production"
                    : "Available after the quote PDF is saved to Drive"}
            </small>
          </button>
          <div className="manager-document-actions">
            <button
              type="button"
              className="manager-document-action"
              disabled={!booking.quoteState?.currentRevisionId}
              onClick={() => onOpenQuote(booking)}
            >
              <strong>Open quote</strong>
              <small>
                {booking.quoteState?.currentRevisionId
                  ? booking.quoteState.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId)?.pdfStatus === "saved"
                    ? "Current quote PDF in Drive"
                    : "PDF persistence required before CPU hand-off"
                  : "Quote not generated"}
              </small>
            </button>
            {matrixArtifact?.driveUrl || matrixArtifact?.localUrl ? (
              <a
                className="manager-document-action"
                href={matrixArtifact.driveUrl || matrixArtifact.localUrl}
                target="_blank"
                rel="noreferrer"
              >
                <strong>Open allergen matrix</strong>
                <small>
                  {matrixArtifact.driveUrl
                    ? "Signed PDF in site Drive"
                    : "Local signed PDF"}
                </small>
              </a>
            ) : (
              <button
                type="button"
                className="manager-document-action"
                disabled
              >
                <strong>Open allergen matrix</strong>
                <small>Available after signing</small>
              </button>
            )}
            {menuOutput ? (
              <>
                <button
                  type="button"
                  className="manager-document-action"
                  onClick={() => onOpenMenu(menuOutput)}
                >
                  <strong>Open menu</strong>
                  <small>{menuStale ? "Open the previous generated menu" : `${siteLabel} menu`}</small>
                </button>
                <button
                  type="button"
                  className="manager-document-action"
                  onClick={() => void onGenerateMenu(booking)}
                  disabled={menuBusy || !menuReady}
                >
                  <strong>Regenerate menu</strong>
                  <small>
                    {menuStale
                      ? "Allergen or production details have changed"
                    : menuReadyReason}
                  </small>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="manager-document-action"
                onClick={() => void onGenerateMenu(booking)}
                disabled={menuBusy || !menuReady}
              >
                <strong>Generate menu</strong>
                <small>{menuReady ? "Generate from the Planned CPU revision" : menuReadyReason}</small>
              </button>
            )}
          </div>
          <div className="menu-output-actions manager-legacy-output">
            <p className="output-block__label">Hospitality menu</p>
            <p className="workflow-callout">
              {menuOutput && !menuStale
                ? `${siteLabel} menu generated from the planned CPU revision.`
                : menuOutput
                  ? "The CPU allergen or production revision changed. Regenerate the menu before service."
                : "Generate this menu after the production team marks the CPU plan Planned."}
            </p>
            {menuOutput && !menuStale ? (
              <>
                <button type="button" onClick={() => onOpenMenu(menuOutput)}>
                  Open menu
                </button>
                <button
                  type="button"
                  onClick={() => void onGenerateMenu(booking)}
                  disabled={menuBusy || !menuReady}
                >
                  {menuBusy ? "Regenerating…" : "Regenerate menu"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void onGenerateMenu(booking)}
                disabled={menuBusy || !menuReady}
              >
                {menuBusy ? "Generating…" : menuOutput ? `Regenerate ${siteLabel} menu` : `Generate ${siteLabel} menu`}
              </button>
            )}
          </div>
          {matrixArtifact && (
            <div className="menu-output-actions manager-legacy-output">
              <p className="output-block__label">Signed allergen checker</p>
              <p
                className={`workflow-callout workflow-reference workflow-reference--${matrixArtifact.driveStatus}`}
              >
                Allergen matrix:{" "}
                {matrixArtifact.driveStatus === "saved"
                  ? "saved to the site Google Drive."
                  : "available locally; Drive needs attention."}
              </p>
              <div className="output-block__links">
                {matrixArtifact.driveUrl && (
                  <a
                    className="button"
                    href={matrixArtifact.driveUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Drive PDF
                  </a>
                )}
                {!matrixArtifact.driveUrl && matrixArtifact.localUrl && (
                  <a
                    className="button"
                    href={matrixArtifact.localUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open local PDF
                  </a>
                )}
                {!matrixArtifact.driveUrl && matrixArtifact.html && (
                  <button
                    type="button"
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([matrixArtifact.html!], { type: "text/html" }),
                      );
                      window.open(url, "_blank", "noopener,noreferrer");
                      setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    }}
                  >
                    Open local matrix
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      <details className="booking-detail__audit">
        <summary>Submitted intent and audit history</summary>
        <pre>
          {JSON.stringify(
            {
              source: booking.source,
              statusHistory: booking.statusHistory,
              audit: booking.audit,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </>
  );
}

function CalendarView({
  bookings,
  week,
  onWeekChange,
  onSelect,
  selectedId,
}: {
  bookings: CanonicalBooking[];
  week: Date;
  onWeekChange: (week: Date) => void;
  onSelect: (booking: CanonicalBooking) => void;
  selectedId?: string;
}) {
  const days = Array.from(
    { length: 5 },
    (_, index) =>
      new Date(week.getFullYear(), week.getMonth(), week.getDate() + index),
  );
  const byDate = new Map<string, CanonicalBooking[]>();
  bookings.forEach((booking) => {
    const entries = byDate.get(booking.service.eventDate) || [];
    entries.push(booking);
    byDate.set(booking.service.eventDate, entries);
  });
  return (
    <section
      className="hospitality-calendar"
      aria-label="Monday to Friday booking schedule"
    >
      <header>
        <div>
          <p className="eyebrow">Week ahead</p>
          <h3>
            {week.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}{" "}
            –{" "}
            {days[4].toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </h3>
          <p className="hospitality-calendar__hint">
            Select a booking for the full operational panel.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={() =>
              onWeekChange(
                new Date(
                  week.getFullYear(),
                  week.getMonth(),
                  week.getDate() - 7,
                ),
              )
            }
          >
            Previous week
          </button>
          <button
            type="button"
            onClick={() => onWeekChange(mondayOf(new Date()))}
          >
            This week
          </button>
          <button
            type="button"
            onClick={() =>
              onWeekChange(
                new Date(
                  week.getFullYear(),
                  week.getMonth(),
                  week.getDate() + 7,
                ),
              )
            }
          >
            Next week
          </button>
        </div>
      </header>
      <div className="hospitality-calendar__weekdays">
        {days.map((day) => (
          <span key={day.toISOString()}>
            {day.toLocaleDateString("en-GB", { weekday: "short" })}
            <b>
              {day.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
            </b>
          </span>
        ))}
      </div>
      <div className="hospitality-calendar__grid">
        {days.map((date) => {
          const key = localDateKey(date);
          const dailyBookings = (byDate.get(key) || []).sort((left, right) =>
            left.service.startTime.localeCompare(right.service.startTime),
          );
          return (
            <div className="calendar-day" key={key}>
              {dailyBookings.map((booking) => {
                const dietaryCount = Object.entries(
                  booking.dietaries || {},
                ).filter(
                  ([, value]) => value !== 0 && value !== "" && value !== false,
                ).length;
                return (
                  <button
                    className={
                      selectedId === booking.canonicalId
                        ? "calendar-booking calendar-booking--selected"
                        : "calendar-booking"
                    }
                    type="button"
                    key={booking.canonicalId}
                    onClick={() => onSelect(booking)}
                  >
                    <span>
                      {booking.service.startTime} · {booking.service.guestCount}{" "}
                      pax
                    </span>
                    <strong>{booking.client.clientCompany || booking.client.companyName}</strong>
                    <small>
                      {booking.service.roomOrArea ||
                        booking.service.floorLevel ||
                        booking.service.deliveryPoint ||
                        "Location TBC"}
                    </small>
                    <small>
                      {booking.order.eventType || "Hospitality"} ·{" "}
                      {booking.lifecycleStatus}
                      {dietaryCount
                        ? ` · ${dietaryCount} dietary note${dietaryCount === 1 ? "" : "s"}`
                        : ""}
                    </small>
                  </button>
                );
              })}
              {!dailyBookings.length && (
                <p className="calendar-day__empty">No bookings</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <div className={`metric metric--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function AmendmentModal({
  amendment,
  onChange,
  onCancel,
  onSave,
}: {
  amendment: Amendment;
  onChange: (value: Amendment) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const changeClient = (key: keyof Amendment["client"], value: string) => {
    const client = { ...amendment.client, [key]: value };
    const requesterKey = {
      name: "name",
      email: "email",
      phone: "phone",
      companyName: "companyName",
    }[key as string] as "name" | "email" | "phone" | "companyName" | undefined;
    if (requesterKey) {
      client.requester = {
        name: client.requester?.name || client.name,
        email: client.requester?.email || client.email,
        phone: client.requester?.phone || client.phone,
        companyName: client.requester?.companyName || client.companyName,
        [requesterKey]: value,
      };
    }
    onChange({ ...amendment, client });
  };
  const changeService = (
    key: keyof Amendment["service"],
    value: string | number,
  ) =>
    onChange({ ...amendment, service: { ...amendment.service, [key]: value } });
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal hospitality-action-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <p className="eyebrow">Governed Booking amendment</p>
        <h2>Edit customer request</h2>
        <p>
          Saving retains the submitted intent and marks any current quote stale.
          The amended Booking returns to review before a new current quote can be sent to CPU.
        </p>
        <div className="amendment-grid">
          <p className="field-group-label wide">Requester details</p>
          <label>
            Your name
            <input
              required
              value={amendment.client.requester?.name || amendment.client.name}
              onChange={(event) =>
                changeClient("name", event.target.value)
              }
            />
          </label>
          <label>
            Work email
            <input
              required
              type="email"
              value={amendment.client.requester?.email || amendment.client.email}
              onChange={(event) => changeClient("email", event.target.value)}
            />
          </label>
          <label>
            Contact number
            <input
              value={amendment.client.requester?.phone || amendment.client.phone || ""}
              onChange={(event) => changeClient("phone", event.target.value)}
            />
          </label>
          <label>
            Your company
            <input
              required
              value={amendment.client.requester?.companyName || amendment.client.companyName}
              onChange={(event) => changeClient("companyName", event.target.value)}
            />
          </label>
          <p className="field-group-label wide">Who is the booking for?</p>
          <label>
            Client name
            <input required value={amendment.client.clientName || amendment.client.name} onChange={(event) => changeClient("clientName", event.target.value)} />
          </label>
          <label>
            Client company
            <input required value={amendment.client.clientCompany || amendment.client.companyName} onChange={(event) => changeClient("clientCompany", event.target.value)} />
          </label>
          <label className="wide">
            Invoice / PO reference <small>(optional)</small>
            <input value={amendment.client.invoiceReference || ""} onChange={(event) => changeClient("invoiceReference", event.target.value)} />
          </label>
          <label>
            Service date
            <input
              required
              type="date"
              value={amendment.service.eventDate}
              onChange={(event) =>
                changeService("eventDate", event.target.value)
              }
            />
          </label>
          <label>
            Service time
            <input
              required
              type="time"
              value={amendment.service.startTime}
              onChange={(event) =>
                changeService("startTime", event.target.value)
              }
            />
          </label>
          <label>
            Guests
            <input
              required
              type="number"
              min="1"
              value={amendment.service.guestCount}
              onChange={(event) =>
                changeService("guestCount", Number(event.target.value || 0))
              }
            />
          </label>
          <label>
            Floor, room or delivery point
            <input
              value={
                amendment.service.roomOrArea ||
                amendment.service.floorLevel ||
                amendment.service.deliveryPoint ||
                ""
              }
              onChange={(event) =>
                changeService("roomOrArea", event.target.value)
              }
            />
          </label>
        </div>
        <label className="workflow-checks">
          <input
            type="checkbox"
            checked={amendment.deliveryChargeRequired}
            onChange={(event) =>
              onChange({
                ...amendment,
                deliveryChargeRequired: event.target.checked,
              })
            }
          />
            Produced by CPU (No means the site will produce this booking internally)
        </label>
        <label>
          Operational notes
          <textarea
            value={amendment.notes}
            onChange={(event) =>
              onChange({ ...amendment, notes: event.target.value })
            }
          />
        </label>
        <label>
          Reason for amendment
          <textarea
            required
            autoFocus
            value={amendment.reason}
            onChange={(event) =>
              onChange({ ...amendment, reason: event.target.value })
            }
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary">Save amendment</button>
        </footer>
      </form>
    </div>
  );
}
function QuoteSettingsModal({
  settings,
  onChange,
  onCancel,
  onSave,
}: {
  settings: DashboardQuoteSettings;
  onChange: (value: DashboardQuoteSettings) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal hospitality-action-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <p className="eyebrow">Dashboard commercial settings</p>
        <h2>MNK quote policy</h2>
        <p>
          These settings belong to this dashboard only. They are captured in
          each generated quote revision.
        </p>
        <label>
          Management fee mode
          <select
            value={settings.managementFee.mode}
            onChange={(event) =>
              onChange({
                ...settings,
                managementFee: {
                  ...settings.managementFee,
                  mode: event.target.value as "fixed" | "percentage",
                },
              })
            }
          >
            <option value="fixed">Fixed amount (£)</option>
            <option value="percentage">Percentage (%)</option>
          </select>
        </label>
        <label>
          Management fee{" "}
          {settings.managementFee.mode === "percentage" ? "(%)" : "(£ net)"}
          <input
            type="number"
            min="0"
            step="0.01"
            value={settings.managementFee.value}
            onChange={(event) =>
              onChange({
                ...settings,
                managementFee: {
                  ...settings.managementFee,
                  value: Number(event.target.value || 0),
                },
              })
            }
          />
        </label>
        <label>
          Management fee label
          <input
            value={settings.managementFee.label}
            onChange={(event) =>
              onChange({
                ...settings,
                managementFee: {
                  ...settings.managementFee,
                  label: event.target.value,
                },
              })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.deliveryCharge.enabled}
            onChange={(event) =>
              onChange({
                ...settings,
                deliveryCharge: {
                  ...settings.deliveryCharge,
                  enabled: event.target.checked,
                },
              })
            }
          />
          Allow per-booking delivery charge
        </label>
        <label>
          Delivery charge (£ net)
          <input
            type="number"
            min="0"
            step="0.01"
            value={settings.deliveryCharge.amount}
            onChange={(event) =>
              onChange({
                ...settings,
                deliveryCharge: {
                  ...settings.deliveryCharge,
                  amount: Number(event.target.value || 0),
                },
              })
            }
          />
        </label>
        <label>
          VAT rate (%)
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={settings.vatRate * 100}
            onChange={(event) =>
              onChange({
                ...settings,
                vatRate: Number(event.target.value || 0) / 100,
              })
            }
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary">Save quote settings</button>
        </footer>
      </form>
    </div>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}
function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`booking-status booking-status--${status.toLowerCase()}`}>
      {workflowLabel(status)}
    </span>
  );
}
function workflowLabel(status: Status) {
  return status === "Approved" ? "Ready for CPU" : status;
}
function pretty(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}
function availableActions(booking: CanonicalBooking, productionOrder?: ProductionOrder): WorkflowAction[] {
  if (booking.lifecycleStatus === "New") return ["Reviewed"];
  if (booking.lifecycleStatus === "Reviewed") return ["Quoted"];
  if (["Quoted", "Approved"].includes(booking.lifecycleStatus)) {
    const current = booking.quoteState?.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId);
    if (current?.stale) return ["Quoted"];
    if (current && current.pdfStatus !== "saved") return ["QuotePdfRetry"];
    if (productionOrderMatchesCurrentQuote(booking, productionOrder) || booking.deliveryChargeRequired === false) return ["Completed"];
    return ["Production"];
  }
  if (booking.lifecycleStatus === "Sent to CPU" && productionOrder) return ["Completed"];
  return [];
}
function productionOrderMatchesCurrentQuote(booking: CanonicalBooking, productionOrder?: ProductionOrder) {
  const currentRevisionId = booking.quoteState?.currentRevisionId;
  return Boolean(productionOrder && currentRevisionId && productionOrder.sourceReferences.quoteRevisionId === currentRevisionId);
}

function quoteReadyForCpu(booking: CanonicalBooking) {
  const current = booking.quoteState?.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId);
  return ["Quoted", "Approved"].includes(booking.lifecycleStatus) && Boolean(current && !current.stale && current.pdfStatus === "saved" && current.driveFileId);
}
function commandTitle(action: WorkflowAction) {
  return (
    {
      Reviewed: "Confirm manager review",
      Quoted: "Generate quote",
      Production: "Send to CPU",
      Completed: "Record completion",
      Cancelled: "Cancel Booking",
    } as Partial<Record<WorkflowAction, string>>
  )[action];
}
function commandHelp(action: WorkflowAction) {
  return (
    {
      Reviewed:
        "Confirm the booking details before generating its current quote.",
      Quoted:
        "Creates a new immutable commercial snapshot revision. Existing revisions remain auditable.",
      QuotePdfRetry:
        "Retry saving the current immutable quote PDF to Drive without creating a new commercial revision.",
      Production:
        "Sends the current quote and booking snapshot to the CPU production dashboard.",
      Completed:
        "Record that the operational service is complete, retaining notes and actor evidence.",
      Cancelled:
        "Retains the Booking and its history. Requested external follow-up stays visible as not configured until an adapter exists.",
    } as Partial<Record<WorkflowAction, string>>
  )[action];
}
function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}
function mondayOf(value: Date) {
  const output = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  );
  output.setDate(output.getDate() - ((output.getDay() + 6) % 7));
  return output;
}
function addDays(value: Date, days: number) {
  const output = new Date(value);
  output.setDate(output.getDate() + days);
  return output;
}
function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function BookingAmendmentPanel({
  siteKey,
  booking,
  amendment,
  onChange,
  onCancel,
  onSave,
}: {
  siteKey: PortalSiteKey;
  booking: CanonicalBooking;
  amendment: Amendment;
  onChange: (value: Amendment) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const changeClient = (key: keyof Amendment["client"], value: string) =>
    onChange({ ...amendment, client: { ...amendment.client, [key]: value } });
  const changeService = (
    key: keyof Amendment["service"],
    value: string | number,
  ) =>
    onChange({ ...amendment, service: { ...amendment.service, [key]: value } });
  const changeQuantity = (index: number, quantity: number) =>
    onChange({
      ...amendment,
      order: {
        ...amendment.order,
        items: amendment.order.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, quantity: /rice paper rolls?/i.test(String(item.itemName || "")) && quantity > 0 ? Math.max(3, quantity) : quantity } : item,
        ),
      },
    });
  return (
    <form
      className="booking-amendment-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <header className="booking-detail__header">
        <div>
          <p className="eyebrow">Governed Booking amendment</p>
          <h2>Amend {booking.client.clientCompany || booking.client.companyName}</h2>
          <p>
            Original request remains in the audit trail. This change reopens the
            Booking for review and a replacement quote.
          </p>
        </div>
        <button type="button" onClick={onCancel}>
          Back to booking
        </button>
      </header>
      <section className="booking-amendment-panel__section">
        <p className="eyebrow">Customer and service</p>
        <div className="amendment-grid">
          <label>
            {siteKey === "angel-court" ? "Client company" : "Company"}
            <input
              required
              value={amendment.client.companyName}
              onChange={(event) =>
                changeClient("companyName", event.target.value)
              }
            />
          </label>
          <label>
            {siteKey === "angel-court" ? "Client name" : "Host name"}
            <input
              required
              value={amendment.client.name}
              onChange={(event) => changeClient("name", event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={amendment.client.email}
              onChange={(event) => changeClient("email", event.target.value)}
            />
          </label>
          <label>
            Phone
            <input
              value={amendment.client.phone || ""}
              onChange={(event) => changeClient("phone", event.target.value)}
            />
          </label>
          {siteKey === "angel-court" && (
            <label className="wide">
              Invoice / PO reference <small>(optional)</small>
              <input
                value={amendment.client.invoiceReference || ""}
                onChange={(event) =>
                  changeClient("invoiceReference", event.target.value)
                }
                placeholder="Add a client invoice or purchase order reference"
              />
            </label>
          )}
          <label>
            Service date
            <input
              required
              type="date"
              value={amendment.service.eventDate}
              onChange={(event) =>
                changeService("eventDate", event.target.value)
              }
            />
          </label>
          <label>
            Service time
            <input
              required
              type="time"
              value={amendment.service.startTime}
              onChange={(event) =>
                changeService("startTime", event.target.value)
              }
            />
          </label>
          <label>
            Guests
            <input
              required
              type="number"
              min="1"
              value={amendment.service.guestCount}
              onChange={(event) =>
                changeService("guestCount", Number(event.target.value || 0))
              }
            />
          </label>
          <label>
            Floor, room or delivery point
            <input
              value={
                amendment.service.roomOrArea ||
                amendment.service.floorLevel ||
                amendment.service.deliveryPoint ||
                ""
              }
              onChange={(event) =>
                changeService("roomOrArea", event.target.value)
              }
            />
          </label>
        </div>
      </section>
      <section className="booking-amendment-panel__section">
        <p className="eyebrow">Service order</p>
        <p className="amendment-help">
          Change quantities or set a line to zero to remove it. Prices remain
          the submitted commercial evidence; adding new menu lines is a separate
          controlled catalogue action.
        </p>
        <div className="amendment-lines">
          {amendment.order.items.map((item, index) => (
            <div className="amendment-line" key={`${item.itemId}-${index}`}>
              <span>
                <b>{item.itemName || item.itemId}</b>
                <small>£{item.unitPrice.toFixed(2)} each</small>
              </span>
              <label>
                Quantity
                <input
                  type="number"
                  min={/rice paper rolls?/i.test(String(item.itemName || "")) ? 3 : 0}
                  value={item.quantity}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) =>
                    changeQuantity(
                      index,
                      Number(event.target.value.replace(/^0+(?=\d)/, "") || 0),
                    )
                  }
                />
              </label>
              <strong>£{(item.unitPrice * item.quantity).toFixed(2)}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="booking-amendment-panel__section">
        <p className="eyebrow">Commercial and operational notes</p>
        <label className="booking-amendment-panel__check">
          <input
            type="checkbox"
            checked={amendment.deliveryChargeRequired}
            onChange={(event) =>
              onChange({
                ...amendment,
                deliveryChargeRequired: event.target.checked,
              })
            }
          />
            Produced by CPU (No means the site will produce this booking internally)
        </label>
        <label>
          Operational notes
          <textarea
            value={amendment.notes}
            onChange={(event) =>
              onChange({ ...amendment, notes: event.target.value })
            }
          />
        </label>
        <label>
          Reason for amendment
          <textarea
            required
            autoFocus
            value={amendment.reason}
            onChange={(event) =>
              onChange({ ...amendment, reason: event.target.value })
            }
          />
        </label>
      </section>
      <footer className="booking-amendment-panel__footer">
        <button type="button" onClick={onCancel}>
          Discard changes
        </button>
        <button className="primary">Save amendment and reopen review</button>
      </footer>
    </form>
  );
}

function DashboardSettingsModal({
  activeTab,
  onTabChange,
  settings,
  onChange,
  onCancel,
  onSave,
}: {
  activeTab: "quotes" | "drive";
  onTabChange: (tab: "quotes" | "drive") => void;
  settings: DashboardQuoteSettings;
  onChange: (value: DashboardQuoteSettings) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal hospitality-action-modal hospitality-settings-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <p className="eyebrow">Dashboard settings</p>
        <h2>MNK Hospitality</h2>
        <nav className="settings-tabs" aria-label="Settings sections">
          <button
            className={activeTab === "quotes" ? "active" : ""}
            type="button"
            onClick={() => onTabChange("quotes")}
          >
            Quote settings
          </button>
          <button
            className={activeTab === "drive" ? "active" : ""}
            type="button"
            onClick={() => onTabChange("drive")}
          >
            Google Drive
          </button>
        </nav>
        {activeTab === "quotes" ? (
          <section className="settings-tab-panel">
            <p>
              Commercial rules for this dashboard only. Each generated quote
              stores the policy used at the time.
            </p>
            <label>
              Management fee mode
              <select
                value={settings.managementFee.mode}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    managementFee: {
                      ...settings.managementFee,
                      mode: event.target.value as "fixed" | "percentage",
                    },
                  })
                }
              >
                <option value="fixed">Fixed amount (£)</option>
                <option value="percentage">Percentage (%)</option>
              </select>
            </label>
            <label>
              Management fee{" "}
              {settings.managementFee.mode === "percentage" ? "(%)" : "(£ net)"}
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.managementFee.value}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    managementFee: {
                      ...settings.managementFee,
                      value: Number(event.target.value || 0),
                    },
                  })
                }
              />
            </label>
            <label>
              Management fee label
              <input
                value={settings.managementFee.label}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    managementFee: {
                      ...settings.managementFee,
                      label: event.target.value,
                    },
                  })
                }
              />
            </label>
            <label>
              Delivery charge (£ net)
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.deliveryCharge.amount}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    deliveryCharge: {
                      ...settings.deliveryCharge,
                      amount: Number(event.target.value || 0),
                    },
                  })
                }
              />
            </label>
            <label>
              VAT rate (%)
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={settings.vatRate * 100}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    vatRate: Number(event.target.value || 0) / 100,
                  })
                }
              />
            </label>
          </section>
        ) : (
          <section className="settings-tab-panel">
            <p>
              Site output settings. Folder and template IDs are safe references
              only; OAuth credentials remain on the server.
            </p>
            <label>
              Generated hospitality menus folder ID
              <input
                value={settings.googleMenuFolderId || ""}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    googleMenuFolderId: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Generated quotes folder ID
              <input
                value={settings.googleQuoteFolderId || ""}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    googleQuoteFolderId: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Allergen checker folder ID
              <input
                value={settings.googleMatrixFolderId || ""}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    googleMatrixFolderId: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Site Google Drive folder ID
              <input
                value={settings.googleDriveFolderId || ""}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    googleDriveFolderId: event.target.value,
                  })
                }
                placeholder="1AbC…"
              />
            </label>
            <label>
              Google Slides menu template ID
              <input
                value={settings.googleMenuTemplateId || ""}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    googleMenuTemplateId: event.target.value,
                  })
                }
                placeholder="1AbC…"
              />
            </label>
            <p className="muted">
              Generated menus and allergen matrices use the configured site
              folder. Existing environment settings remain the fallback.
            </p>
          </section>
        )}
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary">Save quote settings</button>
        </footer>
      </form>
    </div>
  );
}
