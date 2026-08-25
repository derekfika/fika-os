export type BookingStatus = "New" | "Reviewed" | "Quoted" | "Sent to CPU" | "Approved" | "Completed" | "Cancelled";
export type ReviewChecks = { commercialIntent: boolean; serviceTiming: boolean; deliveryContext: boolean; dietaryRequirements: boolean };
export type QuotePdfStatus = "pending" | "saved" | "failed";
export type QuoteRevision = { id: string; revision: number; createdAt: string; createdBy: string; commercialVersion: number; snapshot: unknown; documentReference: string; stale: boolean; pdfStatus?: QuotePdfStatus; driveFileId?: string; driveUrl?: string; pdfError?: string };
export type DashboardWorkflow = { review?: { checks: ReviewChecks; reviewedAt: string; reviewedBy: string; notes?: string }; completion?: { completedAt: string; completedBy: string; notes?: string }; cancellation?: { reason: string; calendarOutcome: "not_requested" | "not_configured"; productionOutcome: "not_requested" | "cancel_requested" | "cancelled" | "no_active_production_order"; notificationOutcome: "not_requested" | "not_configured" } };
export type WorkflowCommand =
  | { action: "review"; checks: Partial<ReviewChecks>; notes?: string }
  | { action: "quote"; regenerate?: boolean }
  | { action: "quote-pdf-status"; revisionId: string; status: QuotePdfStatus; driveFileId?: string; driveUrl?: string; error?: string }
  | { action: "amend"; reason: string; patch: { client: { name: string; email: string; phone?: string; companyName: string; requester?: { name: string; email: string; phone?: string; companyName: string }; clientName?: string; clientCompany?: string; invoiceReference?: string }; service: { eventDate: string; startTime: string; endTime?: string; guestCount: number; floorLevel?: string; roomOrArea?: string; deliveryPoint?: string; onsiteContactName?: string; onsiteContactPhone?: string }; order: { eventType?: string; items: Array<{ itemId: string; itemName?: string; category?: string; description?: string; servingInfo?: string; unitPrice: number; quantity: number; choices?: unknown[]; comments?: string }> }; notes?: string; deliveryChargeRequired?: boolean } }
  | { action: "approve"; quoteRevisionId: string }
  | { action: "complete"; notes?: string }
  | { action: "cancel"; reason: string; removeCalendar?: boolean; cancelProduction?: boolean; notify?: boolean };

export function isQuoteStale(booking: { commercialVersion?: number; quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] } }) {
  const current = booking.quoteState?.revisions.find(revision => revision.id === booking.quoteState?.currentRevisionId);
  return !current || current.stale || current.commercialVersion !== (booking.commercialVersion || 1);
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

export function assertWorkflowCommand(booking: { lifecycleStatus: BookingStatus; commercialVersion?: number; quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] } }, command: WorkflowCommand) {
  if (command.action === "review") {
    if (booking.lifecycleStatus !== "New") throw workflowError("Only a new Booking can be reviewed.");
  }
  if (command.action === "quote" && !["New", "Reviewed", "Quoted"].includes(booking.lifecycleStatus)) throw workflowError("Generate a quote only for a new or active Booking.");
  if (command.action === "amend" && !command.reason.trim()) throw workflowError("An amendment reason is required.");
  if (command.action === "approve") throw workflowError("Quote approval has been removed. Send the current quote to CPU instead.");
  if (command.action === "complete") {
    if (!["Quoted", "Sent to CPU", "Approved"].includes(booking.lifecycleStatus)) throw workflowError("Only a quoted or CPU-submitted Booking can be completed.");
    const current = booking.quoteState?.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId);
    if (!current || current.stale || current.pdfStatus !== "saved" || !current.driveFileId) throw workflowError("Complete the current quote PDF save before marking this Booking complete.");
  }
  if (command.action === "cancel" && ["Completed", "Cancelled"].includes(booking.lifecycleStatus)) throw workflowError("A completed or cancelled Booking cannot be cancelled again.");
}

function workflowError(message: string) { return Object.assign(new Error(message), { status: 422 }); }
