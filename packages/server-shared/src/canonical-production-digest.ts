import { createHash } from "node:crypto";

/**
 * Canonical Production Order fingerprint.
 *
 * A bounded signal of "which canonical orders exist, at which version, in which status" for a scope (one service day
 * or one week). It is derived from the stable tuple `canonicalId | canonical version | status` of EVERY order the Hub
 * holds for the scope - including cancelled ones, because a cancellation is exactly the kind of canonical change a derived
 * projection must not hide. A CPU projection stores the digest it was built from; comparing it with the Hub's current
 * digest detects divergence without reading order bodies.
 */

export type CanonicalOrderTuple = { canonicalId: string; version: number; status: string; serviceDate?: string };
export type CanonicalProductionDigest = { digest: string; count: number };
export type CanonicalProductionDigestSet = CanonicalProductionDigest & { days: Record<string, CanonicalProductionDigest> };

const tuple = (order: CanonicalOrderTuple) => `${order.canonicalId}|${order.version}|${order.status}`;

export function canonicalProductionDigest(orders: CanonicalOrderTuple[]): CanonicalProductionDigest {
  const lines = orders.map(tuple).sort();
  return { digest: createHash("sha256").update(lines.join("\n")).digest("hex"), count: lines.length };
}

/** Digest for a scope plus a per-service-day breakdown (orders with no service date are counted in the scope digest only). */
export function canonicalProductionDigestSet(orders: CanonicalOrderTuple[]): CanonicalProductionDigestSet {
  const days: Record<string, CanonicalOrderTuple[]> = {};
  for (const order of orders) if (order.serviceDate) (days[order.serviceDate] ||= []).push(order);
  return { ...canonicalProductionDigest(orders), days: Object.fromEntries(Object.keys(days).sort().map(date => [date, canonicalProductionDigest(days[date])])) };
}

/** A stored digest is consistent with the authoritative one only when both digest and count agree. */
export function canonicalDigestsMatch(stored: Partial<CanonicalProductionDigest> | undefined, authoritative: CanonicalProductionDigest) {
  return Boolean(stored?.digest) && stored!.digest === authoritative.digest && stored!.count === authoritative.count;
}
