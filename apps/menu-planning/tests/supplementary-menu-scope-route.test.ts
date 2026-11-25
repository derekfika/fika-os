import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/rolling-menu/route";
import { createRollingSnapshot } from "../lib/operational-store";
import { emptyWeek, supplementaryMenuWeekId } from "../lib/rolling-menu";

test("rolling-menu API scopes menus and labels, including date navigation, week heads and explicit detail", async t => {
  const dir = mkdtempSync(join(tmpdir(), "menu-summary-scope-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { FIKA_RUNTIME_MODE: "local", FIKA_HUB_BASE_URL: "http://hub.test", MENU_PLANNING_DB_PATH: join(dir, "fixture.sqlite"), MENU_PLANNING_TEST_MODE: "1" };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
  const date = "2026-11-23";
  const permitted = "oploc:permitted";
  const historical = "oploc:permitted-alias";
  const other = "oploc:other";
  const privateNotes = "Synthetic kitchen preparation instructions";
  const main = emptyWeek(date);
  const menu = (id: string, siteIds: string[]) => {
    const snapshot = emptyWeek(date, "fixture", [], supplementaryMenuWeekId(date, id));
    snapshot.week.supplementaryMenu = {
      id, name: id, serviceType: "Breakfast", siteIds, serviceDate: date, kitchenNotes: privateNotes,
      siteLabels: { [historical]: "Allowed fixture location", [other]: "Other fixture location", orphan: "Unrelated label" },
    };
    return snapshot;
  };
  const shared = menu("shared-breakfast", [historical, other]);
  const hidden = menu("other-breakfast", [other]);
  for (const snapshot of [main, shared, hidden]) await createRollingSnapshot(snapshot);
  let allSites = false;
  let organisationManager = false;
  let writableSites: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    switch (new URL(String(input)).pathname) {
      case "/api/menu-planning/access":
        return Response.json({
          principal: { id: "fixture-user" }, scope: { all: allSites, ids: allSites ? [permitted, other] : [permitted] },
          permissions: { manageOplocIds: writableSites, canManageOrganisation: organisationManager },
          oplocRedirects: { [historical]: permitted },
        });
      case "/api/service-arrangements": return Response.json({ arrangements: [], oplocs: [] });
      default: throw Error("Unexpected upstream request in isolated scope fixture");
    }
  });
  const read = (query: Record<string, string>) => GET(new NextRequest(`http://menu.test/api/rolling-menu?${new URLSearchParams(query)}`, { headers: { cookie: "fika_os_session=fixture" } }));
  const assertScoped = (value: { siteIds: string[]; siteLabels: Record<string, string>; kitchenNotes?: string }) => {
    assert.deepEqual(value.siteIds, [historical]);
    assert.deepEqual(value.siteLabels, { [historical]: "Allowed fixture location" });
    assert.equal(value.kitchenNotes, undefined);
  };
  for (const query of [{ summariesOnly: "true" }, { summariesOnly: "true", weekId: shared.week.id, menuWeekCommencing: date }]) {
    const response = await read(query as Record<string, string>);
    assert.equal(response.status, 200);
    const result = await response.json();
    const weeks = result.menuWeeks || result.weeks;
    assert.deepEqual(weeks.map((week: { id: string }) => week.id).sort(), [main.week.id, shared.week.id].sort());
    assertScoped(weeks.find((week: { id: string }) => week.id === shared.week.id).supplementaryMenu);
  }
  for (const extra of [{}, { menuWeekCommencing: date }]) {
    const response = await read({ summariesOnly: "true", weekId: hidden.week.id, ...extra } as Record<string, string>);
    assert.deepEqual(await response.json(), { week: null });
  }
  const inaccessible = await read({ weekId: hidden.week.id, snapshotOnly: "true" });
  assert.equal(inaccessible.status, 404);
  const detail = await read({ weekId: shared.week.id });
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assertScoped(detailBody.snapshot.week.supplementaryMenu);
  assert.equal(detailBody.weeks.some((week: { id: string }) => week.id === hidden.week.id), false);
  for (const forbidden of [privateNotes, "Other fixture location", "Unrelated label"]) assert.ok(!JSON.stringify(detailBody).includes(forbidden));

  allSites = true;
  const viewerResponse = await read({ weekId: shared.week.id });
  assert.equal(viewerResponse.status, 200);
  assert.ok(!JSON.stringify(await viewerResponse.json()).includes(privateNotes));
  organisationManager = true;
  writableSites = [permitted];
  const partialManagerResponse = await read({ weekId: shared.week.id });
  assert.equal(partialManagerResponse.status, 200);
  assert.ok(!JSON.stringify(await partialManagerResponse.json()).includes(privateNotes));
  writableSites = [permitted, other];
  const managerResponse = await read({ weekId: shared.week.id });
  assert.equal(managerResponse.status, 200);
  const manager = await managerResponse.json();
  assert.equal(manager.snapshot.week.supplementaryMenu.kitchenNotes, privateNotes);
  assert.equal(manager.weeks.length, 3);
  assert.ok(!JSON.stringify(manager.weeks).includes(privateNotes));
  assert.ok(!JSON.stringify(manager.weeks).includes("Unrelated label"));
  assert.notEqual(managerResponse.headers.get("x-fika-menu-cache-scope"), viewerResponse.headers.get("x-fika-menu-cache-scope"));
  assert.notEqual(managerResponse.headers.get("x-fika-menu-cache-scope"), partialManagerResponse.headers.get("x-fika-menu-cache-scope"));
});
