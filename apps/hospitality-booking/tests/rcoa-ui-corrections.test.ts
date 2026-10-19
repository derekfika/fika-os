import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { addAllDayService, createEmptyAllDay, removeAllDayServiceItem, updateAllDayService } from "../lib/rcoa-all-day";
import { integerFieldText } from "../lib/rcoa-portal";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const portal = read("../app/ui/RcoaBookingPortal.tsx");

// ---- 1. remove an item from a service
test("removing an item takes only that line out of that service, immediately; other items, services and quantities are untouched", () => {
  let day = addAllDayService(createEmptyAllDay(), "s2");
  day = updateAllDayService(day, day.services[0].id, { lines: [{ itemId: "a", quantity: 4, choices: {} }, { itemId: "b", quantity: 7, choices: {} }] });
  day = updateAllDayService(day, "s2", { lines: [{ itemId: "a", quantity: 9, choices: {} }] });
  const before = structuredClone(day);
  const after = removeAllDayServiceItem(day, day.services[0].id, "a");
  assert.deepEqual(after.services[0].lines, [{ itemId: "b", quantity: 7, choices: {} }]);
  assert.deepEqual(after.services[1].lines, [{ itemId: "a", quantity: 9, choices: {} }], "the same item in another service stays");
  assert.deepEqual(day, before, "the original draft is not mutated");
  assert.equal(removeAllDayServiceItem(after, after.services[0].id, "missing").services[0].lines.length, 1, "removing an unknown item is a no-op");
});

test("the services page shows an accessible x beside each selected item that removes it through the shared state (basket and totals derive from it)", () => {
  assert.match(portal, /aria-label=\{`Remove \$\{item\.name\} from service \$\{index \+ 1\}`\}/);
  assert.match(portal, /onClick=\{\(\) => removeServiceItem\(service\.id, item\.id\)\}/);
  assert.match(portal, /<span aria-hidden="true">×<\/span>/);
  assert.match(portal, /setAllDay\(\(current\) => removeAllDayServiceItem\(current, serviceId, itemId\)\)/);
  const css = read("../app/ui/RcoaBookingPortal.module.css");
  assert.match(css, /\.itemRemove \{[^}]*width: 32px;[^}]*height: 32px;/);
  assert.match(css, /\.itemRemove:focus-visible \{[^}]*outline: 3px solid/);
});

// ---- 2. dietary numeric inputs
test("dietary counts never show leading zeroes and can be cleared while editing", () => {
  assert.equal(integerFieldText("01"), "1");
  assert.equal(integerFieldText("007"), "7");
  assert.equal(integerFieldText("0"), "0");
  assert.equal(integerFieldText("00"), "0");
  assert.equal(integerFieldText(""), "", "a cleared field stays empty while editing");
  assert.equal(integerFieldText("1a2"), "12");
  assert.equal(integerFieldText("-3"), "3", "no negative counts");
  assert.equal(Number(integerFieldText("") || 0), 0, "an empty field stores 0, so the existing dietary validation is unchanged");
  assert.match(portal, /value=\{dietaryText\[key\] \?\? String\(draft\.dietaries\[key\]\)\}/);
  assert.match(portal, /updateDietary\(key, Number\(text \|\| 0\)\)/);
  assert.match(portal, /onBlur=\{\(\) => setDietaryText/);
});

// ---- 3. acknowledgement warning timing
test("the send button is a distinct element and a submit only counts when the person pressed it, so arriving on the review step shows no warning", () => {
  assert.match(portal, /<button key="continue" type="button"/);
  assert.match(portal, /<button key="send" type="submit" onClick=\{\(\) => \{ submitIntentRef\.current = true; \}\}/);
  assert.match(portal, /if \(!submitIntentRef\.current\) return;\s*\r?\n\s*submitIntentRef\.current = false;/);
});

test("the acknowledgement warning is set only by a failed send, and clears as soon as the requirement is satisfied; final validation is unchanged", () => {
  // Errors only come from the submit handlers (single and all-day), never from rendering or from moving to the review step.
  assert.equal((portal.match(/validateRcoaStep\(5/g) || []).length, 1);
  assert.match(portal, /if \(checked\) \{ setErrors\(\(current\) => \{ const next = \{ \.\.\.current \}; delete next\[fieldKey\]/);
  assert.match(portal, /\.every\(Boolean\)\) setMessage\(\(current\) => \/acknowledgement\/i\.test\(current\) \? "" : current\)/);
  const rules = read("../lib/rcoa-portal.ts");
  assert.match(rules, /if \(!accepted\) errors\[`acknowledgement:\$\{key\}`\] = "Confirm this acknowledgement before sending\."/);
});

// ---- 4. shared spinner
function topLevelKeyframes(css: string) {
  let depth = 0; const found: Array<{ name: string; depth: number }> = [];
  for (let index = 0; index < css.length; index += 1) {
    const rest = css.slice(index, index + 11);
    if (rest === "@keyframes ") found.push({ name: css.slice(index + 11, css.indexOf("{", index)).trim(), depth });
    if (css[index] === "{") depth += 1; else if (css[index] === "}") depth -= 1;
  }
  return found;
}
function cssFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => { const full = path.join(directory, name); return name === "node_modules" || name === ".next" ? [] : statSync(full).isDirectory() ? cssFiles(full) : full.endsWith(".css") ? [full] : []; });
}

test("the shared spinner rotates: its keyframes are top-level (not nested inside a rule, where browsers ignore them) and the animation references them", () => {
  const globals = read("../app/globals.css");
  const keyframes = topLevelKeyframes(globals);
  assert.deepEqual(keyframes.filter((frame) => frame.name === "fika-spin").map((frame) => frame.depth), [0]);
  assert.match(globals, /\.fika-spinner\{[^}]*animation:fika-spin \.7s linear infinite/);
});

test("no stylesheet in the app nests @keyframes inside another rule (root cause of the frozen spinners: the keyframes sat inside .scope)", () => {
  const nested = cssFiles(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "app")).flatMap((file) => topLevelKeyframes(readFileSync(file, "utf8")).filter((frame) => frame.depth > 0).map((frame) => `${path.basename(file)}:${frame.name}`));
  assert.deepEqual(nested, []);
});

test("reduced-motion users get a gentle pulse instead of rotation, and every spinner uses the one shared class", () => {
  const globals = read("../app/globals.css");
  assert.match(globals, /@media \(prefers-reduced-motion:reduce\)\{\.fika-spinner\{animation:fika-spin-pulse 1\.6s ease-in-out infinite/);
  const dashboard = read("../app/ui/HospitalityDashboard.tsx");
  assert.doesNotMatch(dashboard, /styles\.spinner/);
  assert.equal((dashboard.match(/className="fika-spinner"/g) || []).length, 8);
  assert.match(portal, /className="fika-spinner"/);
  assert.match(read("../app/ui/BookingPortal.tsx"), /className="fika-spinner"/);
  assert.doesNotMatch(read("../app/ui/HospitalityDashboard.module.css"), /\.spinner|hospitality-spin/);
});

test("the busy state that shows a spinner is always cleared (finally) when the action succeeds or fails", () => {
  assert.match(portal, /\} finally \{\s*\r?\n\s*sendingRef\.current = false;\s*\r?\n\s*setSending\(false\);/);
});
