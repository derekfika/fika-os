import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { checkedDishes } from "../lib/hospitality-rotations/resources";
import { rotationHandlers } from "../lib/hospitality-rotations/http";
import { RotationStore, rotationProblem } from "../lib/hospitality-rotations/store";

test("rotation picker offers only hospitality-scoped dishes and never the Menu Planning Dish Library", () => {
  const row = (id: string, scope: string | undefined, extra: Record<string, unknown> = {}) => ({ kind: "dish", record: { canonicalId: id, displayName: id, revision: 2, reviewStatus: "approved", operationalScope: scope, ...extra } });
  const dishes = checkedDishes([
    row("dish:hospitality", "HOSPITALITY_ROTATIONS", { displayName: "Chicken skewer", hospitalityClass: "finger-food" }),
    row("dish:shared", "SHARED", { displayName: "Shared dip" }),
    row("dish:planner", "MENU_PLANNING"),
    row("dish:legacy", undefined),
    row("dish:archived", "HOSPITALITY_ROTATIONS", { reviewStatus: "archived" }),
    row("dish:bad-revision", "HOSPITALITY_ROTATIONS", { revision: "2" }),
    { kind: "sandwich", record: { canonicalId: "sandwich:one", displayName: "Sandwich", revision: 1, operationalScope: "HOSPITALITY_ROTATIONS" } },
  ], [{ schema: "hospitality-rotation-dish-link.v1", itemId: "item:one", dishId: "dish:hospitality", classification: "finger-food", actorId: "sam", recordedAt: "2026-10-29T00:00:00Z", requestId: "r" }]);
  assert.deepEqual(dishes, [
    { id: "dish:hospitality", name: "Chicken skewer", category: "Finger Food", revision: 2, scope: "HOSPITALITY_ROTATIONS", hospitalityClass: "finger-food", itemId: "item:one" },
    { id: "dish:shared", name: "Shared dip", category: "Hospitality dish", revision: 2, scope: "SHARED" },
  ]);
});

test("a failing dependency is named in the response and never replaced by an empty success", async () => {
  const handlers = rotationHandlers({} as RotationStore, async () => ({ id: "manager" }) as never, async () => { throw rotationProblem("Hospitality catalogue package is unavailable", 503); });
  const response = await handlers.GET(new NextRequest("http://localhost/api/hospitality-rotations?mode=resources"));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /Hospitality catalogue package is unavailable/);
  const unknown = rotationHandlers({} as RotationStore, async () => ({ id: "manager" }) as never, async () => { throw new Error("secret firestore detail"); });
  const hidden = await unknown.GET(new NextRequest("http://localhost/api/hospitality-rotations?mode=resources"));
  assert.equal(hidden.status, 503);
  assert.doesNotMatch(JSON.stringify(await hidden.json()), /secret firestore detail/);
});

test("link-dish needs Manage and the access mode reports the caller", async () => {
  const actions: string[] = [];
  const linked: unknown[] = [];
  const store = { linkDish: async (actor: string, raw: unknown) => { linked.push({ actor, raw }); return { link: {}, replayed: false }; } } as unknown as RotationStore;
  const handlers = rotationHandlers(store, async (_request, action) => { actions.push(action); if (action === "Publish") throw Object.assign(new Error("forbidden"), { status: 403 }); return { id: "sam", displayName: "Sam" } as never; }, async () => ({}));
  const body = { action: "link-dish", requestId: "r1", itemId: "item:one", dishId: "dish:one", classification: "finger-food" };
  const ok = await handlers.POST(new NextRequest("http://localhost/api/hospitality-rotations", { method: "POST", body: JSON.stringify(body) }));
  assert.equal(ok.status, 200);
  assert.deepEqual(actions, ["Manage"]);
  assert.deepEqual(linked, [{ actor: "sam", raw: body }]);
  const access = await (await handlers.GET(new NextRequest("http://localhost/api/hospitality-rotations?mode=access"))).json();
  assert.deepEqual(access, { permissions: { View: true, Manage: true, Publish: false }, principal: { id: "sam", displayName: "Sam" } });

  const denied = rotationHandlers({ linkDish: async () => { throw new Error("must not run"); } } as unknown as RotationStore, async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); }, async () => ({}));
  assert.equal((await denied.POST(new NextRequest("http://localhost/api/hospitality-rotations", { method: "POST", body: JSON.stringify(body) }))).status, 403);
});

test("resource mode is Manage-authorised and never runs its loader before authorisation", async () => {
  const actions: string[] = [];
  let loaded = false;
  const handlers = rotationHandlers({} as RotationStore, async (_request, action) => {
    actions.push(action);
    if (action !== "Manage") throw Object.assign(new Error("forbidden"), { status: 403 });
    return { id: "manager" } as never;
  }, async () => { loaded = true; return { dishes: [], items: [] }; });
  const response = await handlers.GET(new NextRequest("http://localhost/api/hospitality-rotations?mode=resources"));
  assert.equal(response.status, 200);
  assert.deepEqual(actions, ["Manage"]);
  assert.equal(loaded, true);

  loaded = false;
  const denied = rotationHandlers({} as RotationStore, async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); }, async () => { loaded = true; return { dishes: [], items: [] }; });
  const deniedResponse = await denied.GET(new NextRequest("http://localhost/api/hospitality-rotations?mode=resources"));
  assert.equal(deniedResponse.status, 403);
  assert.equal(loaded, false);
});
