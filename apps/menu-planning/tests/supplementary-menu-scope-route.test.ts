import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/rolling-menu/route";
import { createRollingSnapshot, getWeekHead } from "../lib/operational-store";
import { createSupplementaryMenuWeek, emptyWeek, listSupplementaryMenuTemplates, supplementaryMenuWeekId } from "../lib/rolling-menu";

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

test("a site manager materialises and amends only authorised recurring menus", async t => {
  const dir = mkdtempSync(join(tmpdir(), "menu-recurrence-scope-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [key, value] of Object.entries({ FIKA_RUNTIME_MODE: "local", FIKA_HUB_BASE_URL: "http://hub.test", MENU_PLANNING_DB_PATH: join(dir, "fixture.sqlite"), MENU_PLANNING_TEST_MODE: "1" })) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
  const allowed = "oploc:allowed", alias = "oploc:old-allowed", other = "oploc:other";
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    switch (new URL(String(input)).pathname) {
      case "/api/menu-planning/access": return Response.json({
        principal: { id: "site-manager" }, scope: { all: true, ids: [allowed, other] },
        permissions: { manageOplocIds: [allowed] }, oplocRedirects: { [alias]: allowed },
      });
      case "/api/service-arrangements": return Response.json({ arrangements: [], oplocs: [] });
      default: throw Error("Unexpected upstream in recurrence fixture");
    }
  });
  const first = "2026-11-23", second = "2026-11-30", third = "2026-12-07";
  const fixtureAccess = { canManage: () => true, assertSnapshot() {} };
  for (const [id, sites] of [["allowed-breakfast", [alias]], ["other-breakfast", [other]], ["shared-breakfast", [allowed, other]]] as const) {
    await createSupplementaryMenuWeek(first, { id, name: id, serviceType: "Breakfast", siteIds: [...sites], recurrenceWeekdays: [1] }, "fixture", fixtureAccess);
  }
  const limitedAccess = { canManage: (id: string) => id === allowed || id === alias, assertSnapshot() {} };
  const sameId = { id: "shared-breakfast", name: "Duplicate", serviceType: "Breakfast" as const, siteIds: [allowed], recurrenceWeekdays: [1] };
  await assert.rejects(createSupplementaryMenuWeek(first, sameId, "site-manager", limitedAccess), { status: 403 });
  await assert.rejects(createSupplementaryMenuWeek(second, sameId, "site-manager", limitedAccess), { status: 409 });
  const execute = (body: Record<string, unknown>) => POST(new NextRequest("http://menu.test/api/rolling-menu", {
    method: "POST", headers: { cookie: "fika_os_session=fixture", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const ensure = (weekCommencing: string) => execute({ action: "ensure-recurring-menus", weekCommencing });
  const allowedId = supplementaryMenuWeekId(second, "allowed-breakfast");
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await ensure(second);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).weekIds, [allowedId]);
  }
  for (const id of ["other-breakfast", "shared-breakfast"]) assert.equal(await getWeekHead(supplementaryMenuWeekId(second, id)), undefined);
  const amended = await execute({ action: "update-supplementary-menu", weekId: allowedId, expectedWeekVersion: 1, name: "Revised breakfast", serviceType: "Breakfast", recurrenceWeekdays: [5], applyToFuture: true });
  assert.equal(amended.status, 200);
  const template = (await listSupplementaryMenuTemplates()).find(value => value.id === "allowed-breakfast")!;
  assert.deepEqual(template.recurrenceWeekdays, [5]);
  assert.equal(template.audit?.at(-1)?.by, "site-manager");
  const discontinue = (menuId: string) => execute({ action: "discontinue-supplementary-menu", menuId, discontinuedAfter: second });
  assert.equal((await discontinue("shared-breakfast")).status, 403);
  assert.equal((await discontinue("allowed-breakfast")).status, 200);
  assert.equal((await discontinue("allowed-breakfast")).status, 200);
  assert.equal((await listSupplementaryMenuTemplates()).find(value => value.id === template.id)?.audit?.filter(event => event.action === "recurrence-discontinued").length, 1);
  const pastCutoff = await ensure(third);
  assert.equal(pastCutoff.status, 200);
  assert.deepEqual((await pastCutoff.json()).weekIds, []);
  assert.equal(await getWeekHead(supplementaryMenuWeekId(third, template.id)), undefined);
});
