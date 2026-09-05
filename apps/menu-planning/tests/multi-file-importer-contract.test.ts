import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("multi-file importer exposes native picker and drag/drop safety", async () => {
  const page = await readFile(new URL("../app/import-menu-week/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Choose Excel files/);
  assert.match(page, /multiple/);
  assert.match(page, /onDragEnter/);
  assert.match(page, /onDragOver/);
  assert.match(page, /onDragLeave/);
  assert.match(page, /onDrop/);
  assert.match(page, /Add more files/);
  assert.match(page, /Import \$\{snapshots\.length\} menu weeks/);
  assert.match(page, /Accept all suggested matches/);
  assert.match(page, /Ignore all shown/);
  assert.match(page, /Undo bulk action/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /Choose another/);
});

test("batch import uses one preview and commit endpoint without catalogue creation", async () => {
  const route = await readFile(new URL("../app/api/rolling-menu/import/route.ts", import.meta.url), "utf8");
  assert.match(route, /form\.getAll\("files"\)/);
  assert.match(route, /snapshots/);
  assert.match(route, /duplicateWeeks/);
  assert.match(route, /recordDishSourceAliases/);
  assert.doesNotMatch(route, /createCanonicalMenuItem/);
  assert.match(route, /saveSnapshot\(snapshot\)/);
});
