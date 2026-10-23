import { expect, type Page } from "@playwright/test";

export type Issues = { console: string[]; network: string[] };

/** Layout audit run inside the page: returns human-readable violations. */
export async function auditLayout(page: Page, scope = ".real-planner", extraScrollers: string[] = []) {
  return page.evaluate(([scopeSelector, extra]) => {
    const violations: string[] = [];
    const root = document.querySelector<HTMLElement>(scopeSelector);
    if (!root) return ["scope missing: " + scopeSelector];
    const describe = (element: Element) => {
      const label = element.getAttribute("aria-label") || (element as HTMLElement).innerText?.trim().slice(0, 36) || "";
      return `${element.tagName.toLowerCase()}${(element as HTMLElement).className && typeof (element as HTMLElement).className === "string" ? "." + (element as HTMLElement).className.split(" ")[0] : ""}${label ? `[${label}]` : ""}`;
    };
    // Regions that are SUPPOSED to scroll. Any other scrolling box is a defect.
    const allowedScrollers = [".mock-queue-list", "[data-testid=mounted-timeline-viewport]", ".mock-inspector", ".route-sheet-body", ".run-create-popover", ...(extra as string[])];
    const isAllowed = (element: Element) => allowedScrollers.some((selector) => element.matches(selector)) || element === document.documentElement || element === document.body;
    const scrolls = (element: HTMLElement, axis: "x" | "y") => {
      const cs = getComputedStyle(element);
      const overflow = axis === "x" ? cs.overflowX : cs.overflowY;
      if (overflow !== "auto" && overflow !== "scroll") return false;
      return axis === "x" ? element.scrollWidth > element.clientWidth + 1 : element.scrollHeight > element.clientHeight + 1;
    };
    // checkVisibility also treats content under a closed <details> (content-visibility:
    // hidden, which still has layout boxes) as not rendered.
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.checkVisibility({ visibilityProperty: true });
    };
    // 1. Competing / unexpected scroll regions.
    for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
      if (!visible(element) || isAllowed(element)) continue;
      if (scrolls(element, "x") || scrolls(element, "y")) violations.push(`unexpected scroll region: ${describe(element)}`);
    }
    // 2. Interactive controls need usable, unclipped bounds.
    const controls = root.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=slider], [role=tab]");
    for (const control of controls) {
      if (!visible(control) || control.closest("[aria-hidden=true]") || control.closest(".srOnly")) continue;
      const rect = control.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 12) { violations.push(`control too small (${Math.round(rect.width)}x${Math.round(rect.height)}): ${describe(control)}`); continue; }
      // Walk the clipping ancestors, narrowing the control's *visible* rectangle at each
      // step. A scroll region legitimately hides content (reachable by scrolling), but
      // content clipped by a non-scrolling box, or by a scroller that is not an approved
      // scroll region, is a defect.
      let seen = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      let reachableByScrolling = false;
      for (let ancestor = control.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        const cs = getComputedStyle(ancestor);
        if (cs.position === "fixed") break;
        const clipX = cs.overflowX !== "visible", clipY = cs.overflowY !== "visible";
        if (!clipX && !clipY) continue;
        const box = ancestor.getBoundingClientRect();
        const scrollX = isAllowed(ancestor) && scrolls(ancestor, "x"), scrollY = isAllowed(ancestor) && scrolls(ancestor, "y");
        if (clipX && !scrollX && (seen.left < box.left - 1 || seen.right > box.right + 1)) { violations.push(`clipped horizontally by ${describe(ancestor)}: ${describe(control)}`); break; }
        if (clipY && !scrollY && (seen.top < box.top - 1 || seen.bottom > box.bottom + 1)) { violations.push(`clipped vertically by ${describe(ancestor)}: ${describe(control)}`); break; }
        if (scrollX || scrollY) reachableByScrolling = true;
        seen = { left: clipX ? Math.max(seen.left, box.left) : seen.left, right: clipX ? Math.min(seen.right, box.right) : seen.right, top: clipY ? Math.max(seen.top, box.top) : seen.top, bottom: clipY ? Math.min(seen.bottom, box.bottom) : seen.bottom };
        if (seen.right <= seen.left || seen.bottom <= seen.top) break; // fully scrolled away: reachable by scrolling only
      }
      void reachableByScrolling;
      // Controls (not free text) must not overflow their own box.
      if (control.matches("button, select") && !control.closest("[data-testid=mounted-react-timeline] [data-lane]") && control.scrollHeight > control.clientHeight + 2 && getComputedStyle(control).overflowY !== "visible") violations.push(`control content clipped: ${describe(control)}`);
    }
    // 3. Fixed layers (dialogs, inspector) stay within the viewport.
    for (const fixed of root.querySelectorAll<HTMLElement>("[role=dialog], .mock-inspector")) {
      if (!visible(fixed)) continue;
      const rect = fixed.getBoundingClientRect();
      if (rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) violations.push(`outside viewport: ${describe(fixed)} ${JSON.stringify([rect.left, rect.top, rect.right, rect.bottom].map(Math.round))}`);
    }
    // 4. Page must not scroll horizontally.
    if (document.documentElement.scrollWidth > window.innerWidth + 1) violations.push(`document horizontal overflow ${document.documentElement.scrollWidth}>${window.innerWidth}`);
    return violations;
  }, [scope, extraScrollers] as [string, string[]]);
}

export async function rect(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
}

export const intersects = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;

export function trackIssues(page: Page): Issues {
  const issues: Issues = { console: [], network: [] };
  page.on("console", (message) => { if (message.type() === "error") issues.console.push(message.text()); });
  page.on("pageerror", (error) => issues.console.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => { if (!request.url().includes("/_next/webpack-hmr") && !request.failure()?.errorText.includes("ERR_ABORTED")) issues.network.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`); });
  page.on("response", (response) => { if (response.status() >= 400 && !response.url().includes("favicon")) issues.network.push(`${response.status()} ${response.url()}`); });
  return issues;
}

export function expectClean(issues: Issues, context: string) {
  expect(issues.console, `console errors (${context})`).toEqual([]);
  expect(issues.network, `network failures (${context})`).toEqual([]);
}

