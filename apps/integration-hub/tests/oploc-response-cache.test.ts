import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearOplocResponseCache, getCachedOplocResponse } from "../lib/oploc-response-cache";

test.beforeEach(() => clearOplocResponseCache());

test("the OPLOC route uses the immutable package after server-side permission evaluation", () => {
  const source = readFileSync(new URL("../app/api/oplocs/route.ts", import.meta.url), "utf8");
  const packageSource = readFileSync(new URL("../lib/oploc-read-package.ts", import.meta.url), "utf8");
  assert.match(source, /assertPermission\(actor, "canonical\.view"\)/);
  assert.match(source, /getOplocReadPackage/);
  const reader = packageSource.slice(packageSource.indexOf("export async function getOplocReadPackage"));
  assert.doesNotMatch(reader, /rebuildOplocReadPackage/);
  assert.match(packageSource, /decodeReadPackage/);
  assert.match(packageSource, /OPLOC_DATASET = "integration-hub\/oplocs"/);
});

test("repeated identity-scoped OPLOC requests reuse the app cache", async () => {
  let physicalLoads = 0;
  const load = async () => { physicalLoads += 1; return { oplocs: [{ canonicalId: "oploc:one", label: "One" }] }; };
  await getCachedOplocResponse("person-1:viewer", 7, load, 1000);
  await getCachedOplocResponse("person-1:viewer", 7, load, 2000);
  assert.equal(physicalLoads, 1);
});

test("concurrent identical OPLOC requests deduplicate the physical load", async () => {
  let physicalLoads = 0;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const load = async () => { physicalLoads += 1; await wait; return { oplocs: [] }; };
  const first = getCachedOplocResponse("person-1:viewer", 7, load);
  const second = getCachedOplocResponse("person-1:viewer", 7, load);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(physicalLoads, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ oplocs: [] }, { oplocs: [] }]);
});

test("manifest changes force a fresh OPLOC load and identity scopes remain separate", async () => {
  let physicalLoads = 0;
  const load = async () => { physicalLoads += 1; return { oplocs: [] }; };
  await getCachedOplocResponse("person-1:viewer", 7, load);
  await getCachedOplocResponse("person-1:viewer", 8, load);
  await getCachedOplocResponse("person-2:viewer", 8, load);
  assert.equal(physicalLoads, 3);
});
