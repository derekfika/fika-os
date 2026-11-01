import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest } from "next/server";

test("unauthorised GET stops at Hub admission without reading or exposing dish metadata", async () => {
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  const previousHub = process.env.FIKA_HUB_BASE_URL;
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.FIKA_HUB_BASE_URL = "https://fika-hub-staging.example";
  globalThis.fetch = (async input => { calls.push(String(input)); return Response.json({ error: { message: "Fixture access denied" } }, { status: 403 }); }) as typeof fetch;
  try {
    const { GET } = await import("../app/api/rolling-menu/route");
    const response = await GET(new NextRequest("https://menu.example/api/rolling-menu?weekId=week:private", { headers: { cookie: "fika_os_session=denied-fixture" } }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).dishReferences, undefined);
    assert.deepEqual(calls, ["https://fika-hub-staging.example/api/menu-planning/access"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode;
    if (previousHub === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = previousHub;
  }
});

test("rolling GET resolves reference metadata only after actor and OPLOC scoping", () => {
  const source = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  const get = source.slice(source.indexOf("async function handleGet"), source.indexOf("async function handlePost"));
  assert.ok(get.indexOf("await resolveMenuActor(request)") < get.indexOf("resolveWeekDishReferences(snapshot, actor)"));
  assert.ok(get.indexOf("const snapshot = scopedSnapshot(") < get.indexOf("resolveWeekDishReferences(snapshot, actor)"));
  assert.match(get, /dishReferences: referenceResult\.dishReferences/);
  assert.match(get, /catalogueEntriesForItems\(referenceResult\.items\)/);
  assert.doesNotMatch(get, /repointDishIds|materialiseCataloguePackage|archiveCanonicalMenuItem/);
});

test("historical reference adapter performs named batched reads and has no write/rebuild path", () => {
  const source = readFileSync(new URL("../lib/dish-reference-resolver.ts", import.meta.url), "utf8").split("function defaultReaders()")[1];
  assert.match(source, /getAll\(/);
  assert.match(source, /ids\.slice\(offset \* 100, offset \* 100 \+ 100\)/);
  assert.doesNotMatch(source, /\.where\(|\.add\(|\.set\(|\.update\(|\.delete\(|runTransaction|materialiseCataloguePackage|repointDishIds/);
});
