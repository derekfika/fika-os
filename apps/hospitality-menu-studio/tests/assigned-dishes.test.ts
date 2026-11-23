import assert from "node:assert/strict";
import test from "node:test";
import { studioHandlers } from "../lib/http";
import { StudioProblem } from "../lib/problem";
import type { StudioStore } from "../lib/store";

const actor = {
  id: "actor",
  name: "Actor",
  canManage: false,
  canPublish: false,
};
test("assigned dish lookup authenticates, bounds, validates and deduplicates without writes", async () => {
  const calls: string[][] = [];
  const db = {
    dishes: async (ids: string[]) => {
      calls.push(ids);
      return [{ id: ids[0] }];
    },
  } as unknown as StudioStore;
  const handler = studioHandlers(
    async () => actor,
    () => db,
    () => {},
  );
  const get = (query: string) =>
    handler.GET(new Request(`http://localhost/api/studio?${query}`));
  const response = await get("list=assigned-dishes&ids=a,b,a");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { items: [{ id: "a" }] });
  assert.deepEqual(calls, [["a", "b"]]);
  for (const query of [
    "list=assigned-dishes&ids=",
    "list=assigned-dishes&ids=a%2Fb",
    "list=assigned-dishes&ids=a&ids=b",
    `list=assigned-dishes&ids=${Array.from({ length: 25 }, (_, i) => `d${i}`).join(",")}`,
  ]) {
    assert.equal((await get(query)).status, 422);
  }
  assert.equal(calls.length, 1);
  const maxIds = Array.from({ length: 24 }, (_, i) => `d${i}`);
  assert.equal(
    (await get(`list=assigned-dishes&ids=${maxIds.join(",")}`)).status,
    200,
  );
  assert.deepEqual(calls[1], maxIds);
  const denied = studioHandlers(
    async () => {
      throw new StudioProblem(403, "DENIED", "Denied");
    },
    () => db,
    () => {},
  );
  assert.equal(
    (
      await denied.GET(
        new Request("http://localhost/api/studio?list=assigned-dishes&ids=a"),
      )
    ).status,
    403,
  );
  assert.equal(calls.length, 2);
});
