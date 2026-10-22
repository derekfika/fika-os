import type { ProductionScope } from "./production-scope";
import type { CpuWeekProjection } from "./cpu-projection";
import { cpuProjectionToOrders, filterCpuProjectionForScope } from "./cpu-dashboard-adapter";
import type { ProductionOrder } from "./production-types";
import { orderDate } from "./production-day";
import { productionWeeksInRange, type ProductionTotalsDateRange } from "./production-totals-range";

export type TotalsProjectionResponse = { ok: boolean; status?: number; json(): Promise<unknown> };
export type TotalsProjectionFetcher = (weekCommencing: string, scope: ProductionScope) => Promise<TotalsProjectionResponse>;
export type TotalsRangeLoadResult = { status: "current"; orders: ProductionOrder[] } | { status: "stale"; orders: [] };

function projectionBody(value: unknown, weekCommencing: string): { projection: CpuWeekProjection; package: { sourceVersion: string; contentHash: string } } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as { projection?: Partial<CpuWeekProjection>; package?: { sourceVersion?: unknown; contentHash?: unknown } };
  const projection = body.projection;
  const manifest = body.package;
  if (!projection || projection.serviceDate !== weekCommencing || projection.weekCommencing !== weekCommencing || !Number.isInteger(projection.revision) || !Number.isInteger(projection.lastChangeSequence) || !Array.isArray(projection.orders)) return undefined;
  if (typeof manifest?.sourceVersion !== "string" || manifest.sourceVersion !== `cpu-change-${projection.lastChangeSequence}` || typeof manifest.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.contentHash)) return undefined;
  return { projection: projection as CpuWeekProjection, package: { sourceVersion: manifest.sourceVersion, contentHash: manifest.contentHash } };
}

/** Reads the current weekly CPU packages that intersect a bounded totals range. */
export async function loadProductionTotalsRange(
  range: ProductionTotalsDateRange,
  scope: ProductionScope,
  fetchProjection: TotalsProjectionFetcher,
  isCurrentRequest: () => boolean = () => true,
): Promise<TotalsRangeLoadResult> {
  const weeks = productionWeeksInRange(range);
  if (!weeks.length) throw new Error("Choose a valid production date range of 31 days or fewer.");
  const projections = await Promise.all(weeks.map(async (week) => {
    const response = await fetchProjection(week, scope);
    if (!isCurrentRequest()) return undefined;
    const raw = await response.json().catch(() => undefined);
    const result = projectionBody(raw, week);
    if (!response.ok || !result) {
      const message = raw && typeof raw === "object" && (raw as { error?: { message?: unknown } }).error?.message;
      throw new Error(typeof message === "string" ? message : "Current production totals could not be verified. Refresh to try again.");
    }
    return result.projection;
  }));
  if (!isCurrentRequest()) return { status: "stale", orders: [] };

  const unique = new Map<string, ProductionOrder>();
  for (const projection of projections) {
    if (!projection) continue;
    const scoped = filterCpuProjectionForScope(projection, scope);
    for (const order of cpuProjectionToOrders(scoped)) {
      const date = orderDate(order);
      if (date < range.from || date > range.to) continue;
      const prior = unique.get(order.canonicalId);
      if (!prior || order.version > prior.version) unique.set(order.canonicalId, order);
    }
  }
  return { status: "current", orders: [...unique.values()] };
}
