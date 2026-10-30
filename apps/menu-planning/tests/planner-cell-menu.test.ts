import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LONG_PRESS_MOVE_PX,
  LONG_PRESS_MS,
  cellMenuActions,
  isMenuOpenKey,
  movedTooFar,
  nextMenuIndex,
  placeMenu,
  shouldIgnoreClick,
  suppressClickUntil,
} from "../lib/planner-cell-menu";

const entry = { id: "e1", itemId: "dish:a", itemLabel: "Chicken Tikka" };
const base = { entry, dishResolved: true, copyAvailable: true, copyPending: false };
const ids = (input: Parameters<typeof cellMenuActions>[0]) => cellMenuActions(input).map((action) => action.id);

test("a populated cell offers Edit, Change, Copy and a red Clear after a divider, in that order", () => {
  const actions = cellMenuActions(base);
  assert.deepEqual(actions.map((action) => action.id), ["edit", "change", "copy", "clear"]);
  assert.deepEqual(actions.map((action) => action.label), ["Edit dish", "Change dish", "Copy to another day", "Clear from planner"]);
  const clear = actions[3];
  assert.equal(clear.destructive, true);
  assert.equal(clear.dividerBefore, true);
  assert.ok(actions.slice(0, 3).every((action) => !action.destructive && !action.dividerBefore && !action.disabledReason));
});

test("an empty cell offers only Select dish and never Edit or Clear for an absent record", () => {
  assert.deepEqual(ids({ ...base, entry: undefined }), ["select"]);
  assert.deepEqual(ids({ ...base, entry: { id: "e2", itemId: "", itemLabel: "   " } }), ["select"]);
});

test("Edit fails visibly for an unresolved, historical or unlinked dish instead of editing the wrong one", () => {
  const unresolved = cellMenuActions({ ...base, dishResolved: false }).find((action) => action.id === "edit");
  assert.match(unresolved?.disabledReason || "", /not in the Dish Library any more/);
  const unlinked = cellMenuActions({ ...base, entry: { id: "e3", itemId: undefined, itemLabel: "Legacy text" }, dishResolved: false }).find((action) => action.id === "edit");
  assert.match(unlinked?.disabledReason || "", /not linked to a Dish Library dish/);
  // The other actions stay available for such a cell.
  assert.ok(cellMenuActions({ ...base, dishResolved: false }).filter((action) => action.id !== "edit").every((action) => !action.disabledReason));
});

test("Copy explains why it is unavailable, matching the existing copy button", () => {
  assert.match(cellMenuActions({ ...base, copyAvailable: false }).find((action) => action.id === "copy")?.disabledReason || "", /no day this dish can be copied to/);
  assert.match(cellMenuActions({ ...base, copyPending: true }).find((action) => action.id === "copy")?.disabledReason || "", /already in progress/);
});

test("View dish details is not offered because the Dish Library has no read-only view openable by dish ID", () => {
  assert.ok(!ids(base).includes("details" as never));
  assert.ok(!cellMenuActions(base).some((action) => /details/i.test(action.label)));
});

test("the menu opens at the pointer and flips or clamps so it is always fully inside the viewport", () => {
  const menu = { width: 220, height: 180 };
  const viewport = { width: 1000, height: 700 };
  assert.deepEqual(placeMenu({ x: 100, y: 100 }, menu, viewport), { x: 100, y: 100 });
  assert.deepEqual(placeMenu({ x: 950, y: 100 }, menu, viewport), { x: 730, y: 100 }, "flips left of the pointer at the right edge");
  assert.deepEqual(placeMenu({ x: 100, y: 650 }, menu, viewport), { x: 100, y: 470 }, "flips above the pointer at the bottom edge");
  assert.deepEqual(placeMenu({ x: 990, y: 695 }, menu, viewport), { x: 770, y: 512 }, "flips on both axes in the corner, then keeps the edge margin");
  assert.deepEqual(placeMenu({ x: 0, y: 0 }, menu, viewport), { x: 8, y: 8 }, "never touches the edge");
  const tiny = placeMenu({ x: 150, y: 150 }, menu, { width: 200, height: 160 });
  assert.ok(tiny.x >= 8 && tiny.y >= 8, "stays on screen even if the viewport is smaller than the menu");
});

test("arrow keys move through the menu, wrap, and Home/End jump", () => {
  assert.equal(nextMenuIndex(0, "ArrowDown", 4), 1);
  assert.equal(nextMenuIndex(3, "ArrowDown", 4), 0);
  assert.equal(nextMenuIndex(0, "ArrowUp", 4), 3);
  assert.equal(nextMenuIndex(2, "Home", 4), 0);
  assert.equal(nextMenuIndex(1, "End", 4), 3);
  assert.equal(nextMenuIndex(-1, "ArrowDown", 4), 0);
  assert.equal(nextMenuIndex(-1, "ArrowUp", 4), 3);
  assert.equal(nextMenuIndex(1, "a", 4), 1);
  assert.equal(nextMenuIndex(0, "ArrowDown", 0), -1);
});

test("Shift+F10 and the Menu key open the menu; plain F10 and other keys do not", () => {
  assert.equal(isMenuOpenKey({ key: "F10", shiftKey: true }), true);
  assert.equal(isMenuOpenKey({ key: "ContextMenu" }), true);
  assert.equal(isMenuOpenKey({ key: "F10" }), false);
  assert.equal(isMenuOpenKey({ key: "Enter", shiftKey: true }), false);
});

test("a long press is cancelled once the finger moves enough to be a scroll or drag", () => {
  assert.equal(LONG_PRESS_MS >= 400 && LONG_PRESS_MS <= 800, true);
  assert.equal(movedTooFar({ x: 10, y: 10 }, { x: 10 + LONG_PRESS_MOVE_PX, y: 10 }), false);
  assert.equal(movedTooFar({ x: 10, y: 10 }, { x: 10 + LONG_PRESS_MOVE_PX + 1, y: 10 }), true);
  assert.equal(movedTooFar({ x: 0, y: 0 }, { x: 8, y: 8 }), true);
});

test("the click that follows opening the menu is ignored briefly so the picker never opens behind it", () => {
  const until = suppressClickUntil(1000);
  assert.equal(shouldIgnoreClick(1100, until), true);
  assert.equal(shouldIgnoreClick(until, until), false);
  assert.equal(shouldIgnoreClick(5000, until), false);
});

const planner = readFileSync(new URL("../app/week-planner.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/planner-cell-menu.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/planner-cell-menu.css", import.meta.url), "utf8");

test("right-click is prevented only on populated planner cells, so the browser menu stays elsewhere", () => {
  assert.match(planner, /onContextMenu=\{entry \? event => \{ event\.preventDefault\(\);/);
  assert.equal((planner.match(/onContextMenu=/g) || []).length, 1, "one scoped handler, never page-wide");
  assert.doesNotMatch(planner, /addEventListener\("contextmenu"/);
  assert.doesNotMatch(menu, /document\.addEventListener\("contextmenu"/);
});

test("single click still opens the picker and double-click edit is not added", () => {
  assert.match(planner, /if \(shouldIgnoreClick\(Date\.now\(\), ignoreClickUntilRef\.current\)\) return; setQuery\(""\)/);
  assert.doesNotMatch(planner, /onDoubleClick/);
});

test("the menu is keyboard operable ARIA, closes without acting, and acts only on an explicit activation", () => {
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /role="separator"/);
  assert.match(menu, /aria-disabled=/);
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /pointerdown", closeOutside/);
  assert.match(menu, /focus\(\{ preventScroll: true \}\)/);
  assert.match(menu, /onClick=\{\(\) => run\(action\)\}/);
  assert.doesNotMatch(menu, /onMouseUp|onPointerUp/, "never fires an action on release");
  assert.match(planner, /closeCellMenu\(\);\s*\/\/ Act on the next tick/);
  assert.match(planner, /if \(id === "clear"\) void clearEntry\(entry\)/);
});

test("keyboard, touch and a visible fallback exist, so the menu never depends on right-click alone", () => {
  assert.match(planner, /isMenuOpenKey\(event\)/);
  assert.match(planner, /event\.pointerType !== "touch"/);
  assert.match(planner, /LONG_PRESS_MS/);
  assert.match(planner, /className="week-menu-copy-action week-menu-more"/, "the fallback reuses the existing compact cell-action style");
  assert.match(planner, /aria-label=\{`More actions for \$\{entry\.itemLabel\}`\}/);
  assert.match(css, /min-height: 44px/);
});

test("actions reuse the existing planner operations with the cell's own day, slot and canonical ID", () => {
  assert.match(planner, /entry = snapshot\.entries\.find\(item => item\.dayId === target\.dayId && item\.slot === target\.slot\)/);
  assert.match(planner, /dishes\.find\(item => item\.id === entry\.itemId\)/);
  assert.match(planner, /setCopyDialogSourceId\(entry\.id\)/);
  assert.match(planner, /const clearEntry = \(entry: \{ id: string \}\) => command\("update-entry"/);
  assert.match(planner, /onClick=\{\(\) => void clearEntry\(entry\)\}/);
});

test("the repeated Edit buttons are gone from the picker rows and the edit modal opens from a cell without the picker", () => {
  assert.doesNotMatch(planner, /dish-picker-edit/);
  assert.doesNotMatch(planner, /onEdit=\{openEditDish\}/);
  assert.match(planner, /\{!picker && editor && <DishEditorModal/);
  assert.match(planner, /\{picker && editor && <DishEditorModal/);
});

test("menu styling is the floating menu only and uses existing tokens", () => {
  assert.match(css, /\.planner-cell-menu \{/);
  assert.match(css, /box-shadow/);
  assert.match(css, /planner-cell-menu__item--danger/);
  assert.doesNotMatch(css, /\.week-matrix|\.week-menu-cell \{|\.week-menu-cell-button \{[^}]*(background|color|font)/, "no redesign of the planner grid or cards");
});
