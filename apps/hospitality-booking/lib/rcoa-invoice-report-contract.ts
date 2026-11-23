export type RcoaInvoiceReportRow = {
  canonicalId: string;
  serviceDate: string;
  serviceTime: string;
  meetingTitle: string;
  bookingReference: string;
  client: string;
  lifecycleStatus: string;
  exVatPence?: number;
  financialIssue?: string;
};

export type RcoaInvoiceReport = {
  startDate: string;
  endDate: string;
  generatedAt: string;
  bookings: RcoaInvoiceReportRow[];
  bookingCount: number;
  confirmedExVatPence: number;
  unresolvedCount: number;
  financialCoverageComplete: boolean;
  excludedCancelledCount: number;
  excludedUnconfirmedCount: number;
  dataDigest: string;
};
