/** Remove a previous CPU handoff result once an amendment changes the booking. */
export function clearServiceResult<T>(results: Record<string, T>, bookingId: string): Record<string, T> {
  if (!Object.hasOwn(results, bookingId)) return results;
  const next = { ...results };
  delete next[bookingId];
  return next;
}
