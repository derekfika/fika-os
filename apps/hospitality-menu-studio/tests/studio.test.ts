import assert from "node:assert/strict";
import { getApp } from "firebase-admin/app";
import test from "node:test";
import { authoriseStudio, assertStudioRequestHost, requireSameOrigin, studioSignIn } from "../lib/auth";
import { londonDate, rotationWeek, type Dish, type Menu } from "../lib/contract";
import { studioHandlers } from "../lib/http";
import { StudioProblem } from "../lib/problem";
import { assortmentIsComplete, draftCustomerChoices, draftReadiness, kitchenQuantities } from "../lib/review";
import { assertStudioDraftCommand, localStudioSafetyAvailable, studioRuntime } from "../lib/runtime";
import { studioStore } from "../lib/store";
import { commandSchema, dateSchema } from "../lib/schema";

const dish: Dish = {
  id: "dish-1", version: 1, name: "Test selection", category: "vegetarian", temperature: null,
  customerDescription: "Customer copy", kitchenDescription: "Kitchen evidence only",
  assortment: { expectedTotal: 24, unit: "pieces", components: [
    { id: "component-a", name: "Test item A", quantity: 12 },
    { id: "component-b", name: "Test item B", quantity: 12 },
  ] }, updatedAt: "",
};
const menu: Menu = {
  id: "menu-1", version: 1, name: "Test season", kind: "seasonal",
  startDate: "2026-11-30", endDate: "2027-02-28", anchorMonday: "2026-11-30", updatedAt: "",
  sections: [
    { id: "all", name: "All season", catalogueItemId: "catalogue-a", mode: "static", staticDishIds: [dish.id], weeks: [[], [], [], [], [], []] },
    { id: "weekly", name: "Weekly", catalogueItemId: "catalogue-b", mode: "rotation", staticDishIds: [], weeks: [[dish.id], [], [], [], [], []] },
  ],
};

test("London dates and the shared rotation cross DST and year boundaries", () => {
  assert.equal(londonDate(new Date("2026-10-24T23:30:00Z")), "2026-10-25");
  assert.equal(londonDate(new Date("2026-10-25T23:30:00Z")), "2026-10-25");
  assert.equal(rotationWeek(menu.anchorMonday, "2027-01-04"), 6);
  assert.equal(rotationWeek(menu.anchorMonday, "2027-01-11"), 1);
  assert.equal(rotationWeek(menu.anchorMonday, "2026-11-29"), 6);
  assert.equal(rotationWeek("2027-03-22", "2027-03-28"), 1);
  assert.equal(rotationWeek("2027-03-22", "2027-03-29"), 2);
  assert.equal(rotationWeek("2027-03-22", "2027-05-03"), 1);
  assert.equal(dateSchema.safeParse("2027-02-29").success, false);
});

test("incomplete assortments can be saved as drafts and block readiness", () => {
  const incomplete = { ...dish, assortment: { expectedTotal: 24, unit: "pieces", components: [] } };
  assert.equal(commandSchema.safeParse({ action: "save-dish", item: incomplete }).success, true);
  assert.equal(assortmentIsComplete(incomplete), false);
  const review = draftReadiness(menu, [incomplete], "2026-12-01", { sectionId: "weekly", week: 1 }, "2026-11-18");
  assert.ok(review.issues.some(issue => issue.includes("incomplete fixed assortment")));
  assert.equal(review.canPublish, false);
  assert.equal(review.reviewToken, null);
  assert.deepEqual(review.impact, { status: "unavailable" });
});

test("draft preview selects by event date and excludes kitchen and assortment evidence", () => {
  assert.deepEqual(draftCustomerChoices(menu, [dish], "2026-11-29"), []);
  const first = draftCustomerChoices(menu, [dish], "2027-01-11");
  const next = draftCustomerChoices(menu, [dish], "2027-01-18");
  assert.deepEqual(first.map(section => section.dishes.length), [1, 1]);
  assert.deepEqual(next.map(section => section.dishes.length), [1, 0]);
  assert.deepEqual(first[0].dishes[0], {
    id: dish.id, name: dish.name, category: "vegetarian", temperature: null, description: "Customer copy",
  });
});

test("a rotating draft needs a valid Monday anchor for preview; all-season drafts do not", () => {
  for (const anchorMonday of ["", "2026-12-01"]) {
    assert.throws(() => draftCustomerChoices({ ...menu, anchorMonday }, [dish], "2026-12-01"), {
      code: "ROTATION_ANCHOR_REQUIRED",
    });
  }
  const allSeason = { ...menu, anchorMonday: "", sections: menu.sections.slice(0, 1) };
  assert.equal(draftCustomerChoices(allSeason, [dish], "2026-12-01")[0].dishes.length, 1);
});

test("kitchen totals distinguish box count, pieces per box and component totals", () => {
  const result = kitchenQuantities(dish, 4);
  assert.equal(result.perBox, 24);
  assert.equal(result.total, 96);
  assert.deepEqual(result.components.map(component => [component.perBox, component.total]), [[12, 48], [12, 48]]);
  for (const invalid of [0, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => kitchenQuantities(dish, invalid), StudioProblem);
});

const staging = {
  NODE_ENV: "test" as const,
  FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev",
  FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com",
  FIKA_STUDIO_ORIGIN: "https://menu-studio-staging.fikacatering.com",
  FIKA_STUDIO_FIRESTORE_DATABASE: "hospitality-menu-studio",
  FIKA_SESSION_COOKIE_DOMAIN: ".fikacatering.com",
};

test("Studio food-safety work requires the authenticated demo emulator runtime", () => {
  const demo = { NODE_ENV: "development", FIREBASE_PROJECT_ID: "demo-fika-os", FIKA_RUNTIME_MODE: "local" } as const;
  assert.equal(localStudioSafetyAvailable(demo), false);
  assert.equal(localStudioSafetyAvailable({ ...demo, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8896" }), true);
  assert.throws(() => localStudioSafetyAvailable({ ...demo, FIRESTORE_EMULATOR_HOST: "other.test:8896" }), StudioProblem);
  assert.equal(localStudioSafetyAvailable({ ...demo, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8896", FIKA_STUDIO_LOCAL_PREVIEW: "1" }), false);
  assert.equal(localStudioSafetyAvailable(staging), false);
});

test("runtime rejects cross-project configuration and local fixture settings in staging", () => {
  assert.equal(studioRuntime(staging).name, "fika_os_session_staging");
  assert.equal(studioRuntime(staging).writes, true);
  assert.equal(studioRuntime(staging).databaseId, "hospitality-menu-studio");
  for (const override of [
    { FIREBASE_PROJECT_ID: "fika-os" }, { FIREBASE_PROJECT_ID: "another-staging-project" },
    { GOOGLE_APPLICATION_CREDENTIALS: "unexpected.json" }, { GOOGLE_CLOUD_PROJECT: "another-staging-project" }, { FIKA_HUB_BASE_URL: "https://os.fikacatering.com" },
    { FIKA_STUDIO_LOCAL_PREVIEW: "1" }, { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085" },
    { FIKA_RUNTIME_MODE: "production" }, { GCLOUD_PROJECT: "fika-os" },
    { FIKA_STUDIO_FIRESTORE_DATABASE: undefined }, { FIKA_STUDIO_FIRESTORE_DATABASE: "(default)" },
    { FIKA_STUDIO_ORIGIN: "https://menu-studio-staging.fikacatering.com.example.org" },
    { FIKA_SESSION_COOKIE_DOMAIN: undefined },
  ]) assert.throws(() => studioRuntime({ ...staging, ...override }), StudioProblem);
  const fixture = studioRuntime({ NODE_ENV: "development", FIREBASE_PROJECT_ID: "demo-fika-os", FIKA_STUDIO_LOCAL_PREVIEW: "1" });
  assert.equal(fixture.fixture, true);
  assert.throws(() => assertStudioRequestHost(fixture, "other.example:13686"), StudioProblem);
});

test("staging Studio accepts only a stable principal and a dedicated View decision from Hub", async () => {
  const runtime = studioRuntime(staging);
  const principal = { id: "legend:test", displayName: "Test editor" };
  const reply: typeof fetch = async (url, init) => {
    assert.equal(url, "https://staging-os.fikacatering.com/api/hospitality-studio-access");
    assert.deepEqual(init?.headers, { cookie: "fika_os_session_staging=sample", accept: "application/json" });
    assert.equal(init?.redirect, "error");
    return Response.json({ principal, permissions: { View: true } });
  };
  assert.deepEqual(await authoriseStudio("sample", runtime, reply), {
    id: principal.id, name: principal.displayName, canManage: false, canPublish: false,
  });
  assert.deepEqual(await authoriseStudio("sample", runtime, async () => Response.json({
    principal, permissions: { View: true, Manage: true },
  })), { id: principal.id, name: principal.displayName, canManage: true, canPublish: false });
  await assert.rejects(authoriseStudio(undefined, runtime, reply), { status: 401 });
  await assert.rejects(authoriseStudio("sample", runtime, async () => new Response(null, { status: 403 })), { status: 403 });
  await assert.rejects(authoriseStudio("sample", runtime, async () => Response.json({
    principal, permissions: { View: true, Manage: false, Publish: true },
  })), { status: 503 });
  await assert.rejects(authoriseStudio("sample", runtime, async () => Response.json({})), { status: 503 });
});

test("staging rejects alternate request hosts and sends sign-in to the pinned Hub and return URL", () => {
  const runtime = studioRuntime(staging);
  const host = "menu-studio-staging.fikacatering.com";
  assert.doesNotThrow(() => assertStudioRequestHost(runtime, host));
  const transport = "fika-menu-studio-staging-594727519934.europe-west4.run.app";
  assert.doesNotThrow(() => assertStudioRequestHost(runtime, transport));
  const request = (origin: string) => new Request("https://" + host + "/api/studio", {
    method: "POST", headers: { host: transport, origin },
  });
  assert.doesNotThrow(() => requireSameOrigin(request("https://" + host), runtime));
  assert.throws(() => requireSameOrigin(request("https://os.fikacatering.com"), runtime), { code: "STUDIO_ORIGIN_DENIED" });
  for (const outside of [null, "fika-menu-studio-staging--fika-os-dev.europe-west4.hosted.app", "os.fikacatering.com"]) {
    assert.throws(() => assertStudioRequestHost(runtime, outside), { code: "STUDIO_ORIGIN_DENIED" });
  }
  const url = new URL(studioSignIn(runtime, new StudioProblem(401, "FIKA_SESSION_INVALID", "Test")));
  assert.equal(url.origin, "https://staging-os.fikacatering.com");
  assert.equal(url.searchParams.get("returnTo"), "https://" + host + "/");
  assert.equal(url.searchParams.get("appId"), "hospitality-menu-studio");
  assert.equal(url.searchParams.get("launchError"), "FIKA_SESSION_INVALID");
});

test("the staging Admin SDK client is bound to the named database", () => {
  const store = studioStore(studioRuntime(staging));
  assert.equal(getApp("hospitality-menu-studio-fika-os-dev").options.projectId, "fika-os-dev");
  assert.equal(store["db"].databaseId, "hospitality-menu-studio");
});

test("publication and activation require explicit rights and intent and fail closed without providers", async () => {
  const make = (allowed: boolean) => studioHandlers(async () => ({
    id: "test-actor", name: "Test", canManage: true, canPublish: allowed,
  }), () => assert.fail("blocked action accessed storage"), requireSameOrigin);
  const post = (body: unknown, origin = "http://localhost:13686") => new Request("http://localhost:13686/api/studio", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const publish = { action: "publish", menuId: "menu-1", version: 1, effectiveDate: "2026-12-01", scope: {}, reviewToken: "test" };
  const activate = { action: "activate-collection", menuId: "menu-1", publicationId: "publication-1", visibility: "customer" };
  for (const action of [publish, activate]) {
    assert.equal((await make(true).POST(post(action))).status, 422);
    assert.equal((await make(false).POST(post({ ...action, confirmed: true }))).status, 403);
    assert.equal((await make(true).POST(post({ ...action, confirmed: true }))).status, 503);
  }
  assert.equal((await make(true).POST(post({ ...publish, confirmed: true }, "https://untrusted.invalid"))).status, 403);
});

test("staging commands are limited to synthetic draft actions before accessing storage", async () => {
  const make = studioHandlers(async () => ({ id: "fixture", name: "Fixture", canManage: true, canPublish: true }),
    () => assert.fail("An operational command accessed storage"), () => {}, undefined,
    command => assertStudioDraftCommand(command.action));
  const planned = { menuId: "menu-1", version: 1, effectiveDate: "2026-12-01", scope: {} };
  for (const command of [
    { action: "submit-dish-review", dishId: "dish-1", version: 1, confirmed: true },
    { ...planned, action: "publish", reviewToken: "test", confirmed: true },
    { action: "activate-collection", menuId: "menu-1", publicationId: "publication-1", visibility: "customer", confirmed: true },
    { action: "restore-menu", menuId: "menu-1", publicationId: "publication-1", version: 1 },
  ]) {
    const response = await make.POST(new Request("https://menu-studio-staging.fikacatering.com/api/studio", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
    }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "STUDIO_WRITE_DENIED");
  }
  const state = await make.GET(new Request("https://menu-studio-staging.fikacatering.com/api/studio?dishId=dish-1&reviewVersion=1"));
  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), { status: "unavailable" });
  for (const query of ["list=published-kitchen-dishes&menuId=menu-1&publicationId=pub-1",
    "menuId=menu-1&publicationId=pub-1&kitchenDishId=dish-1"]) {
    const response = await make.GET(new Request("https://menu-studio-staging.fikacatering.com/api/studio?" + query));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "PUBLICATION_UNAVAILABLE", error: "Published kitchen specifications are unavailable." });
  }
  for (const action of ["save-dish", "save-menu", "restore-draft", "review"]) assert.doesNotThrow(() => assertStudioDraftCommand(action));
  assert.throws(() => assertStudioDraftCommand("sign-allergens"), { code: "STUDIO_WRITE_DENIED" });
});

test("local same-origin accepts either exact loopback host when Next normalizes its URL", () => {
  const runtime = studioRuntime({ NODE_ENV: "test", FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "demo-fika-os" });
  const call = (host: string, origin: string) => requireSameOrigin(new Request("http://localhost:13686/api/studio", {
    method: "POST", headers: { host, origin },
  }), runtime);
  assert.doesNotThrow(() => call("127.0.0.1:13686", "http://127.0.0.1:13686"));
  assert.doesNotThrow(() => call("localhost:13686", "http://localhost:13686"));
  assert.throws(() => call("127.0.0.1:13686", "http://localhost:13686"), { code: "STUDIO_ORIGIN_DENIED" });
  assert.throws(() => call("unknown.invalid:13686", "http://unknown.invalid:13686"), { code: "STUDIO_ORIGIN_DENIED" });
});
