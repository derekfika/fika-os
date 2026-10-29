import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { DictionaryIntegrityError, createEnGbSpeller, decodeEnGbPayload, sha256Hex, verifyPackageBytes, type DictionaryMeta } from "../lib/dictionary/en-gb-payload";
import { findSpellingIssues, isDictionaryCandidate } from "../lib/menu-spellcheck";

const meta = JSON.parse(readFileSync(new URL("../dictionary/en-GB-3.0.0-culinary-1.meta.json", import.meta.url), "utf8")) as DictionaryMeta & { version: string };
const packageBytes = new Uint8Array(readFileSync(new URL(`../dictionary/${meta.version}.json.gz`, import.meta.url)));
const speller = createEnGbSpeller(decodeEnGbPayload(packageBytes, meta.version));
const flagged = (text: string) => findSpellingIssues(text, { speller }).map(item => item.word);

test("the packaged checksum and size match the committed metadata", async () => {
  assert.equal(packageBytes.byteLength, meta.byteLength);
  assert.equal(await sha256Hex(packageBytes), meta.sha256);
  await verifyPackageBytes(packageBytes, meta);
});

test("British spellings are accepted and the US forms are still corrected", () => {
  assert.deepEqual(flagged("colour, flavour, caramelised, centre, favourite, honour, grey, metre, litre, mould"), []);
  assert.deepEqual(findSpellingIssues("roasted color and flavor", { speller }).map(item => [item.word, item.suggestions[0]]), [["color", "colour"], ["flavor", "flavour"]]);
});

test("culinary and international vocabulary is not flagged", () => {
  assert.deepEqual(flagged("harissa, tahini, gochujang, crème brûlée, béchamel, velouté, jalapeño, pâtisserie, gnocchi, bruschetta, focaccia"), []);
  assert.deepEqual(flagged("tenderstem broccoli with aioli, paneer tikka masala and pak choi"), []);
});

test("a misspelling that was never in the old table is flagged with ranked UK suggestions", () => {
  const [recieve] = findSpellingIssues("Chicken with recieve sauce", { speller });
  assert.equal(recieve.word, "recieve");
  assert.equal(recieve.kind, "misspelling");
  assert.equal(recieve.suggestions[0], "receive");
  assert.ok(recieve.suggestions.length <= 5);
  assert.deepEqual(findSpellingIssues("seperate", { speller })[0].suggestions.slice(0, 1), ["separate"]);
  assert.deepEqual(findSpellingIssues("accomodate", { speller })[0].suggestions.slice(0, 1), ["accommodate"]);
});

test("source casing is preserved in suggestions", () => {
  assert.equal(findSpellingIssues("Recieve", { speller })[0].suggestions[0], "Receive");
  assert.equal(findSpellingIssues("RECIEVE", { speller })[0] ?? null, null, "all-caps acronyms are not judged");
});

test("apostrophes, possessives and accents stay in one token and are not flagged", () => {
  assert.deepEqual(flagged("Chef’s special, Chef's table and Mum's pie"), []);
  assert.deepEqual(flagged("Crème fraîche and jalapeño"), []);
});

test("acronyms, numbers and CamelCase are never judged by the dictionary", () => {
  assert.equal(isDictionaryCandidate("BBQ"), false);
  assert.equal(isDictionaryCandidate("iPhone"), false);
  assert.equal(isDictionaryCandidate("ab"), false);
  assert.equal(isDictionaryCandidate("chef's"), true, "a plain possessive is judged on its stem");
  assert.equal(isDictionaryCandidate("l'orange"), false, "other apostrophe forms are not judged");
  assert.deepEqual(flagged("BBQ 12 hour lamb"), []);
});

test("the known-correction layer still applies when no dictionary is loaded", () => {
  assert.deepEqual(findSpellingIssues("Tomatos").map(item => item.suggestions[0]), ["Tomatoes"]);
  assert.deepEqual(findSpellingIssues("recieve").length, 0, "without the speller unknown words are not guessed");
});

test("ignored and added words are not flagged even with the speller", () => {
  assert.equal(findSpellingIssues("recieve", { speller, ignored: new Set(["recieve"]) }).length, 0);
  assert.equal(findSpellingIssues("recieve", { speller, addedWords: new Set(["recieve"]) }).length, 0);
});

test("decoding rejects a wrong version, non-gzip bytes and a payload that does not match the expected shape", () => {
  assert.throws(() => decodeEnGbPayload(packageBytes, "en-GB-other"), DictionaryIntegrityError);
  assert.throws(() => decodeEnGbPayload(new Uint8Array([1, 2, 3]), meta.version), DictionaryIntegrityError);
  const notDictionary = new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ format: "other" }))));
  assert.throws(() => decodeEnGbPayload(notDictionary, meta.version), DictionaryIntegrityError);
});

test("an incomplete or altered download is refused before decompression", async () => {
  await assert.rejects(verifyPackageBytes(packageBytes.slice(0, packageBytes.length - 1), meta), DictionaryIntegrityError);
  const altered = packageBytes.slice();
  altered[altered.length - 5] ^= 0xff;
  await assert.rejects(verifyPackageBytes(altered, meta), DictionaryIntegrityError);
});
