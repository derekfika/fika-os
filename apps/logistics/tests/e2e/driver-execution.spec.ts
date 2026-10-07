import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
const { setup, jobs, loads, run } = createRequire(import.meta.url)("../helpers/execution-fixture.cjs");

async function mobile(page: Page, merged = false) {
  const f = await setup({ collection: true, merged, draft: true, sharedSession: true });
  const commands: Record<string, any>[] = [];
  await page.clock.install({ time: new Date(f.date + "T12:00:00Z") });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill({ json: { permittedVehicleIds: ["van1", "van2"] } });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); commands.push(body);
      if (body.stopId?.startsWith("projection-stop:")) {
        for (const id of body.loadIds) expect(body.expectedLoadVersions[id]).toBe(loads(f).find((load: any) => load.id === id).version);
        for (const job of jobs(f)) expect(body.expectedJobVersions[job.id]).toBe(job.version);
        expect(body.expectedRunVersion).toBe(run(f).version);
      }
      const result = await f.post(body); return route.fulfill({ status: result.response.status, json: result.body });
    }
    const projection = structuredClone(f.records.get("fikaLogisticsDayProjectionsV1/" + f.date));
    if (url.searchParams.has("syncHead")) return route.fulfill({ headers: { "x-logistics-cache-scope": "batch3-isolated" }, json: { sequence: projection.lastChangeSequence } });
    return route.fulfill({ headers: { "x-logistics-cache-scope": "batch3-isolated" }, json: { ...projectionToDashboardData(projection), projection } });
  });
  await page.goto("/mobile/van1");
  return { f, commands };
}

test("fresh projected multi-job driver journey completes delivery, collection and CPU return", async ({ page }) => {
  const { f, commands } = await mobile(page);
  expect([...f.records.keys()].some((key: string) => key.startsWith("fikaLogisticsDeliveryStopsV1/"))).toBe(false);
  await expect(page.getByRole("button", { name: "Load all deliveries" })).toBeDisabled();
  const openDelivery = () => page.getByRole("button", { name: "Open details for Execution site" }).click();
  await openDelivery();
  await page.locator(".subload-card").nth(0).click();
  await expect.poll(() => jobs(f)[0].deliveryStatus).toBe("loaded"); expect(jobs(f)[1].deliveryStatus).toBe("pending");
  await openDelivery(); await page.locator(".subload-card").nth(1).click();
  await page.getByRole("button", { name: "Dispatch vehicle", exact: true }).click();
  await expect.poll(() => run(f).status).toBe("dispatched");
  await openDelivery(); await page.getByRole("button", { name: "Mark arrived" }).click();
  await openDelivery(); await page.locator(".subload-card").nth(0).click();
  await expect.poll(() => jobs(f)[0].deliveryStatus).toBe("delivered"); expect(jobs(f)[1].deliveryStatus).toBe("loaded"); expect(loads(f)[0].status).not.toBe("delivered");
  await openDelivery(); await page.getByRole("button", { name: "Report issue", exact: true }).click();
  await page.getByLabel("Notes", { exact: false }).fill("Access needs attention"); await page.getByRole("button", { name: "Submit issue" }).click();
  await openDelivery(); await expect(page.locator(".detail-issue")).toContainText("Access needs attention"); await page.getByRole("button", { name: "Resolve issue" }).click();
  await openDelivery(); await page.locator(".subload-card").nth(1).click();
  await expect.poll(() => jobs(f).every((job: any) => job.deliveryStatus === "delivered")).toBe(true); expect(jobs(f).every((job: any) => job.collectionStatus === "awaiting")).toBe(true);
  await page.getByRole("button", { name: /Collections/ }).last().click();
  const openCollection = () => page.getByRole("button", { name: "Open details for CPU production" }).click();
  await openCollection(); await expect(page.getByRole("button", { name: "Postpone collection", exact: true })).toHaveCount(0); await page.getByRole("button", { name: "Mark arrived" }).click();
  await openCollection(); await page.locator(".subload-card").nth(0).click();
  await expect.poll(() => jobs(f)[0].collectionStatus).toBe("collected"); expect(jobs(f)[1].collectionStatus).toBe("awaiting");
  await openCollection(); await page.locator(".subload-card").nth(1).click();
  await expect.poll(() => run(f).returnToCpuPending).toBe(true);
  await page.getByRole("button", { name: /returned to CPU/i }).click();
  await expect.poll(() => run(f).status).toBe("completed");
  expect(commands.filter(body => body.action === "mark-subload-delivered")).toHaveLength(2);
  expect(commands.filter(body => body.action === "mark-subload-collected")).toHaveLength(2);
  expect(commands.filter(body => body.action === "arrive-stop")).toHaveLength(2);
});

test("merged mobile execution and undo carry all constituent authority", async ({ page }) => {
  const { f, commands } = await mobile(page, true);
  const open = () => page.getByRole("button", { name: "Open details for Execution site" }).click();
  await open(); await page.locator(".subload-card").nth(0).click();
  await open(); await page.locator(".subload-card").nth(1).click();
  await page.getByRole("button", { name: "Dispatch vehicle", exact: true }).click();
  await open(); await page.getByRole("button", { name: "Mark arrived" }).click();
  await open(); await page.getByRole("button", { name: "Mark delivered", exact: true }).click();
  await expect.poll(() => jobs(f).every((job: any) => job.deliveryStatus === "delivered")).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => jobs(f).every((job: any) => job.deliveryStatus === "loaded")).toBe(true);
  expect(commands.find(body => body.action === "complete-stop")?.loadIds).toHaveLength(2);
  expect(commands.find(body => body.action === "undo-completion")?.loadIds).toHaveLength(2);
  expect(jobs(f).every((job: any) => job.collectionStatus === "awaiting")).toBe(true);
});
