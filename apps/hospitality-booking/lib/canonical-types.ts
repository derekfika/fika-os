export type CanonicalBooking = {
  canonicalId: string;
  entityType: "Booking";
  schemaVersion: string;
  version: number;
  lifecycleStatus: "New" | "Reviewed" | "Quoted" | "Sent to CPU" | "Approved" | "Completed" | "Cancelled";
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  source: { provider: string; sourceBookingId: string; submissionTimestamp: string; contractVersion: string; originalPayload: unknown };
  client: { name: string; email: string; phone?: string; companyName: string; requester?: { name: string; email: string; phone?: string; companyName: string }; clientName?: string; clientCompany?: string; invoiceReference?: string };
  service: { eventDate: string; startTime: string; endTime?: string; guestCount: number; floorLevel?: string; roomOrArea?: string; deliveryPoint?: string; onsiteContactName?: string; onsiteContactPhone?: string; portalSiteId?: string; portalSiteLabel?: string; oplocId?: string; operationalAreaId?: string; serviceArrangementId?: string };
  order: { eventType?: string; items: Array<{ itemId: string; itemName?: string; category?: string; description?: string; servingInfo?: string; unitPrice: number; quantity: number; lineTotal: number; choices?: unknown[]; comments?: string; menuItemId?: string }>; netTotal: number; vatNote?: string; currency: "GBP"; vatTotal: number; grossTotal: number };
  dietaries: Record<string, unknown>; acknowledgements: Record<string, unknown>; notes?: string; attachments: string[];
  statusHistory: Array<{ status: CanonicalBooking["lifecycleStatus"]; changedAt: string; changedBy: string; reason: string }>;
  audit: Array<{ action: string; at: string; by: string; reason: string }>;
  commercialVersion?: number;
  quoteState?: { currentRevisionId?: string; revisions: Array<{ id: string; revision: number; createdAt: string; stale?: boolean; snapshot: Record<string, unknown>; driveUrl?: string; driveFileId?: string; pdfStatus?: string }> };
  dashboardWorkflow?: Record<string, unknown>;
  deliveryChargeRequired?: boolean;
};

export type DashboardQuoteSettings = Record<string, any>;

export type ProductionOrder = {
  canonicalId: string; bookingId: string; state: "Requested" | "Planned" | "Cancelled" | "Uncertain"; updatedAt?: string; createdAt: string; createdBy: string;
  attempts: Array<{ at: string; by: string; outcome: "created" | "uncertain" | "cancel_requested"; reason: string }>;
  sourceReferences: { bookingId: string; quoteRevisionId: string; bookingJsonReference: string; sourceBookingReference: string };
};
