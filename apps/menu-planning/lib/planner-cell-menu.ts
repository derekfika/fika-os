/**
 * Pure rules for the Week Planner cell context menu (#186): which actions a cell offers, where the
 * menu sits inside the viewport, how arrow keys move through it, and when a pointer gesture counts as
 * a deliberate long press. No React and no writes; the planner owns what each action does.
 */

export type CellMenuActionId = "edit" | "change" | "copy" | "clear" | "select";

export type CellMenuAction = {
  id: CellMenuActionId;
  label: string;
  /** Present when the action is shown but cannot run; it is announced, never silently dropped. */
  disabledReason?: string;
  destructive?: boolean;
  /** A divider is drawn above this action. */
  dividerBefore?: boolean;
};

export type CellMenuInput = {
  /** The planner entry in the cell, if any. */
  entry?: { id: string; itemId?: string; itemLabel: string };
  /** Whether the entry's dish ID resolves to an active canonical Dish Library record. */
  dishResolved: boolean;
  /** Where Copy to another day can currently go. */
  copyAvailable: boolean;
  /** Specific current-rule explanation when no compatible destination is available. */
  copyDisabledReason?: string;
  copyPending: boolean;
};

/**
 * A populated cell offers Edit, Change, Copy and (after a divider, in red) Clear. An empty cell offers
 * only Select; edit and clear are never shown for an absent record. View dish details is intentionally
 * not offered: the Dish Library has no read-only detail view that can be opened by dish ID.
 */
export function cellMenuActions(input: CellMenuInput): CellMenuAction[] {
  if (!input.entry || !input.entry.itemLabel.trim()) return [{ id: "select", label: "Select dish" }];
  const actions: CellMenuAction[] = [];
  const canEdit = Boolean(input.entry.itemId) && input.dishResolved;
  actions.push({
    id: "edit",
    label: "Edit dish",
    ...(canEdit ? {} : { disabledReason: input.entry.itemId ? "This dish is not in the Dish Library any more, so it cannot be edited." : "This entry is not linked to a Dish Library dish, so it cannot be edited." }),
  });
  actions.push({ id: "change", label: "Change dish" });
  actions.push({
    id: "copy",
    label: "Copy to another day",
    ...(input.copyPending ? { disabledReason: "A copy is already in progress." } : !input.copyAvailable ? { disabledReason: input.copyDisabledReason || "There is no empty compatible menu cell on an editable weekday." } : {}),
  });
  actions.push({ id: "clear", label: "Clear from planner", destructive: true, dividerBefore: true });
  return actions;
}

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/**
 * Keep the menu fully inside the viewport. It opens at the pointer; when it would run off the right
 * or bottom edge it flips to the other side of the pointer, then is clamped with a margin so it never
 * hides under an edge, even on a tiny viewport.
 */
export function placeMenu(point: Point, menu: Size, viewport: Size, margin = 8): Point {
  let x = point.x;
  let y = point.y;
  if (x + menu.width + margin > viewport.width) x = point.x - menu.width;
  if (y + menu.height + margin > viewport.height) y = point.y - menu.height;
  x = Math.min(Math.max(margin, x), Math.max(margin, viewport.width - menu.width - margin));
  y = Math.min(Math.max(margin, y), Math.max(margin, viewport.height - menu.height - margin));
  return { x, y };
}

/** Arrow-key movement through the menu's enabled-or-disabled items, wrapping at the ends. */
export function nextMenuIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  return current;
}

/** Keys that open the menu from a focused cell: Shift+F10 and the dedicated Menu key. */
export function isMenuOpenKey(event: { key: string; shiftKey?: boolean }) {
  return event.key === "ContextMenu" || (event.key === "F10" && Boolean(event.shiftKey));
}

export const LONG_PRESS_MS = 550;
export const LONG_PRESS_MOVE_PX = 10;

/** A long press is cancelled once the finger travels far enough that it is a scroll or drag, not a press. */
export function movedTooFar(start: Point, now: Point, threshold = LONG_PRESS_MOVE_PX) {
  return Math.hypot(now.x - start.x, now.y - start.y) > threshold;
}

/**
 * After the menu opens from a long press or right-click, the click that follows must not also open the
 * picker. Returns the time until which a click on the cell should be ignored.
 */
export function suppressClickUntil(now: number, windowMs = 700) {
  return now + windowMs;
}

export const shouldIgnoreClick = (now: number, until: number) => now < until;
