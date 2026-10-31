import { hubFetch } from "./hub";

/** A bounded server-to-server existence check; it grants no mutation authority or historical data access. */
export async function existingRcoaBookingIds(bookingIds: string[]): Promise<Set<string>> {
  const response = await hubFetch("/api/bookings/mnk/existing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingIds }) });
  if (!response.ok) throw Object.assign(new Error("Existing services could not be verified. Retry the same request shortly."), { status: 503 });
  const body = await response.json() as { existingBookingIds?: unknown };
  if (!Array.isArray(body.existingBookingIds) || body.existingBookingIds.some(id => typeof id !== "string" || !bookingIds.includes(id))) throw Object.assign(new Error("Existing services could not be verified. Retry the same request shortly."), { status: 503 });
  return new Set(body.existingBookingIds as string[]);
}
