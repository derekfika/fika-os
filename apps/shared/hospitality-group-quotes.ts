/** Hub-owned additive read contract. Child bookings remain the operational authority. */
export type GroupMoneyTotals = { itemsNet: number; chargesNet: number; net: number; vat: number; gross: number };
export type GroupQuoteStatus = "artifact_pending" | "failed" | "integrity_failed" | "complete" | "superseded";
export type HospitalityGroupService = {
  bookingId: string; sourceReference: string; commercialVersion: number; lifecycleStatus: string;
  serviceType: string; time: string; endTime?: string; location: string; guests: number;
  lines: Array<{ name: string; description?: string; quantity: number; unitNet: number; net: number; choices?: unknown[]; comments?: string }>;
  charges: Array<{ label: string; net: number; detail?: string }>;
  totals: GroupMoneyTotals;
  production?: { orderId: string; version: number; sourceRevision: number; status: string; quoteRevisionId: string; quoteCurrent: boolean };
  cancellation?: { downstreamPropagation: "pending" | "delivered" | "review_required"; productionOutcome: string };
  routing?: { status: string; statusLabel: string; lines: Array<{ index: number; state: string; label: string }> };
};
export type HospitalityGroupQuoteState = {
  id: string; revision: number; status: GroupQuoteStatus; sourceHash: string;
  createdAt: string; updatedAt: string; driveUrl?: string; error?: string; stale: boolean;
};
export type HospitalityBookingGroup = {
  kind: "booking-group"; id: string; reference: string; version: number; sourceHash: string;
  client: { name: string; companyName: string; email: string; phone?: string; invoiceReference?: string };
  eventDate: string; eventName?: string; firstTime: string; lastTime: string;
  status: "New" | "Quote preparing" | "Quoted" | "Awaiting quote" | "Awaiting routing" | "Ready for CPU" | "Sent to CPU" | "Needs attention" | "Partially processed" | "Cancelled" | "Completed";
  services: HospitalityGroupService[]; totals: GroupMoneyTotals; quote?: HospitalityGroupQuoteState;
  routing: { cpuServices: number; inHouseServices: number; warnings: number };
};
