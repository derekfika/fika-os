import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import { createAndLinkHospitalityDish } from "../lib/hospitality-dish-command";
import { forwardRotations, readRotationAccess, rotationsHubPath } from "../lib/hospitality-rotations-hub";
import { hospitalityDishIdForItem } from "../../shared/hospitality-rotations";
import type { MenuItem } from "../lib/domain";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const base = { requestId: "request-1", itemId: "item:one", classification: "finger-food", displayName: "Chicken skewer" };
function hub(options: { manage?: boolean; items?: Array<{ id: string; dishId?: string }>; linkStatus?: number } = {}) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const fetchHub = (async (path: string, _cookie: string | null, init?: RequestInit) => {
    calls.push({ path, init });
    if (path.includes("mode=access")) return json({ permissions: { View: true, Manage: options.manage ?? true, Publish: false }, principal: { id: "sam" } });
    if (path.includes("mode=resources")) return json({ items: options.items ?? [{ id: "item:one" }], dishes: [] });
    return options.linkStatus && options.linkStatus >= 400 ? json({ error: { message: "Item is already linked" } }, options.linkStatus) : json({ link: {}, replayed: false });
  }) as never;
  return { calls, fetchHub };
}
const fakeDish = (id: string, outcome: "created_new" | "matched_existing" = "created_new") => ({ outcome, item: { canonicalId: id } as MenuItem });

test("creating a hospitality dish requires Rotations Manage and writes nothing without it", async () => {
  const { fetchHub, calls } = hub({ manage: false });
  let created = 0;
  await assert.rejects(createAndLinkHospitalityDish("cookie", base, { fetchHub, createDish: async () => { created++; return fakeDish("x"); } }), error => (error as { status?: number }).status === 403);
  assert.equal(created, 0);
  assert.equal(calls.some(call => call.init?.method === "POST"), false);
});

test("create and link derives a stable Item-based dish ID and records the Hub mapping", async () => {
  const { fetchHub, calls } = hub();
  const seen: string[] = [];
  const result = await createAndLinkHospitalityDish("cookie", base, { fetchHub, createDish: async input => { seen.push(input.dishId); assert.equal(input.classification, "finger-food"); return fakeDish(input.dishId); } });
  assert.equal(result.status, 201);
  assert.equal(result.dishId, hospitalityDishIdForItem("item:one"));
  assert.deepEqual(seen, [hospitalityDishIdForItem("item:one")]);
  const link = JSON.parse(String(calls.at(-1)!.init!.body));
  assert.deepEqual(link, { action: "link-dish", requestId: "request-1", itemId: "item:one", dishId: result.dishId, classification: "finger-food" });
});

test("an Item that already has a dish is reused, not duplicated", async () => {
  const { fetchHub } = hub({ items: [{ id: "item:one", dishId: "hospitality-dish:item:one" }] });
  const result = await createAndLinkHospitalityDish("cookie", base, { fetchHub, createDish: async () => { throw new Error("must not create"); } });
  assert.deepEqual(result, { status: 200, dishId: "hospitality-dish:item:one", outcome: "already_linked" });
});

test("independent rotation dish creation requires Manage and leaves catalogue links untouched", async () => {
  const input = { requestId: "standalone-1", classification: "finger-food" as const, displayName: "Chicken skewer" };
  const denied = hub({ manage: false });
  await assert.rejects(createAndLinkHospitalityDish("cookie", input, { fetchHub: denied.fetchHub, createDish: async () => { throw new Error("must not create"); } }), { status: 403 });
  const { fetchHub, calls } = hub();
  const created = new Map<string, MenuItem>();
  const createDish = (async ({ dishId, displayName, classification }) => {
    const existing = created.get(dishId);
    if (existing) return { item: existing, outcome: "matched_existing" };
    const item = { canonicalId: dishId, displayName, hospitalityClass: classification } as MenuItem;
    created.set(dishId, item);
    return { item, outcome: "created_new" };
  }) satisfies typeof import("../lib/canonical-menu-repository").createHospitalityDish;
  const first = await createAndLinkHospitalityDish("cookie", input, { fetchHub, createDish });
  const retry = await createAndLinkHospitalityDish("cookie", input, { fetchHub, createDish });
  const second = await createAndLinkHospitalityDish("cookie", { ...input, requestId: "standalone-2", displayName: "Mushroom skewer" }, { fetchHub, createDish });
  assert.equal(retry.dishId, first.dishId);
  assert.equal(retry.outcome, "matched_existing");
  assert.notEqual(second.dishId, first.dishId);
  assert.equal(created.size, 2);
  assert.ok(calls.every(call => call.path.includes("mode=access")));
  await assert.rejects(createAndLinkHospitalityDish("cookie", { ...input, displayName: "Changed recipe" }, { fetchHub, createDish }), { status: 409 });
});

test("unknown Items, bad input and Hub mapping failures are surfaced, not masked", async () => {
  await assert.rejects(createAndLinkHospitalityDish("c", { ...base, itemId: "item:missing" }, { fetchHub: hub().fetchHub, createDish: async () => fakeDish("x") }), error => (error as { status?: number }).status === 422);
  await assert.rejects(createAndLinkHospitalityDish("c", { ...base, classification: "main-course" }, { fetchHub: hub().fetchHub, createDish: async () => fakeDish("x") }), ZodError);
  await assert.rejects(createAndLinkHospitalityDish("c", base, { fetchHub: hub({ linkStatus: 409 }).fetchHub, createDish: async input => fakeDish(input.dishId) }), error => (error as { status?: number }).status === 409);
});

test("the Menu Planning proxy forwards only rotation query keys and the caller's own cookie", async () => {
  assert.equal(rotationsHubPath(new URL("http://x/api/hospitality-rotations?mode=revision&revision=3&secret=1")), "/api/hospitality-rotations?mode=revision&revision=3");
  const seen: Array<{ path: string; cookie: string | null }> = [];
  const response = await forwardRotations(new Request("http://x/api/hospitality-rotations?mode=resources", { headers: { cookie: "session=abc" } }), "GET", (async (path: string, cookie: string | null) => { seen.push({ path, cookie }); return json({ error: { message: "Hospitality catalogue package is unavailable" } }, 503); }) as never);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(seen, [{ path: "/api/hospitality-rotations?mode=resources", cookie: "session=abc" }]);
  assert.match(JSON.stringify(await response.json()), /catalogue package is unavailable/);
  await assert.rejects(readRotationAccess(null, (async () => json({ error: { message: "no session" } }, 401)) as never), error => (error as { status?: number }).status === 401);
});

test("the Hospitality Rotations workspace has its own navigation entry, separate from the Week Planner", () => {
  const shell = readFileSync(new URL("../app/menu-planning-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /href: "\/rotations", label: "Hospitality Rotations"/);
  assert.match(shell, /href: "\/", label: "Week Planner"/);
});

test("week dish order can be moved within bounds and survives re-selection", async () => {
  const { moveWithin, mergeSelectionOrder } = await import("../lib/rotations-ui-model");
  assert.deepEqual(moveWithin(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moveWithin(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveWithin(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
  assert.deepEqual(mergeSelectionOrder(["c", "a"], ["a", "b", "c"]), ["c", "a", "b"]);
  assert.deepEqual(mergeSelectionOrder(["c", "a"], ["a"]), ["a"]);
});

test("the first mapped row starts with six independent empty weeks", async () => {
  const { initialRotationConfiguration } = await import("../lib/rotations-ui-model");
  const configuration = initialRotationConfiguration({ label: "Autumn", anchorMonday: "2026-11-09", groupLabel: "Bowl Food", categoryId: "bowl-food", itemId: "item:one" });
  const row = configuration.groups[0]!;
  assert.equal(row.itemId, "item:one");
  assert.deepEqual(row.dishBank, []);
  assert.deepEqual(row.weeks.map(week => [week.week, week.dishIds.length]), [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]]);
  row.weeks[2]!.dishIds.push("dish:one");
  assert.deepEqual(row.weeks.map(week => week.dishIds), [[], [], ["dish:one"], [], [], []]);
});
