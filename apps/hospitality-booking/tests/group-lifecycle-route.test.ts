import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/dashboard-bookings/route";

test("dashboard reload obtains authoritative CPU batch evidence, preserves one booking, and makes no write/artifact requests", async () => {
  const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
  process.env.FIKA_HUB_BASE_URL = "https://hub.test"; process.env.CPU_PRODUCTION_BASE_URL = "https://cpu.test";
  const requests: string[] = [];
  const group = { id: "group:uat", status: "Sent to CPU", quote: { status: "complete", stale: false }, services: [
    { bookingId: "booking:cpu", lifecycleStatus: "Completed", routing: { status: "cpu_required" }, production: { orderId: "order:cpu", version: 3, sourceRevision: 1, status: "planned", quoteRevisionId: "quote:cpu", quoteCurrent: true } },
    { bookingId: "booking:site", lifecycleStatus: "Quoted", routing: { status: "no_cpu_production" } },
  ] };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url.hostname);
    assert.ok(!init?.method || init.method === "GET");
    assert.equal(new Headers(init?.headers).get("cookie"), "fika_os_session=test");
    if (url.hostname === "hub.test") return Response.json({ bookings: [], dashboardBookings: [], bookingGroups: [structuredClone(group)] });
    assert.equal(url.hostname, "cpu.test"); assert.equal(url.searchParams.get("reviewStatus"), "1");
    assert.equal(url.searchParams.get("orderIds"), "order:cpu");
    return Response.json({ reviewStatuses: [{ orderId: "order:cpu", planStatus: "planned", reviewed: true, signatureRoles: ["production_chef", "head_chef_site_manager"], matrixStatus: "ready", sourceLineage: { productionOrderId: "order:cpu", sourceBookingId: "booking:cpu", sourceQuoteRevisionId: "quote:cpu", sourceVersion: 1 } }] });
  };
  try {
    for (let reload = 0; reload < 2; reload++) {
      const response = await GET(new NextRequest("https://hospitality.test/api/dashboard-bookings?site=rcoa&oploc=oploc:uat", { headers: { cookie: "fika_os_session=test" } }));
      assert.equal(response.status, 200); const body = await response.json();
      assert.equal(body.bookingGroups.length, 1); assert.equal(body.bookingGroups[0].status, "Completed");
    }
    assert.deepEqual(requests, ["hub.test", "cpu.test", "hub.test", "cpu.test"]);
  } finally { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); }
});
