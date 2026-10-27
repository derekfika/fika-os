import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
const { setup } = createRequire(import.meta.url)("../helpers/execution-fixture.cjs");

type Item = { id: string; kind: string; title: string; detail: string; priority: "normal" | "high"; serviceDate: string; runId: string; createdAt: string; readAt?: string };

/** Mocks the driver API with a stateful, vehicle-scoped inbox so the whole tab flow runs in a real browser. */
async function openDriverApp(page: Page, options: { items: (date: string) => Item[]; failInboxGets?: number }) {
  const f = await setup({ draft: true, sharedSession: true });
  let items = options.items(f.date);
  let failuresLeft = options.failInboxGets ?? 0;
  const posts: Array<Record<string, unknown>> = [];
  const view = () => ({ vehicleId: "van1", unreadCount: items.filter(item => !item.readAt).length, items: [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  await page.clock.install({ time: new Date(f.date + "T12:00:00Z") });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/logistics/mobile/session" && method === "GET") return route.fulfill({ json: { vehicleId: "van1", sessionId: "e2e" } });
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill({ json: { permittedVehicleIds: ["van1", "van2"] } });
    if (url.pathname === "/api/logistics/driver-notifications") {
      if (method === "GET") {
        if (failuresLeft > 0) { failuresLeft -= 1; return route.fulfill({ status: 503, json: { error: { message: "Notifications are unavailable right now." } } }); }
        return route.fulfill({ json: view() });
      }
      const body = route.request().postDataJSON() as { action: string; id?: string };
      posts.push(body);
      const now = new Date().toISOString();
      if (body.action === "mark-read") items = items.map(item => item.id === body.id ? { ...item, readAt: item.readAt ?? now } : item);
      if (body.action === "mark-all-read") items = items.map(item => ({ ...item, readAt: item.readAt ?? now }));
      return route.fulfill({ json: view() });
    }
    if (method === "POST") { const result = await f.post(route.request().postDataJSON()); return route.fulfill({ status: result.response.status, json: result.body }); }
    const projection = structuredClone(f.records.get("fikaLogisticsDayProjectionsV1/" + f.date));
    if (url.searchParams.has("syncHead")) return route.fulfill({ headers: { "x-logistics-cache-scope": "notifications-e2e" }, json: { sequence: projection.lastChangeSequence } });
    return route.fulfill({ headers: { "x-logistics-cache-scope": "notifications-e2e" }, json: { ...projectionToDashboardData(projection), projection } });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/mobile/van1");
  await page.getByText("Run 1").first().waitFor({ timeout: 60_000 });
  return { f, posts, setItems: (next: Item[]) => { items = next; } };
}

const item = (id: string, date: string, extra: Partial<Item> = {}): Item => ({ id, kind: "departure-time-changed", title: "Departure time changed", detail: "Departure moved from 11:30 to 12:00.", priority: "normal", serviceDate: date, runId: "r1", createdAt: "2026-10-28T10:00:00.000Z", ...extra });
const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("unread badge, newest-first list, read styling, mark read and a deep link to the current run", async ({ page }) => {
  const { posts } = await openDriverApp(page, { items: date => [
    item("older", date, { title: "Route order updated", detail: "One Angel Court is now your first stop.", createdAt: "2026-10-28T09:00:00.000Z" }),
    item("newer", date, { createdAt: "2026-10-28T10:30:00.000Z" }),
  ] });
  await expect(nav(page).getByRole("button", { name: "Notifications, 2 unread" })).toBeVisible();
  await expect(nav(page).getByText("2", { exact: true })).toBeVisible();

  await nav(page).getByRole("button", { name: /^Notifications/ }).click();
  const cards = page.getByRole("button", { name: /^Unread\./ });
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Departure time changed");
  await expect(cards.nth(1)).toContainText("Route order updated");
  await expect(page.getByText("2 unread")).toBeVisible();
  expect(await overflow(page)).toBe(true);
  if (process.env.CAPTURE_DIR) await page.screenshot({ path: `${process.env.CAPTURE_DIR}/notifications-tab-375.png` });

  await cards.first().click();
  await expect(page.getByRole("heading", { name: /^Run 1/ })).toBeVisible();
  expect(posts.some(post => post.action === "mark-read" && post.id === "newer")).toBe(true);
  await expect(nav(page).getByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();

  await nav(page).getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("button", { name: /^Departure time changed/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Unread\./ })).toHaveCount(1);
});

test("a notification for a run that has since changed explains it and shows the current run", async ({ page }) => {
  await openDriverApp(page, { items: date => [item("gone", date, { runId: "run-that-no-longer-exists", title: "Stop removed", detail: "Delivery at Haleon has been removed from your route." })] });
  await nav(page).getByRole("button", { name: /^Notifications/ }).click();
  await page.getByRole("button", { name: /^Unread\./ }).click();
  await expect(page.getByRole("status").filter({ hasText: "This run has changed since the notification was sent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Run 1/ })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("This run has changed since the notification was sent")).toHaveCount(0);
});

test("mark all read clears the badge, keeps the history and reads as caught up", async ({ page }) => {
  const { posts } = await openDriverApp(page, { items: date => [item("a", date), item("b", date, { createdAt: "2026-10-28T11:00:00.000Z" })] });
  await nav(page).getByRole("button", { name: /^Notifications/ }).click();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByText("All caught up")).toBeVisible();
  expect(posts.some(post => post.action === "mark-all-read")).toBe(true);
  await expect(nav(page).getByRole("button", { name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Departure time changed/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Mark all read" })).toBeDisabled();
});

test("empty inbox shows a calm empty state", async ({ page }) => {
  await openDriverApp(page, { items: () => [] });
  await nav(page).getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByText("No notifications yet.")).toBeVisible();
});

test("a failed load shows an error with Retry, and Retry recovers without losing the app", async ({ page }) => {
  await openDriverApp(page, { items: date => [item("a", date)], failInboxGets: 1 });
  await nav(page).getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Notifications are unavailable right now." })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: /^Unread\./ })).toHaveCount(1);
  await nav(page).getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Run 1/ })).toBeVisible();
});

test("history comes from the server: a fresh page load shows the same notifications and read state", async ({ page }) => {
  await openDriverApp(page, { items: date => [item("a", date)] });
  await nav(page).getByRole("button", { name: /^Notifications/ }).click();
  await page.getByRole("button", { name: /^Unread\./ }).click();
  await page.reload();
  await page.getByText("Run 1").first().waitFor({ timeout: 60_000 });
  await nav(page).getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("button", { name: /^Departure time changed/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Unread\./ })).toHaveCount(0);
});
