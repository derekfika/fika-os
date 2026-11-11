"use client";

import { CustomerBookingsDashboard } from "@/lib/rcoa-dashboard/CustomerBookingsDashboard";
import { gallagherDashboardConfig } from "@/lib/rcoa-dashboard/config";

/** Gallagher retains its own routes, cookie, PIN and legacy/canonical provider. */
export default function GallagherDashboard() {
  return <CustomerBookingsDashboard config={gallagherDashboardConfig} />;
}
