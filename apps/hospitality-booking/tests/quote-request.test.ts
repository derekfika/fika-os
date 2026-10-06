import assert from "node:assert/strict";
import test from "node:test";
import { fetchQuoteRequest } from "../lib/quote-request";

test("quote request times out even when headers arrive but the body never finishes", async () => {
  let signal: AbortSignal | null | undefined;
  const fetcher = (async (_: unknown, init: RequestInit) => {
    signal = init.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"booking":')); } }));
  }) as typeof fetch;
  await assert.rejects(fetchQuoteRequest("https://example.test", {}, "Quote timed out", 10, fetcher), /Quote timed out/);
  assert.equal(signal?.aborted, true);
});

test("quote response preserves HTTP failure and settles for a subsequent retry", async () => {
  let calls = 0;
  const fetcher = (async () => ++calls === 1
    ? new Response('{"error":{"message":"Try again"}}', { status: 503 })
    : new Response('{"booking":{"version":3}}')) as typeof fetch;
  const failed = await fetchQuoteRequest("https://example.test", {}, "Timeout", 100, fetcher);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error.message, "Try again");
  const retry = await fetchQuoteRequest("https://example.test", {}, "Timeout", 100, fetcher);
  assert.equal((await retry.json()).booking.version, 3);
  assert.equal(calls, 2);
});

test("network errors remain visible and a fetch that ignores abort still settles", async () => {
  await assert.rejects(fetchQuoteRequest("https://example.test", {}, "Timeout", 100, (async () => { throw new Error("Network unavailable"); }) as typeof fetch), /Network unavailable/);
  await assert.rejects(fetchQuoteRequest("https://example.test", {}, "Timeout", 10, (() => new Promise(() => {})) as typeof fetch), /Timeout/);
});
