import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Menu Designer exposes reusable layout editing and lifecycle actions", () => {
  const page = read("../app/menu-designer/page.tsx");
  const editor = read("../app/menu-structure-editor.tsx");
  assert.match(page, /Menu title/);
  assert.match(page, /Save Layout/);
  assert.match(page, /Saved Layouts/);
  assert.doesNotMatch(page, /Menu Library/);
  assert.match(page, /Duplicate/);
  assert.match(page, /Archive/);
  assert.match(page, /beforeunload/);
  assert.match(page, /Discard and continue/);
  assert.match(page, /dates, dishes, portions, PAX, site allocations and publication details stay with each menu instance/i);
  assert.match(editor, /enableDragAndDrop/);
  assert.match(editor, /Move \$\{category\.name \|\| "category"\} up/);
  assert.match(editor, /Move \$\{row\.name \|\| "row"\} down/);
});

test("supplementary menu creation selects a saved layout and keeps service setup separate", () => {
  const planner = read("../app/week-planner.tsx");
  const createDialog = planner.slice(planner.indexOf("function AddSupplementaryMenuDialog"), planner.indexOf("function ResetWeekDialog"));
  const shell = read("../app/menu-planning-shell.tsx");
  assert.match(shell, /Menu Designer/);
  assert.match(createDialog, /Menu layout/);
  assert.match(createDialog, /Menu Designer/);
  assert.match(createDialog, /target="_blank" rel="noreferrer"/);
  assert.match(createDialog, /Allocated sites/);
  assert.match(createDialog, /Service or delivery time/);
  assert.match(createDialog, /Repeat weekly/);
  assert.doesNotMatch(createDialog, /MenuStructureEditor|Save structure changes|Save Layout/);
});

test("Menu Designer opts into the shared FIKA controls without changing other Menu Planning screens", () => {
  const page = read("../app/menu-designer/page.tsx");
  const layout = read("../app/layout.tsx");
  const styles = read("../app/menu-structure-library.css");
  assert.match(layout, /shared\/fika\/component-atlas\.css/);
  assert.match(page, /className="fika-ui menu-designer-ui"/);
  assert.match(styles, /\.menu-designer-ui \.menu-structure-row/);
  assert.match(styles, /var\(--fika-font-body\)/);
  assert.match(styles, /@media \(max-width: 1100px\)/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});
