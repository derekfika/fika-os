import { expect, test } from "@playwright/test";
import { boot, DATE, v3Seed } from "./v3-helpers";

test("classic day actions distinguish each run and open the matching van PIN screen", async ({ page }) => {
  const seed = v3Seed();
  const first = `run:${DATE}:first`;
  const second = `run:${DATE}:second`;
  const third = `run:${DATE}:third`;
  seed.runs = [
    { id: first, vehicleId: "van1", dep: "08:00", ret: "10:00" },
    { id: second, vehicleId: "van2", dep: "09:00", ret: "12:00" },
    { id: third, vehicleId: "van1", dep: "11:00", ret: "13:00" },
  ];
  await boot(page, seed, "&ui=classic");
  const links = page.getByRole("group", { name: "Driver views" });
  await expect(links.getByRole("link")).toHaveCount(3);
  await expect(links.getByRole("link", { name: "Van 1 driver view · Run 1" })).toHaveAttribute("href", `/mobile/van1?run=${encodeURIComponent(first)}&serviceDate=${DATE}`);
  const vanTwo = links.getByRole("link", { name: "Van 2 driver view · Run 2" });
  await expect(vanTwo).toHaveAttribute("href", `/mobile/van2?run=${encodeURIComponent(second)}&serviceDate=${DATE}`);
  await expect(links.getByRole("link", { name: "Van 1 driver view · Run 3" })).toHaveAttribute("href", `/mobile/van1?run=${encodeURIComponent(third)}&serviceDate=${DATE}`);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => links.evaluate(group => group.scrollWidth <= group.clientWidth)).toBe(true);
    await expect(vanTwo).toHaveCSS("min-height", "44px");
  }
  await page.route("**/api/logistics/mobile/session?vehicle=van2", route => route.fulfill({ status: 401, json: { error: { code: "TEST_SESSION_REQUIRED" } } }));
  await vanTwo.focus();
  await expect(vanTwo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Van 2 PIN", { exact: true })).toBeVisible();
  const target = new URL(page.url());
  expect(target.pathname).toBe("/mobile/van2");
  expect(Object.fromEntries(target.searchParams)).toEqual({ run: second, serviceDate: DATE });
});

test("a classic day without eligible runs omits the driver action", async ({ page }) => {
  await boot(page, { ...v3Seed(), runs: [] }, "&ui=classic");
  await expect(page.getByRole("group", { name: "Driver views" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Driver view/ })).toHaveCount(0);
});
