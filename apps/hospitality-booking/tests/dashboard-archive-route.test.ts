import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/dashboard-bookings/route";

test("dashboard forwards the authorised archive request and keeps its site scope", async () => {
  const originalFetch = globalThis.fetch;
  const originalHubUrl = process.env.FIKA_HUB_BASE_URL;
  process.env.FIKA_HUB_BASE_URL = "https://hub.test";
  let requested: URL | undefined;
  globalThis.fetch = async (input, init) => {
    requested = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("cookie"), "fika_os_session=history-test");
    return Response.json({ bookings: [], dashboardBookings: [], bookingGroups: [], productionOrders: {}, truncated: false });
  };
  try {
    const response = await GET(new NextRequest("https://hospitality.test/api/dashboard-bookings?site=rcoa&oploc=oploc:rcoa&archive=true", { headers: { cookie: "fika_os_session=history-test" } }));
    assert.equal(response.status, 200);
    assert.equal(requested?.pathname, "/api/hospitality-bookings");
    assert.equal(requested?.searchParams.get("site"), "rcoa");
    assert.equal(requested?.searchParams.get("oploc"), "oploc:rcoa");
    assert.equal(requested?.searchParams.get("archive"), "true");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHubUrl === undefined) delete process.env.FIKA_HUB_BASE_URL;
    else process.env.FIKA_HUB_BASE_URL = originalHubUrl;
  }
});

test("dashboard does not replace an archive permission denial with booking data", async () => {
  const originalFetch = globalThis.fetch;
  const originalHubUrl = process.env.FIKA_HUB_BASE_URL;
  process.env.FIKA_HUB_BASE_URL = "https://hub.test";
  globalThis.fetch = async () => Response.json({ error: { message: "That Hospitality location is not authorised for your account." } }, { status: 403 });
  try {
    const response = await GET(new NextRequest("https://hospitality.test/api/dashboard-bookings?site=rcoa&oploc=oploc:other&archive=true", { headers: { cookie: "fika_os_session=history-test" } }));
    assert.equal(response.status, 403);
    assert.match((await response.text()), /not authorised/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHubUrl === undefined) delete process.env.FIKA_HUB_BASE_URL;
    else process.env.FIKA_HUB_BASE_URL = originalHubUrl;
  }
});
