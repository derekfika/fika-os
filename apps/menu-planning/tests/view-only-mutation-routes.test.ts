import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as legacyMenu } from "../app/api/menu/route";
import { POST as legacyRecipes } from "../app/api/menu/recipes/route";
import { POST as sandwiches } from "../app/api/sandwiches/route";
import { POST as rollingMenu } from "../app/api/rolling-menu/route";
import { POST as rollingImport } from "../app/api/rolling-menu/import/route";
import { POST as publications } from "../app/api/rolling-menu/publications/route";
import { POST as catalogue } from "../app/api/catalogue/route";
import { POST as dishTags } from "../app/api/dish-tags/route";
import { POST as sources } from "../app/api/menu/source-candidates/route";
import { POST as rotations } from "../app/api/hospitality-rotations/route";
import { POST as rotationDishes } from "../app/api/hospitality-rotations/dishes/route";
import { POST as mirror } from "../app/api/internal/cpux-mirror/route";
import { menuReadScopeKey, resolveMenuActor, scopeMenuPublication, type MenuActor } from "../lib/auth";
import { assertMenuAllocationsScope } from "../lib/menu-mutation-scope";
import type { MenuPublication } from "../lib/menu-publication";

const first = "oploc:permitted-fixture";
const second = "oploc:viewer-fixture";
const permissions = (manageOplocIds: string[], publishOplocIds: string[]) => ({
  manageOplocIds, publishOplocIds, canManageOrganisation: false, canPublishOrganisation: false,
});
const request = (path: string, action: string) => new NextRequest(`http://menu.test${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: "fika_os_session=fixture", origin: "http://menu.test" },
  body: JSON.stringify(path === "/api/internal/cpux-mirror" ? { from: "2026-11-23", through: "2026-11-24" } : { action, weekId: "fixture-week", publicationId: "fixture-publication" }),
});

async function withHubFixture(permissionData: ReturnType<typeof permissions> | undefined, assertion: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.FIKA_HUB_BASE_URL;
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  process.env.FIKA_HUB_BASE_URL = "https://fixture.example";
  process.env.FIKA_RUNTIME_MODE = "staging";
  const unexpectedCalls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input);
    if (!url.endsWith("/api/menu-planning/access")) {
      unexpectedCalls.push(url);
      throw new Error("Denied request reached another dependency.");
    }
    return Response.json({ principal: { id: "authmod:fixture" }, scope: { all: false, ids: [first, second] },
      canManage: true, canPublish: true, permissions: permissionData });
  }) as typeof fetch;
  try {
    await assertion();
    assert.deepEqual(unexpectedCalls, []);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = previousUrl;
    if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode;
  }
}

test("View-only sessions reject every interactive Menu write surface with 403 before downstream work", async () => {
  await withHubFixture(permissions([], []), async () => {
    const mutations = [
      ["/api/menu", legacyMenu, ["publish", "allocate-site"]],
      ["/api/menu/recipes", legacyRecipes, ["import-all"]],
      ["/api/sandwiches", sandwiches, ["save"]],
      ["/api/rolling-menu", rollingMenu, ["save-week", "publish", "publish-amendment", "set-hospitality-availability", "duplicate-plan", "duplicate-week", "create-week", "reset-week", "update-entry", "batch-update-entries", "create-entry", "add-one-off-destination", "add-menu-slot", "remove-menu-slot", "clean-duplicate-entries"]],
      ["/api/rolling-menu/import", rollingImport, ["commit"]],
      ["/api/rolling-menu/publications", publications, ["withdraw", "withdraw-week", "repair-handoff", "retry-handoff", "retry-archive"]],
      ["/api/catalogue", catalogue, ["update-dish", "add-use-classification", "merge-reviewed-dishes"]],
      ["/api/dish-tags", dishTags, ["create-tag"]],
      ["/api/menu/source-candidates", sources, ["promote"]],
      ["/api/hospitality-rotations", rotations, ["save-draft"]],
      ["/api/hospitality-rotations/dishes", rotationDishes, ["create-and-link"]],
      ["/api/internal/cpux-mirror", mirror, ["save"]],
    ] as const;
    for (const [path, handler, actions] of mutations) {
      for (const action of actions) assert.equal((await handler(request(path, action))).status, 403, `${path} ${action}`);
    }
  });
});

test("Publish authority only applies where that same OPLOC has Manage", async () => {
  await withHubFixture(permissions([first], [second]), async () => {
    const actor = await resolveMenuActor(request("/api/rolling-menu", "save-week"));
    assert.equal(actor.role, "reviewer");
    assert.deepEqual(actor.permissions?.manageOplocIds, [first]);
    assert.deepEqual(actor.permissions?.publishOplocIds, []);
    assert.equal((await rollingMenu(request("/api/rolling-menu", "publish"))).status, 403);
    assert.equal((await publications(request("/api/rolling-menu/publications", "withdraw-week"))).status, 403);
  });
  await withHubFixture(permissions([first], [first]), async () => {
    const actor = await resolveMenuActor(request("/api/rolling-menu", "publish"));
    assert.equal(actor.role, "integration-admin");
    assert.deepEqual(actor.permissions?.publishOplocIds, [first]);
  });
});

test("legacy aggregate booleans cannot create scoped write authority", async () => {
  await withHubFixture(undefined, async () => {
    const actor = await resolveMenuActor(request("/api/rolling-menu", "save-week"));
    assert.equal(actor.role, "viewer");
    assert.equal((await rollingMenu(request("/api/rolling-menu", "save-week"))).status, 403);
  });
});

test("historical published menus expose only allowed allocations and PAX with no unscoped packet or archive", () => {
  const oldFirst = "oploc:legacy-permitted-fixture";
  const actor: MenuActor = { uid: "authmod:fixture", role: "viewer", oplocIds: [first], allOplocs: false, oplocRedirects: { [oldFirst]: first } };
  const publication = {
    weekPacket: { fixture: "full week" },
    compiledSnapshotId: "full-week-fixture",
    audit: [{ impactSummary: { site: second } }],
    days: [{
      destinationPax: { [`governed:${oldFirst}`]: 4, [`governed:${second}`]: 9, "one-off:private-location": 25 },
      driveArchive: { pdfDriveUrl: "https://example.invalid/full-week" },
      retainedSiteLineage: { [oldFirst]: { version: 1 }, [second]: { version: 1 } },
      entries: [
        { sourceEntryId: "shared", allocations: [{ destinationId: oldFirst, quantity: 4 }, { destinationId: second, quantity: 100 }] },
        { sourceEntryId: "other-site-only", allocations: [{ destinationId: second, quantity: 10 }] },
        { sourceEntryId: "one-off-only", allocations: [{ oneOffDestinationId: "private-location", quantity: 25 }] },
      ],
    }],
  } as unknown as MenuPublication;
  const visible = scopeMenuPublication(publication, actor);
  assert.equal(visible.weekPacket, undefined);
  assert.equal(visible.compiledSnapshotId, undefined);
  assert.deepEqual(visible.audit, []);
  assert.deepEqual(visible.days[0].destinationPax, { [`governed:${oldFirst}`]: 4 });
  assert.deepEqual(Object.keys(visible.days[0].retainedSiteLineage || {}), [oldFirst]);
  assert.equal(visible.days[0].driveArchive, undefined);
  assert.deepEqual(visible.days[0].entries.map(entry => [entry.sourceEntryId, entry.portions]), [["shared", 4]]);
  assert.notEqual(menuReadScopeKey(actor), menuReadScopeKey({ ...actor, oplocIds: [first, second] }));
  assert.notEqual(menuReadScopeKey(actor), menuReadScopeKey({ ...actor, allOplocs: true }));
  const afterRedirect = { ...actor, oplocRedirects: {} };
  assert.notEqual(menuReadScopeKey(actor), menuReadScopeKey(afterRedirect));
  assert.deepEqual(scopeMenuPublication(publication, afterRedirect).days, []);
});

test("a scoped Manage session cannot write through a different site or an ungoverned one-off", () => {
  const actor: MenuActor = { uid: "authmod:fixture", role: "reviewer", oplocIds: [first, second], allOplocs: false,
    permissions: permissions([first], []), oplocRedirects: { "oploc:legacy-fixture": first } };
  assert.doesNotThrow(() => assertMenuAllocationsScope(actor, "manage", [{ destinationId: "oploc:legacy-fixture" }], new Map()));
  for (const destination of [{ destinationId: second }, { oneOffDestinationId: "private-location" }]) {
    assert.throws(() => assertMenuAllocationsScope(actor, "manage", [destination], new Map()), { status: 403 });
  }
});
