import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name: string) => readFile(new URL(`../app/${name}`, import.meta.url), "utf8");

test("targeted Menu Planning dialogs use the shared modal contract", async () => {
  const [week, rolling, primitive] = await Promise.all([read("week-planner.tsx"), read("rolling-menu-workspace.tsx"), read("planner-modal.tsx")]);
  assert.match(week, /PlannerModal/);
  assert.match(rolling, /PlannerModal/);
  assert.match(primitive, /role="dialog"/);
  assert.match(primitive, /aria-modal="true"/);
  assert.match(primitive, /onCloseRef\.current\(\)/);
  assert.match(primitive, /event\.key !== "Tab"/);
  assert.match(week + rolling, /dismissible=\{false\}/);
  assert.match(week, /button-danger.*Copy and replace week/);
});

test("targeted production files contain no native browser dialogs", async () => {
  const source = `${await read("week-planner.tsx")}\n${await read("rolling-menu-workspace.tsx")}`;
  assert.doesNotMatch(source, /window\.(alert|confirm|prompt)\s*\(/);
});
