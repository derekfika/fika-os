import assert from "node:assert/strict";
import test from "node:test";
import { errorResponse } from "../lib/api";
import { assertExpectedRcoaOploc } from "../lib/hospitality-booking-service";

test("a masked 5xx stays generic to the caller but its real cause is logged against the same requestId", async () => {
  const errors: unknown[][] = []; const original = console.error; console.error = (...args: unknown[]) => { errors.push(args); };
  let response: Response;
  try {
    // The exact failure a generic RCoA submission produced: the governed expected-OPLOC header was absent.
    try { assertExpectedRcoaOploc(undefined, undefined); assert.fail("must fail closed"); } catch (error) { response = errorResponse(error, "req-123"); }
  } finally { console.error = original; }
  const body = await response!.json();
  assert.equal(response!.status, 503);
  assert.equal(body.error.requestId, "req-123");
  assert.doesNotMatch(JSON.stringify(body), /FIKA_RCOA_OPLOC_ID/, "the user-facing body does not expose the configuration detail");
  const logged = errors.find(args => args[0] === "API request failed")?.[1] as Record<string, unknown>;
  assert.equal(logged.requestId, "req-123"); assert.equal(logged.status, 503);
  assert.match(String(logged.errorMessage), /FIKA_RCOA_OPLOC_ID is not configured/, "the actionable cause is in the server log");
});

test("the Hub still refuses an RCoA booking without the expected OPLOC (validation is not weakened)", () => {
  assert.throws(() => assertExpectedRcoaOploc(undefined, undefined), (error: { status?: number }) => error.status === 503);
  assert.throws(() => assertExpectedRcoaOploc("oploc:a", "oploc:b"), /configuration mismatch/);
});
