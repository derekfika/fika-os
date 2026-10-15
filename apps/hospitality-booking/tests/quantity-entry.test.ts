import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { quantityFromInput, quantityMinimumMessage, stepQuantityDown, stepQuantityUp } from "../lib/quantity-entry";
import { createEmptyRcoaDraft, validateRcoaStep } from "../lib/rcoa-portal";
import type { PortalMenuItem } from "../lib/mnk-contract";

/** What a controlled number input does: every keystroke's resulting text goes through quantityFromInput and is stored as typed. */
const typeInto = (keystrokes: string[]) => keystrokes.reduce((_, text) => quantityFromInput(text), 0);

test("1. minimum 8: typing 10 stays 10, never 80", () => {
  assert.deepEqual(["1", "10"].map(quantityFromInput), [1, 10]);
  assert.equal(typeInto(["1", "10"]), 10);
});

test("2. minimum 8: typing 100 stays 100", () => assert.equal(typeInto(["1", "10", "100"]), 100));

test("3. minimum 8: 5 is allowed while editing (not silently raised to 8)", () => assert.equal(typeInto(["5"]), 5));

test("4. blur on 5 reports 'Minimum order is 8'", () => assert.equal(quantityMinimumMessage(5, 8), "Minimum order is 8"));

test("6. changing 5 to 10 clears the message", () => {
  assert.equal(quantityMinimumMessage(5, 8), "Minimum order is 8");
  assert.equal(quantityMinimumMessage(10, 8), "");
  assert.equal(quantityMinimumMessage(8, 8), "");
});

test("7. plus and minus still work", () => {
  assert.equal(stepQuantityUp(8, 8), 9);
  assert.equal(stepQuantityUp(0, 8), 8, "plus from nothing starts at the minimum");
  assert.equal(stepQuantityDown(9, 8, true), 8);
  assert.equal(stepQuantityDown(9, 8, false), 8);
  assert.equal(stepQuantityUp(3, 1), 4);
});

test("8. minus cannot leave a selected item below its minimum", () => {
  assert.equal(stepQuantityDown(8, 8, false), 8, "RCoA holds at the minimum");
  assert.equal(stepQuantityDown(8, 8, true), 0, "shared portal removes the item instead of going to 7");
  assert.equal(stepQuantityDown(5, 8, false), 8);
  assert.equal(stepQuantityDown(5, 8, true), 0);
  assert.equal(stepQuantityDown(0, 8, true), 0);
});

test("9. empty and partial editing states are never clamped to the minimum mid-keystroke", () => {
  assert.equal(quantityFromInput(""), 0);
  assert.equal(quantityFromInput("  "), 0);
  assert.equal(quantityFromInput("abc"), 0);
  assert.equal(quantityFromInput("-4"), 0);
  assert.equal(quantityFromInput("1"), 1);
  assert.equal(quantityFromInput("10"), 10);
  assert.equal(quantityFromInput("12.7"), 12);
  assert.equal(quantityMinimumMessage(0, 8), "", "an empty field is not a minimum error (the line is simply not selected)");
});

const item = { canonicalId: "c-1", id: "tea-8", name: "Test Item", description: "", category: "Breakfast", unitPrice: 2, minimumQuantity: 8 } as unknown as PortalMenuItem;

test("5. a below-minimum quantity blocks continuing; the corrected value clears it", () => {
  const draft = createEmptyRcoaDraft();
  draft.occasion = "breakfast";
  draft.event = { ...draft.event, eventDate: "2026-12-10", guestCount: 20, startTime: "09:00" };
  draft.lines = [{ itemId: item.id, quantity: 5, choices: {} }];
  const blocked = validateRcoaStep(3, draft, [item]);
  assert.ok(blocked[`quantity:${item.id}`], "step validation reports the quantity");
  draft.lines = [{ itemId: item.id, quantity: 10, choices: {} }];
  assert.equal(validateRcoaStep(3, draft, [item])[`quantity:${item.id}`], undefined);
});

test("10. every portal uses the shared quantity rules and no portal clamps while typing", () => {
  for (const file of ["../app/ui/RcoaBookingPortal.tsx", "../app/ui/BookingPortal.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /from "@\/lib\/quantity-entry"/, file);
    assert.doesNotMatch(source, /Math\.max\(\s*(rcoaMinimumQuantity\(item\)|minimum),\s*(Math\.floor\()?requested/, `${file} must not clamp to the minimum inside setQuantity`);
    assert.match(source, /onBlur=\{/, `${file} reports the minimum on blur`);
    assert.match(source, /quantityMinimumMessage\(/, file);
    assert.match(source, /stepQuantityDown\(/, file);
    assert.match(source, /stepQuantityUp\(/, file);
  }
});
