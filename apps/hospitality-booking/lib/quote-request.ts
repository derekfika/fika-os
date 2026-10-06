/** Bound the complete response, including a body that stalls after headers. */
export async function fetchQuoteRequest(input: RequestInfo | URL, init: RequestInit, timeoutMessage: string, timeoutMs = 60_000, fetcher = fetch) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(input, { ...init, signal: controller.signal });
        const body = await response.text();
        return new Response(body || null, { status: response.status, statusText: response.statusText, headers: response.headers });
      })(),
      expired,
    ]);
  } catch (cause) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw cause;
  } finally {
    clearTimeout(timeout!);
  }
}
