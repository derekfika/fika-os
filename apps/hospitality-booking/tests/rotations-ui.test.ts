import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { compareVersions, copyDish, moveDish, rotationWeekForDate, versionForDate } from "../lib/rotations-ui-model";
import { rotationPreviewFixtures } from "../lib/rotations-preview-fixtures";
import { isRotationsPreviewAvailable } from "../lib/rotations-ui-access";
import { forwardHospitalityRotations, hospitalityRotationsHubPath } from "../lib/hospitality-rotations-hub-proxy";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/rotations-preview" });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });

const React = await import("react");
const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { default: RotationsDashboardPreview } = await import("../app/rotations-preview/RotationsDashboardPreview");
const mockStyles = new Proxy<Record<string, string>>({}, { get: (_target, key) => String(key) });

afterEach(() => cleanup());
after(() => { dom.window.close(); });

test("all groups use one configured global cycle and future dates resolve their scheduled version", () => {
  const { globalCycle, groups } = rotationPreviewFixtures.workspace;
  assert.equal(globalCycle.lengthWeeks, 6);
  assert.equal(groups.length, 5);
  assert.equal(rotationWeekForDate("2026-01-05", globalCycle.anchorDate, globalCycle.lengthWeeks), 1);
  assert.equal(rotationWeekForDate("2026-02-16", globalCycle.anchorDate, globalCycle.lengthWeeks), 1);
  assert.equal(rotationWeekForDate("2025-12-29", globalCycle.anchorDate, globalCycle.lengthWeeks), 6);
  assert.equal(versionForDate(rotationPreviewFixtures.workspace, "2026-12-06")?.id, "version-preview-active");
  assert.equal(versionForDate(rotationPreviewFixtures.workspace, "2026-12-07")?.id, "version-preview-scheduled");
});

test("move reorders or transfers a dish while copy retains the source", () => {
  const groupId = "group-preview-1";
  const source = { [groupId]: { 1: ["a", "b"], 2: ["c"] } };
  assert.deepEqual(moveDish(source, groupId, 1, 0, 1, 1)[groupId]?.[1], ["b", "a"]);
  const moved = moveDish(source, groupId, 1, 0, 2, 1);
  assert.deepEqual(moved[groupId]?.[1], ["b"]);
  assert.deepEqual(moved[groupId]?.[2], ["c", "a"]);
  const copied = copyDish(source, groupId, 1, 0, 2, 1);
  assert.deepEqual(copied[groupId]?.[1], ["a", "b"]);
  assert.deepEqual(copied[groupId]?.[2], ["c", "a"]);
});

test("version comparison identifies weekly selection differences", () => {
  const workspace = structuredClone(rotationPreviewFixtures.workspace);
  workspace.versions.find((version) => version.id === "version-preview-draft")!.weeklySelections["group-preview-1"]![1] = ["dish-preview-002"];
  const differences = compareVersions(workspace, "version-preview-active", "version-preview-draft");
  assert.equal(differences.length, 1);
  assert.deepEqual(differences[0], { groupId: "group-preview-1", groupLabel: "Finger Food", field: "Week 1", left: "dish-preview-001", right: "dish-preview-002" });
});

test("preview route is unavailable in production", () => {
  assert.equal(isRotationsPreviewAvailable("production"), false);
  assert.equal(isRotationsPreviewAvailable("development"), true);
});

test("Hub adapter uses the documented path, forwards the session, and disables caching", async () => {
  assert.equal(hospitalityRotationsHubPath(new URL("https://local.test/api/hospitality-rotations?mode=access&ignore=untrusted")), "/api/hospitality-rotations?mode=access");
  let observed: { path: string; cookie: string | null; init?: RequestInit } | undefined;
  const request = new Request("https://local.test/api/hospitality-rotations?mode=manage", { headers: { cookie: "fika_session=fixture" } });
  const response = await forwardHospitalityRotations(request, "GET", async (path, cookie, init) => {
    observed = { path, cookie, init };
    return Response.json({ head: { version: 1 }, draft: null }, { status: 200 });
  });
  assert.equal(observed?.path, "/api/hospitality-rotations?mode=manage");
  assert.equal(observed?.cookie, "fika_session=fixture");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.status, 200);
});

test("dashboard renders labelled controls, semantic statuses and dynamic groups", () => {
  render(React.createElement(RotationsDashboardPreview, { styles: mockStyles }));
  assert.ok(screen.getByRole("heading", { name: "Rotations" }));
  assert.ok(screen.getByRole("heading", { name: "Six-week planner" }));
  assert.ok(screen.getByRole("heading", { name: "Compare weekly menus" }));
  assert.ok(screen.getByRole("heading", { name: "Status and changes" }));
  assert.ok(screen.getByRole("navigation", { name: "Choose a rotation group" }));
  assert.ok(screen.getByLabelText("Search Dish Library"));
  assert.ok(screen.getByLabelText("Minimum guests"));
  assert.ok(screen.getByLabelText("Minimum distinct dishes"));
  assert.ok(screen.getByLabelText("Quantity increment"));
  assert.ok(screen.getByLabelText("Quantity unit"));
  assert.ok(screen.getByLabelText("Event date"));
  const statuses = screen.getAllByRole("status").map((status) => status.textContent);
  assert.ok(statuses.some((status) => status?.includes("Active")));
  assert.ok(statuses.some((status) => status?.includes("Scheduled")));
  assert.ok(statuses.some((status) => status?.includes("Draft")));
  for (const button of screen.getAllByRole("button")) {
    assert.ok(button.getAttribute("aria-label") || button.textContent?.trim(), "every button has an accessible name");
  }
  for (const control of document.querySelectorAll("input, select")) {
    assert.ok((control as HTMLInputElement).labels?.length || control.getAttribute("aria-label") || control.getAttribute("aria-labelledby"), "every form control has a programmatic label");
  }
});

test("search adds a canonical fixture dish to a selected group's bank", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup({ document: dom.window.document });
  render(React.createElement(RotationsDashboardPreview, { styles: mockStyles }));
  await user.type(screen.getByLabelText("Search Dish Library"), "Heritage");
  await user.click(screen.getAllByRole("button").find((button) => button.textContent?.trim() === "Add")!);
  assert.ok(screen.getAllByText("Heritage beetroot tartlet").length >= 1);
  assert.ok(screen.getByText(/dish-preview-006/));
});

test("groups can be added dynamically and event-date preview selects the scheduled version", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup({ document: dom.window.document });
  render(React.createElement(RotationsDashboardPreview, { styles: mockStyles }));
  await user.type(screen.getByLabelText("Add a group"), "Breakfast");
  await user.click(screen.getByRole("button", { name: "Add group" }));
  assert.ok(screen.getByRole("button", { name: /Breakfast/ }));
  fireEvent.change(screen.getByLabelText("Event date"), { target: { value: "2026-12-07" } });
  assert.ok(screen.getAllByText("Winter menu").length > 0);
  assert.ok(screen.getAllByRole("status").some((status) => status.textContent?.includes("Scheduled")));
});

test("keyboard controls reorder and copy dishes across the shared six weeks", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup({ document: dom.window.document });
  render(React.createElement(RotationsDashboardPreview, { styles: mockStyles }));
  const weekThree = screen.getByRole("region", { name: "Week 3" });
  await user.click(within(weekThree).getByRole("button", { name: "Move Roasted tomato arancini down in week 3" }));
  assert.deepEqual([...weekThree.querySelectorAll(".dishName")].map((item) => item.textContent), ["Smoked salmon blinis", "Roasted tomato arancini"]);
  await user.click(screen.getByRole("button", { name: "Copy Roasted tomato arancini to week 4" }));
  const weekFour = screen.getByRole("region", { name: "Week 4" });
  assert.deepEqual([...weekFour.querySelectorAll(".dishName")].map((item) => item.textContent), ["Roasted tomato arancini"]);
});
