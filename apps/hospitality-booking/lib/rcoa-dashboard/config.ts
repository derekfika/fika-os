export type CustomerDashboardConfig = {
  siteName: string;
  brandLabel: string;
  logoPath: string;
  title: string;
  lead: string;
  dataPath: string;
  sessionPath: string;
  searchPlaceholder: string;
  emptyMessage: string;
  readOnlyMessage: string;
  identityLabel: string;
  allowIdentity: boolean;
  allowCommercial: boolean;
  allowNotes: boolean;
  statusOptions: string[];
  bookingHref?: string;
  supportHref?: string;
  supportLabel?: string;
  brandClass?: string;
  navigation?: Array<{ label: string; href: string; active?: boolean }>;
  bookingLabel?: string;
  secondaryActionLabel?: string;
};

export const gallagherDashboardConfig: CustomerDashboardConfig = {
  siteName: "One Angel Court",
  brandLabel: "Hospitality bookings",
  logoPath: "/brand/angel-court/angel-court-bank-logo.png",
  title: "Gallagher bookings",
  lead: "Your hospitality bookings, upcoming and past.",
  dataPath: "/angel-court/gallagher/data",
  sessionPath: "/angel-court/gallagher/session",
  searchPlaceholder: "Client, reference, item, room…",
  emptyMessage: "Bookings made for Gallagher at One Angel Court will appear here.",
  readOnlyMessage: "This dashboard is view-only. To change or cancel a future booking, please contact the on-site manager.",
  identityLabel: "Client",
  allowIdentity: true,
  allowCommercial: true,
  allowNotes: true,
  statusOptions: ["Upcoming", "Completed", "Cancelled"],
};

export const rcoaDashboardConfig: CustomerDashboardConfig = {
  siteName: "Royal College of Anaesthetists",
  brandLabel: "Hospitality bookings",
  logoPath: "/brand/rcoa/rcoa-logo-white.svg",
  title: "RCoA Hospitality Dashboard",
  lead: "View your hospitality bookings, upcoming and past.",
  dataPath: "/api/rcoa-dashboard",
  sessionPath: "/api/rcoa-dashboard/session",
  searchPlaceholder: "Search bookings, reference, location or item…",
  emptyMessage: "RCoA Hospitality bookings will appear here.",
  readOnlyMessage: "This dashboard is view-only. To change a booking, please contact the RCoA hospitality team.",
  identityLabel: "Service",
  allowIdentity: false,
  allowCommercial: false,
  allowNotes: false,
  statusOptions: ["New", "Reviewed", "Quoted", "Sent to CPU", "Approved", "Amended", "Completed", "Cancelled", "Partially cancelled", "In progress"],
  bookingHref: "/rcoa",
  supportHref: "mailto:rcoa@fikacatering.com?subject=RCoA%20Hospitality%20Dashboard%20support",
  supportLabel: "Support",
  brandClass: "rcoa",
  navigation: [
    { label: "Dashboard", href: "/rcoa/bookings", active: true },
    { label: "Bookings", href: "/rcoa" },
    { label: "Support", href: "mailto:rcoa@fikacatering.com?subject=RCoA%20Hospitality%20Dashboard%20support" },
  ],
  bookingLabel: "New booking",
  secondaryActionLabel: "Help",
};
