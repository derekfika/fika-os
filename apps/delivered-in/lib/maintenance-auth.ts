import type { NextRequest } from "next/server";

/** Maintenance is a service-to-service capability, never a manager session. */
export function deliveredInMaintenanceAllowed(request: NextRequest) {
  const configured = process.env.DELIVERED_IN_INTERNAL_API_TOKEN || process.env.FIKA_INTERNAL_API_TOKEN;
  return Boolean(configured && request.headers.get("x-fika-internal-token") === configured);
}

export function requireDeliveredInMaintenance(request: NextRequest) {
  if (!deliveredInMaintenanceAllowed(request)) throw Object.assign(new Error("Explicit Delivered-In maintenance authentication is required."), { status: 401, code: "DELIVERED_IN_MAINTENANCE_AUTH_REQUIRED" });
}
