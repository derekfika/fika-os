/**
 * Keyboard reveal for the Portion Planner matrix. The TOTAL column is sticky to the right edge, so a focused destination input can sit
 * underneath it even when the browser considers it in view. This keeps the input clear of the sticky first and last columns.
 */
export type Span = { left: number; right: number };

/** Horizontal scroll change (px) that brings `cell` fully inside `visible`. Returns 0 when it is already visible. */
export function horizontalScrollDelta(cell: Span, visible: Span): number {
  if (cell.left < visible.left) return cell.left - visible.left;
  if (cell.right > visible.right) return cell.right - visible.right;
  return 0;
}

/** Width a sticky header cell covers. A static cell (phone layout) covers nothing, so only sticky cells are subtracted. */
function stickyWidth(cell: Element | null) {
  if (!cell) return 0;
  return getComputedStyle(cell).position === "sticky" ? cell.getBoundingClientRect().width : 0;
}

export function revealPortionInput(target: HTMLElement) {
  const wrap = target.closest<HTMLElement>(".table-wrap");
  const cell = target.closest<HTMLElement>("td, th");
  const table = wrap?.querySelector("table");
  if (!wrap || !cell || !table) return;
  const wrapRect = wrap.getBoundingClientRect();
  const firstWidth = stickyWidth(table.querySelector("thead th:first-child"));
  const lastWidth = stickyWidth(table.querySelector("thead th:last-child"));
  const cellRect = cell.getBoundingClientRect();
  const delta = horizontalScrollDelta({ left: cellRect.left, right: cellRect.right }, { left: wrapRect.left + firstWidth, right: wrapRect.right - lastWidth });
  if (delta) wrap.scrollLeft += delta;
}
