import { governedCatalogueResponse, governedMenu } from "./support/governed-rcoa-catalogue";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { localRcoaMenuCatalogue } from "../lib/local-rcoa-menu";
import { buildRcoaClientRequest } from "../lib/rcoa-booking-request-client";
import { createEmptyRcoaDraft } from "../lib/rcoa-portal";
import type { PortalMenuItem } from "../lib/mnk-contract";

process.env.FIKA_HUB_BASE_URL = "http://hub.test";
process.env.MNK_CANON_BRIDGE_TOKEN = "bridge-token-for-tests";
process.env.FIKA_RCOA_OPLOC_ID = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const { POST: genericPost } = await import("../app/api/bookings/route");
const { POST: rcoaPost } = await import("../app/api/bookings/rcoa/route");
const { POST: rcoaGroupPost } = await import("../app/api/bookings/rcoa/group/route");

const menu: PortalMenuItem[] = governedMenu; // the governed catalogue the portal displays (stable Item IDs)

/** A real RCoA browser submission: the exact client request the portal builds. */
function realRcoaSubmission() {
  const item = menu.find(candidate => candidate.category === "Breakfast")!;
  const draft = createEmptyRcoaDraft();
  draft.occasion = "breakfast";
  draft.contact = { name: "Casey Guest", email: "casey@example.test", phone: "020 0000 0000", companyName: "College", invoiceReference: "" };
  draft.event = { eventDate: "2026-12-01", guestCount: 12, startTime: "10:00", endTime: "", floorLevel: "First floor", roomOrArea: "", deliveryPoint: "", onsiteContactName: "", onsiteContactPhone: "" };
  draft.lines = [{ itemId: item.id, quantity: Math.max(1, item.minimumQuantity || 1), choices: Object.fromEntries((item.optionGroups || []).filter(group => group.required).map(group => [group.id, group.options[0]?.label || ""])) }];
  draft.acknowledgements = { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true };
  return buildRcoaClientRequest(draft, menu, { bookingId: "RCOA-20261012133429-AB12", submittedAt: "2026-10-12T13:34:29.000Z" });
}
const post = (url: string, body: unknown) => new NextRequest(`https://hospitality.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const malformedPost = (url: string) => new NextRequest(`https://hospitality.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });

async function withHub<T>(respond: (url: string, init: RequestInit) => Response, run: (calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }>) => Promise<T>) {
  const original = globalThis.fetch; const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { const catalogue = governedCatalogueResponse(String(input)); if (catalogue) return catalogue; calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body || "{}")) }); return respond(String(input), init || {}); }) as typeof fetch;
  try { return await run(calls); } finally { globalThis.fetch = original; }
}

test("a real RCoA submission goes to the Hub with the expected-OPLOC header, the bridge token and its stable booking ID", async () => {
  await withHub(() => Response.json({ canonicalBookingId: "booking:rcoa:RCOA-20261012133429-AB12", status: "New", created: true, validationWarnings: [] }), async calls => {
    const response = await rcoaPost(post("/api/bookings/rcoa", realRcoaSubmission()));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://hub.test/api/bookings/mnk");
    assert.equal(calls[0].headers.get("x-fika-expected-rcoa-oploc-id"), "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2");
    assert.equal(calls[0].headers.get("x-fika-mnk-bridge-token"), "bridge-token-for-tests");
    assert.equal(calls[0].body.siteId, "rcoa");
    assert.equal(calls[0].body.bookingId, "RCOA-20261012133429-AB12", "the stable request/booking ID is preserved so a retry is idempotent");
  });
});

test("RCoA submissions need no feature flag: a valid request is forwarded even when no booking-availability variable exists", async () => {
  const leaked = Object.keys(process.env).filter(key => /RCOA.*(SUBMISSION|ENABLED|OPEN|CLOSED)/i.test(key));
  assert.deepEqual(leaked, [], "no RCoA rollout flag may be set in the test environment");
  await withHub(() => Response.json({ canonicalBookingId: "booking:rcoa:RCOA-20261012133429-AB12", status: "New", created: true, validationWarnings: [] }), async calls => {
    const response = await rcoaPost(post("/api/bookings/rcoa", realRcoaSubmission()));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
  });
});

test("an invalid RCoA single request is rejected with 400 before anything is forwarded to the Hub", async () => {
  await withHub(() => Response.json({}), async (calls) => {
    const response = await rcoaPost(malformedPost("/api/bookings/rcoa"));
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test("an invalid RCoA all-day/group request is rejected before anything is forwarded to the Hub", async () => {
  await withHub(() => Response.json({}), async (calls) => {
    const response = await rcoaGroupPost(malformedPost("/api/bookings/rcoa/group"));
    assert.ok(response.status >= 400 && response.status < 500, `unexpected status ${response.status}`);
    assert.equal(calls.length, 0);
  });
});

test("the same RCoA payload on the generic route is refused clearly and never forwarded to the Hub", async () => {
  await withHub(() => Response.json({}), async calls => {
    const trusted = { ...realRcoaSubmission(), siteId: "rcoa", site: "RCoA Hospitality" };
    const response = await genericPost(post("/api/bookings", trusted));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error.message, /RCoA bookings must be submitted through the RCoA booking form/);
    assert.equal(calls.length, 0, "no Hub call is made, so no booking can be created without the governed OPLOC check");
  });
});

test("non-RCoA bookings still use the generic route unchanged", async () => {
  await withHub(() => Response.json({ canonicalBookingId: "booking:mnk:x", status: "New", created: true, validationWarnings: [] }), async calls => {
    const response = await genericPost(post("/api/bookings", { bookingId: "MNK-1", siteId: "mnk", site: "MNK" }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.get("x-fika-expected-rcoa-oploc-id"), null);
  });
});

test("a Hub rejection stays generic to the browser but is logged with the status, code and Hub requestId", async () => {
  const errors: unknown[][] = []; const original = console.error; console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await withHub(() => Response.json({ error: { code: "INVALID_REQUEST", message: "We couldn’t complete that request.", requestId: "hub-request-1" } }, { status: 503 }), async () => {
      const response = await rcoaPost(post("/api/bookings/rcoa", realRcoaSubmission()));
      assert.equal(response.status, 503);
      assert.doesNotMatch(JSON.stringify(await response.json()), /stack|FIKA_RCOA_OPLOC_ID/);
    });
  } finally { console.error = original; }
  const logged = errors.find(args => args[0] === "hospitality.booking.create.upstream-rejected");
  assert.ok(logged, "the rejection is logged server-side");
  assert.deepEqual(logged![1], { path: "/api/bookings/rcoa", status: 503, code: "INVALID_REQUEST", hubRequestId: "hub-request-1" });
});

test("the authenticated workspace renders the governed RCoA portal for the RCoA site, never the generic form", () => {
  const workspace = readFileSync(new URL("../app/ui/HospitalityWorkspace.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /active\.portalSiteKey === "rcoa"\) return <RcoaBookingPortal configured=\{rcoaConfigured\} \/>/);
  assert.ok(workspace.indexOf('portalSiteKey === "rcoa"') < workspace.indexOf("return <BookingPortal siteKey"), "the RCoA branch comes before the generic portal");
  assert.match(page, /rcoaConfigured=\{Boolean\(process\.env\.FIKA_RCOA_OPLOC_ID\?\.trim\(\)\)\}/);
  assert.doesNotMatch(page, /SUBMISSIONS_ENABLED|bookingSubmissionsEnabled/);
});
