import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailPath = new URL("../app/authmod/accounts/[id]/AccountDetail.tsx", import.meta.url);

test("account detail uses the shared package/IndexedDB-first options loader", async () => {
  const source = await readFile(detailPath, "utf8");
  assert.match(source, /import \{ loadAuthmodOptions \} from "\.\.\/\.\.\/\.\.\/ui\/authmod-options-cache"/);
  assert.match(source, /loadAuthmodOptions\(\)/);
  assert.doesNotMatch(source, /fetch\("\/api\/authmod\/options", \{ cache: "no-store" \}\)/);
});

test("shared options loader fetches the full reference package once per package version", async () => {
  const stores = new Map<string, Map<string, unknown>>();
  const store = (name: string) => { let value = stores.get(name); if (!value) { value = new Map(); stores.set(name, value); } return value; };
  const fakeIndexedDb = {
    open: (_name: string, _version: number) => {
      const request: any = {};
      setTimeout(() => { const database: any = { objectStoreNames: { contains: (name: string) => stores.has(name) }, createObjectStore: (name: string) => store(name), transaction: (name: string) => { const transaction: any = { objectStore: (storeName: string) => ({ get: (id: string) => { const result: any = {}; setTimeout(() => { result.result = store(storeName).get(id); result.onsuccess?.({ target: result }); transaction.oncomplete?.(); }, 0); return result; }, put: (value: any) => { const result: any = {}; setTimeout(() => { store(storeName).set(value.id, value); result.onsuccess?.(); transaction.oncomplete?.(); }, 0); return result; } }) }; return transaction; } }; request.result = database; request.onupgradeneeded?.(); request.onsuccess?.(); }, 0); return request;
    },
  };
  (globalThis as any).window = { location: { protocol: "https:", host: "uat.example" } };
  (globalThis as any).indexedDB = fakeIndexedDb;
  const calls: string[] = [];
  const options = { applications: [{ appId: "cpu-production", displayName: "CPU", standardActions: ["use"] }], oplocs: [{ id: "site-1", label: "Site 1" }], legends: [{ id: "legend-1", label: "Legend 1" }] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("manifest=1")) return new Response(JSON.stringify({ manifest: { packageVersion: 1 } }), { status: 200 });
    return new Response(JSON.stringify(options), { status: 200 });
  }) as typeof fetch;
  try {
    const { loadAuthmodOptions } = await import("../app/ui/authmod-options-cache");
    await loadAuthmodOptions();
    await loadAuthmodOptions();
    assert.equal(calls.filter(url => url === "/api/authmod/options").length, 1);
    assert.equal(calls.filter(url => url.includes("manifest=1")).length, 2);
    calls.length = 0;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("manifest=1")) return new Response(JSON.stringify({ manifest: { packageVersion: 2 } }), { status: 200 });
      return new Response(JSON.stringify({ ...options, applications: [] }), { status: 200 });
    }) as typeof fetch;
    await loadAuthmodOptions();
    assert.equal(calls.filter(url => url === "/api/authmod/options").length, 1);
  } finally { globalThis.fetch = originalFetch; delete (globalThis as any).indexedDB; delete (globalThis as any).window; }
});
