import type { BookingAdditionalCharge, BookingAdditionalChargeInput } from "./hospitality-additional-charges";

export type BookingStatus = "New" | "Reviewed" | "Quoted" | "Sent to CPU" | "Approved" | "Completed" | "Cancelled";
export type ReviewChecks = { commercialIntent: boolean; serviceTiming: boolean; deliveryContext: boolean; dietaryRequirements: boolean };
export type QuotePdfStatus = "pending" | "saved" | "failed";
export type QuoteRevision = { id: string; revision: number; createdAt: string; createdBy: string; commercialVersion: number; snapshot: unknown; documentReference: string; groupQuoteId?: string; stale: boolean; pdfStatus?: QuotePdfStatus; driveFileId?: string; driveUrl?: string; pdfError?: string };
export type DashboardWorkflow = { review?: { checks: ReviewChecks; reviewedAt: string; reviewedBy: string; notes?: string }; completion?: { completedAt: string; completedBy: string; notes?: string }; cancellation?: { reason: string; calendarOutcome: "not_requested" | "not_configured"; productionOutcome: "not_requested" | "cancel_requested" | "cancelled" | "no_active_production_order" | "review_required"; downstreamPropagation?: "pending" | "delivered" | "review_required"; notificationOutcome: "not_requested" | "not_configured" | "queued" } };
export type WorkflowCommand =
  | { action: "review"; checks: Partial<ReviewChecks>; notes?: string }
  | { action: "quote"; regenerate?: boolean }
  | { action: "quote-pdf-status"; revisionId: string; status: QuotePdfStatus; driveFileId?: string; driveUrl?: string; error?: string }
  | { action: "set-additional-charges"; charges: BookingAdditionalChargeInput[] }
  | { action: "amend"; reason: string; patch: { client: { name: string; email: string; phone?: string; companyName: string; requester?: { name: string; email: string; phone?: string; companyName: string }; clientName?: string; clientCompany?: string; invoiceReference?: string }; service: { eventDate: string; startTime: string; endTime?: string; guestCount: number; floorLevel?: string; roomOrArea?: string; deliveryPoint?: string; onsiteContactName?: string; onsiteContactPhone?: string }; order: { eventType?: string; items: Array<{ itemId: string; itemName?: string; category?: string; description?: string; servingInfo?: string; unitPrice: number; quantity: number; choices?: unknown[]; comments?: string }> }; notes?: string; dietaries?: Record<string, unknown>; deliveryChargeRequired?: boolean } }
  | { action: "approve"; quoteRevisionId: string }
  | { action: "complete"; notes?: string }
  | { action: "cancel"; reason: string; removeCalendar?: boolean; cancelProduction?: boolean; notify?: boolean };

const HOSPITALITY_CANCELLATION_SAFE_PRODUCTION_STATES = new Set(["received", "draft", "needs_review", "needs_clarification"]);

export function hospitalityCancellationRequiresCpuReview(productionStatuses: string[]) {
  const unsafe = productionStatuses.filter(status => !["cancelled", "amended"].includes(status) && !HOSPITALITY_CANCELLATION_SAFE_PRODUCTION_STATES.has(status));
  return unsafe.length > 0;
}

export function isQuoteStale(booking: { commercialVersion?: number; quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] } }) {
  const current = booking.quoteState?.revisions.find(revision => revision.id === booking.quoteState?.currentRevisionId);
  return !current || current.stale || current.commercialVersion !== (booking.commercialVersion || 1);
}

export function applyBookingAdditionalCharges(
  booking: {
    version: number;
    commercialVersion?: number;
    additionalCharges?: BookingAdditionalCharge[];
    quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] };
  },
  additionalCharges: BookingAdditionalCharge[],
) {
  return {
    version: booking.version + 1,
    commercialVersion: (booking.commercialVersion || 1) + 1,
    additionalCharges: structuredClone(additionalCharges),
    quoteState: {
      ...(booking.quoteState || { revisions: [] }),
      revisions: (booking.quoteState?.revisions || []).map((revision) => ({ ...revision, stale: true })),
    },
  };
}

export function assertBookingExpectedVersion(actual: number, expected: number, action?: WorkflowCommand["action"]) {
  if (actual !== expected) {
    const status = action === "set-additional-charges" ? 409 : 422;
    throw Object.assign(new Error(action === "set-additional-charges"
      ? "Booking changed elsewhere. Refresh before saving additional charges."
      : "Booking changed elsewhere. Refresh and try again."), { status });
  }
}

export function applyQuotePdfPersistence(revisions: QuoteRevision[], currentRevisionId: string | undefined, revisionId: string, status: QuotePdfStatus, driveFileId?: string, driveUrl?: string, error?: string) {
  if (!currentRevisionId || currentRevisionId !== revisionId) throw workflowError("The quote revision is no longer current.");
  const current = revisions.find((revision) => revision.id === revisionId);
  if (!current || current.stale) throw workflowError("A stale quote PDF cannot be persisted.");
  if (status === "saved" && !driveFileId) throw workflowError("A saved quote PDF must include its Drive file ID.");
  return revisions.map((revision) => revision.id === revisionId ? {
    ...revision,
    pdfStatus: status,
    ...(driveFileId ? { driveFileId } : {}),
    ...(driveUrl ? { driveUrl } : {}),
    ...(error ? { pdfError: error } : {}),
  } : revision);
}

/**
 * Lifecycle statuses in which commercial charges, and the revised quote that reflects them, may be maintained directly.
 * `Completed` is included on purpose: a handed-off Booking is auto-completed, yet its additional charges (labour, equipment,
 * building/site, other) stay commercially editable. Charges are commercial only: they never change the lifecycle, the Production
 * Order or the production lineage, and the hand-off itself stays gated on Quoted/Approved. `Sent to CPU` and `Cancelled` remain closed.
 */
export const COMMERCIAL_EDITABLE_STATUSES = ["New", "Reviewed", "Quoted", "Completed"] as const;
export const isCommerciallyEditable = (lifecycleStatus: BookingStatus) => (COMMERCIAL_EDITABLE_STATUSES as readonly string[]).includes(lifecycleStatus);

export function assertWorkflowCommand(booking: { lifecycleStatus: BookingStatus; commercialVersion?: number; quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] } }, command: WorkflowCommand) {
  if (command.action === "review") {
    if (booking.lifecycleStatus !== "New") throw workflowError("Only a new Booking can be reviewed.");
  }
  if (command.action === "quote" && !isCommerciallyEditable(booking.lifecycleStatus) && !("bookingGroup" in booking && booking.bookingGroup && booking.lifecycleStatus === "Sent to CPU")) throw workflowError("Generate a quote only for a new, active or completed Booking.");
  if (command.action === "set-additional-charges" && !isCommerciallyEditable(booking.lifecycleStatus))
    throw workflowError("Additional charges can be changed directly before CPU hand-off and on a completed Booking. Reopen the Booking through its governed amendment workflow to change commercial intent in any other state.");
  if (command.action === "amend" && !command.reason.trim()) throw workflowError("An amendment reason is required.");
  if (command.action === "approve") throw workflowError("Quote approval has been removed. Send the current quote to CPU instead.");
  if (command.action === "complete") {
    if (!["Quoted", "Sent to CPU", "Approved"].includes(booking.lifecycleStatus)) throw workflowError("Only a quoted or CPU-submitted Booking can be completed.");
    const current = booking.quoteState?.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId);
    if (!current || current.stale || current.pdfStatus !== "saved" || !current.driveFileId) throw workflowError("Complete the current quote PDF save before marking this Booking complete.");
  }
}

function workflowError(message: string) { return Object.assign(new Error(message), { status: 422 }); }
