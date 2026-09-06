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
  assert.match(page, /Accept \{visible\.filter/);
  assert.match(page, /Ignore \{visible\.filter/);
  assert.match(page, /Undo last bulk action/);
  assert.match(page, /bulk-confirm-title/);
  assert.match(page, /Choose another/);
  assert.match(page, /still need a decision/);
  assert.match(page, /Show unresolved dishes/);
  assert.match(page, /Needs review/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /Importing week/);
  assert.match(page, /View Week Planner/);
  assert.match(page, /loadImportSession/);
  assert.match(page, /Discard saved import/);
  assert.match(page, /clearImportSession/);
});

test("batch import uses one preview and commit endpoint without catalogue creation", async () => {
  const route = await readFile(new URL("../app/api/rolling-menu/import/route.ts", import.meta.url), "utf8");
  assert.match(route, /form\.getAll\("files"\)/);
  assert.match(route, /snapshots/);
  assert.match(route, /duplicateWeeks/);
  assert.match(route, /recordDishSourceAliases/);
  assert.doesNotMatch(route, /createCanonicalMenuItem/);
  assert.match(route, /saveSnapshotsCreateOnly\(prepared\)/);
  assert.match(route, /already exist/);
});

test("historic import is create-only at the authoritative batch write", async () => {
  const source = await readFile(new URL("../lib/rolling-menu.ts", import.meta.url), "utf8");
  assert.match(source, /saveSnapshotsCreateOnly/);
  assert.match(source, /planningWeekImportConflictReason/);
  assert.match(source, /status: 409/);
});

test("import gating ignores orphan week heads but blocks complete planning snapshots", async () => {
  const source = await readFile(new URL("../lib/rolling-menu.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/rolling-menu/import/route.ts", import.meta.url), "utf8");
  assert.match(source, /isCompletePlanningWeek/);
  assert.match(source, /week\.dayIds\.includes\(day\.id\)/);
  assert.match(route, /getWeekSnapshot/);
  assert.match(route, /candidate\.snapshot && planningWeekImportConflictReason/);
});

test("import review offers explicit governed dish creation with provenance", async () => {
  const page = await readFile(new URL("../app/import-menu-week/page.tsx", import.meta.url), "utf8");
  const catalogueRoute = await readFile(new URL("../app/api/catalogue/route.ts", import.meta.url), "utf8");
  assert.match(page, /Create new dish/);
  assert.match(page, /sourceReference/);
  assert.match(page, /created and matched/i);
  assert.match(catalogueRoute, /createCanonicalMenuItem/);
});

test("create-dish importer modal uses a labelled standard form modal", async () => {
  const page = await readFile(new URL("../app/import-menu-week/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/import-menu-week.css", import.meta.url), "utf8");
  assert.match(page, /className="import-form-modal"/);
  assert.match(page, /htmlFor="create-dish-name"/);
  assert.match(page, /id="create-dish-name"/);
  assert.match(page, /htmlFor="create-dish-category"/);
  assert.match(page, /id="create-dish-category"/);
  assert.match(page, /data-modal-autofocus/);
  assert.match(page, /dismissible=\{!saving\}/);
  assert.match(styles, /width: min\(560px/);
  assert.match(styles, /\.import-form-fields \{ display: grid; gap: 16px; \}/);
});
