import assert from "node:assert/strict";
import test from "node:test";
import { readStudioBookingImpact } from "../lib/booking-impact";
import type { PublicationImpactTarget } from "../lib/publication";

const target: PublicationImpactTarget = { scope: "catalogue-item", firstEventDate: "2026-12-01", lastEventDate: "2026-12-30",
  catalogueItemIds: ["hospitality-menu-item:synthetic"] };
const complete = { coverage: "complete", scope: target.scope, bookings: [], reasons: [] };
const read = (response: Response) => readStudioBookingImpact("http://127.0.0.1:3100", "test_session=opaque", target, async () => response);

test("booking impact forwards only caller session and a bounded parent-product scope", async () => {
  let calls = 0;
  const result = await readStudioBookingImpact("http://127.0.0.1:3100", "test_session=opaque", target, async (url, init) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:3100/api/hospitality-studio-impact");
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(init?.body as string), target);
    assert.deepEqual(new Headers(init?.headers).get("cookie"), "test_session=opaque");
    assert.equal(new Headers(init?.headers).get("x-fika-internal-token"), null);
    return Response.json(complete);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: "available", coverage: "complete", bookings: [], reasons: [] });
});

test("booking impact preserves partial parent matches and refuses invalid or unavailable evidence", async () => {
  const booking = { id: "booking:synthetic", eventDate: "2026-12-10", site: "Example site", selectionIds: target.catalogueItemIds, selections: ["Synthetic"] };
  const partial = await read(Response.json({ ...complete, coverage: "partial", reasons: ["BOOKING_WINDOW_TRUNCATED"], bookings: [booking] }));
  assert.deepEqual(partial, { status: "available", coverage: "partial", reasons: ["BOOKING_WINDOW_TRUNCATED"], bookings: [booking] });
  for (const response of [
    Response.json({ error: true }, { status: 403 }),
    Response.json({ ...complete, scope: "dish-selection" }),
    Response.json({ ...complete, bookings: [{ ...booking, eventDate: "2027-01-01" }] }),
    Response.json({ ...complete, bookings: [booking, booking] }),
  ]) assert.deepEqual(await read(response), { status: "unavailable" });
  const overlong = { ...target, lastEventDate: "2028-01-01" };
  assert.deepEqual(await readStudioBookingImpact("http://127.0.0.1:3100", "test_session=opaque", overlong, async () => {
    assert.fail("oversized target reached the Hub");
  }), { status: "unavailable" });
});

test("rotation impact filters booking dates by the published Monday without sending extra query fields", async () => {
  const scoped = { ...target, rotation: { anchorMonday: "2026-11-30", week: 2 } };
  const base = { eventDate: "2026-12-03", site: "Example site", selectionIds: target.catalogueItemIds, selections: ["Synthetic"] };
  const result = await readStudioBookingImpact("http://127.0.0.1:3100", "test_session=opaque", scoped, async (_url, init) => {
    assert.deepEqual(JSON.parse(init?.body as string), target);
    return Response.json({ ...complete, bookings: [{ ...base, id: "first" }, { ...base, id: "second", eventDate: "2026-12-10" }] });
  });
  assert.equal(result.status, "available");
  if (result.status === "available") assert.deepEqual(result.bookings.map(booking => booking.id), ["second"]);
});
