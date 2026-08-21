import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";

const goldenWeek = JSON.parse(readFileSync(new URL("../../../../tools/uat/golden-week.json", import.meta.url), "utf8")) as {
  marker: string;
  week: { dates: string[]; start: string };
  hospitality: unknown[];
  grabAndGo: { dates: string[]; sites: Array<{ label: string }> };
  expected: { hospitalityBookings: number; grabAndGoOrders: number; publishedMenuDays: number; ownedMovements: number; ownedRuns: number; scopeLabels: string[] };
};

const urls = {
  hub: process.env.UAT_HUB_URL || "http://localhost:3200",
  menu: process.env.UAT_MENU_URL || "http://localhost:3500",
  delivered: process.env.UAT_DELIVERED_URL || "http://localhost:3800",
  hospitality: process.env.UAT_HOSPITALITY_URL || "http://localhost:3300",
  cpu: process.env.UAT_CPU_URL || "http://localhost:3400",
  logistics: process.env.UAT_LOGISTICS_URL || "http://localhost:3900",
};

async function localCookie() {
  const context = await playwrightRequest.newContext({ baseURL: urls.hospitality });
  const response = await context.post("/api/local-session", { data: {} });
  expect(response.ok(), "Local test session must be available").toBeTruthy();
  const cookie = (response.headers()["set-cookie"] || "").split(";")[0];
  await context.dispose();
  return cookie;
}

async function json(context: APIRequestContext, baseURL: string, route: string, cookie: string) {
  const response = await context.get(`${baseURL}${route}`, { headers: { cookie } });
  expect(response.ok(), `${baseURL}${route} must be readable`).toBeTruthy();
  return response.json();
}

test.describe.serial("Golden Week whole-system contract", () => {
  test("fixture is internally deterministic", async () => {
    expect(goldenWeek.week.dates).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(goldenWeek.expected.hospitalityBookings).toBe(goldenWeek.hospitality.length);
    expect(goldenWeek.expected.grabAndGoOrders).toBe(goldenWeek.grabAndGo.dates.length * goldenWeek.grabAndGo.sites.length);
  });

  test("source records, downstream requirements and operational UI agree", async ({ page }) => {
    const cookie = await localCookie();
    const context = await playwrightRequest.newContext();
    const [menu, mnk, angelCourt, cpu, logistics] = await Promise.all([
      json(context, urls.menu, "/api/rolling-menu?weekId=rolling-week:2026-08-24", cookie),
      json(context, urls.hub, "/api/hospitality-bookings?site=mnk", cookie),
      json(context, urls.hub, "/api/hospitality-bookings?site=angel-court", cookie),
      json(context, urls.cpu, "/api/production?view=site_manager&scope=all", cookie),
      Promise.all(goldenWeek.week.dates.map((date) => json(context, urls.logistics, `/api/logistics?serviceDate=${date}`, cookie))),
    ]);
    const oplocs = (await json(context, urls.hub, "/api/oplocs", cookie)).oplocs || [];
    const grab = await Promise.all(goldenWeek.grabAndGo.sites.map(async (site) => {
      const oploc = oplocs.find((item: { label: string }) => item.label === site.label);
      return json(context, urls.delivered, `/api/delivered-in/grab-and-go?oplocId=${encodeURIComponent(oploc.canonicalId)}`, cookie);
    }));
    await context.dispose();

    const hospitalityRows = [...(mnk.bookings || []), ...(angelCourt.bookings || [])].filter((booking: { service?: { eventDate?: string }; source?: { sourceBookingId?: string } }) => goldenWeek.week.dates.includes(booking.service?.eventDate || "") && booking.source?.sourceBookingId?.startsWith(goldenWeek.marker));
    expect(hospitalityRows, "Golden Week hospitality booking count").toHaveLength(goldenWeek.expected.hospitalityBookings);
    const grabRows = grab.flatMap((body) => body.orders || []).filter((order: { deliveryDate?: string; status?: string }) => goldenWeek.grabAndGo.dates.includes(order.deliveryDate || "") && order.status === "submitted");
    expect(grabRows, "Golden Week submitted Grab & Go order count").toHaveLength(goldenWeek.expected.grabAndGoOrders);
    const publishedDays = (menu.snapshot?.days || []).filter((day: { date: string; id: string }) => goldenWeek.week.dates.includes(day.date) && menu.publicationState?.[day.id]?.status === "published");
    expect(publishedDays, "Golden Week published menu days").toHaveLength(goldenWeek.expected.publishedMenuDays);
    const cpuOrders = (cpu.orders || []).filter((order: { sourceBookingId?: string; requiredBy?: string }) => order.sourceBookingId?.startsWith(goldenWeek.marker) && goldenWeek.week.dates.some((date) => order.requiredBy?.startsWith(date)));
    expect(new Set(cpuOrders.map((order: { canonicalId: string }) => order.canonicalId)).size).toBe(cpuOrders.length);
    const ownedMovements = logistics.flatMap((body) => body.movements || []).filter((movement: { canonicalId?: string }) => movement.canonicalId?.startsWith(`movement:${goldenWeek.marker}:`));
    expect(ownedMovements, "Golden Week owned Logistics movements").toHaveLength(goldenWeek.expected.ownedMovements);
    const ownedRuns = logistics.flatMap((body) => body.runs || []).filter((run: { canonicalId?: string }) => run.canonicalId?.startsWith(`run:${goldenWeek.marker}:`));
    expect(ownedRuns, "Golden Week owned Logistics runs").toHaveLength(goldenWeek.expected.ownedRuns);

    await page.goto(`${urls.cpu}/`);
    for (const label of goldenWeek.expected.scopeLabels) {
      const scope = page.getByRole("button", { name: label, exact: true });
      await expect(scope, `CPU scope selector: ${label}`).toBeVisible();
      await scope.click();
      await expect(scope).toHaveClass(/selected/);
    }
    await page.goto(`${urls.logistics}/?serviceDate=${goldenWeek.week.start}`);
    await expect(page.getByRole("heading", { name: /Planning queue/ })).toBeVisible();
  });
});
