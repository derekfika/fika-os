import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../app/ui/HospitalityDashboard.tsx");
const dashboardCss = read("../app/ui/HospitalityDashboard.module.css");
const globals = read("../app/globals.css");
const rcoa = read("../app/ui/RcoaBookingPortal.tsx");
const portal = read("../app/ui/BookingPortal.tsx");

test("the visible menu cards show a spinner, accurate text and aria-busy while a menu generates", () => {
  const visible = dashboard.slice(dashboard.indexOf("{menuOutput ? ("), dashboard.indexOf('className="menu-output-actions manager-legacy-output"'));
  assert.equal((visible.match(/Generating menu…/g) || []).length, 2, "both the Generate and Regenerate cards");
  assert.equal((visible.match(/aria-busy=\{menuBusy \? true : undefined\}/g) || []).length, 2);
  assert.match(visible, /This can take a few seconds\. Please keep this page open\./);
  assert.doesNotMatch(visible, /\d+\s*%/, "no invented progress");
});

test("the allergen-matrix generating card has a spinner", () => {
  assert.match(dashboard, /<span className=\{styles\.spinner\} aria-hidden="true" \/>\s*Generating allergen matrix…/);
});

test("portal submit buttons show a spinner and aria-busy while sending", () => {
  assert.match(rcoa, /aria-busy=\{sending \? true : undefined\}>\{sending \? <><span className="fika-spinner" aria-hidden="true" \/>Sending request…<\/>/);
  assert.match(portal, /aria-busy=\{sending \? true : undefined\}>\{sending \? <><span className="fika-spinner" aria-hidden="true" \/>Sending…<\/>/);
});

test("both spinners are hidden under reduced motion, leaving the status text", () => {
  assert.match(dashboardCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.spinner \{ display: none !important; animation: none !important; \}/);
  assert.match(globals, /@media \(prefers-reduced-motion:reduce\)\{\.fika-spinner\{display:none!important;animation:none!important\}\}/);
});
