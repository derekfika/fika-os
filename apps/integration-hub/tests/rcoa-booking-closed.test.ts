import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { assertBookingSubmissionOpen, ingestMnkBooking, type MnkBookingPayload } from "../lib/hospitality-booking-service";

/** Records every Firestore access and outbound request attempted while `run` executes. */
async function withSideEffectSpies<T>(run: (attempts: string[]) => Promise<T>) {
  const attempts: string[] = [];
  const target = db as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  for (const method of ["runTransaction", "collection", "doc", "batch", "bulkWriter", "getAll", "collectionGroup"]) {
    originals.set(method, target[method]);
    target[method] = (...args: unknown[]) => { attempts.push(`firestore.${method}`); void args; throw new Error(`unexpected Firestore ${method}`); };
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => { attempts.push(`fetch ${String(input)}`); throw new Error("unexpected outbound request"); }) as typeof fetch;
  try { return await run(attempts); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [method, original] of originals) target[method] = original;
  }
}

const closedValues = [undefined, "", "false", "TRUE", "True", "1", "yes", " true"];

test("the Hub refuses RCoA booking ingestion unless the flag is exactly 'true' (fail-closed default)", () => {
  for (const value of closedValues) {
    assert.throws(
      () => assertBookingSubmissionOpen("rcoa", { FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED: value }),
      (error: Error & { status?: number; code?: string }) => error.status === 503 && error.code === "RCOA_BOOKING_SUBMISSIONS_CLOSED",
      `value ${JSON.stringify(value)}`,
    );
  }
  assert.doesNotThrow(() => assertBookingSubmissionOpen("rcoa", { FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED: "true" }));
});

test("other sites are unaffected by the RCoA flag", () => {
  for (const site of ["mnk", "angel-court", "cfc", "munich-re"]) {
    for (const value of closedValues) assert.doesNotThrow(() => assertBookingSubmissionOpen(site, { FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED: value }), `${site}/${JSON.stringify(value)}`);
  }
});

test("ingestMnkBooking rejects an RCoA payload before any store access when closed, and still enforces the OPLOC header when open", async () => {
  const previous = process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED;
  const payload = { bookingId: "rcoa-closed-gate", siteId: "rcoa" } as unknown as MnkBookingPayload;
  try {
    delete process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED;
    await withSideEffectSpies(async (attempts) => {
      await assert.rejects(ingestMnkBooking(payload, "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2"), (error: Error & { code?: string }) => error.code === "RCOA_BOOKING_SUBMISSIONS_CLOSED");
      // Not just the status: no Booking document, transaction, outbox/notification or CPU/Logistics call was attempted.
      assert.deepEqual(attempts, []);
    });
    process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED = "true";
    // Open: the closed gate no longer applies; the pre-existing expected-OPLOC requirement still does (no store is reached).
    await withSideEffectSpies(async (attempts) => {
      await assert.rejects(ingestMnkBooking(payload, undefined), (error: Error & { code?: string }) => error.code !== "RCOA_BOOKING_SUBMISSIONS_CLOSED");
      assert.deepEqual(attempts, []);
    });
  } finally {
    if (previous === undefined) delete process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED; else process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED = previous;
  }
});

test("positive control: the side-effect spies do observe store access when an RCoA booking is allowed through the gate", async () => {
  const previous = process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED;
  process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED = "true";
  try {
    await withSideEffectSpies(async (attempts) => {
      await assert.rejects(ingestMnkBooking({ bookingId: "rcoa-control", siteId: "rcoa" } as unknown as MnkBookingPayload, "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2"), /unexpected Firestore|Firestore/);
      assert.ok(attempts.some((attempt) => attempt.startsWith("firestore.")), `expected a Firestore access, saw ${JSON.stringify(attempts)}`);
    });
  } finally {
    if (previous === undefined) delete process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED; else process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED = previous;
  }
});

test("production and staging configuration keep RCoA submissions closed by default", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const path of ["../apphosting.production.yaml", "../../hospitality-booking/apphosting.production.yaml"]) {
    assert.match(read(path), /variable: FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED\r?\n\s+value: "false"/, path);
  }
  for (const path of ["../apphosting.staging.yaml", "../../hospitality-booking/apphosting.staging.yaml", "../apphosting.production.yaml", "../../hospitality-booking/apphosting.production.yaml"]) {
    assert.doesNotMatch(read(path), /FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED\r?\n\s+value: "?true/, path);
  }
});
