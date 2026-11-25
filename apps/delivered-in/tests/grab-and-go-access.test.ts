import assert from "node:assert/strict";
import test from "node:test";
import { readGrabAndGoAccess, selectGrabAndGoSite } from "../app/lib/grab-and-go-access";

const accountEmail = "REVIEWER@example.test";
const eligibleSite = { oplocId: "oploc:eligible", label: "Eligible site", services: { deliveredIn: false, grabAndGo: true } };
const otherSite = { oplocId: "oploc:other", label: "Other site", services: { deliveredIn: true, grabAndGo: false } };

test("navigation uses only the independently scoped Grab & Go access response", async t => {
  const request = new AbortController();
  const fetchAccess = t.mock.method(globalThis, "fetch", async () => Response.json({
    access: { email: accountEmail, oplocIds: [eligibleSite.oplocId] },
    sites: [eligibleSite, otherSite],
  }));

  assert.deepEqual(await readGrabAndGoAccess(request.signal), {
    status: "ready",
    sites: [eligibleSite],
    accountScope: accountEmail.toLowerCase(),
  });
  assert.deepEqual(fetchAccess.mock.calls[0].arguments, [
    "/api/delivered-in/access?service=grab-and-go",
    { cache: "no-store", signal: request.signal },
  ]);
});

test("a direct site must be in scope and does not silently select another site", () => {
  const both = { ...eligibleSite, oplocId: "oploc:both", services: { deliveredIn: true, grabAndGo: true } };
  const sites = [eligibleSite, both];
  assert.equal(selectGrabAndGoSite(sites), eligibleSite);
  assert.equal(selectGrabAndGoSite(sites, eligibleSite.oplocId), eligibleSite);
  assert.equal(selectGrabAndGoSite(sites, both.oplocId), both);
  assert.equal(selectGrabAndGoSite(sites, otherSite.oplocId), undefined);
  assert.equal(selectGrabAndGoSite([], "oploc:neither"), undefined);
});

test("an empty Grab & Go scope differs from denial, session failure and unavailable access", async t => {
  const signal = new AbortController().signal;
  let response = Response.json({ access: { email: accountEmail, oplocIds: [] }, sites: [] });
  t.mock.method(globalThis, "fetch", async () => response);

  assert.deepEqual(await readGrabAndGoAccess(signal), { status: "ready", sites: [], accountScope: accountEmail.toLowerCase() });
  for (const [status, expected] of [[403, "denied"], [401, "sign-in"], [503, "unavailable"]] as const) {
    response = new Response(null, { status });
    assert.deepEqual(await readGrabAndGoAccess(signal), { status: expected });
  }
  response = Response.json({ sites: [eligibleSite] });
  assert.deepEqual(await readGrabAndGoAccess(signal), { status: "unavailable" });
});
