import type { ProductionOrder } from "../../lib/production-types";
import type { CpuDayProjection } from "../../lib/cpu-projection";
import { cpuProjectionToOrders } from "../../lib/cpu-dashboard-adapter";
import { isCpuWithdrawn } from "../../lib/production-presentation";
/** Deliberate print-time, fresh whole-day read. Never uses viewport/filtered/week cache data. */
export async function loadWholeDay(
  day: string,
  fetcher: typeof fetch = fetch,
): Promise<ProductionOrder[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw Error("Select a production date before printing.");
  const response = await fetcher(
    `/api/production?projection=1&serviceDate=${encodeURIComponent(day)}&scope=all`,
    { cache: "no-store", redirect: "error" },
  );
  if (!response.ok)
    throw Error(
      "The complete production day could not be verified. Refresh and retry.",
    );
  const body = (await response.json()) as {
    projection?: CpuDayProjection;
    nextPageToken?: string;
    partial?: boolean;
  };
  const p = body.projection;
  if (
    !p ||
    p.serviceDate !== day ||
    !Array.isArray(p.orders) ||
    body.nextPageToken ||
    body.partial ||
    p.summary?.orders !== p.orders.length ||
    p.orders.some(
      (row) => row.serviceDate !== day || !Array.isArray(row.quantities),
    )
  )
    throw Error(
      "Production data is incomplete or belongs to another day. Nothing was printed.",
    );
  return cpuProjectionToOrders(p).filter(order => !isCpuWithdrawn(order));
}
