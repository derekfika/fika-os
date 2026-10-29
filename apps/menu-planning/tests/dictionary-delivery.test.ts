import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import meta from "../dictionary/en-GB-3.0.0-culinary-1.meta.json";
import { createDictionaryLoader, DICTIONARY_URL } from "../lib/dictionary/client";
import { dictionaryHandler } from "../lib/dictionary/response";
import { DictionaryIntegrityError, verifyPackageBytes } from "../lib/dictionary/en-gb-payload";

const bytes = new Uint8Array(readFileSync(new URL(`../dictionary/${meta.version}.json.gz`, import.meta.url)));

test("dictionary HTTP response preserves the exact compressed bytes for browser integrity verification", async () => {
  let reads = 0;
  const handler = dictionaryHandler(async () => { reads++; return bytes; });
  assert.equal((await handler(new Request("https://fixture.invalid/api/spellcheck/dictionary?version=other"))).status, 404);
  assert.equal(reads, 0);
  const response = await handler(new Request(`https://fixture.invalid${DICTIONARY_URL}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.match(response.headers.get("cache-control")!, /private.*immutable/);
  const received = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(received, bytes);
  await verifyPackageBytes(received, meta);
  const failure = await dictionaryHandler(async () => { throw Error("fixture missing file"); })(new Request(`https://fixture.invalid${DICTIONARY_URL}`));
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get("cache-control"), "no-store");
});

test("all cells share one dictionary load and receive a full UK speller", async () => {
  let calls = 0;
  const load = createDictionaryLoader(async (url, options) => {
    calls++;
    assert.equal(url, DICTIONARY_URL);
    assert.equal(options?.cache, "force-cache");
    return new Response(bytes.slice());
  });
  const first = load();
  assert.equal(load(), first);
  const [a, b] = await Promise.all([first, load()]);
  assert.equal(a, b);
  assert.equal(a.correct("colour"), true);
  assert.equal(a.correct("recieve"), false);
  assert.equal(a.suggest("recieve")[0], "receive");
  assert.equal(await load(), a);
  assert.equal(calls, 1);
});

test("corrupt dictionary downloads are rejected and explicit retry reloads before exposing a speller", async () => {
  let calls = 0;
  const load = createDictionaryLoader(async (_url, options) => {
    calls++;
    const candidate = bytes.slice();
    if (calls === 1) candidate[candidate.length - 5] ^= 0xff;
    else assert.equal(options?.cache, "reload");
    return new Response(candidate);
  });
  await assert.rejects(load(), DictionaryIntegrityError);
  const speller = await load(true);
  assert.equal(speller.correct("broccoli"), true);
  assert.equal(calls, 2);
});

test("denied dictionary reads remain unavailable rather than being decoded as a successful empty dictionary", async () => {
  const load = createDictionaryLoader(async () => Response.json({ error: "No authority" }, { status: 403 }));
  await assert.rejects(load(), /could not be loaded/);
});
