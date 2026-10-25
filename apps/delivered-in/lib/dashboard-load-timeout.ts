export const DELIVERED_IN_DASHBOARD_LOAD_TIMEOUT_MS = 30_000;

/** Bound a dashboard loading step without aborting its request or recovery work. */
export async function withDeliveredInLoadTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = DELIVERED_IN_DASHBOARD_LOAD_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Delivered-In dashboard loading timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
