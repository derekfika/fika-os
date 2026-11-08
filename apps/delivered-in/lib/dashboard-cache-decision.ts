/**
 * How long the dashboard waits for an optional IndexedDB cache read before it
 * falls back to the authoritative API. A valid cache hit inside this window
 * still avoids the full dashboard request.
 */
export const DELIVERED_IN_CACHE_WAIT_MS = 1_500;

export type CacheWaitOutcome = "settled" | "timed-out" | "rejected";

/**
 * Wait briefly for an optional cache read. Never throws, and never returns a
 * late result: once the window has closed the fallback is used and any later
 * settlement is ignored.
 */
export async function awaitDeliveredInCacheWithin<T>(
  operation: Promise<T>,
  fallback: T,
  waitMs = DELIVERED_IN_CACHE_WAIT_MS,
): Promise<{ value: T; outcome: CacheWaitOutcome }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Attach a handler up front so a late rejection is never unhandled.
  const guarded = operation.then(
    (value) => ({ kind: "settled" as const, value }),
    () => ({ kind: "rejected" as const }),
  );
  const waitWindow = new Promise<{ kind: "timed-out" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timed-out" }), waitMs);
  });
  try {
    const result = await Promise.race([guarded, waitWindow]);
    if (result.kind === "settled") return { value: result.value, outcome: "settled" };
    if (result.kind === "rejected") return { value: fallback, outcome: "rejected" };
    return { value: fallback, outcome: "timed-out" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type CacheableEntry = {
  serviceDate: string;
  projectionVersion: number;
  contentHash: string;
  state?: string;
};

export type CacheableDay = {
  date: string;
  projectionVersion?: number;
  contentHash?: string;
};

/** Old IndexedDB entries can predate server-side artifact containment. */
export function cachedDayHasArtifactAccess(value: unknown, artifact = false): boolean {
  if (Array.isArray(value)) return value.some(item => cachedDayHasArtifactAccess(item, artifact));
  if (!value || typeof value !== "object") return false;
  const pointers = new Set(["driveUrl", "driveFileId", "drivePdfUrl", "pdfDriveUrl", "pdfPath", "localUrl", "signedPdfUrl", "presentationUrl"]);
  return Object.entries(value).some(([key, item]) => {
    const context = artifact || /artifact|packet|bundle/i.test(key);
    if ((pointers.has(key) || (context && (key === "url" || key === "fileId"))) && typeof item === "string" && item.length > 0) return true;
    if (typeof item === "string" && /https?:\/\/(drive|docs)\.google\.com\//i.test(item)) return true;
    return cachedDayHasArtifactAccess(item, context);
  });
}

/**
 * Decide whether cached days can stand in for the authoritative dashboard.
 * Withdrawn entries are never shown from the cache, and a cache hit requires
 * every active entry to match the head's projection version and content hash.
 */
export function selectDeliveredInCachedDays<D extends CacheableDay>(input: {
  entries: CacheableEntry[];
  projectionState: string;
  cachedDays: D[];
  artifactLinksAllowed?: boolean;
}) {
  const activeEntries = input.entries.filter((entry) => entry.state !== "withdrawn");
  const safeCachedDays = input.artifactLinksAllowed === true
    ? input.cachedDays
    : input.cachedDays.filter(day => !cachedDayHasArtifactAccess(day));
  const cachedByDate = new Map(safeCachedDays.map((day) => [day.date, day]));
  const matches =
    input.projectionState === "current" &&
    activeEntries.every((entry) => {
      const cached = cachedByDate.get(entry.serviceDate);
      return Boolean(
        cached &&
          cached.projectionVersion === entry.projectionVersion &&
          cached.contentHash === entry.contentHash,
      );
    });
  const visibleCachedDays = safeCachedDays.filter((day) =>
    activeEntries.some((entry) => entry.serviceDate === day.date),
  );
  return { matches, visibleCachedDays };
}

/** Keep only records for the requesting account and OPLOC. */
export function selectScopedCachedValues<
  T extends { accountScope: string; oplocId: string },
>(values: T[], accountScope: string, oplocId: string) {
  return values.filter(
    (value) => value.accountScope === accountScope && value.oplocId === oplocId,
  );
}
