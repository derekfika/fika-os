import type { LogisticsDayProjection } from "./types";

type ProjectionBody = Record<string, unknown> & { projection?: LogisticsDayProjection; projectionState?: string; state?: string; error?: { code?: string } };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function readBody(response: Response) {
  return await response.clone().json().catch(() => null) as ProjectionBody | null;
}

/**
 * Materialises a missing or stale day once, then tolerates the short visibility gap
 * between the command response and the projection read. The expected sequence
 * prevents an older projection from being accepted after reconciliation.
 */
export async function fetchProjectionWithRecovery(input: {
  serviceDate: string;
  vehicleQuery?: string;
  fetcher?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  retryDelays?: number[];
}) {
  const fetcher = input.fetcher || fetch;
  const sleep = input.sleep || wait;
  const vehicleQuery = input.vehicleQuery || "";
  const url = `/api/logistics?projection=1&serviceDate=${encodeURIComponent(input.serviceDate)}${vehicleQuery}`;
  let response = await fetcher(url, { cache: "no-store" });
  let body = await readBody(response);
  const stale = response.ok && (body?.projectionState === "STALE" || body?.projection?.state === "STALE");
  const missing = !response.ok && body?.error?.code === "LOGISTICS_PROJECTION_NOT_MATERIALIZED";
  if (!stale && !missing) return { response, body };

  const reconcileResponse = await fetcher("/api/logistics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reconcile-logistics-day", serviceDate: input.serviceDate }),
  });
  const reconcileBody = await readBody(reconcileResponse);
  if (!reconcileResponse.ok) return { response: reconcileResponse, body: reconcileBody };
  const expectedSequence = Number((reconcileBody?.projection as LogisticsDayProjection | undefined)?.lastChangeSequence || 0);

  for (const delay of input.retryDelays || [0, 100, 250, 500]) {
    if (delay) await sleep(delay);
    response = await fetcher(url, { cache: "no-store" });
    body = await readBody(response);
    const projection = body?.projection;
    const validEmpty = body?.projectionState === "VALID_EMPTY" || body?.state === "EMPTY";
    const stillStale = body?.projectionState === "STALE" || projection?.state === "STALE";
    if (response.ok && !stillStale && (validEmpty || (projection && projection.lastChangeSequence >= expectedSequence))) return { response, body };
    if (!response.ok && body?.error?.code !== "LOGISTICS_PROJECTION_NOT_MATERIALIZED") return { response, body };
  }
  return { response, body };
}
