import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.FIKA_CPU_SESSION_TEST_URL;
for (const width of [820, 1280]) test(`session recovery preserves dashboard context at ${width}px`, { skip: !baseUrl }, async () => {
  const target = new URL(baseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname), "Use only an isolated local CPU server");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: "Europe/London" });
    let mode: "current" | "expired" | "denied" | "offline" | "changed" = "current";
    let pauseScope = false;
    let scopePaused: () => void = () => {};
    let releaseScope: () => void = () => {};
    await page.route("**/api/**", async route => {
      assert.equal(route.request().method(), "GET", "recovery must not replay operational writes");
      const query = new URL(route.request().url()).searchParams;
      if (pauseScope && query.get("cacheScope") === "1") {
        pauseScope = false;
        scopePaused();
        await new Promise<void>(resolve => { releaseScope = resolve; });
      }
      if (mode === "offline") return route.abort("failed");
      if (mode === "expired") return route.fulfill({ status: 401, json: { error: { code: "FIKA_SESSION_INVALID", message: "Session invalid or expired" } } });
      if (mode === "denied") return route.fulfill({ status: 403, json: { error: { code: "AUTHMOD_DENIED", message: "Not permitted" } } });
      const week = query.get("weekCommencing") || "2026-10-26";
      return route.fulfill({ json: { cacheScope: mode === "changed" ? "synthetic-other-actor" : "synthetic-isolated-session-test", lastChangeSequence: 1, projection: { serviceDate: week, weekCommencing: week, revision: 1, lastChangeSequence: 1, rebuiltAt: `${week}T12:00:00Z`, summary: { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 }, orders: [] }, package: { packageVersion: 1, sourceVersion: "cpu-change-1", contentHash: "a".repeat(64) } } });
    });
    await page.goto(baseUrl!);
    await page.getByRole("heading", { name: "Production week", exact: true }).waitFor();
    await page.getByRole("button", { name: "Day", exact: true }).last().click();
    await page.getByRole("heading", { name: "Production day", exact: true }).waitFor();
    mode = "expired";
    await page.getByRole("button", { name: "Refresh production", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in again to continue", exact: true }).waitFor();
    const signIn = page.getByRole("link", { name: "Sign in again (opens a new tab)", exact: true });
    assert.equal(await signIn.getAttribute("target"), "_blank");
    assert.match(await signIn.getAttribute("rel") || "", /noopener/);
    assert.equal(new URL((await signIn.getAttribute("href"))!).searchParams.get("returnTo"), page.url());
    assert.equal(await signIn.evaluate(element => element.getBoundingClientRect().height >= 44), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    mode = "offline";
    await page.getByRole("button", { name: "Check login", exact: true }).click();
    await page.getByText("Login could not be checked. Check your connection and try again.", { exact: true }).waitFor();
    mode = "denied";
    await page.getByRole("button", { name: "Check login", exact: true }).click();
    await page.getByRole("heading", { name: "CPU access is not available", exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: /Sign in again/ }).count(), 0, "denial must not become another sign-in request");
    mode = "expired";
    await page.getByRole("button", { name: "Refresh production", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in again to continue", exact: true }).waitFor();
    mode = "current";
    pauseScope = true;
    const paused = new Promise<void>(resolve => { scopePaused = resolve; });
    await page.getByRole("button", { name: "Check login", exact: true }).click();
    await paused;
    const weekLoaded = page.waitForResponse(response => {
      const query = new URL(response.url()).searchParams;
      return query.get("projection") === "1" && query.has("weekCommencing");
    });
    await page.getByRole("button", { name: "Week", exact: true }).last().click();
    await weekLoaded;
    const recoveredRead = page.waitForResponse(response => {
      const query = new URL(response.url()).searchParams;
      return query.get("projection") === "1" || query.get("projectionHead") === "1";
    });
    releaseScope();
    const recoveredQuery = new URL((await recoveredRead).url()).searchParams;
    assert.ok(recoveredQuery.has("weekCommencing"), "a delayed login check must refresh the current Week view");
    assert.equal(recoveredQuery.has("serviceDate"), false, "the old Day callback must not replace the new view's data");
    await page.getByRole("heading", { name: "Sign in again to continue", exact: true }).waitFor({ state: "detached" });
    await page.getByRole("heading", { name: "Production week", exact: true }).waitFor();
    const errors = await page.locator("body").evaluate(element => element.textContent || "");
    assert.doesNotMatch(errors, /Sign in again to continue/);
    const dayLoaded = page.waitForResponse(response => {
      const query = new URL(response.url()).searchParams;
      return query.get("projection") === "1" && query.has("serviceDate");
    });
    await page.getByRole("button", { name: "Day", exact: true }).last().click();
    await dayLoaded;
    mode = "changed";
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() }),
      page.getByRole("button", { name: "Refresh production", exact: true }).click(),
    ]);
    await page.getByRole("heading", { name: "Production week", exact: true }).waitFor();
  } finally { await browser.close(); }
});
