import test from "node:test";
import assert from "node:assert/strict";
import { findSpellingIssues, spellKey } from "../lib/menu-spellcheck";

test("flags the misspellings from the mockup with their UK suggestions and offsets", () => {
  const text = "Heritage Tabbouleh With Sicilion Lemon Oil, Heritage Tomatos";
  const findings = findSpellingIssues(text);
  assert.deepEqual(findings.map(item => [item.word, item.suggestions[0]]), [["Sicilion", "Sicilian"], ["Tomatos", "Tomatoes"]]);
  for (const finding of findings) assert.equal(text.slice(finding.start, finding.end), finding.word);
});

test("flags US spellings with UK forms and keeps the source casing", () => {
  const findings = findSpellingIssues("Roasted Caramelized onions, COLOR pepper and flavor");
  assert.deepEqual(findings.map(item => [item.word, item.suggestions[0], item.kind]), [
    ["Caramelized", "Caramelised", "us-spelling"],
    ["COLOR", "COLOUR", "us-spelling"],
    ["flavor", "flavour", "us-spelling"],
  ]);
});

test("does not flag culinary names, brands or unknown words", () => {
  const text = "Tenderstem broccoli with aioli, harissa, tahini, Sicilian lemon and Ottolenghi-style gnocchi";
  assert.deepEqual(findSpellingIssues(text), []);
});

test("ignored and dictionary words are never flagged again", () => {
  const text = "Tomatos and sicilion";
  assert.equal(findSpellingIssues(text, { ignored: new Set(["tomatos"]) }).length, 1);
  assert.equal(findSpellingIssues(text, { addedWords: new Set([spellKey("Sicilion")]) }).length, 1);
  assert.equal(findSpellingIssues(text, { ignored: new Set(["tomatos"]), addedWords: new Set(["sicilion"]) }).length, 0);
});

test("curly apostrophes match the same dictionary key", () => {
  assert.equal(spellKey("Chef’s"), "chef's");
  assert.equal(findSpellingIssues("Mayonaise").length, 1);
  assert.equal(findSpellingIssues("Mayonaise", { ignored: new Set([spellKey("Mayonaise")]) }).length, 0);
});

test("empty and punctuation-only text produce no findings", () => {
  assert.deepEqual(findSpellingIssues(""), []);
  assert.deepEqual(findSpellingIssues("  ,.; 123 -- "), []);
});
