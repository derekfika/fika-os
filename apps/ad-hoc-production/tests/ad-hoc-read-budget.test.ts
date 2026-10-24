import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Ad Hoc discovery is service-date bounded and capped, never a collection scan", async () => {
  const service = await read("../lib/ad-hoc-service.ts");
  assert.match(service, /where\("serviceDate", ">=", from\)/);
  assert.match(service, /where\("serviceDate", "<", endExclusive\)/);
  assert.match(service, /limit\(200\)/);
  assert.match(service, /MAX_WINDOW_DAYS/);
});

test("Ad Hoc known requests use direct IDs and read diagnostics are opt-in", async () => {
  const service = await read("../lib/ad-hoc-service.ts");
  const diagnostics = await read("../lib/ad-hoc-read-budget.ts");
  assert.match(service, /collection\(\)\.doc\(stableDocumentId\(id\)\)\.get\(\)/);
  assert.match(service, /stage: "known_request_lookup"/);
  assert.match(diagnostics, /AD_HOC_PRODUCTION_READ_BUDGET/);
  assert.doesNotMatch(diagnostics, /db\.collection|\.set\(|\.add\(/);
});

test("Ad Hoc UI has no idle polling and loads only on window or selection change", async () => {
  for (const file of ["../app/overview.tsx", "../app/order-form.tsx", "../app/frame.tsx"]) assert.doesNotMatch(await read(file), /setInterval|setTimeout/);
  assert.match(await read("../app/overview.tsx"), /api\/requests\?from=/);
  assert.match(await read("../app/order-form.tsx"), /api\/requests\?id=/);
});

test("Ad Hoc UI never uses native browser dialogs and carries no quote or allergen-checker surface", async () => {
  for (const file of ["../app/overview.tsx", "../app/order-form.tsx", "../app/frame.tsx"]) {
    const source = await read(file);
    assert.doesNotMatch(source, /window\.(alert|confirm|prompt)|\b(alert|confirm|prompt)\(/);
    assert.doesNotMatch(source, />\s*(Quotes|Allergen Review)\s*</);
  }
});

test("Ad-Hoc never re-filters the Hub OPLOC list on lifecycle status (staging uses \"published\", and the Hub already returns only active, permitted OPLOCs)", async () => {
  for (const file of ["../app/order-form.tsx", "../app/overview.tsx", "../lib/destinations.ts", "../lib/hub-client.ts", "../app/api/oplocs/route.ts"]) assert.doesNotMatch(await read(file), /lifecycleStatus/, file);
});
