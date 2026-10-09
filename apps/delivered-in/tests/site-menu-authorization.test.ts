import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { deliveredInPermissionsFor, resolveDeliveredInAccess } from "@fika/server-shared/delivered-in-access";
import { SITE_MENU_GENERATE_PERMISSION, authorizeSiteMenuGeneration, canGenerateSiteMenu } from "../lib/site-menu-authorization";
import type { SiteAccess } from "../lib/projection";

const MNK = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";
const ANGEL = "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10";
const TOKEN = "test-internal-token";
const request = (headers: Record<string, string> = {}) => new NextRequest("https://delivered-in.test/api/delivered-in/site-menu", { method: "POST", headers });
const manager: SiteAccess = { email: "manager@fikacatering.com", oplocIds: [MNK], permissions: ["delivered_in.view", SITE_MENU_GENERATE_PERMISSION] };
const viewer: SiteAccess = { email: "viewer@fikacatering.com", oplocIds: [MNK], permissions: ["delivered_in.view"] };
const asSession = (access: SiteAccess) => async () => ({ access });
const rejects = (status: number, code: string) => (error: unknown) => (error as { status?: number }).status === status && (error as { code?: string }).code === code;

async function withToken<T>(run: () => Promise<T>) {
  const saved = [process.env.FIKA_INTERNAL_API_TOKEN, process.env.DELIVERED_IN_INTERNAL_API_TOKEN];
  process.env.FIKA_INTERNAL_API_TOKEN = TOKEN; delete process.env.DELIVERED_IN_INTERNAL_API_TOKEN;
  try { return await run(); } finally { for (const [index, key] of ["FIKA_INTERNAL_API_TOKEN", "DELIVERED_IN_INTERNAL_API_TOKEN"].entries()) { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; } }
}

test("an authorised manager (session + OPLOC scope + generate permission) may generate", async () => {
  const caller = await authorizeSiteMenuGeneration(request({ cookie: "fika_session=x" }), MNK, asSession(manager));
  assert.deepEqual(caller, { kind: "manager", actor: "manager@fikacatering.com", email: "manager@fikacatering.com" });
});

test("a view-only user is rejected: viewing a site is not permission to generate", async () => {
  await assert.rejects(authorizeSiteMenuGeneration(request({ cookie: "fika_session=x" }), MNK, asSession(viewer)), rejects(403, "DELIVERED_IN_SITE_MENU_PERMISSION_REQUIRED"));
});

test("a manager is rejected for an OPLOC outside their scope, even with the permission", async () => {
  await assert.rejects(authorizeSiteMenuGeneration(request({ cookie: "fika_session=x" }), ANGEL, asSession(manager)), (error: unknown) => (error as { status?: number }).status === 403 && /not authorised/.test((error as Error).message));
});

test("an anonymous or expired session is rejected with 401/403, never a 5xx; a real upstream outage keeps its status", async () => {
  for (const status of [401, 403]) await assert.rejects(authorizeSiteMenuGeneration(request(), MNK, async () => { throw Object.assign(new Error("no session"), { status }); }), rejects(status, "DELIVERED_IN_SESSION_REQUIRED"));
  await assert.rejects(authorizeSiteMenuGeneration(request(), MNK, async () => { throw Object.assign(new Error("hub down"), { status: 503 }); }), (error: unknown) => (error as { status?: number }).status === 503);
});

test("the internal service-token automation path still works and needs no session", async () => {
  await withToken(async () => {
    let resolved = 0;
    const caller = await authorizeSiteMenuGeneration(request({ "x-fika-internal-token": TOKEN }), ANGEL, async () => { resolved += 1; return { access: viewer }; });
    assert.deepEqual(caller, { kind: "internal", actor: "system:internal" });
    assert.equal(resolved, 0, "the session resolver is not consulted for a valid service token");
  });
});

test("a wrong internal token is rejected outright and never falls back to a valid manager session", async () => {
  await withToken(async () => {
    let resolved = 0;
    await assert.rejects(authorizeSiteMenuGeneration(request({ "x-fika-internal-token": "guess", cookie: "fika_session=x" }), MNK, async () => { resolved += 1; return { access: manager }; }), rejects(401, "DELIVERED_IN_MAINTENANCE_AUTH_REQUIRED"));
    assert.equal(resolved, 0);
  });
  // With no token configured at all, a presented token can never match.
  const saved = [process.env.FIKA_INTERNAL_API_TOKEN, process.env.DELIVERED_IN_INTERNAL_API_TOKEN]; delete process.env.FIKA_INTERNAL_API_TOKEN; delete process.env.DELIVERED_IN_INTERNAL_API_TOKEN;
  try { await assert.rejects(authorizeSiteMenuGeneration(request({ "x-fika-internal-token": "" + "anything" }), MNK, asSession(manager)), rejects(401, "DELIVERED_IN_MAINTENANCE_AUTH_REQUIRED")); }
  finally { if (saved[0] !== undefined) process.env.FIKA_INTERNAL_API_TOKEN = saved[0]; if (saved[1] !== undefined) process.env.DELIVERED_IN_INTERNAL_API_TOKEN = saved[1]; }
});

test("the UI only offers generation to permitted managers, and the permission is issued to editors only", () => {
  assert.equal(canGenerateSiteMenu(manager, MNK), true);
  assert.equal(canGenerateSiteMenu(viewer, MNK), false);
  assert.equal(canGenerateSiteMenu(manager, ANGEL), false);
  assert.deepEqual(deliveredInPermissionsFor(false), ["delivered_in.view"]);
  assert.deepEqual(deliveredInPermissionsFor(true), ["delivered_in.view", "delivered_in.site_menu.generate"]);
  const records = [{ entityType: "OPLOC", canonicalId: MNK, record: { approvedName: "MNK" } }];
  assert.deepEqual(resolveDeliveredInAccess({ email: "viewer@local.fika", role: "viewer" }, records).access.permissions, ["delivered_in.view"]);
});

test("authorisation precedes any data or Drive access, and the internal token never reaches the browser", async () => {
  const route = await readFile(new URL("../app/api/delivered-in/site-menu/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const post = route.slice(route.indexOf("async function handlePost"));
  assert.ok(post.indexOf("authorizeSiteMenuGeneration(") > -1 && post.indexOf("authorizeSiteMenuGeneration(") < post.indexOf("projectedAllergenDay("), "authorise before reading the day");
  assert.ok(post.indexOf("authorizeSiteMenuGeneration(") < post.indexOf("createGoogleSiteMenu("), "authorise before Drive");
  assert.doesNotMatch(page, /x-fika-internal-token|INTERNAL_API_TOKEN/, "no service credential in client code");
  assert.doesNotMatch(route, /NextResponse\.json\([^)]*(token|INTERNAL)/i, "the token is never echoed");
});
