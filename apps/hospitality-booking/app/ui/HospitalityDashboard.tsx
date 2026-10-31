"use client";

import { BookingDatePicker, useBookingClock } from "./BookingDatePicker";
import { loadHospitalityPortalMenu } from "../../lib/hospitality-portal-catalogue";
import type { PortalMenuItem } from "../../lib/mnk-contract";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FormEvent, ReactNode } from "react";
import { MailSearch, RefreshCw, Settings } from "lucide-react";
import type { BookingAdditionalChargeInput, CanonicalBooking, ProductionOrder, DashboardQuoteSettings, LabourRateSetting } from "@/lib/canonical-types";
import { dailyRunSheetHtml } from "../../lib/run-sheet";
import { bookingRequestedItems } from "../../lib/booking-presentation";
import { bookingLocation } from "../../lib/booking-location";
import { quoteHtml } from "../../lib/quote-document";
import { fetchQuoteRequest } from "../../lib/quote-request";
import { amendmentPatchDto } from "../../lib/amendment-dto";
import { mnkMenuHtml } from "../../lib/mnk-menu-output";
import type { MenuOutput } from "../../lib/mnk-menu-output";
import styles from "./HospitalityDashboard.module.css";
import { HospitalityGroupDetail } from "./HospitalityGroupDetail";
import { BookingProductionPanel } from "./BookingProductionPanel";
import panelStyles from "./BookingProductionPanel.module.css";
import { isBookingQuoteStale, planServiceProduction, standaloneStatusLabel, productionOrderMatchesCurrentQuote, quoteReadyForCpu, serviceCpuRequirement, sendPendingServices, type ServiceProductionRow, type ServiceResult } from "../../lib/cpu-production-plan";
import { RequestedItemsList } from "./RequestedItemsList";
import { AdditionalChargesModal } from "./AdditionalChargesModal";
import { CancellationStatusPanel } from "./CancellationStatusPanel";
import { cancellationView, propagationOutcome, type PropagationOutcome } from "../../lib/cancellation-status";
import type { HospitalityBookingGroup } from "../../../shared/hospitality-group-quotes";
import { hospitalitySiteThemeStyle, portalSite, type PortalSiteKey } from "@/lib/portal-sites";
import { hospitalityWorkspacePath } from "@/lib/hospitality-workspace";
import { DashboardQueueFilters } from "./DashboardQueueFilters";
import { availableStatuses, emptyQueueFilters, filterQueue, hasActiveFilters, type QueueFilters } from "../../lib/dashboard-queue-filters";

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
const defaultLabourRates: LabourRateSetting[] = [
  { id: "chef", label: "Chef" },
  { id: "foh-assistant", label: "FOH Assistant" },
  { id: "kp", label: "KP" },
];

async function readDashboardJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`The booking update returned an unexpected server response (${response.status}). Please try again.`);
  }
}

function quoteFilename(bookingId: string, companyName: string, extension: "pdf" | "html") {
  // Keep one stable Drive filename per booking. Drive persistence updates the
  // existing file, so an amendment replaces the current quote instead of
  // creating confusing revision copies.
  return `Quote_${companyName}_${bookingId}.${extension}`
    .replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function saveQuoteDocument(payload: { name: string; html: string; canonicalId: string }) {
  let lastMessage = "The quote PDF could not be saved to Drive.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchQuoteRequest("/api/quotes/drive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, "Quote PDF saving timed out. The dashboard remains available; use Retry quote generation once the Drive service is responding.");
    const body = await readDashboardJson(response) as { error?: { message?: string }; saved?: { fileId?: string; driveUrl?: string } };
    if (response.ok && body.saved?.fileId) return body.saved;
    lastMessage = body.error?.message || lastMessage;
    if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw new Error(lastMessage);
}

export default function HospitalityDashboard({
  siteKey,
  oplocId,
  siteLabel,
}: {
  siteKey: PortalSiteKey;
  oplocId: string;
  siteLabel: string;
}) {
  const site = portalSite(siteKey);
  const currentSiteLabel = siteLabel.trim() || site.theme.shortLabel;
  const themeStyle = hospitalitySiteThemeStyle(site) as CSSProperties;
  const [bookings, setBookings] = useState<CanonicalBooking[]>([]);
  const [groups, setGroups] = useState<HospitalityBookingGroup[]>([]);
  const [standaloneIds, setStandaloneIds] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const selectedGroup = groups.find(group => group.id === selectedGroupId);
  const selectBooking = (booking: CanonicalBooking) => { setSelectedGroupId(null); setSelected(booking); };
  const selectGroup = (group: HospitalityBookingGroup) => { setSelectedGroupId(group.id); setSelected(null); setAmendment(null); };
  const [productionOrders, setProductionOrders] = useState<
    Record<string, ProductionOrder | undefined>
  >({});
  const [selected, setSelected] = useState<CanonicalBooking | null>(null);
  const [queueFilters, setQueueFilters] = useState<QueueFilters>(emptyQueueFilters);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionInFlight = useRef(false);
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
  const [additionalChargeBusy, setAdditionalChargeBusy] = useState(false);
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
          viewUrl?: string;
          fileName: string;
          driveStatus: string;
          status?: "checking" | "generating" | "ready" | "not_configured" | "failed" | "error";
          error?: string;
        }
      | undefined
    >
  >({});
  const [matrixRefreshTick, setMatrixRefreshTick] = useState(0);
  const [serviceResults, setServiceResults] = useState<Record<string, ServiceResult | undefined>>({});
  // Menu outputs change only when a menu is regenerated. Avoid rereading the
  // whole output collection on every dashboard refresh.
  const menuCacheLoadedAt = useRef(0);

  const load = async (clearError = true) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/dashboard-bookings?site=${encodeURIComponent(site.key)}${oplocId ? `&oploc=${encodeURIComponent(oplocId)}` : ""}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok)
        throw Error(body.error?.message || "Could not load Bookings.");
      setBookings(body.cpuRouting ? body.bookings.map((item: CanonicalBooking) => body.cpuRouting[item.canonicalId] ? { ...item, cpuRouting: body.cpuRouting[item.canonicalId] } : item) : body.bookings);
      setGroups(body.bookingGroups || []);
      setStandaloneIds(new Set((body.dashboardBookings || body.bookings).map((item: CanonicalBooking) => item.canonicalId)));
      if (body.groupWarnings?.length) setNotice(body.groupWarnings.map((w: { message: string }) => w.message).join(" "));
      setProductionOrders(body.productionOrders || {});
      setMatrixRefreshTick((current) => current + 1);
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

  // Booking-level production: one grouped booking (or one single booking) is planned from each service's own items and governed routing.
  const productionRows: ServiceProductionRow[] = selectedGroup
    ? selectedGroup.services.flatMap(service => {
        const child = bookings.find(b => b.canonicalId === service.bookingId);
        if (!child) return [];
        const withRouting = child.cpuRouting || !service.routing ? child : { ...child, cpuRouting: service.routing as CanonicalBooking["cpuRouting"] };
        return [planServiceProduction(withRouting, productionOrders[service.bookingId], `${service.time} · ${service.serviceType.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase())}`, serviceResults)];
      })
    : selected ? [planServiceProduction(selected, productionOrders[selected.canonicalId], `${selected.service.startTime} · ${selected.order.eventType?.replaceAll("_", " ") || "Booking"}`, serviceResults)] : [];
  // Allergen matrices and menus are per CPU-producing service (domain relationship unchanged); a group looks up only those, never No CPU services.
  const documentTargets = selectedGroup
    ? productionRows.filter(row => row.requirement === "cpu" && row.hasProductionOrder).flatMap(row => bookings.find(b => b.canonicalId === row.bookingId) || [])
    : selected && productionRows.some(row => row.requirement === "cpu" && row.hasProductionOrder) ? [selected] : [];
  const documentTargetKey = documentTargets.map(b => `${b.canonicalId}:${b.version}:${productionOrders[b.canonicalId]?.canonicalId}:${productionOrders[b.canonicalId]?.version}:${productionOrders[b.canonicalId]?.updatedAt}`).join("|");

  useEffect(() => {
    let cancelled = false;
    for (const target of documentTargets) {
    const bookingId = target.canonicalId;
    const productionOrder = productionOrders[bookingId];
    const productionOrderId = productionOrder?.canonicalId;
    const setMatrixState = (state: { status: "checking" | "generating" | "ready" | "not_configured" | "failed" | "error"; driveStatus: string; error?: string; artifact?: Record<string, unknown> }) => {
      if (cancelled) return;
      setMatrixArtifacts((current) => ({
        ...current,
        [bookingId]: {
          ...(state.artifact || {}),
          fileName: typeof state.artifact?.fileName === "string" ? state.artifact.fileName : "",
          driveStatus: state.driveStatus,
          status: state.status,
          ...(state.error ? { error: state.error } : { error: undefined }),
        },
      }));
    };
    // A lookup in progress is not a signed-PDF generation: only the server reporting `generating` (both signatures present) says that.
    setMatrixState({ status: "checking", driveStatus: "checking" });
    void fetch(
      `/api/allergen-matrix?bookingId=${encodeURIComponent(bookingId)}${productionOrderId ? `&productionOrderId=${encodeURIComponent(productionOrderId)}` : ""}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const body = await readDashboardJson(response) as { artifact?: Record<string, unknown>; status?: "checking" | "generating" | "ready" | "not_configured" | "failed" | "error"; error?: string | { message?: string } };
        if (!response.ok) throw Error(typeof body.error === "string" ? body.error : body.error?.message || `The allergen matrix could not be loaded (${response.status}).`);
        return body;
      })
      .then((body) => {
        if (body.artifact) return setMatrixState({ status: "ready", driveStatus: String(body.artifact.driveStatus || "saved"), artifact: body.artifact });
        if (body.status === "generating") return setMatrixState({ status: "generating", driveStatus: "generating" });
        if (body.status === "not_configured") return setMatrixState({ status: "not_configured", driveStatus: "not_configured" });
        if (body.status === "failed") return setMatrixState({ status: "failed", driveStatus: "failed", error: typeof body.error === "string" ? body.error : "CPU matrix materialisation failed. Retry from CPU Production." });
        setMatrixState({ status: "error", driveStatus: "error", error: "The Hospitality dashboard received no current allergen matrix artifact." });
      })
      .catch((cause) => setMatrixState({ status: "error", driveStatus: "error", error: (cause as Error).message }));
    }
    return () => { cancelled = true; };
  }, [documentTargetKey, matrixRefreshTick]);

  useEffect(() => {
    let cancelled = false;
    for (const target of documentTargets) {
    const bookingId = target.canonicalId;
    const productionOrderId = productionOrders[bookingId]?.canonicalId;
    setMenuReadiness(current => ({ ...current, [bookingId]: { available: false, reason: "Checking current menu readiness…" } }));
    void fetch(`/api/menus?bookingId=${encodeURIComponent(bookingId)}&readiness=1${productionOrderId ? `&productionOrderId=${encodeURIComponent(productionOrderId)}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await readDashboardJson(response) as { readiness?: { available: boolean; reason: string }; error?: { message?: string } };
        if (!response.ok) throw Error(body.error?.message || body.readiness?.reason || `Menu readiness is unavailable (${response.status}).`);
        return body;
      })
      .then((body) => { if (!cancelled) setMenuReadiness((current) => ({ ...current, [bookingId]: body.readiness || { available: false, reason: "Menu readiness is unavailable." } })); })
      .catch((cause) => { if (!cancelled) setMenuReadiness((current) => ({ ...current, [bookingId]: { available: false, reason: (cause as Error).message } })); });
    }
    return () => { cancelled = true; };
  }, [documentTargetKey]);

  // CPU planning is a shared projection, so keep an open manager panel current
  // while the production team is working without requiring a manual refresh.
  useEffect(() => {
    if (!selected && !selectedGroupId) return;
    // Keep the manager view reasonably fresh without turning every open tab
    // into a high-frequency Firestore read loop.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [selected?.canonicalId, selectedGroupId, site.key]);

  const signInLocally = async () => {
    const response = await fetch("/api/local-session", { method: "POST" });
    const body = await readDashboardJson(response);
    if (!response.ok) {
      setError(body.error?.message || "Local sign-in was unavailable.");
      return;
    }
    await load();
  };

  const queue = useMemo(
    () => filterQueue({ bookings, groups, standaloneIds, filters: queueFilters }),
    [bookings, groups, standaloneIds, queueFilters],
  );
  const queueStatuses = useMemo(() => availableStatuses({ bookings, groups, standaloneIds }), [bookings, groups, standaloneIds]);
  const visible = queue.bookings as CanonicalBooking[];
  const visibleGroups = queue.groups as HospitalityBookingGroup[];
  const newCount = visibleGroups.filter(group => group.status === "New").length + visible.filter(
    (item) => standaloneIds.has(item.canonicalId) && item.lifecycleStatus === "New",
  ).length;
  const readyForCpuCount = visibleGroups.filter(g => g.status === "Ready for CPU").length + visible.filter((item) => standaloneIds.has(item.canonicalId) && item.deliveryChargeRequired !== false && quoteReadyForCpu(item)).length;
  const attentionCount = visibleGroups.filter(group => ["New", "Quote preparing", "Awaiting routing", "Awaiting quote", "Partially processed", "Needs attention"].includes(group.status)).length + visible.filter(
    (item) =>
      standaloneIds.has(item.canonicalId) && (item.lifecycleStatus === "New" || item.lifecycleStatus === "Reviewed"),
  ).length;
  const scanStepIndex = inboxScanSteps.findIndex(({ key }) => key === scanPhase);
  const scanProgress = scanPhase === "complete"
    ? "100%"
    : scanPhase === "error"
      ? "0%"
      : `${((scanStepIndex + 1) / inboxScanSteps.length) * 100}%`;

  const generateGroupQuote = async () => {
    if (!selectedGroup || actionInFlight.current) return;
    actionInFlight.current = true; setActionBusy(true); setActionStage("Preparing the group quote and saving one PDF…"); setError("");
    try {
      const response = await fetchQuoteRequest("/api/booking-groups/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingGroupId: selectedGroup.id, expectedVersion: selectedGroup.version, expectedSourceHash: selectedGroup.sourceHash }) }, "The group quote is still being prepared. Refresh, then retry this group to resume safely.", 180_000);
      const body = await readDashboardJson(response);
      if (!response.ok) throw new Error(body.error?.message || "The group quote could not be prepared.");
      setNotice(body.quote?.status === "complete" ? "One group quote PDF has been saved." : body.quote?.status === "superseded" ? "The services changed during quote preparation. Generate an updated quote for the current services." : body.quote?.error || "Quote preparation is in progress. Refresh to check its result, or retry after an interruption.");
    } catch (cause) { setError((cause as Error).message); }
    finally { await load(false); actionInFlight.current = false; setActionBusy(false); }
  };

  /** The EXISTING per-service production command (unchanged payload), then the existing automatic completion. Returns a compact result. */
  const sendBookingToCpu = async (booking: CanonicalBooking): Promise<ServiceResult> => {
    const response = await fetch("/api/dashboard-bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canonicalId: booking.canonicalId, expectedVersion: booking.version, action: "production-handoff" }) });
    const body = await readDashboardJson(response);
    if (!response.ok) return { status: "failed", message: body.error?.message || "Could not send this service to CPU." };
    if (body.status === "no_cpu_production_required") return { status: "failed", message: body.message || "CPU reports no production is required for this service. Review its item routing." };
    const refreshedResponse = await fetch(`/api/dashboard-bookings?site=${encodeURIComponent(site.key)}${oplocId ? `&oploc=${encodeURIComponent(oplocId)}` : ""}`, { cache: "no-store" });
    const refreshedBody = await refreshedResponse.json();
    const refreshed = refreshedBody.bookings?.find((item: CanonicalBooking) => item.canonicalId === booking.canonicalId) as CanonicalBooking | undefined;
    if (!refreshed) return { status: "sent" };
    const completedResponse = await fetch("/api/dashboard-bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canonicalId: refreshed.canonicalId, expectedVersion: refreshed.version, action: "complete", notes: "Automatically completed after CPU hand-off." }) });
    const completedBody = await completedResponse.json();
    if (!completedResponse.ok) return { status: "sent", message: completedBody.error?.message || "Sent to CPU, but the booking could not be marked complete." };
    if (selected?.canonicalId === booking.canonicalId) setSelected(completedBody.booking || refreshed);
    return { status: "sent" };
  };

  /** The single booking-level Send to CPU action: runs the existing production command for each pending CPU-producing service only. */
  const sendProductionToCpu = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setActionBusy(true); setActionStage("Sending to CPU…"); setError(""); setNotice("");
    try {
      const outcome = await sendPendingServices(productionRows, async bookingId => {
        const booking = bookings.find(b => b.canonicalId === bookingId);
        if (!booking) return { status: "failed", message: "This service is no longer available. Refresh and retry." };
        return sendBookingToCpu(booking);
      });
      setServiceResults(current => ({ ...current, ...outcome }));
      const failedCount = Object.values(outcome).filter(result => result.status === "failed").length;
      if (failedCount) setError(`${failedCount === 1 ? "One service was" : `${failedCount} services were`} not sent to CPU. Services already sent are unaffected; use Send to CPU to retry the rest.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sending to CPU failed. Please try again."); }
    finally { await load(false); actionInFlight.current = false; setActionBusy(false); setActionStage(""); }
  };

  const persistQuotePdf = async (booking: CanonicalBooking, quote: { id: string; revision: number }) => {
    const saved = await saveQuoteDocument({ name: quoteFilename(booking.canonicalId, booking.client.companyName, "pdf"), html: quoteHtml(booking), canonicalId: booking.canonicalId });
    const statusResponse = await fetchQuoteRequest("/api/dashboard-bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonicalId: booking.canonicalId, expectedVersion: booking.version, action: "quote-pdf-status", revisionId: quote.id, status: "saved", driveFileId: saved.fileId, driveUrl: saved.driveUrl }),
    }, "Quote PDF was saved, but recording its status timed out. Use Retry quote generation from the dashboard.");
    const statusBody = await readDashboardJson(statusResponse) as { error?: { message?: string }; booking?: CanonicalBooking };
    if (!statusResponse.ok) throw new Error(statusBody.error?.message || "The quote PDF was saved but could not be recorded against the quote.");
    return statusBody.booking as CanonicalBooking;
  };

  const [cancelRetry, setCancelRetry] = useState<{ id: string; busy: boolean; error?: string; outcome?: PropagationOutcome; emailQueued?: boolean }>();
  const retryCancellation = async (booking: CanonicalBooking) => {
    if (actionInFlight.current || cancelRetry?.busy) return;
    actionInFlight.current = true;
    setCancelRetry(current => ({ ...(current?.id === booking.canonicalId ? current : { emailQueued: false }), id: booking.canonicalId, busy: true }));
    try {
      // Replaying the authorised cancel is the Hub's retry contract; a Cancelled booking is never cancelled twice or re-emailed.
      const response = await fetch("/api/dashboard-bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canonicalId: booking.canonicalId, expectedVersion: booking.version, action: "cancel", reason: booking.dashboardWorkflow?.cancellation?.reason || "Retry cancellation downstream recovery", notify: false }) });
      const body = await readDashboardJson(response);
      if (!response.ok) throw new Error(body.error?.message || "The retry could not be completed.");
      if (body.booking) { setSelected(body.booking); setBookings(current => current.map(item => item.canonicalId === body.booking.canonicalId ? body.booking : item)); }
      setCancelRetry({ id: booking.canonicalId, busy: false, outcome: propagationOutcome(body.projectionPropagation) });
    } catch (cause) {
      setCancelRetry(current => ({ ...(current || { id: booking.canonicalId }), id: booking.canonicalId, busy: false, error: (cause as Error).message || "The retry could not be completed." }));
    } finally { actionInFlight.current = false; }
  };

  const performAction = async (actionOverride?: WorkflowAction | null, target?: CanonicalBooking) => {
    const subject = target ?? selected;
    // A group service is acted on in place: showing its result must not select the service.
    const showBooking = (next: CanonicalBooking | null) => { if (!target) setSelected(next); };
    setError("");
    setNotice("");
    const action = actionOverride || pending;
    if (!subject || !action) return;
    setActionStage(action === "Production" ? "Sending to CPU…" : action === "Quoted" || action === "QuotePdfRetry" ? "Creating quote…" : "Saving changes…");
    if (action === "QuotePdfRetry") {
      const current = subject.quoteState?.revisions.find((revision) => revision.id === subject.quoteState?.currentRevisionId);
      if (!current) {
        setError("The current quote revision could not be found. Reload the booking before retrying.");
        setPending(null);
        return;
      }
      try { showBooking(await persistQuotePdf(subject, current)); setError(""); } catch (cause) { setError((cause as Error).message); }
      setPending(null);
      void load(false);
      return;
    }
    const base = {
      canonicalId: subject.canonicalId,
      expectedVersion: subject.version,
    };
    const command =
      action === "Amend" && amendment
        ? {
            ...base,
            action: "amend",
            reason: amendment.reason,
            patch: amendmentPatchDto(amendment),
          }
        : action === "Reviewed"
          ? { ...base, action: "review", checks: reviewChecks, notes: reason }
          : action === "Quoted"
            ? {
                ...base,
                action: "quote",
                regenerate: Boolean(subject.quoteState?.currentRevisionId),
              }
            : action === "Production"
                ? { ...base, action: "production-handoff" }
                : action === "Completed"
                  ? { ...base, action: "complete", notes: reason }
                  : { ...base, action: "cancel", reason, ...cancelOptions };
    if (action === "Cancelled" && !reason.trim()) {
      setError("A cancellation reason is required.");
      return;
    }
    if (action === "Amend" && !amendment?.reason.trim()) {
      setError("An amendment reason is required.");
      return;
    }
    const response = await (action === "Quoted"
      ? fetchQuoteRequest("/api/dashboard-bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      }, "Quote creation timed out. No new quote revision was confirmed; check the booking before retrying.")
      : fetch("/api/dashboard-bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    }));
    const body = await readDashboardJson(response);
    if (!response.ok) {
      const message = body.error?.message || "Could not update this Booking.";
      setError(message);
      return;
    }
    if (body.status === "no_cpu_production_required") setNotice(body.message || "No CPU production required: every item on this booking is produced in house.");
    showBooking(body.booking || subject);
    if (action === "Cancelled") setCancelRetry({ id: subject.canonicalId, busy: false, outcome: propagationOutcome(body.projectionPropagation), emailQueued: body.notification?.status === "queued" });
    if (action === "Quoted" && body.booking) {
      setActionStage("Saving quote PDF…");
      let pdfSaved = false;
      try {
        const quote = body.booking.quoteState?.revisions?.find(
          (revision: { id: string }) =>
            revision.id === body.booking.quoteState?.currentRevisionId,
        );
        if (quote) {
          const saved = await saveQuoteDocument({ name: quoteFilename(body.booking.canonicalId, body.booking.client.companyName, "pdf"), html: quoteHtml(body.booking), canonicalId: body.booking.canonicalId });
          setActionStage("Recording quote status…");
          const statusResponse = await fetchQuoteRequest("/api/dashboard-bookings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ canonicalId: body.booking.canonicalId, expectedVersion: body.booking.version, action: "quote-pdf-status", revisionId: quote.id, status: "saved", driveFileId: saved.fileId, driveUrl: saved.driveUrl }),
          }, "Quote PDF was saved, but recording its status timed out. Use Retry quote generation from the dashboard.");
          const statusBody = await readDashboardJson(statusResponse);
          if (!statusResponse.ok) {
            const message = statusBody.error?.message || "The quote PDF was saved but could not be recorded against the quote.";
            setError(message);
          }
          else {
            pdfSaved = true;
            const savedBooking = statusBody.booking || body.booking;
            showBooking(savedBooking);
          }
        }
      } catch (cause) {
        const message = `Quote created, but Drive saving failed: ${(cause as Error).message}`;
        setError(message);
      }
      if (!pdfSaved && body.booking.quoteState?.currentRevisionId) {
        try {
          const failureResponse = await fetchQuoteRequest("/api/dashboard-bookings", {
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
          }, "The quote PDF failure status could not be recorded.");
          const failureBody = await readDashboardJson(failureResponse);
          if (failureResponse.ok && failureBody.booking) showBooking(failureBody.booking);
        } catch {
          // The refresh below reconciles a write whose response could not be confirmed.
        }
      }
    }
    if (action === "Production") {
      setActionStage("Completing booking…");
      const refreshedResponse = await fetch(`/api/dashboard-bookings?site=${encodeURIComponent(site.key)}${oplocId ? `&oploc=${encodeURIComponent(oplocId)}` : ""}`, { cache: "no-store" });
      const refreshedBody = await refreshedResponse.json();
      const refreshed = refreshedBody.bookings?.find((booking: CanonicalBooking) => booking.canonicalId === subject.canonicalId) as CanonicalBooking | undefined;
      if (refreshed) {
        const completedResponse = await fetch("/api/dashboard-bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ canonicalId: refreshed.canonicalId, expectedVersion: refreshed.version, action: "complete", notes: "Automatically completed after CPU hand-off." }),
        });
        const completedBody = await completedResponse.json();
        if (!completedResponse.ok) setError(completedBody.error?.message || "The booking was sent to CPU but could not be marked complete.");
        else showBooking(completedBody.booking || refreshed);
      }
    }
    setPending(null);
    setReason("");
    setAmendment(null);
    void load(action !== "Quoted");
  };

  const act = async (actionOverride?: WorkflowAction | null, target?: CanonicalBooking) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionStage("Working…");
    setActionBusy(true);
    try {
      await performAction(actionOverride, target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The booking action failed. Please try again.");
      setPending(null);
      void load(false);
    } finally {
      actionInFlight.current = false;
      setActionBusy(false);
      setActionStage("");
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
        `<nav class="fika-document-tools" aria-label="Document actions"><button type="button" id="fika-download">Download document</button><button type="button" id="fika-share">Share</button><button type="button" class="primary" id="fika-pdf">Save as PDF</button></nav><script>(function(){const source=()=>document.documentElement.outerHTML;const notify=(message)=>{const backdrop=document.createElement("div");backdrop.setAttribute("role","presentation");backdrop.style="position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:#24183a99";const modal=document.createElement("section");modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.setAttribute("aria-label","Document message");modal.style="width:min(420px,calc(100% - 32px));padding:24px;border-radius:16px;background:#fff;color:#24115c;box-shadow:0 18px 50px #180d4340;font:16px Arial,sans-serif";modal.innerHTML="<h2 style='margin:0 0 12px;font-size:20px'>Document action</h2><p style='margin:0 0 20px;line-height:1.5'>"+message+"</p><button type='button' style='border:0;border-radius:8px;padding:10px 18px;background:#4df7c2;color:#24115c;font-weight:700;cursor:pointer'>Close</button>";modal.querySelector("button").onclick=()=>backdrop.remove();backdrop.onclick=(event)=>{if(event.target===backdrop)backdrop.remove()};backdrop.appendChild(modal);document.body.appendChild(backdrop);modal.querySelector("button").focus()};const download=()=>{const blob=new Blob([source()],{type:"text/html"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=document.title.replace(/[^A-Za-z0-9_-]+/g,"_")+".html";link.click();URL.revokeObjectURL(link.href)};document.getElementById("fika-download").onclick=download;document.getElementById("fika-pdf").onclick=()=>window.print();document.getElementById("fika-share").onclick=async()=>{if(!navigator.share){notify("Sharing is not available in this browser. Use Download document instead.");return}try{const file=new File([source()],document.title.replace(/[^A-Za-z0-9_-]+/g,"_")+".html",{type:"text/html"});await navigator.share({title:document.title,files:[file]})}catch(error){if(error.name!=="AbortError")notify("The document could not be shared. Use Download document instead.")}}})();</script></body>`,
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
      if (isBookingQuoteStale(booking)) throw new Error("Quote needs regeneration before it can be opened as current.");
      if (current?.driveUrl && current.pdfStatus === "saved") window.open(current.driveUrl, "_blank", "noopener,noreferrer");
      else throw new Error("The quote PDF isn't ready yet. Use Retry quote generation.");
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
      const response = await fetchQuoteRequest("/api/dashboard-bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }, "The booking workflow timed out. Check its saved state before retrying.");
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
        labourRates: quoteSettings.labourRates ?? defaultLabourRates,
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

  const saveAdditionalCharges = async (charges: BookingAdditionalChargeInput[]) => {
    if (!selected) throw new Error("Select a Booking before saving charges.");
    setAdditionalChargeBusy(true);
    try {
      const response = await fetchQuoteRequest("/api/dashboard-bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          canonicalId: selected.canonicalId,
          expectedVersion: selected.version,
          action: "set-additional-charges",
          charges,
        }),
      }, "Saving charges timed out. Check the booking before retrying.");
      const body = await readDashboardJson(response) as { error?: { message?: string }; booking?: CanonicalBooking };
      if (!response.ok) throw new Error(body.error?.message || "Could not save Booking charges.");
      if (!body.booking) throw new Error("Charges were saved but the updated Booking was not returned.");
      setSelected(body.booking);
      setBookings((current) => current.map((booking) => booking.canonicalId === body.booking?.canonicalId ? body.booking! : booking));
    } finally {
      setAdditionalChargeBusy(false);
    }
  };

  const selectedProductionOrder = selected
    ? productionOrders[selected.canonicalId]
    : undefined;
  const selectedMenuOutput = selected
    ? menuOutputs[selected.canonicalId]
    : undefined;
  // Same freshness rule for any booking: a menu is stale once its CPU plan has moved on.
  const isMenuStale = (bookingId: string) => {
    const output = menuOutputs[bookingId];
    const order = productionOrders[bookingId];
    return Boolean(output?.planUpdatedAt && (order?.updatedAt || order?.createdAt) && output.planUpdatedAt < (order.updatedAt || order.createdAt));
  };
  const selectedMenuStale = Boolean(
    selectedMenuOutput?.planUpdatedAt &&
      selectedProductionOrder?.updatedAt &&
      selectedMenuOutput.planUpdatedAt < selectedProductionOrder.updatedAt,
  );

  const renderGroupDocuments = (row: ServiceProductionRow) => {
    const child = bookings.find(b => b.canonicalId === row.bookingId);
    if (!child || !row.hasProductionOrder) return null;
    const matrix = matrixArtifacts[child.canonicalId];
    const matrixUrl = matrix?.status === "ready" ? matrix.driveUrl || matrix.localUrl : undefined;
    const order = productionOrders[child.canonicalId];
    const output = menuOutputs[child.canonicalId];
    const stale = Boolean(output?.planUpdatedAt && (order?.updatedAt || order?.createdAt) && output.planUpdatedAt < (order.updatedAt || order.createdAt));
    const ready = Boolean(menuReadiness[child.canonicalId]?.available);
    return <div className={panelStyles.docs} role="group" aria-label={`${row.label} allergens and menu`}>
      {matrixUrl
        ? <a href={matrixUrl} target="_blank" rel="noreferrer">Open signed allergen PDF</a>
        : matrix?.status === "failed" || matrix?.status === "error"
          ? <button type="button" onClick={() => setMatrixRefreshTick(current => current + 1)}>Allergen matrix unavailable · retry</button>
          : <button type="button" disabled aria-busy={matrix?.status === "checking" || matrix?.status === "generating" ? true : undefined}>{matrix?.status === "checking" ? "Checking allergen matrix…" : matrix?.status === "generating" ? "Generating allergen matrix…" : "Allergen matrix after signing"}</button>}
      {output && <button type="button" onClick={() => openMenu(output)}>Open menu{stale ? " (previous)" : ""}</button>}
      <button type="button" disabled={menuBusy || !ready} aria-busy={menuBusy ? true : undefined} title={ready ? undefined : menuReadiness[child.canonicalId]?.reason} onClick={() => void generateMenu(child)}>{menuBusy ? "Generating menu…" : output ? "Regenerate menu" : "Generate menu"}</button>
    </div>;
  };
  const productionPanel = <BookingProductionPanel rows={productionRows} results={serviceResults} busy={actionBusy} sending={actionBusy && actionStage === "Sending to CPU…"} onSend={() => void sendProductionToCpu()} renderDocuments={selectedGroup ? renderGroupDocuments : undefined} />;

  return (
    <div className={styles.scope}>
      <main className={`hospitality-dashboard ${site.cssClass} hospitality-site-themed`} data-surface="fika-internal-operational" data-client-brand={site.key} style={themeStyle}>
        <header className="hospitality-dashboard__topbar">
          <div className="hospitality-dashboard__brand-group">
            <a
              className="hospitality-dashboard__brand"
              href="/workspace"
              aria-label="FIKA OS Hospitality workspace"
            >
              <strong>FIKA</strong>
              <span>OS</span>
              <i>·</i>
              <b>Hospitality</b>
            </a>
            <span className="hospitality-dashboard__site-context">{currentSiteLabel}</span>
            <a className="hospitality-dashboard__workspace-link" href="/workspace">Change workspace</a>
          </div>
          <div>
            <a className="start-again" href={oplocId ? hospitalityWorkspacePath(oplocId, "booking") : site.portalPath}>View Booking platform</a>
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
            <p className="eyebrow">{currentSiteLabel} · {site.theme.heroEyebrow}</p>
            <h1>
              {currentSiteLabel}, <em>in hand.</em>
            </h1>
            <p>
              Review every customer request, protect the commercial snapshot and
              keep the next operational action clear.
            </p>
          </div>
          <div
            className="hospitality-dashboard__metrics"
            aria-label="Filtered booking summary"
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
            onSelect={selectBooking}
            groups={visibleGroups}
            onSelectGroup={selectGroup}
            busy={actionBusy}
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
                Run sheet
              </button>
            </div>
          </div>
          {notice && <div className="hospitality-dashboard__notice" role="status">{notice}</div>}
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
          <DashboardQueueFilters
            filters={queueFilters}
            onChange={setQueueFilters}
            statuses={queueStatuses}
            shown={queue.shown}
            total={queue.total}
            loading={loading}
          />
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
              {!loading && queue.rows.map(row => {
                if (row.kind === "group") {
                  const group = row.group as HospitalityBookingGroup;
                  return (
                    <button key={`group:${group.id}`} className={`booking-card ${selectedGroupId === group.id ? "booking-card--selected" : ""}`} disabled={actionBusy} onClick={() => selectGroup(group)}>
                      <span className="booking-card__date">{formatDate(group.eventDate)}<small>{group.firstTime}–{group.lastTime}</small></span>
                      <span className="booking-card__content"><strong>{group.client.companyName}</strong><small>All Day Hospitality · {group.services.length} services</small><span>{group.services.every(s => s.guests === group.services[0].guests) ? group.services[0].guests + " pax" : "Guests vary by service"} · £{group.totals.gross.toFixed(2)}</span></span>
                      <span className="booking-status">{group.status}</span>
                    </button>
                  );
                }
                const booking = row.booking as CanonicalBooking;
                return (
                  <button
                    key={`booking:${booking.canonicalId}`}
                    className={`booking-card ${selected?.canonicalId === booking.canonicalId ? "booking-card--selected" : ""}`}
                    disabled={actionBusy}
                    onClick={() => selectBooking(booking)}
                  >
                    <span className="booking-card__date">
                      {formatDate(booking.service.eventDate)}
                      <small>{booking.service.startTime}</small>
                    </span>
                    <span className="booking-card__content">
                      <strong>{booking.client.clientCompany || booking.client.companyName}</strong>
                      <small>
                        {booking.client.name} ·{" "}
                        {booking.service.portalSiteLabel?.trim() || currentSiteLabel}
                      </small>
                      <span>
                        {booking.service.guestCount} pax · £
                        {booking.order.grossTotal.toFixed(2)}
                      </span>
                    </span>
                    <StatusPill status={booking.lifecycleStatus} label={standaloneStatusLabel(booking, productionOrders[booking.canonicalId])} />
                  </button>
                );
              })}
              {!loading && !queue.rows.length && (
                <p className="hospitality-dashboard__empty">
                  {hasActiveFilters(queueFilters) && queue.total
                    ? `No bookings match these filters (${queue.total} hidden). Reset the filters to see them all.`
                    : "No canonical Bookings match this view."}
                </p>
              )}
            </aside>

            <section
              className="hospitality-dashboard__detail"
              aria-live="polite"
            >
              <div role="status" aria-live="polite" aria-atomic="true">
                {actionBusy && (
                  <p className={styles.actionProgress}>
                    <span className="fika-spinner" aria-hidden="true" />
                    {actionStage}
                  </p>
                )}
              </div>
              {selectedGroup && <HospitalityGroupDetail group={selectedGroup} onBusyChange={busy => { actionInFlight.current = busy; setActionBusy(busy); }} site={site.key} oplocId={bookings.find(b => b.canonicalId === selectedGroup.services[0]?.bookingId)?.service.oplocId || ""} onAmended={async () => { setServiceResults({}); setMatrixArtifacts({}); setMenuReadiness({}); await load(); }} busy={actionBusy} production={productionPanel} onQuote={() => void generateGroupQuote()} />}
              {selected ? (
                <fieldset className={styles.actionControls} disabled={actionBusy} aria-busy={actionBusy} aria-label="Booking details and actions">
                <BookingPane
                  booking={selected}
                  siteKey={site.key}
                  siteLabel={currentSiteLabel}
                  productionOrder={selectedProductionOrder}
                  menuOutput={selectedMenuOutput}
                  menuStale={selectedMenuStale}
                  menuReady={Boolean(menuReadiness[selected.canonicalId]?.available)}
                  menuReadyReason={menuReadiness[selected.canonicalId]?.reason || "Waiting for menu items and allergen information."}
                  matrixArtifact={matrixArtifacts[selected.canonicalId]}
                  onRefreshMatrix={() => setMatrixRefreshTick((current) => current + 1)}
                  menuBusy={menuBusy}
                  quoteBusy={actionBusy}
                  setPending={setPending}
                  amendment={amendment}
                  onAmend={openAmendment}
                  onChangeAmendment={setAmendment}
                  onCancelAmendment={() => setAmendment(null)}
                  onSaveAmendment={saveAmendment}
                  onOpenQuote={openQuote}
                  onSaveAdditionalCharges={saveAdditionalCharges}
                  additionalChargeBusy={additionalChargeBusy}
                  onAction={(action) => void act(action)}
                  onGenerateMenu={generateMenu}
                  onOpenMenu={openMenu}
                  productionPanel={productionPanel}
                  cancellationPanel={selected.lifecycleStatus === "Cancelled" ? <CancellationStatusPanel view={cancellationView({ lifecycleStatus: selected.lifecycleStatus, cancellation: selected.dashboardWorkflow?.cancellation })} reason={selected.dashboardWorkflow?.cancellation?.reason} emailQueued={cancelRetry?.id === selected.canonicalId ? cancelRetry.emailQueued : selected.dashboardWorkflow?.cancellation?.notificationOutcome === "queued"} retry={cancelRetry?.id === selected.canonicalId ? cancelRetry.outcome : undefined} busy={cancelRetry?.id === selected.canonicalId && cancelRetry.busy} error={cancelRetry?.id === selected.canonicalId ? cancelRetry.error : undefined} onRetry={() => void retryCancellation(selected)} /> : null}
                />
                </fieldset>
              ) : !selectedGroup ? (
                <div className="hospitality-dashboard__blank">
                  <p className="eyebrow">Ready when you are</p>
                  <h2>Select a booking</h2>
                  <p>
                    Its customer request, commercial snapshot and governed
                    operational actions will appear here.
                  </p>
                </div>
              ) : null}
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
                    A client cancellation email is queued automatically only where the Hub has customer cancellation email enabled for this site. If CPU has already advanced production, it is flagged for manual review instead of being withdrawn.
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
                  {actionBusy && <span className="fika-spinner" aria-hidden="true" />}
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
                Open one scan-first run sheet for the selected bookings; save or
                print it as a PDF from the document. It defaults to the visible
                Monday-to-Friday week.
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
                <button className="primary">Open run sheet</button>
              </footer>
            </form>
          </div>
        )}
        {settingsOpen && quoteSettings && (
          <DashboardSettingsModal
            activeTab={settingsTab}
            onTabChange={setSettingsTab}
            siteLabel={currentSiteLabel}
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
  onRefreshMatrix,
  menuBusy,
  quoteBusy,
  setPending,
  amendment,
  onAmend,
  onChangeAmendment,
  onCancelAmendment,
  onSaveAmendment,
  onOpenQuote,
  onSaveAdditionalCharges,
  additionalChargeBusy,
  onAction,
  onGenerateMenu,
  onOpenMenu,
  productionPanel,
  cancellationPanel,
}: {
  productionPanel: ReactNode;
  cancellationPanel?: ReactNode;
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
    viewUrl?: string;
    fileName: string;
    driveStatus: string;
    approvalMode?: string;
    status?: "checking" | "generating" | "ready" | "not_configured" | "failed" | "error";
    error?: string;
  };
  onRefreshMatrix: () => void;
  menuBusy: boolean;
  quoteBusy: boolean;
  setPending: (status: WorkflowAction) => void;
  amendment: Amendment | null;
  onAmend: (booking: CanonicalBooking) => void;
  onChangeAmendment: (value: Amendment) => void;
  onCancelAmendment: () => void;
  onSaveAmendment: () => Promise<void>;
  onOpenQuote: (booking: CanonicalBooking) => void;
  onSaveAdditionalCharges: (charges: BookingAdditionalChargeInput[]) => Promise<void>;
  additionalChargeBusy: boolean;
  onAction: (action: WorkflowAction) => void;
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
      onRefreshMatrix={onRefreshMatrix}
      menuBusy={menuBusy}
      quoteBusy={quoteBusy}
      setPending={setPending}
      onAmend={onAmend}
      onOpenQuote={onOpenQuote}
      onSaveAdditionalCharges={onSaveAdditionalCharges}
      additionalChargeBusy={additionalChargeBusy}
      onAction={onAction}
      onGenerateMenu={onGenerateMenu}
      onOpenMenu={onOpenMenu}
      productionPanel={productionPanel}
      cancellationPanel={cancellationPanel}
    />
  );
}

function MatrixDiagnostics({ bookingId, detail }: { bookingId: string; detail?: string }) {
  useEffect(() => {
    if (detail) console.warn("FIKA allergen matrix unavailable", { bookingId, detail });
  }, [bookingId, detail]);
  return null;
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
  onRefreshMatrix,
  menuBusy,
  quoteBusy,
  setPending,
  onAmend,
  onOpenQuote,
  onSaveAdditionalCharges,
  additionalChargeBusy,
  onAction,
  onGenerateMenu,
  onOpenMenu,
  productionPanel,
  cancellationPanel,
}: {
  productionPanel: ReactNode;
  cancellationPanel?: ReactNode;
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
    viewUrl?: string;
    fileName: string;
    driveStatus: string;
    approvalMode?: string;
    status?: "checking" | "generating" | "ready" | "not_configured" | "failed" | "error";
    error?: string;
  };
  onRefreshMatrix: () => void;
  menuBusy: boolean;
  quoteBusy: boolean;
  setPending: (status: WorkflowAction) => void;
  onAmend: (booking: CanonicalBooking) => void;
  onOpenQuote: (booking: CanonicalBooking) => void;
  onSaveAdditionalCharges: (charges: BookingAdditionalChargeInput[]) => Promise<void>;
  additionalChargeBusy: boolean;
  onAction: (action: WorkflowAction) => void;
  onGenerateMenu: (booking: CanonicalBooking) => Promise<void>;
  onOpenMenu: (output: MenuOutput) => void;
}) {
  const { floorLevel, roomOrArea, deliveryPoint } = bookingLocation(booking.service);
  const dietaryEntries = Object.entries(booking.dietaries).filter(
    ([, value]) => value !== 0 && value !== "" && value !== false,
  );
  const [additionalChargesOpen, setAdditionalChargesOpen] = useState(false);
  const additionalCharges = booking.additionalCharges || [];
  const additionalChargesNet = additionalCharges.reduce((total, charge) => total + charge.netTotal, 0);
  const quoteNeedsRegeneration = isBookingQuoteStale(booking);
  return (
    <>
      <div className="booking-detail__actions">
        {!booking.bookingGroup && <button type="button" onClick={() => onAmend(booking)}>
          {["Completed", "Cancelled"].includes(booking.lifecycleStatus)
            ? "Reopen and amend booking"
            : "Edit booking"}
        </button>}
        {!booking.bookingGroup && !["Completed", "Cancelled"].includes(booking.lifecycleStatus) && (
          <button
            type="button"
            className="danger"
            onClick={() => setPending("Cancelled")}
          >
            Cancel booking
          </button>
        )}
        {availableActions(booking, productionOrder)
          .filter((action) => action !== "Production" && (!booking.bookingGroup || !["Quoted", "QuotePdfRetry"].includes(action)))
          .map((action) => (
            <button
              key={action}
              type="button"
              className="primary"
              disabled={quoteBusy && (action === "Quoted" || action === "QuotePdfRetry")}
              aria-busy={quoteBusy && (action === "Quoted" || action === "QuotePdfRetry") ? true : undefined}
              onClick={() => {
                if (quoteBusy) return;
                if (action === "Quoted") onAction(action);
                else setPending(action);
              }}
            >
              {quoteBusy && (action === "Quoted" || action === "QuotePdfRetry") ? (
                <>
                  <span className="fika-spinner" aria-hidden="true" />
                  Generating quote…
                </>
              ) : action === "Reviewed"
                ? "Review booking"
                : action === "Quoted"
                  ? booking.quoteState?.currentRevisionId && isBookingQuoteStale(booking)
                    ? "Regenerate quote"
                    : booking.quoteState?.currentRevisionId ? "Open quote" : "Generate quote"
                  : action === "QuotePdfRetry"
                    ? "Retry quote generation"
                    : action === "Completed"
                      ? "Mark complete"
                      : "Send to CPU"}
            </button>
          ))}
      </div>
      <header className="booking-detail__header">
        <div>
          <p className="eyebrow">
            {booking.service.portalSiteLabel?.trim() || siteLabel} ·{" "}
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
          <StatusPill status={booking.lifecycleStatus} label={standaloneStatusLabel(booking, productionOrder)} />
        </div>
      </header>
      <section className="booking-detail__location" aria-labelledby={`booking-location-${booking.canonicalId}`}>
        <p id={`booking-location-${booking.canonicalId}`} className="booking-detail__location-title">Location</p>
        <dl className="booking-detail__location-grid">
          <div>
            <dt>Floor level</dt>
            <dd>{floorLevel ?? <span className="booking-detail__location-missing">Not recorded</span>}</dd>
          </div>
          <div>
            <dt>Room or area</dt>
            <dd>{roomOrArea ?? <span className="booking-detail__location-missing">Not recorded</span>}</dd>
          </div>
          {deliveryPoint && (
            <div>
              <dt>Delivery point</dt>
              <dd>{deliveryPoint}</dd>
            </div>
          )}
        </dl>
        {(!floorLevel || !roomOrArea) && <p className="booking-detail__location-note">Floor or room is missing on this booking. Confirm it with the customer before service.</p>}
      </section>
      <div className="booking-detail__facts">
        <Fact
          label="When"
          value={`${formatDate(booking.service.eventDate)} · ${booking.service.startTime}`}
        />
        <Fact label="Guests" value={`${booking.service.guestCount} pax`} />
        <Fact label="Request ID" value={booking.source.sourceBookingId} />
        {booking.bookingGroup && <Fact label="Request group" value={`${booking.bookingGroup.id} · service ${booking.bookingGroup.sequence} of ${booking.bookingGroup.size}`} />}
        {booking.client.invoiceReference && (
          <Fact label="Invoice / PO" value={booking.client.invoiceReference} />
        )}
        {booking.cpuRouting
          ? <Fact label={booking.cpuRouting.enforced === false ? "CPU production (advisory)" : "CPU production"} value={booking.cpuRouting.statusLabel} />
          : <Fact label="Produced by CPU" value={booking.deliveryChargeRequired === false ? "No" : "Yes"} />}
      </div>
      <section className="booking-detail__section">
        <div className="booking-detail__section-title">
          <div>
            <p className="eyebrow">Commercial snapshot</p>
            <h3>What was requested</h3>
          </div>
          <strong>£{booking.order.grossTotal.toFixed(2)}</strong>
        </div>
        <RequestedItemsList rows={bookingRequestedItems(booking)} />
        <div className="booking-detail__total">
          <span>
            Net £{booking.order.netTotal.toFixed(2)} · VAT £
            {booking.order.vatTotal.toFixed(2)}
          </span>
          <b>Total £{booking.order.grossTotal.toFixed(2)}</b>
        </div>
      </section>
      <section className="booking-detail__section additional-charges-summary">
        <div className="booking-detail__section-title">
          <div>
            <p className="eyebrow">Quote additions</p>
            <h3>Additional charges</h3>
          </div>
          <strong>£{additionalChargesNet.toFixed(2)} net</strong>
        </div>
        <div className="additional-charges-summary__row">
          <span>{additionalCharges.length} {additionalCharges.length === 1 ? "charge" : "charges"}</span>
          <button
            type="button"
            className="additional-charges-summary__manage"
            disabled={!canManageBookingCharges(booking.lifecycleStatus) || additionalChargeBusy}
            onClick={() => setAdditionalChargesOpen(true)}
          >
            Manage charges
          </button>
        </div>
        {quoteNeedsRegeneration && (
          <p className="additional-charges-summary__stale" role="status">
            Quote needs regeneration. The previous revision remains in history.
          </p>
        )}
        {!canManageBookingCharges(booking.lifecycleStatus) && (
          <p className="additional-charges-summary__help">
            Charges can be changed on new, reviewed, quoted and completed bookings. Otherwise change commercial intent through the governed Booking amendment workflow.
          </p>
        )}
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
              <strong>{standaloneStatusLabel(booking, productionOrder) ?? workflowLabel(booking.lifecycleStatus)}</strong>
            </div>
          </div>
          {cancellationPanel}
          {booking.bookingGroup
            ? <p className="muted">CPU production, allergens and menus are managed once for the whole booking, not per service.</p>
            : productionPanel}
          <div className="manager-document-actions" role="group" aria-label="Quote, allergen matrix and menu">
            <p className="manager-document-actions__title">Quote, allergens and menu</p>
            <button
              type="button"
              className="manager-document-action"
              disabled={quoteBusy || !booking.quoteState?.currentRevisionId || quoteNeedsRegeneration || booking.quoteState.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId)?.pdfStatus !== "saved"}
              aria-busy={quoteBusy ? true : undefined}
              onClick={() => { const current = booking.quoteState?.revisions.find(r => r.id === booking.quoteState?.currentRevisionId); if (booking.bookingGroup && current?.driveUrl) window.open(current.driveUrl, "_blank", "noopener,noreferrer"); else onOpenQuote(booking); }}
            >
              <strong>
                {quoteBusy ? (
                  <>
                    <span className="fika-spinner" aria-hidden="true" />
                    Generating quote…
                  </>
                ) : quoteNeedsRegeneration ? "Quote needs regeneration" : "Open quote"}
              </strong>
              <small>
                {quoteBusy
                  ? "Preparing the quote PDF"
                  : quoteNeedsRegeneration
                  ? "The previous revision is retained for history"
                  : booking.quoteState?.currentRevisionId
                  ? booking.quoteState.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId)?.pdfStatus === "saved"
                    ? "Current quote PDF in Drive"
                    : "Quote PDF not saved yet. Use Retry quote generation."
                  : "Quote not generated"}
              </small>
            </button>
            {!booking.bookingGroup && serviceCpuRequirement({ routing: booking.cpuRouting, deliveryChargeRequired: booking.deliveryChargeRequired }) === "cpu" && (<>
            {matrixArtifact?.driveUrl || matrixArtifact?.localUrl ? (
              <a
                className="manager-document-action"
                href={matrixArtifact.driveUrl || matrixArtifact.localUrl}
                target="_blank"
                rel="noreferrer"
              >
                <strong>Open signed allergen PDF</strong>
                <small>
                  {matrixArtifact.approvalMode === "reused_authority"
                    ? "Approved by reuse of a previously signed sandwich set (not signed for this booking)"
                    : matrixArtifact.driveUrl
                    ? "Signed PDF in site Drive"
                    : "Local signed PDF"}
                </small>
              </a>
            ) : matrixArtifact?.status === "checking" ? (
              <button type="button" className="manager-document-action" disabled aria-busy="true">
                <strong>
                  <span className="fika-spinner" aria-hidden="true" />
                  Checking allergen matrix…
                </strong>
                <small>Looking up the latest CPU allergen status</small>
              </button>
            ) : matrixArtifact?.status === "generating" ? (
              <button type="button" className="manager-document-action" disabled aria-busy="true">
                <strong>
                  <span className="fika-spinner" aria-hidden="true" />
                  Generating allergen matrix…
                </strong>
                <small>The signed PDF is being prepared</small>
              </button>
            ) : matrixArtifact?.status === "failed" || matrixArtifact?.status === "error" ? (
              <button type="button" className="manager-document-action" onClick={onRefreshMatrix}>
                <MatrixDiagnostics bookingId={booking.canonicalId} detail={matrixArtifact.error} />
                <strong>Allergen matrix unavailable</strong>
                <small>We couldn&apos;t load the latest CPU allergen data. Try again.</small>
              </button>
            ) : (
              <button
                type="button"
                className="manager-document-action"
                disabled
              >
                <strong>Open signed allergen PDF</strong>
                <small>{matrixArtifact?.status === "not_configured" ? "Signed matrix storage is not configured" : "Available after signing"}</small>
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
                  aria-busy={menuBusy ? true : undefined}
                >
                  <strong>
                    {menuBusy ? (
                      <>
                        <span className="fika-spinner" aria-hidden="true" />
                        Generating menu…
                      </>
                    ) : "Regenerate menu"}
                  </strong>
                  <small>
                    {menuBusy
                      ? "This can take a few seconds. Please keep this page open."
                      : menuStale
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
                aria-busy={menuBusy ? true : undefined}
              >
                <strong>
                  {menuBusy ? (
                    <>
                      <span className="fika-spinner" aria-hidden="true" />
                      Generating menu…
                    </>
                  ) : "Generate menu"}
                </strong>
                <small>{menuBusy ? "This can take a few seconds. Please keep this page open." : menuReady ? "Generate from the Planned CPU revision" : menuReadyReason}</small>
              </button>
            )}
            </>)}
          </div>
          {!booking.bookingGroup && serviceCpuRequirement({ routing: booking.cpuRouting, deliveryChargeRequired: booking.deliveryChargeRequired }) === "cpu" && (<>
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
              </div>
            </div>
          )}
          </>)}
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
      {additionalChargesOpen && (
        <AdditionalChargesModal
          booking={booking}
          busy={additionalChargeBusy}
          onCancel={() => setAdditionalChargesOpen(false)}
          onSave={async (charges) => {
            await onSaveAdditionalCharges(charges);
            setAdditionalChargesOpen(false);
          }}
        />
      )}
    </>
  );
}

function CalendarView({
  bookings,
  groups,
  onSelectGroup,
  busy,
  week,
  onWeekChange,
  onSelect,
  selectedId,
}: {
  bookings: CanonicalBooking[];
  groups: HospitalityBookingGroup[];
  onSelectGroup: (group: HospitalityBookingGroup) => void;
  busy: boolean;
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
              {groups.filter(group => group.eventDate === key).map(group => <button className="calendar-booking" type="button" key={group.id} disabled={busy} onClick={() => onSelectGroup(group)}><span>{group.firstTime}–{group.lastTime} · {group.services.length} services</span><strong>{group.client.companyName}</strong><small>All Day Hospitality · {group.status}</small></button>)}
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
                    disabled={busy}
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
              {!dailyBookings.length && !groups.some(group => group.eventDate === key) && (
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
        <h2>Hospitality quote policy</h2>
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
function StatusPill({ status, label }: { status: Status; label?: string }) {
  return (
    <span className={`booking-status booking-status--${status.toLowerCase()}`}>
      {label ?? workflowLabel(status)}
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
// Mirrors the Hub's commercial-editing guard (COMMERCIAL_EDITABLE_STATUSES): charges, and the revised quote reflecting them, stay
// maintainable on a Completed booking. The server enforces the same rule; this only decides what the UI offers.
function canManageBookingCharges(status: Status) {
  return ["New", "Reviewed", "Quoted", "Completed"].includes(status);
}
function availableActions(booking: CanonicalBooking, productionOrder?: ProductionOrder): WorkflowAction[] {
  if (booking.lifecycleStatus === "New") return ["Quoted"];
  if (booking.lifecycleStatus === "Reviewed") return ["Quoted"];
  if (["Quoted", "Approved"].includes(booking.lifecycleStatus)) {
    const current = booking.quoteState?.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId);
    if (isBookingQuoteStale(booking)) return ["Quoted"];
    if (current && current.pdfStatus !== "saved") return ["QuotePdfRetry"];
    if (productionOrderMatchesCurrentQuote(booking, productionOrder) || booking.deliveryChargeRequired === false) return ["Completed"];
    return ["Production"];
  }
  if (booking.lifecycleStatus === "Sent to CPU" && productionOrder) return ["Completed"];
  // A Completed booking whose charges changed offers only the revised quote; it never offers a hand-off or a lifecycle change.
  if (booking.lifecycleStatus === "Completed" && isBookingQuoteStale(booking)) return ["Quoted"];
  return [];
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
  const now = useBookingClock();
  const [cutoffMenu, setCutoffMenu] = useState<PortalMenuItem[]>([]);
  const [cutoffWarning, setCutoffWarning] = useState("Checking current catalogue constraints…");
  useEffect(() => {
    const controller = new AbortController();
    setCutoffWarning("Checking current catalogue constraints…");
    void loadHospitalityPortalMenu(siteKey, booking.service.oplocId, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setCutoffMenu(result.menu); setCutoffWarning(""); }
    }).catch(() => { if (!controller.signal.aborted) setCutoffWarning("Current catalogue constraints could not be verified. Refresh before changing the date."); });
    return () => controller.abort();
  }, [siteKey, booking.service.oplocId]);
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
          <BookingDatePicker value={amendment.service.eventDate} onChange={eventDate => changeService("eventDate", eventDate)} items={amendment.order.items.filter(line => line.quantity > 0).map(line => cutoffMenu.find(item => [item.id, item.canonicalId].includes(line.itemId)) || { id: line.itemId })} context={{ site: siteKey, occasion: amendment.order.eventType, startTime: amendment.service.startTime }} now={now} unavailableReason={cutoffWarning || undefined} />
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
  siteLabel,
  settings,
  onChange,
  onCancel,
  onSave,
}: {
  activeTab: "quotes" | "drive";
  onTabChange: (tab: "quotes" | "drive") => void;
  siteLabel: string;
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
        <h2>{siteLabel} Hospitality</h2>
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
