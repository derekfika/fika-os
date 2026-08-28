import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical Hospitality lookup authorises and returns settings for the booking OPLOC", async () => {
  const route = await readFile(new URL("../app/api/hospitality-bookings/route.ts", import.meta.url), "utf8");
  assert.match(route, /canonicalId = request\.nextUrl\.searchParams\.get\("canonicalId"\)/);
  assert.match(route, /oplocId: booking\.service\.oplocId/);
  assert.match(route, /getDashboardQuoteSettingsForBooking\(booking\)/);
  assert.doesNotMatch(route, /portalSiteId.*resolveUserAccess|resolveUserAccess.*portalSiteId/);
});
