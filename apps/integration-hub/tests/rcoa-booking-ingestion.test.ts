import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { db } from "../lib/firebase-admin";
import { assertExpectedRcoaOploc, ingestMnkBooking, type MnkBookingPayload } from "../lib/hospitality-booking-service";
import { POST as bridgePost } from "../app/api/bookings/mnk/route";

const RCOA_OPLOC = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const rcoaPayload = { bookingId: "RCOA-INGEST-1", siteId: "rcoa" } as unknown as MnkBookingPayload;

/** Records every Firestore access and outbound request attempted while `run` executes. */
async function withSideEffectSpies<T>(run: (attempts: string[]) => Promise<T>) {
  const attempts: string[] = [];
  const target = db as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  for (const method of ["runTransaction", "collection", "doc", "batch", "bulkWriter", "getAll", "collectionGroup"]) {
    originals.set(method, target[method]);
    target[method] = () => { attempts.push(`firestore.${method}`); throw new Error(`unexpected Firestore ${method}`); };
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => { attempts.push(`fetch ${String(input)}`); throw new Error("unexpected outbound request"); }) as typeof fetch;
  try { return await run(attempts); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [method, original] of originals) target[method] = original;
  }
}

async function withBridgeToken<T>(token: string | undefined, run: () => Promise<T>) {
  const previous = process.env.MNK_CANON_BRIDGE_TOKEN;
  if (token === undefined) delete process.env.MNK_CANON_BRIDGE_TOKEN; else process.env.MNK_CANON_BRIDGE_TOKEN = token;
  try { return await run(); }
  finally { if (previous === undefined) delete process.env.MNK_CANON_BRIDGE_TOKEN; else process.env.MNK_CANON_BRIDGE_TOKEN = previous; }
}

const bridgeRequest = (headers: Record<string, string>, body: unknown = {}) =>
  new NextRequest("https://hub.test/api/bookings/mnk", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("RCoA is not gated by any rollout flag: a valid ingestion proceeds to the authoritative store", async () => {
  assert.deepEqual(Object.keys(process.env).filter((key) => /RCOA.*(SUBMISSION|ENABLED|OPEN|CLOSED)/i.test(key)), []);
  await withSideEffectSpies(async (attempts) => {
    await assert.rejects(ingestMnkBooking(rcoaPayload, RCOA_OPLOC), /Firestore/);
    assert.ok(attempts.some((attempt) => attempt.startsWith("firestore.")), `expected the ingestion transaction to start, saw ${JSON.stringify(attempts)}`);
  });
});

test("an RCoA submission without the governed expected-OPLOC header is refused before any store access or side effect", async () => {
  await withSideEffectSpies(async (attempts) => {
    await assert.rejects(ingestMnkBooking(rcoaPayload, undefined), (error: Error & { status?: number }) => error.status === 503 && /FIKA_RCOA_OPLOC_ID is not configured/.test(error.message));
    await assert.rejects(ingestMnkBooking(rcoaPayload, "   "), (error: Error & { status?: number }) => error.status === 503);
    assert.deepEqual(attempts, []);
  });
});

test("the governed RCoA destination must be mapped, equal to the configured OPLOC, and active", () => {
  assert.throws(() => assertExpectedRcoaOploc(RCOA_OPLOC, undefined), /confirmed Hub provider-location mapping/);
  assert.throws(() => assertExpectedRcoaOploc(RCOA_OPLOC, "oploc:someone-else", "oploc:someone-else"), /configuration mismatch/);
  assert.throws(() => assertExpectedRcoaOploc(RCOA_OPLOC, RCOA_OPLOC, undefined), /not an active canonical destination/);
  assert.equal(assertExpectedRcoaOploc(RCOA_OPLOC, RCOA_OPLOC, RCOA_OPLOC), RCOA_OPLOC);
});

test("the bridge rejects unauthenticated or wrongly authenticated RCoA submissions before any store access", async () => {
  await withSideEffectSpies(async (attempts) => {
    await withBridgeToken("expected-token", async () => {
      const missing = await bridgePost(bridgeRequest({ "x-fika-expected-rcoa-oploc-id": RCOA_OPLOC }, { siteId: "rcoa" }));
      assert.equal(missing.status, 401);
      const wrong = await bridgePost(bridgeRequest({ "x-fika-mnk-bridge-token": "not-the-token", "x-fika-expected-rcoa-oploc-id": RCOA_OPLOC }, { siteId: "rcoa" }));
      assert.equal(wrong.status, 401);
    });
    await withBridgeToken(undefined, async () => {
      const unconfigured = await bridgePost(bridgeRequest({ "x-fika-mnk-bridge-token": "anything" }, { siteId: "rcoa" }));
      assert.equal(unconfigured.status, 503);
    });
    assert.deepEqual(attempts, []);
  });
});

test("an authenticated but invalid RCoA payload is rejected with a client error and nothing is written", async () => {
  await withSideEffectSpies(async (attempts) => {
    await withBridgeToken("expected-token", async () => {
      const response = await bridgePost(bridgeRequest({ "x-fika-mnk-bridge-token": "expected-token", "x-fika-expected-rcoa-oploc-id": RCOA_OPLOC }, { bookingId: "RCOA-BAD", siteId: "rcoa", client: { name: "No Email" } }));
      assert.equal(response.status, 400);
    });
    assert.deepEqual(attempts, []);
  });
});

test("neither Hub nor production configuration carries an RCoA rollout flag", async () => {
  const { readFileSync } = await import("node:fs");
  for (const path of ["../apphosting.production.yaml", "../apphosting.staging.yaml", "../../hospitality-booking/apphosting.production.yaml", "../../hospitality-booking/apphosting.staging.yaml", "../lib/hospitality-booking-service.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), /RCOA_BOOKING_SUBMISSIONS|assertBookingSubmissionOpen/, path);
  }
});
