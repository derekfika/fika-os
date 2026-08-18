export type BookingStatus = "New" | "Reviewed" | "Quoted" | "Approved" | "Completed" | "Cancelled";
export type ReviewChecks = { commercialIntent: boolean; serviceTiming: boolean; deliveryContext: boolean; dietaryRequirements: boolean };
export type QuoteRevision = { id: string; revision: number; createdAt: string; createdBy: string; commercialVersion: number; snapshot: unknown; documentReference: string; stale: boolean };
export type DashboardWorkflow = { review?: { checks: ReviewChecks; reviewedAt: string; reviewedBy: string; notes?: string }; completion?: { completedAt: string; completedBy: string; notes?: string }; cancellation?: { reason: string; calendarOutcome: "not_requested" | "not_configured"; productionOutcome: "not_requested" | "cancel_requested" | "cancelled" | "no_active_production_order"; notificationOutcome: "not_requested" | "not_configured" } };
export type WorkflowCommand =
  | { action: "review"; checks: ReviewChecks; notes?: string }
  | { action: "quote"; regenerate?: boolean }
  | { action: "amend"; reason: string; patch: { client: { name: string; email: string; phone?: string; companyName: string; invoiceReference?: string }; service: { eventDate: string; startTime: string; endTime?: string; guestCount: number; floorLevel?: string; roomOrArea?: string; deliveryPoint?: string; onsiteContactName?: string; onsiteContactPhone?: string }; order: { eventType?: string; items: Array<{ itemId: string; itemName?: string; category?: string; description?: string; servingInfo?: string; unitPrice: number; quantity: number; choices?: unknown[]; comments?: string }> }; notes?: string; deliveryChargeRequired?: boolean } }
  | { action: "approve"; quoteRevisionId: string }
  | { action: "complete"; notes?: string }
  | { action: "cancel"; reason: string; removeCalendar?: boolean; cancelProduction?: boolean; notify?: boolean };

export function isQuoteStale(booking: { commercialVersion?: number; quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] } }) {
  const current = booking.quoteState?.revisions.find(revision => revision.id === booking.quoteState?.currentRevisionId);
  return !current || current.stale || current.commercialVersion !== (booking.commercialVersion || 1);
}

export function assertWorkflowCommand(booking: { lifecycleStatus: BookingStatus; commercialVersion?: number; quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] } }, command: WorkflowCommand) {
  if (command.action === "review") {
    if (booking.lifecycleStatus !== "New") throw workflowError("Only a new Booking can be reviewed.");
    if (!Object.values(command.checks).every(Boolean)) throw workflowError("Complete every review check before marking this Booking reviewed.");
  }
  if (command.action === "quote" && !["Reviewed", "Quoted"].includes(booking.lifecycleStatus)) throw workflowError("Review the Booking before generating a quote.");
  if (command.action === "amend" && !command.reason.trim()) throw workflowError("An amendment reason is required.");
  if (command.action === "approve") {
    if (booking.lifecycleStatus !== "Quoted") throw workflowError("Only a quoted Booking can be approved.");
    const revision = booking.quoteState?.revisions.find(item => item.id === command.quoteRevisionId);
    if (!revision || revision.id !== booking.quoteState?.currentRevisionId || isQuoteStale(booking)) throw workflowError("Approval requires the current, non-stale quote revision.");
  }
  if (command.action === "complete" && booking.lifecycleStatus !== "Approved") throw workflowError("Only an approved Booking can be completed.");
  if (command.action === "cancel" && ["Completed", "Cancelled"].includes(booking.lifecycleStatus)) throw workflowError("A completed or cancelled Booking cannot be cancelled again.");
}

function workflowError(message: string) { return Object.assign(new Error(message), { status: 422 }); }
