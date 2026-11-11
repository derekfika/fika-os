import type { Metadata } from "next";
import { CustomerBookingsDashboard } from "@/lib/rcoa-dashboard/CustomerBookingsDashboard";
import { rcoaDashboardConfig } from "@/lib/rcoa-dashboard/config";

export const metadata: Metadata = {
  title: "RCoA Hospitality Bookings",
  description: "Read-only RCoA Hospitality booking dashboard.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function RcoaHospitalityBookingsPage() {
  return <CustomerBookingsDashboard config={rcoaDashboardConfig} />;
}
