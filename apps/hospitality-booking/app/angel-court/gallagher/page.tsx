import type { Metadata } from "next";
import GallagherDashboard from "./GallagherDashboard";

export const metadata: Metadata = {
  title: "Gallagher Bookings · One Angel Court",
  description: "Read-only Gallagher booking ledger for One Angel Court.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function GallagherBookingsPage() {
  return <GallagherDashboard />;
}
